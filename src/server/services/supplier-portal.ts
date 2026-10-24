import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { orderLines, orders, supplierTransfers, suppliers } from '../db/schema';
import { requireSupplierMember } from '../authz';
import { conflict, notFound } from '../errors';
import { audit } from '../audit';
import { appUrl } from '../auth/login';
import { payments, SimulatedPayments } from '../payments/provider';
import { processTransfers } from './orders';
import { supplierCategories } from './catalogue';
import type { Actor } from '../auth/actor';

/** The supplier portal home: Stripe set-up, what needs doing and what they are owed. */
export async function supplierOverview(actor: Actor, supplierId: string) {
  await requireSupplierMember(actor, supplierId);
  const db = await getDb();
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier) throw notFound();
  const [lines] = await db
    .select({
      newLines: sql<number>`count(*) filter (where ${orderLines.fulfilmentStatus} = 'received')::int`,
      confirmed: sql<number>`count(*) filter (where ${orderLines.fulfilmentStatus} = 'confirmed')::int`,
      delivered: sql<number>`count(*) filter (where ${orderLines.fulfilmentStatus} = 'delivered')::int`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orderLines.supplierId, supplierId), inArray(orders.status, ['paid', 'invoiced', 'partially_refunded'])));
  const [money] = await db
    .select({
      paidOut: sql<number>`coalesce(sum(${supplierTransfers.amountPence} - ${supplierTransfers.reversedPence}) filter (where ${supplierTransfers.status} in ('created','partially_reversed')), 0)::bigint`,
      waiting: sql<number>`coalesce(sum(${supplierTransfers.amountPence}) filter (where ${supplierTransfers.status} in ('pending','failed')), 0)::bigint`,
      manualOwed: sql<number>`coalesce(sum(${supplierTransfers.amountPence} - ${supplierTransfers.reversedPence}) filter (where ${supplierTransfers.status} = 'manual' and ${supplierTransfers.settledAt} is null), 0)::bigint`,
    })
    .from(supplierTransfers)
    .where(eq(supplierTransfers.supplierId, supplierId));
  const categories = await supplierCategories(actor, supplierId);
  return {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      website: supplier.website,
      status: supplier.status,
      stripe: { connected: Boolean(supplier.stripeAccountId), detailsSubmitted: supplier.stripeDetailsSubmitted, payoutsEnabled: supplier.stripePayoutsEnabled },
    },
    counts: { newLines: Number(lines.newLines), confirmed: Number(lines.confirmed), delivered: Number(lines.delivered) },
    money: { paidOutPence: Number(money.paidOut), waitingPence: Number(money.waiting), manualOwedPence: Number(money.manualOwed) },
    categories,
    paymentsMode: payments()?.kind ?? null,
  };
}

/** Starts (or continues) the supplier's Stripe set-up and returns the Stripe page to send them to. */
export async function startStripeOnboarding(actor: Actor, supplierId: string) {
  await requireSupplierMember(actor, supplierId, { write: true });
  const p = payments();
  if (!p) throw conflict('Card payments are not switched on yet, so there is nothing to set up. The show team will pay you directly.');
  const db = await getDb();
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!s) throw notFound();
  if (s.status !== 'active') throw conflict('This supplier account is switched off. Contact the show team.');
  let accountId = s.stripeAccountId;
  if (!accountId) {
    const created = await p.createConnectedAccount({ email: s.email, businessName: s.name, idempotencyKey: `account-${s.id}` });
    // Only the first request stores an account, even if two people click at once.
    await db.update(suppliers).set({ stripeAccountId: created.id }).where(and(eq(suppliers.id, supplierId), isNull(suppliers.stripeAccountId)));
    const [after] = await db.select({ id: suppliers.stripeAccountId }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
    accountId = after.id!;
    await audit(actor, 'supplier.stripe_account_created', { entityType: 'supplier', entityId: supplierId });
  }
  return p.onboardingLink(accountId, appUrl(`/supplier/${supplierId}/payouts?stripe=return`), appUrl(`/supplier/${supplierId}/payouts?stripe=refresh`));
}

/** Reads the supplier's Stripe status straight from Stripe, and sends any payouts that were waiting for it. */
export async function refreshStripeStatus(actor: Actor, supplierId: string) {
  await requireSupplierMember(actor, supplierId);
  const db = await getDb();
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!s) throw notFound();
  const p = payments();
  if (!s.stripeAccountId || !p) return { payoutsEnabled: s.stripePayoutsEnabled };
  // The simulator keeps its state in the database (set by the test set-up page).
  if (p.kind === 'stripe') {
    const status = await p.accountStatus(s.stripeAccountId);
    await db
      .update(suppliers)
      .set({ stripeChargesEnabled: status.chargesEnabled, stripePayoutsEnabled: status.payoutsEnabled, stripeDetailsSubmitted: status.detailsSubmitted })
      .where(eq(suppliers.id, supplierId));
    if (status.payoutsEnabled) await processTransfers({ supplierId });
    return { payoutsEnabled: status.payoutsEnabled };
  }
  if (s.stripePayoutsEnabled) await processTransfers({ supplierId });
  return { payoutsEnabled: s.stripePayoutsEnabled };
}

export async function stripeDashboardLink(actor: Actor, supplierId: string) {
  await requireSupplierMember(actor, supplierId);
  const db = await getDb();
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  const p = payments();
  if (!s?.stripeAccountId || !p) return null;
  return p.dashboardLink(s.stripeAccountId);
}

/** Local test payments only: stands in for finishing Stripe's set-up pages. */
export async function completeSimulatedOnboarding(actor: Actor, accountId: string) {
  const p = payments();
  if (!(p instanceof SimulatedPayments)) throw notFound();
  const db = await getDb();
  const [s] = await db.select().from(suppliers).where(eq(suppliers.stripeAccountId, accountId)).limit(1);
  if (!s) throw notFound();
  await requireSupplierMember(actor, s.id, { write: true });
  await db.update(suppliers).set({ stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true }).where(eq(suppliers.id, s.id));
  await audit(actor, 'supplier.stripe_onboarded', { entityType: 'supplier', entityId: s.id, details: { simulated: true } });
  await processTransfers({ supplierId: s.id });
  return s.id;
}

/** Super admin: refreshes a supplier's Stripe status from the admin pages. */
export async function adminRefreshSupplierStripe(supplierId: string) {
  const db = await getDb();
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  const p = payments();
  if (!s?.stripeAccountId || !p || p.kind !== 'stripe') return;
  const status = await p.accountStatus(s.stripeAccountId);
  await db
    .update(suppliers)
    .set({ stripeChargesEnabled: status.chargesEnabled, stripePayoutsEnabled: status.payoutsEnabled, stripeDetailsSubmitted: status.detailsSubmitted })
    .where(eq(suppliers.id, supplierId));
  if (status.payoutsEnabled) await processTransfers({ supplierId });
}
