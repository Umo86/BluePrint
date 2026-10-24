import 'server-only';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { editions, emailOutbox, emailSuppressions, unsubscribes } from '../db/schema';
import { emailProvider } from './provider';
import { senderFor } from './templates';

export type EmailCategory = 'transactional' | 'reminder' | 'campaign' | 'security';

export type SendEmailInput = {
  to: string;
  toUserId?: string | null;
  editionId?: string | null;
  companyId?: string | null;
  standId?: string | null;
  templateKey: string;
  category: EmailCategory;
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string | null;
  campaignId?: string | null;
  sentBy?: string | null;
  headers?: Record<string, string>;
  /** Queue it for the next batch instead of sending now (campaigns). */
  deferred?: boolean;
};

export type SendResult = { outboxId: string; status: 'sent' | 'failed' | 'suppressed' | 'queued' };

const PLAIN_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Sign-in codes and personal links (invitations, unsubscribe) are for the recipient only. Once an
 * email has gone, the copy BluePrint keeps has them hidden, and staff never see them in the log.
 */
export function hideSecrets(value: string, category: string): string {
  let out = value
    .replace(/(\/invite\/)[A-Za-z0-9_-]{16,}/g, '$1[hidden]')
    .replace(/(\/unsubscribe\/)[A-Za-z0-9_.-]{16,}/g, '$1[hidden]');
  if (category === 'security') out = out.replace(/\b\d{6}\b/g, '••••••');
  return out;
}

/**
 * Records every email in the outbox (so it shows on the exhibitor's record), then hands it to
 * the provider. Suppressed addresses (bounced or complained) are skipped, except for security
 * emails such as sign-in codes, which the person has just asked for.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const db = await getDb();
  const to = input.to.trim().toLowerCase();
  let from = input.from;
  let replyTo = input.replyTo ?? null;
  // Show emails come from the show's own sender (set in Show settings), unless a caller chose one.
  if (!from) {
    const sender = await senderFor(input.editionId ? ((await db.select().from(editions).where(eq(editions.id, input.editionId)).limit(1))[0] ?? null) : null, input.category);
    from = sender.from;
    replyTo = replyTo ?? sender.replyTo;
  }
  // Header values are always single lines, and a reply-to is a plain address or nothing.
  from = oneLine(from);
  replyTo = replyTo && PLAIN_ADDRESS.test(replyTo.trim()) ? replyTo.trim() : null;
  const subject = oneLine(input.subject).slice(0, 300);

  let suppressedReason: string | null = null;
  if (input.category !== 'security') {
    const [s] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, to)).limit(1);
    if (s) suppressedReason = `Address suppressed (${s.reason})`;
  }
  if (!suppressedReason && input.category === 'campaign') {
    const [u] = await db
      .select()
      .from(unsubscribes)
      .where(and(eq(unsubscribes.email, to), or(isNull(unsubscribes.editionId), eq(unsubscribes.editionId, input.editionId ?? '00000000-0000-0000-0000-000000000000'))))
      .limit(1);
    if (u) suppressedReason = 'Unsubscribed from campaigns';
  }

  const [row] = await db
    .insert(emailOutbox)
    .values({
      editionId: input.editionId ?? null,
      toEmail: to,
      toUserId: input.toUserId ?? null,
      companyId: input.companyId ?? null,
      standId: input.standId ?? null,
      templateKey: input.templateKey,
      category: input.category,
      fromAddress: from,
      replyTo,
      subject,
      html: input.html,
      text: input.text,
      status: suppressedReason ? 'suppressed' : 'queued',
      error: suppressedReason,
      campaignId: input.campaignId ?? null,
      sentBy: input.sentBy ?? null,
      headers: input.headers ?? null,
    })
    .returning({ id: emailOutbox.id });

  if (suppressedReason) return { outboxId: row.id, status: 'suppressed' };
  if (input.deferred) return { outboxId: row.id, status: 'queued' };
  return deliverOutboxEmail(row.id);
}

/** Sends one queued outbox email. Also used by the batch sender and the retry job. */
export async function deliverOutboxEmail(outboxId: string): Promise<SendResult> {
  const db = await getDb();
  const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId)).limit(1);
  if (!mail) throw new Error('Outbox email not found');
  if (mail.status !== 'queued' && mail.status !== 'failed') return { outboxId, status: mail.status === 'suppressed' ? 'suppressed' : 'sent' };
  // Claim the email first (the attempt counter only moves on for one worker), so two batch
  // senders running at once can never send the same email twice.
  const [claimed] = await db
    .update(emailOutbox)
    .set({ attempts: mail.attempts + 1 })
    .where(and(eq(emailOutbox.id, outboxId), eq(emailOutbox.attempts, mail.attempts), inArray(emailOutbox.status, ['queued', 'failed'])))
    .returning({ id: emailOutbox.id });
  if (!claimed) return { outboxId, status: 'sent' };
  try {
    const result = await emailProvider().send({
      from: mail.fromAddress,
      to: mail.toEmail,
      replyTo: mail.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers ?? undefined,
    });
    await db.update(emailOutbox).set({ status: 'sent', providerMessageId: result.id, sentAt: new Date(), error: null }).where(eq(emailOutbox.id, outboxId));
    // With real delivery the stored copy is only a record, so codes and personal links come out of it.
    // (Locally the stored copy is the mailbox, so it is kept whole.)
    if (emailProvider().name !== 'outbox') {
      const hidden = {
        subject: hideSecrets(mail.subject, mail.category),
        html: hideSecrets(mail.html, mail.category),
        text: hideSecrets(mail.text, mail.category),
        headers: mail.headers ? Object.fromEntries(Object.entries(mail.headers).map(([k, v]) => [k, hideSecrets(v, mail.category)])) : null,
      };
      await db.update(emailOutbox).set(hidden).where(eq(emailOutbox.id, outboxId));
    }
    return { outboxId, status: 'sent' };
  } catch (err) {
    await db
      .update(emailOutbox)
      .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 500) : 'Send failed' })
      .where(eq(emailOutbox.id, outboxId));
    return { outboxId, status: 'failed' };
  }
}
