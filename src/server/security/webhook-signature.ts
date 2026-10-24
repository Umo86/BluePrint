import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a webhook signed with the Standard Webhooks scheme (used by Resend, via Svix):
 * HMAC-SHA256 over `${id}.${timestamp}.${body}` with the endpoint's secret (`whsec_` + base64).
 * Refuses anything older or newer than five minutes so a captured request cannot be replayed.
 */
export function verifyStandardWebhook(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  const { id, timestamp, signature, body } = input;
  if (!id || !timestamp || !signature || !input.secret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > (input.toleranceSeconds ?? 300)) return false;
  const key = Buffer.from(input.secret.replace(/^whsec_/, ''), 'base64');
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  // The header can carry several space-separated signatures (during secret rotation).
  for (const part of signature.split(' ')) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) continue;
    let given: Buffer;
    try {
      given = Buffer.from(value, 'base64');
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}
