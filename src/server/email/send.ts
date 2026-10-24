import 'server-only';
import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '../db/client';
import { emailOutbox, emailSuppressions, unsubscribes } from '../db/schema';
import { env } from '../env';
import { emailProvider } from './provider';

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
};

export type SendResult = { outboxId: string; status: 'sent' | 'failed' | 'suppressed' };

/**
 * Records every email in the outbox (so it shows on the exhibitor's record), then hands it to
 * the provider. Suppressed addresses (bounced or complained) are skipped, except for security
 * emails such as sign-in codes, which the person has just asked for.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const db = await getDb();
  const to = input.to.trim().toLowerCase();
  const from = input.from ?? env().EMAIL_DEFAULT_FROM;

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
      replyTo: input.replyTo ?? null,
      subject: input.subject,
      html: input.html,
      text: input.text,
      status: suppressedReason ? 'suppressed' : 'queued',
      error: suppressedReason,
      campaignId: input.campaignId ?? null,
      sentBy: input.sentBy ?? null,
    })
    .returning({ id: emailOutbox.id });

  if (suppressedReason) return { outboxId: row.id, status: 'suppressed' };
  return deliverOutboxEmail(row.id, input.headers);
}

/** Sends one queued outbox email. Also used by the retry job. */
export async function deliverOutboxEmail(outboxId: string, headers?: Record<string, string>): Promise<SendResult> {
  const db = await getDb();
  const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId)).limit(1);
  if (!mail) throw new Error('Outbox email not found');
  try {
    const result = await emailProvider().send({
      from: mail.fromAddress,
      to: mail.toEmail,
      replyTo: mail.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers,
    });
    await db
      .update(emailOutbox)
      .set({ status: 'sent', providerMessageId: result.id, sentAt: new Date(), attempts: mail.attempts + 1, error: null })
      .where(eq(emailOutbox.id, outboxId));
    return { outboxId, status: 'sent' };
  } catch (err) {
    await db
      .update(emailOutbox)
      .set({ status: 'failed', attempts: mail.attempts + 1, error: err instanceof Error ? err.message.slice(0, 500) : 'Send failed' })
      .where(eq(emailOutbox.id, outboxId));
    return { outboxId, status: 'failed' };
  }
}
