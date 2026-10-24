import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { verifyStandardWebhook } from '@/server/security/webhook-signature';
import { handleResendEvent, type ResendEvent } from '@/server/services/email-events';

/** Delivery events from Resend (delivered, opened, bounced...). Every request must carry a valid signature. */
export async function POST(req: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  const body = await req.text();
  if (body.length > 256_000) return new NextResponse(null, { status: 413 });
  const id = req.headers.get('svix-id') ?? req.headers.get('webhook-id');
  const ok = verifyStandardWebhook({
    secret,
    id,
    timestamp: req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp'),
    signature: req.headers.get('svix-signature') ?? req.headers.get('webhook-signature'),
    body,
  });
  if (!ok || !id) return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }
  try {
    const result = await handleResendEvent(id, event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    console.error('Resend webhook failed', err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
