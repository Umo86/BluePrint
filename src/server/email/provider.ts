import 'server-only';
import { randomUUID } from 'node:crypto';
import { emailMode, env } from '../env';

export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

/** Sends through Resend from the show's verified sending subdomain (SPF, DKIM and DMARC set up). */
class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(private apiKey: string) {}

  async send(email: OutgoingEmail) {
    const { Resend } = await import('resend');
    const client = new Resend(this.apiKey);
    const { data, error } = await client.emails.send({
      from: email.from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo ?? undefined,
      headers: email.headers,
    });
    if (error || !data) throw new Error(`Resend rejected the email: ${error?.message ?? 'unknown error'}`);
    return { id: data.id };
  }
}

/** Local development and tests: the email is stored in the outbox and shown in the dev mailbox only. */
class OutboxOnlyProvider implements EmailProvider {
  readonly name = 'outbox';
  async send() {
    return { id: `local_${randomUUID()}` };
  }
}

export const EMAIL_OFF_REASON = 'Not sent: email sending is not set up yet';

/** A live site with no Resend key yet: nothing is sent (sendEmail records these as not sent). */
class NotSetUpProvider implements EmailProvider {
  readonly name = 'off';
  async send(): Promise<{ id: string }> {
    throw new Error(EMAIL_OFF_REASON);
  }
}

let override: EmailProvider | null = null;

/** Tests can swap in a fake provider. */
export function setEmailProviderForTests(p: EmailProvider | null) {
  override = p;
}

export function emailProvider(): EmailProvider {
  if (override) return override;
  const mode = emailMode();
  if (mode === 'resend') return new ResendProvider(env().RESEND_API_KEY!);
  if (mode === 'outbox') return new OutboxOnlyProvider();
  return new NotSetUpProvider();
}
