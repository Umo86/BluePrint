import 'server-only';
import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cronRuns, emailOutbox, loginCodes, sessions, stripeEvents } from '../db/schema';
import { deliverOutboxEmail } from '../email/send';
import { purgeOldRateLimits } from '../security/rate-limit';
import { getPlatformSettings } from './settings';
import { purgeAbandonedUploads } from './files';
import { expireStaleOrders, processTransfers } from './orders';

const DAY = 86_400_000;

/**
 * Sends emails waiting in the outbox (campaigns are queued, then sent in batches here) and
 * retries ones that failed, a few times, with a gap between attempts.
 */
export async function sendQueuedEmails(opts: { limit?: number; now?: Date } = {}) {
  const db = await getDb();
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 300;
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      or(
        eq(emailOutbox.status, 'queued'),
        // Failed sends are retried up to three times, at least 15 minutes apart.
        and(eq(emailOutbox.status, 'failed'), lt(emailOutbox.attempts, 3), lt(emailOutbox.createdAt, new Date(now.getTime() - 15 * 60 * 1000))),
      ),
    )
    .orderBy(emailOutbox.createdAt)
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await deliverOutboxEmail(r.id);
    if (res.status === 'sent') sent += 1;
    else failed += 1;
  }
  return { attempted: rows.length, sent, failed };
}

/**
 * Daily tidy-up: releases abandoned checkouts, sends supplier payouts that were waiting, removes
 * expired sign-in records and unfinished uploads, and deletes logs past the retention periods
 * set in Platform settings.
 */
export async function runHousekeeping(now = new Date()) {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const checkouts = await expireStaleOrders();
  const payouts = await processTransfers({});
  const uploads = await purgeAbandonedUploads();
  await purgeOldRateLimits();
  const oldSessions = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, new Date(now.getTime() - DAY)), and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, new Date(now.getTime() - 30 * DAY)))))
    .returning({ id: sessions.id });
  const oldCodes = await db.delete(loginCodes).where(lt(loginCodes.createdAt, new Date(now.getTime() - DAY))).returning({ id: loginCodes.id });
  const emailCutoff = new Date(now.getTime() - settings.retention.emailLogMonths * 30 * DAY);
  const oldEmails = await db
    .delete(emailOutbox)
    .where(and(lt(emailOutbox.createdAt, emailCutoff), inArray(emailOutbox.status, ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'suppressed'])))
    .returning({ id: emailOutbox.id });
  const oldEvents = await db.delete(stripeEvents).where(and(isNotNull(stripeEvents.processedAt), lt(stripeEvents.receivedAt, new Date(now.getTime() - 90 * DAY)))).returning({ id: stripeEvents.id });
  const oldRuns = await db.delete(cronRuns).where(lt(cronRuns.startedAt, new Date(now.getTime() - 90 * DAY))).returning({ id: cronRuns.id });
  const { purgeOldConversations } = await import('../assistant');
  const oldChats = await purgeOldConversations(settings.retention.assistantMonths);
  return {
    checkoutsReleased: checkouts.cancelled,
    payoutsSent: payouts.sent,
    uploadsRemoved: uploads.removed,
    sessionsRemoved: oldSessions.length,
    codesRemoved: oldCodes.length,
    emailLogsRemoved: oldEmails.length,
    stripeEventsRemoved: oldEvents.length,
    cronRunsRemoved: oldRuns.length,
    assistantConversationsRemoved: oldChats,
  };
}
