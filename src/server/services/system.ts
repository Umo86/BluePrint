import 'server-only';
import { and, count, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cronRuns, emailOutbox, emailSuppressions, stripeEvents } from '../db/schema';
import { assertSuperAdmin } from '../authz';
import { audit } from '../audit';
import { emailMode, env, storageMode, twoFactorOn } from '../env';
import { getPlatformSettings } from './settings';
import { DEMO_ADDRESS_REASON, DEMO_SHOW_REASON, deliverOutboxEmail } from '../email/send';
import { EMAIL_OFF_REASON } from '../email/provider';
import type { Actor } from '../auth/actor';

export async function systemStatus(actor: Actor) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const emailByStatus = await db
    .select({ status: emailOutbox.status, n: count() })
    .from(emailOutbox)
    .where(gte(emailOutbox.createdAt, since))
    .groupBy(emailOutbox.status);
  // Emails held back, by why: the demo shows never send, nothing is sent while email is not set up,
  // and the rest went to blocked or unsubscribed addresses.
  const held = await db
    .select({ reason: emailOutbox.error, n: count() })
    .from(emailOutbox)
    .where(and(gte(emailOutbox.createdAt, since), eq(emailOutbox.status, 'suppressed')))
    .groupBy(emailOutbox.error);
  const notSent = { demo: 0, emailOff: 0, blocked: 0 };
  for (const h of held) {
    const n = Number(h.n);
    if (h.reason === DEMO_ADDRESS_REASON || h.reason === DEMO_SHOW_REASON) notSent.demo += n;
    else if (h.reason === EMAIL_OFF_REASON) notSent.emailOff += n;
    else notSent.blocked += n;
  }
  const failed = await db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.status, 'failed'))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(50);
  const suppressions = await db.select().from(emailSuppressions).orderBy(desc(emailSuppressions.createdAt)).limit(200);
  const jobs = await db.select().from(cronRuns).orderBy(desc(cronRuns.startedAt)).limit(30);
  const webhookErrors = await db
    .select()
    .from(stripeEvents)
    .where(isNotNull(stripeEvents.error))
    .orderBy(desc(stripeEvents.receivedAt))
    .limit(30);
  const e = env();
  const invoicing = (await getPlatformSettings()).invoicing;
  const config = {
    database: e.DATABASE_URL ? 'Postgres (Neon)' : 'Local PGlite',
    email: { resend: 'Resend (key set)', outbox: 'Local outbox only', off: 'Not set up: emails are recorded but not sent' }[emailMode()],
    emailWebhooks: e.RESEND_WEBHOOK_SECRET ? 'Signed webhooks on' : 'Not set up',
    storage: { r2: 'Cloudflare R2', local: 'Local disk', off: 'Not set up: uploads are switched off' }[storageMode()],
    payments: e.STRIPE_SECRET_KEY ? (e.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'Stripe (live)' : 'Stripe (test mode)') : 'Not connected',
    paymentWebhooks: e.STRIPE_WEBHOOK_SECRET ? 'Signed webhooks on' : 'Not set up',
    assistant: e.ANTHROPIC_API_KEY ? 'Claude (key set)' : e.NODE_ENV === 'production' ? 'Not set up (no Claude API key)' : 'Practice mode (no Claude API key)',
    cron: e.CRON_SECRET ? 'Protected' : 'Secret missing',
    encryptionKey: e.APP_ENCRYPTION_KEY ? 'Set' : 'Development key in use',
    twoFactor: twoFactorOn() ? 'Required for staff' : 'Switched off: staff sign in without a second step (TWO_FACTOR=off)',
    invoiceDetails: invoicing.legalName && invoicing.address ? 'Set' : 'Not set up: add your company name and address in Platform settings',
  };
  return {
    emailByStatus: Object.fromEntries(emailByStatus.map((r) => [r.status, Number(r.n)])),
    notSent,
    failed,
    suppressions,
    jobs,
    webhookErrors,
    config,
  };
}

export async function retryFailedEmails(actor: Actor, ids?: string[]) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(ids?.length ? and(eq(emailOutbox.status, 'failed'), inArray(emailOutbox.id, ids)) : and(eq(emailOutbox.status, 'failed'), lt(emailOutbox.attempts, 10)))
    .limit(200);
  let sent = 0;
  for (const r of rows) {
    const res = await deliverOutboxEmail(r.id);
    if (res.status === 'sent') sent++;
  }
  await audit(actor, 'email.retry_failed', { details: { attempted: rows.length, sent } });
  return { attempted: rows.length, sent };
}

export async function removeSuppression(actor: Actor, email: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.delete(emailSuppressions).where(eq(emailSuppressions.email, email.toLowerCase()));
  await audit(actor, 'email.suppression_removed', { details: { email } });
}

export async function recordCronRun<T extends Record<string, unknown>>(job: string, fn: () => Promise<T>) {
  const db = await getDb();
  const [run] = await db.insert(cronRuns).values({ job }).returning();
  try {
    const details = await fn();
    await db.update(cronRuns).set({ status: 'ok', finishedAt: new Date(), details }).where(eq(cronRuns.id, run.id));
    return details;
  } catch (err) {
    await db
      .update(cronRuns)
      .set({ status: 'error', finishedAt: new Date(), details: { error: err instanceof Error ? err.message : String(err) } })
      .where(eq(cronRuns.id, run.id));
    throw err;
  }
}

export async function lastCronRuns() {
  const db = await getDb();
  return db
    .select({ job: cronRuns.job, last: sql<Date>`max(${cronRuns.startedAt})` })
    .from(cronRuns)
    .groupBy(cronRuns.job);
}
