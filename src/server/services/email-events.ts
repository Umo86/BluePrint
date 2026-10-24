import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { emailEvents, emailOutbox, emailSuppressions, type EmailStatus } from '../db/schema';
import { audit } from '../audit';
import { SYSTEM_ACTOR } from '../auth/actor';

/** How far along an email is; a later event never moves it backwards (an open after a click stays "clicked"). */
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, failed: 5, suppressed: 5, bounced: 6, complained: 7 };

const TYPE_TO_STATUS: Record<string, EmailStatus | null> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': null,
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

export type ResendEvent = { type?: string; created_at?: string; data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string } } };

/**
 * Applies one verified Resend delivery event: updates the email's status on the exhibitor's
 * record, and stops sending to addresses that hard-bounce or mark email as spam.
 */
export async function handleResendEvent(eventId: string, event: ResendEvent) {
  const db = await getDb();
  const type = String(event.type ?? '');
  if (!(type in TYPE_TO_STATUS)) return { ignored: true };
  const providerId = event.data?.email_id;
  if (!providerId) return { ignored: true };
  const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.providerMessageId, providerId)).limit(1);
  if (!mail) return { ignored: true };
  const [fresh] = await db
    .insert(emailEvents)
    .values({ outboxId: mail.id, type: type.replace('email.', ''), providerEventId: eventId, at: event.created_at ? new Date(event.created_at) : new Date() })
    .onConflictDoNothing()
    .returning({ id: emailEvents.id });
  if (!fresh) return { duplicate: true };
  const status = TYPE_TO_STATUS[type];
  if (status && (RANK[status] ?? 0) > (RANK[mail.status] ?? 0)) {
    await db.update(emailOutbox).set({ status, lastEventAt: new Date() }).where(eq(emailOutbox.id, mail.id));
  } else {
    await db.update(emailOutbox).set({ lastEventAt: new Date() }).where(eq(emailOutbox.id, mail.id));
  }
  // Hard bounces and spam complaints: stop emailing that address (sign-in codes still go).
  const permanent = type === 'email.bounced' && (event.data?.bounce?.type ?? 'Permanent').toLowerCase() !== 'transient';
  if (permanent || type === 'email.complained') {
    await db
      .insert(emailSuppressions)
      .values({ email: mail.toEmail, reason: type === 'email.complained' ? 'complained' : 'bounced' })
      .onConflictDoNothing();
    await audit(SYSTEM_ACTOR, type === 'email.complained' ? 'email.complaint' : 'email.bounce', { entityType: 'email', entityId: mail.id, editionId: mail.editionId, companyId: mail.companyId, details: { to: mail.toEmail } });
  }
  return { updated: true };
}
