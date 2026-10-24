import 'server-only';
import { randomUUID } from 'node:crypto';
import { env, localProductionAllowed } from '../env';

/**
 * Card payments and supplier payouts. In production this is Stripe Connect with separate charges
 * and transfers: Media10 takes the payment, then transfers each supplier's share to their own
 * Stripe account. Locally (no Stripe key) a simulator stands in so everything can be tried safely.
 */

export type CheckoutLine = { name: string; amountPence: number; quantity: number };

export type WebhookEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

export interface PaymentsProvider {
  kind: 'stripe' | 'simulator';
  createCheckout(input: {
    orderId: string;
    orderNumber: string;
    lines: CheckoutLine[];
    customerEmail: string | null;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string }>;
  /** Asks the payment provider directly whether a checkout was paid (the return page does this, so it never waits on a webhook). */
  checkoutStatus(sessionId: string): Promise<{ paid: boolean; open: boolean; paymentIntentId: string | null; amountTotal: number | null; currency: string | null; orderId: string | null }>;
  /** Closes an unpaid checkout so it can no longer be paid. Returns false if it was already paid. */
  expireCheckout(sessionId: string): Promise<boolean>;
  /** After payment: the charge to transfer from. */
  paymentDetails(paymentIntentId: string): Promise<{ chargeId: string | null }>;
  createTransfer(input: { amountPence: number; destination: string; transferGroup: string; sourceTransaction: string | null; idempotencyKey: string; description: string }): Promise<{ id: string }>;
  reverseTransfer(transferId: string, amountPence: number, idempotencyKey: string): Promise<{ id: string }>;
  refund(input: { paymentIntentId: string; amountPence: number; idempotencyKey: string; refundId: string }): Promise<{ id: string; status: 'succeeded' | 'pending' | 'failed' }>;
  createConnectedAccount(input: { email: string; businessName: string; idempotencyKey: string }): Promise<{ id: string }>;
  onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  dashboardLink(accountId: string): Promise<string | null>;
  accountStatus(accountId: string): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean }>;
  verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent>;
}

class StripeProvider implements PaymentsProvider {
  kind = 'stripe' as const;
  private clientPromise: Promise<import('stripe').default> | null = null;

  private async stripe() {
    if (!this.clientPromise) {
      this.clientPromise = import('stripe').then(({ default: Stripe }) => new Stripe(env().STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, timeout: 20_000 }));
    }
    return this.clientPromise;
  }

  async createCheckout(input: Parameters<PaymentsProvider['createCheckout']>[0]) {
    const s = await this.stripe();
    const session = await s.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: input.lines.map((l) => ({ quantity: l.quantity, price_data: { currency: 'gbp', unit_amount: l.amountPence, product_data: { name: l.name.slice(0, 250) } } })),
        customer_email: input.customerEmail ?? undefined,
        client_reference_id: input.orderId,
        metadata: { orderId: input.orderId, orderNumber: input.orderNumber },
        payment_intent_data: { transfer_group: input.orderId, metadata: { orderId: input.orderId, orderNumber: input.orderNumber }, description: `BluePrint order ${input.orderNumber}` },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      { idempotencyKey: `checkout-${input.orderId}` },
    );
    return { id: session.id, url: session.url! };
  }

  async checkoutStatus(sessionId: string) {
    const s = await this.stripe();
    const cs = await s.checkout.sessions.retrieve(sessionId);
    const pi = cs.payment_intent;
    return {
      paid: cs.payment_status === 'paid',
      open: cs.status === 'open',
      paymentIntentId: typeof pi === 'string' ? pi : (pi?.id ?? null),
      amountTotal: cs.amount_total,
      currency: cs.currency,
      orderId: cs.client_reference_id ?? null,
    };
  }

  async expireCheckout(sessionId: string) {
    const s = await this.stripe();
    const cs = await s.checkout.sessions.retrieve(sessionId);
    if (cs.status === 'complete' || cs.payment_status === 'paid') return false;
    if (cs.status === 'open') await s.checkout.sessions.expire(sessionId);
    return true;
  }

  async paymentDetails(paymentIntentId: string) {
    const s = await this.stripe();
    const pi = await s.paymentIntents.retrieve(paymentIntentId);
    const charge = pi.latest_charge;
    return { chargeId: typeof charge === 'string' ? charge : (charge?.id ?? null) };
  }

  async createTransfer(input: Parameters<PaymentsProvider['createTransfer']>[0]) {
    const s = await this.stripe();
    const t = await s.transfers.create(
      {
        amount: input.amountPence,
        currency: 'gbp',
        destination: input.destination,
        transfer_group: input.transferGroup,
        ...(input.sourceTransaction ? { source_transaction: input.sourceTransaction } : {}),
        description: input.description,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: t.id };
  }

  async reverseTransfer(transferId: string, amountPence: number, idempotencyKey: string) {
    const s = await this.stripe();
    const r = await s.transfers.createReversal(transferId, { amount: amountPence }, { idempotencyKey });
    return { id: r.id };
  }

  async refund(input: Parameters<PaymentsProvider['refund']>[0]) {
    const s = await this.stripe();
    const r = await s.refunds.create(
      { payment_intent: input.paymentIntentId, amount: input.amountPence, metadata: { blueprintRefundId: input.refundId } },
      { idempotencyKey: input.idempotencyKey },
    );
    const status = r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending';
    return { id: r.id, status: status as 'succeeded' | 'pending' | 'failed' };
  }

  async createConnectedAccount(input: { email: string; businessName: string; idempotencyKey: string }) {
    const s = await this.stripe();
    const a = await s.accounts.create(
      {
        type: 'express',
        country: 'GB',
        email: input.email,
        business_profile: { name: input.businessName },
        capabilities: { transfers: { requested: true } },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: a.id };
  }

  async onboardingLink(accountId: string, returnUrl: string, refreshUrl: string) {
    const s = await this.stripe();
    const link = await s.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
    return link.url;
  }

  async dashboardLink(accountId: string) {
    const s = await this.stripe();
    try {
      return (await s.accounts.createLoginLink(accountId)).url;
    } catch {
      return null;
    }
  }

  async accountStatus(accountId: string) {
    const s = await this.stripe();
    const a = await s.accounts.retrieve(accountId);
    return { chargesEnabled: Boolean(a.charges_enabled), payoutsEnabled: Boolean(a.payouts_enabled), detailsSubmitted: Boolean(a.details_submitted) };
  }

  async verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent> {
    const secrets = [env().STRIPE_WEBHOOK_SECRET, env().STRIPE_CONNECT_WEBHOOK_SECRET].filter((x): x is string => Boolean(x));
    if (!secrets.length || !signature) throw new Error('Webhook signature missing');
    const s = await this.stripe();
    let lastError: unknown = null;
    for (const secret of secrets) {
      try {
        // Checks the signature over the exact bytes Stripe sent, and refuses events older than five minutes.
        const event = await s.webhooks.constructEventAsync(rawBody, signature, secret, 300);
        return event as unknown as WebhookEvent;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Invalid webhook signature');
  }
}

/** Local stand-in for Stripe: never moves money, never leaves the machine. */
export class SimulatedPayments implements PaymentsProvider {
  kind = 'simulator' as const;
  calls: { method: string; args: unknown }[] = [];
  failTransfers = false;
  /** Checkouts the simulator has "paid", keyed by session id. */
  paidSessions = new Map<string, string>();

  async createCheckout(input: Parameters<PaymentsProvider['createCheckout']>[0]) {
    this.calls.push({ method: 'createCheckout', args: input });
    return { id: `sim_cs_${randomUUID()}`, url: `/shop/test-checkout/${input.orderId}` };
  }
  async checkoutStatus(sessionId: string) {
    const pi = this.paidSessions.get(sessionId) ?? null;
    return { paid: Boolean(pi), open: !pi, paymentIntentId: pi, amountTotal: null, currency: 'gbp', orderId: null };
  }
  async expireCheckout(sessionId: string) {
    this.calls.push({ method: 'expireCheckout', args: { sessionId } });
    return !this.paidSessions.has(sessionId);
  }
  async paymentDetails(paymentIntentId: string) {
    return { chargeId: `sim_ch_${paymentIntentId.slice(-12)}` };
  }
  async createTransfer(input: Parameters<PaymentsProvider['createTransfer']>[0]) {
    this.calls.push({ method: 'createTransfer', args: input });
    if (this.failTransfers) throw new Error('Simulated transfer failure');
    return { id: `sim_tr_${randomUUID()}` };
  }
  async reverseTransfer(transferId: string, amountPence: number) {
    this.calls.push({ method: 'reverseTransfer', args: { transferId, amountPence } });
    return { id: `sim_trr_${randomUUID()}` };
  }
  async refund(input: Parameters<PaymentsProvider['refund']>[0]) {
    this.calls.push({ method: 'refund', args: input });
    return { id: `sim_re_${randomUUID()}`, status: 'succeeded' as const };
  }
  async createConnectedAccount(input: { email: string; businessName: string; idempotencyKey: string }) {
    this.calls.push({ method: 'createConnectedAccount', args: input });
    return { id: `acct_sim${randomUUID().replace(/-/g, '').slice(0, 12)}` };
  }
  async onboardingLink(accountId: string) {
    return `/supplier/test-onboarding?account=${encodeURIComponent(accountId)}`;
  }
  async dashboardLink() {
    return null;
  }
  async accountStatus() {
    return { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };
  }
  async verifyWebhook(): Promise<WebhookEvent> {
    throw new Error('The simulator does not receive webhooks.');
  }
}

let instance: PaymentsProvider | null = null;
let override: PaymentsProvider | null = null;

/**
 * Real Stripe when a key is set. Without one, the simulator runs only on a developer's machine:
 * a production build uses it only when explicitly allowed AND the site address is localhost, so a
 * mis-configured live site can never take "payments" that are not real.
 */
export function payments(): PaymentsProvider | null {
  if (override) return override;
  if (instance) return instance;
  const e = env();
  if (e.STRIPE_SECRET_KEY) instance = new StripeProvider();
  else if (e.NODE_ENV !== 'production' || localProductionAllowed(e.APP_URL)) instance = new SimulatedPayments();
  return instance;
}

export { isLocalAddress } from '@/lib/local-address';

export function setPaymentsForTests(p: PaymentsProvider | null) {
  override = p;
}

/** For tests only: forget the provider chosen from the environment. */
export function resetPaymentsForTests() {
  instance = null;
}
