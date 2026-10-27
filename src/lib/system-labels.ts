/** Names for the connections on the System page and the set-up notice on the super admin overview. */
export const CONFIG_LABELS: Record<string, string> = {
  database: 'Database',
  email: 'Email sending',
  emailWebhooks: 'Email delivery events',
  storage: 'File storage',
  payments: 'Payments',
  paymentWebhooks: 'Payment events',
  assistant: 'Assistant',
  cron: 'Scheduled jobs',
  encryptionKey: 'Encryption key',
  twoFactor: 'Two-factor sign-in',
  invoiceDetails: 'Invoice details',
};

/** What each count in a scheduled job's result means, as [one, many]. Counts not listed here are not shown. */
const JOB_RESULT_LABELS: Record<string, [string, string]> = {
  sent: ['email sent', 'emails sent'],
  failed: ['email failed', 'emails failed'],
  campaignsQueued: ['scheduled email started', 'scheduled emails started'],
  emails: ['reminder email', 'reminder emails'],
  stands: ['stand reminded', 'stands reminded'],
  staffDigests: ['team summary sent', 'team summaries sent'],
  checkoutsReleased: ['unpaid checkout released', 'unpaid checkouts released'],
  payoutsSent: ['supplier payout sent', 'supplier payouts sent'],
  uploadsRemoved: ['unfinished upload removed', 'unfinished uploads removed'],
  orderFilesRemoved: ['unused order file removed', 'unused order files removed'],
  sessionsRemoved: ['expired sign-in removed', 'expired sign-ins removed'],
  codesRemoved: ['old sign-in code removed', 'old sign-in codes removed'],
  emailLogsRemoved: ['old email record removed', 'old email records removed'],
  stripeEventsRemoved: ['old payment event removed', 'old payment events removed'],
  cronRunsRemoved: ['old job record removed', 'old job records removed'],
  assistantConversationsRemoved: ['old assistant conversation removed', 'old assistant conversations removed'],
};

/** A scheduled job's result in a sentence, such as "3 emails sent, 1 email failed". */
export function jobResultText(status: string, details: Record<string, unknown> | null | undefined): string {
  const d = details ?? {};
  if (status === 'running') return 'Still running';
  if (status === 'error') return typeof d.error === 'string' && d.error ? d.error : 'It stopped with an error.';
  const parts = Object.entries(JOB_RESULT_LABELS).flatMap(([key, [one, many]]) => {
    const n = Number(d[key]);
    return Number.isFinite(n) && n > 0 ? [`${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`] : [];
  });
  const problems = Array.isArray(d.campaignProblems) ? d.campaignProblems.filter((p): p is string => typeof p === 'string') : [];
  if (problems.length) parts.push(`problems: ${problems.join('; ')}`);
  return parts.length ? parts.join(', ') : 'Nothing to do';
}
