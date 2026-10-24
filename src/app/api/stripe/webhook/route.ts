import { NextResponse } from 'next/server';
import { payments } from '@/server/payments/provider';
import { handleStripeEvent } from '@/server/services/orders';

/**
 * Stripe webhook. Every request must carry a valid Stripe signature over its exact body; anything
 * else is refused before it is read further. Events are applied once (see handleStripeEvent).
 */
export async function POST(req: Request) {
  const p = payments();
  if (!p || p.kind !== 'stripe') return new NextResponse(null, { status: 404 });
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > 1_000_000) return new NextResponse(null, { status: 413 });
  const body = await req.text();
  if (body.length > 1_000_000) return new NextResponse(null, { status: 413 });
  let event;
  try {
    event = await p.verifyWebhook(body, req.headers.get('stripe-signature'));
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch (err) {
    console.error('Stripe webhook failed', event.type, event.id, err);
    // A 500 makes Stripe retry later; the event is only marked processed once it succeeds.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
