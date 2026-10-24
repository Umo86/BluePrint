import 'server-only';
import { and, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { rateLimits } from '../db/schema';

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/**
 * Fixed-window rate limiting stored in Postgres, so it works across serverless instances.
 * Each call counts `cost` attempts (one by default) against `key` within the current window.
 */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number, cost = 1): Promise<RateLimitResult> {
  const db = await getDb();
  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000;
  const windowStart = new Date(windowStartMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: cost })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + ${cost}` } })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowSeconds * 1000 - nowMs) / 1000));
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds };
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Too many attempts. Please wait a few minutes and try again.');
  }
}

export async function assertRateLimit(key: string, limit: number, windowSeconds: number, cost = 1) {
  const r = await consumeRateLimit(key, limit, windowSeconds, cost);
  if (!r.allowed) throw new RateLimitedError(r.retryAfterSeconds);
}

/** Housekeeping: drop windows older than a day. Called by the daily cron. */
export async function purgeOldRateLimits() {
  const db = await getDb();
  await db.delete(rateLimits).where(and(lt(rateLimits.windowStart, new Date(Date.now() - 24 * 3600 * 1000))));
}
