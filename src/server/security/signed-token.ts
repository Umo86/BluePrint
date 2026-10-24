import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

/**
 * Small tamper-proof tokens for links in emails (such as "unsubscribe"), so the link works
 * without signing in but cannot be forged or edited to act on someone else's address.
 * The key is derived from APP_ENCRYPTION_KEY with a purpose label, so tokens for one purpose
 * are never valid for another.
 */
function key(purpose: string) {
  const root = env().APP_ENCRYPTION_KEY ?? 'blueprint-local-development-key';
  return createHash('sha256').update(`blueprint-signed-token:${purpose}:${root}`).digest();
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
  const expected = createHmac('sha256', key(purpose)).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, string>) : null;
  } catch {
    return null;
  }
}
