import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env, localProductionAllowed } from '../env';

/** URL-safe random token with `bytes` bytes of entropy (32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison (both sides hashed first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** A numeric one-time code such as 042913. */
export function numericCode(digits = 6): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += String(randomInt(0, 10));
  return out;
}

// ---------------------------------------------------------------------------
// Authenticated encryption for secrets stored in the database (AES-256-GCM)
// ---------------------------------------------------------------------------

const DEV_KEY = createHash('sha256').update('blueprint-local-development-key').digest();

function keyFrom(raw: string, name: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded`);
  return key;
}

function encryptionKey(): Buffer {
  const raw = env().APP_ENCRYPTION_KEY;
  if (!raw) {
    if (env().NODE_ENV === 'production' && !localProductionAllowed()) {
      throw new Error('APP_ENCRYPTION_KEY is required in production');
    }
    return DEV_KEY;
  }
  return keyFrom(raw, 'APP_ENCRYPTION_KEY');
}

/** While the key is being changed, the old key can still open secrets written before the change. */
function previousKey(): Buffer | null {
  const raw = env().APP_ENCRYPTION_KEY_PREVIOUS;
  return raw ? keyFrom(raw, 'APP_ENCRYPTION_KEY_PREVIOUS') : null;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

function decryptWith(key: Buffer, payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || dataB64 === undefined) throw new Error('Unrecognised secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
  return dec.toString('utf8');
}

export function decryptSecret(payload: string): string {
  try {
    return decryptWith(encryptionKey(), payload);
  } catch (err) {
    const previous = previousKey();
    if (!previous) throw err;
    return decryptWith(previous, payload);
  }
}

/**
 * For changing the key: returns the secret re-encrypted under the current key if it was written with
 * the previous one, or null if it is already on the current key. Throws if neither key opens it.
 */
export function reencryptSecret(payload: string): string | null {
  try {
    decryptWith(encryptionKey(), payload);
    return null;
  } catch {
    const previous = previousKey();
    if (!previous) throw new Error('This secret was not written with the current key, and no previous key is set.');
    return encryptSecret(decryptWith(previous, payload));
  }
}
