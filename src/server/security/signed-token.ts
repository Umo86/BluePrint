import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env, localProductionAllowed } from '../env';

/**
 * Small tamper-proof tokens for links in emails (such as "unsubscribe"), so the link works
 * without signing in but cannot be forged or edited to act on someone else's address.
 * The key is derived from APP_ENCRYPTION_KEY with a purpose label, so tokens for one purpose
 * are never valid for another.
 */
function deriveKey(purpose: string, root: string) {
  return createHash('sha256').update(`blueprint-signed-token:${purpose}:${root}`).digest();
}

function key(purpose: string) {
  const e = env();
  if (!e.APP_ENCRYPTION_KEY && e.NODE_ENV === 'production' && !localProductionAllowed(e.APP_URL)) {
    throw new Error('APP_ENCRYPTION_KEY is required in production');
  }
  return deriveKey(purpose, e.APP_ENCRYPTION_KEY ?? 'blueprint-local-development-key');
}

/** Keys a token may have been signed with: the current key, and the previous one while the key is being changed. */
function verificationKeys(purpose: string) {
  const previous = env().APP_ENCRYPTION_KEY_PREVIOUS;
  return previous ? [key(purpose), deriveKey(purpose, previous)] : [key(purpose)];
}

export function signToken(purpose: string, data: Record<string, string>) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig = createHmac('sha256', key(purpose)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(purpose: string, token: string): Record<string, string> | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const valid = verificationKeys(purpose).some((k) => {
    const expected = createHmac('sha256', k).update(payload).digest();
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, string>) : null;
  } catch {
    return null;
  }
}
