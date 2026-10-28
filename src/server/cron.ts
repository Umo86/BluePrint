import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from './db/client';
import { cronRuns } from './db/schema';
import { recordCronRun } from './services/system';
import { runReminders, runStaffDigest } from './services/reminders';
import { runHousekeeping, sendQueuedEmails } from './services/housekeeping';
import { processScheduledCampaigns } from './services/campaigns';
import { runBasketReminders } from './services/baskets';

/** Scheduled jobs. Vercel Cron calls /api/cron/<job> on the schedules in vercel.json. */
export const CRON_JOBS = {
  /** Every 10 minutes: queued campaign emails and retries. */
  'send-queue': async () => {
    const campaigns = await processScheduledCampaigns();
    const emails = await sendQueuedEmails();
    return { ...emails, campaignsQueued: campaigns.campaigns, campaignProblems: campaigns.problems };
  },
  /** Every morning: exhibitor reminders, basket reminders and the team's summary. */
  reminders: async () => {
    const reminders = await runReminders();
    const baskets = await runBasketReminders();
    const digest = await runStaffDigest();
    return { ...reminders, basketsReminded: baskets.stands, staffDigests: digest.sent };
  },
  /** Every night: abandoned checkouts, waiting payouts, expired records and retention. */
  housekeeping: async () => runHousekeeping(),
} satisfies Record<string, () => Promise<Record<string, unknown>>>;

export type CronJob = keyof typeof CRON_JOBS;

export function isCronJob(name: string): name is CronJob {
  return Object.prototype.hasOwnProperty.call(CRON_JOBS, name);
}

/** Runs a job unless the same job is already running (started in the last 15 minutes and not finished). */
export async function runCronJob(job: CronJob) {
  const db = await getDb();
  const [running] = await db
    .select({ id: cronRuns.id })
    .from(cronRuns)
    .where(and(eq(cronRuns.job, job), eq(cronRuns.status, 'running'), gt(cronRuns.startedAt, new Date(Date.now() - 15 * 60 * 1000))))
    .limit(1);
  if (running) return { skipped: 'already running' };
  return recordCronRun(job, CRON_JOBS[job] as () => Promise<Record<string, unknown>>);
}
