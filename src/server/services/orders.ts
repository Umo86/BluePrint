import 'server-only';
import { and, asc, desc, eq, ilike, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import {
  cartItems,
  companies,
  companyMembers,
  counters,
  editions,
  halls,
  invoices,
  orderLines,
  orders,
  refunds,
  stands,
  stripeEvents,
  submissions,
  supplierTransfers,
  suppliers,
  tasks,
  users,
  type OrderStatus,
} from '../db/schema';
import { editionStaffWith, getEditionAccess, memberCovers, requireEditionPermission, requireStandAccess, supplierIdsFor } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { SYSTEM_ACTOR, type Actor } from '../auth/actor';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { renderTemplate } from '../email/templates';
import { appUrl } from '../auth/login';
import { payments, paymentsForEdition, type WebhookEvent } from '../payments/provider';
import { isDemoEdition } from '../demo/flags';
import { renderInvoice, type InvoiceDocument, type InvoiceLine } from '../pdf/invoice';
import { getPlatformSettings } from './settings';
import { canReadOrderDocuments, storeGeneratedFile } from './files';
import { storage } from '../storage';
import { notifySupplier } from './catalogue';
import { reversalFor, vatWithin } from '@/lib/pricing';
import { money, spreadsheetDateTime } from '@/lib/format';
import { csvCell } from '@/lib/csv';
import { answerText } from '@/lib/order-details';

type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;
type RefundRow = typeof refunds.$inferSelect;
type InvoiceRow = typeof invoices.$inferSelect;

/** Orders that count as sold (they hold stock, complete order tasks and appear to suppliers). */
export const LIVE_ORDER_STATUSES: OrderStatus[] = ['paid', 'invoiced', 'partially_refunded'];
const SUPPLIER_VISIBLE: OrderStatus[] = ['paid', 'invoiced', 'partially_refunded', 'refunded'];
/** Card checkouts expire after an hour; anything unpaid for longer than this is released. */
export const PENDING_ORDER_TTL_MS = 75 * 60 * 1000;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  invoiced: 'Invoiced (awaiting payment)',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
  payment_failed: 'Payment failed',
};

// ---------------------------------------------------------------------------
// Numbers and loading
// ---------------------------------------------------------------------------

const PREFIX = { order: 'ORD', invoice: 'INV', credit_note: 'CRN', ticket: 'HD' } as const;

const WAITING_FOR_SUPPLIER = 'Waiting for the supplier to finish setting up Stripe payouts.';

/**
 * Next number in a gap-free sequence (orders, invoices and credit notes each have their own). The
 * demo shows have sequences of their own (DEMO-ORD-000001 and so on), so removing the demo data
 * never leaves gaps in the real ones.
 */
export async function nextNumber(db: DbLike, key: keyof typeof PREFIX, opts: { demo?: boolean } = {}) {
  const counter = opts.demo ? `demo_${key}` : key;
  const [r] = await db
    .insert(counters)
    .values({ key: counter, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return `${opts.demo ? 'DEMO-' : ''}${PREFIX[key]}-${String(r.value).padStart(6, '0')}`;
}

async function orderContext(db: DbLike, orderId: string) {
  const [row] = await db
    .select({ order: orders, edition: editions, stand: stands, company: companies, hall: halls })
    .from(orders)
    .innerJoin(editions, eq(editions.id, orders.editionId))
    .innerJoin(stands, eq(stands.id, orders.standId))
    .leftJoin(companies, eq(companies.id, orders.companyId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!row) throw notFound();
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId)).orderBy(asc(orderLines.description));
  return { ...row, lines };
}
type OrderContext = Awaited<ReturnType<typeof orderContext>>;

export const lineGross = (l: Pick<LineRow, 'netPence' | 'vatPence'>) => l.netPence + l.vatPence;
const cardFeeRefunded = (o: OrderRow, lines: LineRow[]) => Math.max(0, o.refundedPence - lines.reduce((a, l) => a + l.refundedPence, 0));

/** What the supplier is owed for a line after any refunds. */
export function linePayoutAfterRefunds(l: LineRow) {
  return l.supplierPayoutPence - reversalFor(l.refundedPence, lineGross(l), l.supplierPayoutPence);
}

// ---------------------------------------------------------------------------
// Documents: VAT invoices and credit notes (the organiser is the seller of record)
// ---------------------------------------------------------------------------

function lineDescription(l: Pick<LineRow, 'description' | 'options'>) {
  const opts = Object.entries(l.options ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return opts ? `${l.description} (${opts})` : l.description;
}

async function placerName(db: DbLike, order: OrderRow) {
  if (!order.placedBy) return null;
  const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, order.placedBy)).limit(1);
  return u ? u.name || u.email : null;
}

async function documentBase(db: DbLike, ctx: OrderContext) {
  const settings = await getPlatformSettings();
  const c = ctx.company;
  return {
    seller: {
      legalName: settings.invoicing.legalName,
      address: settings.invoicing.address,
      vatNumber: settings.invoicing.vatNumber,
      companyNumber: settings.invoicing.companyNumber,
      email: settings.invoicing.email,
      phone: settings.invoicing.phone,
    },
    buyer: {
      name: c?.name ?? 'Exhibitor',
      address: [c?.addressLine1, c?.addressLine2, c?.city, c?.postcode, c?.country].filter((x): x is string => Boolean(x && x.trim())),
      vatNumber: c?.vatNumber ?? null,
      contact: await placerName(db, ctx.order),
    },
    show: { name: ctx.edition.name, venue: ctx.edition.venue, standNumber: ctx.stand.number, hall: ctx.hall?.name ?? null },
    orderNumber: ctx.order.number,
    poNumber: ctx.order.poNumber,
    footer: settings.invoicing.footer || null,
    brandColor: ctx.edition.branding.primaryColor ?? null,
    paymentInstructions: settings.invoicing.paymentInstructions || null,
    dueDays: settings.invoicing.dueDays,
  };
}

async function storeDocument(ctx: OrderContext, number: string, body: Uint8Array) {
  return storeGeneratedFile({
    purpose: 'invoice',
    filename: `${number}.pdf`,
    contentType: 'application/pdf',
    body,
    editionId: ctx.order.editionId,
    companyId: ctx.order.companyId,
    standId: ctx.order.standId,
  });
}

/**
 * Issues the order's VAT invoice once (marked paid for card orders). Safe to call repeatedly and
 * from two places at once: the order row is locked while the number is reserved.
 */
export async function ensureInvoice(orderId: string) {
  const db = await getDb();
  const [head] = await db.select({ editionId: orders.editionId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  const demo = await isDemoEdition(head?.editionId);
  const reserved = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for('update');
    if (!o) throw notFound();
    const [existing] = await tx.select().from(invoices).where(and(eq(invoices.orderId, orderId), eq(invoices.kind, 'invoice'))).limit(1);
    if (existing) return existing;
    const number = await nextNumber(tx, 'invoice', { demo });
    const [row] = await tx.insert(invoices).values({ number, orderId, kind: 'invoice', totalPence: o.totalPence }).returning();
    return row;
  });
  if (reserved.fileId) return reserved;
  // Without file storage the invoice is drawn from the order each time it is downloaded (the demo
  // shows keep theirs in the database instead).
  if (storage().kind === 'off' && !demo) return reserved;
  const ctx = await orderContext(db, orderId);
  const pdf = await renderInvoice(await invoiceDocument(db, ctx, reserved));
  const file = await storeDocument(ctx, reserved.number, pdf);
  const [updated] = await db.update(invoices).set({ fileId: file.id }).where(eq(invoices.id, reserved.id)).returning();
  return updated;
}

/** An order's VAT invoice as printed (marked paid for card orders). */
async function invoiceDocument(db: DbLike, ctx: OrderContext, row: InvoiceRow): Promise<InvoiceDocument> {
  const base = await documentBase(db, ctx);
  const paid = ctx.order.paymentMethod === 'card' && Boolean(ctx.order.paidAt);
  return {
    ...base,
    kind: 'invoice',
    number: row.number,
    issuedAt: row.issuedAt,
    taxPointAt: paid ? ctx.order.paidAt! : row.issuedAt,
    dueAt: ctx.order.dueAt,
    paid,
    creditFor: null,
    reason: null,
    lines: ctx.lines.map((l) => ({ description: lineDescription(l), quantity: l.quantity, unitPence: l.unitPricePence, vatRateBps: l.vatRateBps, netPence: l.netPence, vatPence: l.vatPence })),
    cardFeePence: ctx.order.cardFeePence,
    totalPence: ctx.order.totalPence,
  };
}

/** A refund's credit note as printed. */
async function creditNoteDocument(db: DbLike, ctx: OrderContext, row: InvoiceRow, refund: RefundRow): Promise<InvoiceDocument> {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.orderId, ctx.order.id), eq(invoices.kind, 'invoice'))).limit(1);
  const base = await documentBase(db, ctx);
  const lines: InvoiceLine[] = [];
  for (const [lineId, amount] of Object.entries(refund.lineAmounts)) {
    const l = ctx.lines.find((x) => x.id === lineId);
    if (!l || amount <= 0) continue;
    if (amount === lineGross(l)) {
      lines.push({ description: lineDescription(l), quantity: l.quantity, unitPence: l.unitPricePence, vatRateBps: l.vatRateBps, netPence: l.netPence, vatPence: l.vatPence });
    } else {
      const vat = vatWithin(amount, l.vatRateBps);
      lines.push({ description: `${lineDescription(l)} (part refund)`, quantity: 1, unitPence: amount - vat, vatRateBps: l.vatRateBps, netPence: amount - vat, vatPence: vat });
    }
  }
  return {
    ...base,
    kind: 'credit_note',
    number: row.number,
    issuedAt: row.issuedAt,
    taxPointAt: row.issuedAt,
    dueAt: null,
    paid: false,
    creditFor: inv?.number ?? null,
    reason: refund.reason,
    lines,
    cardFeePence: refund.cardFeePence,
    totalPence: refund.amountPence,
    paymentInstructions: null,
  };
}

/**
 * An order's VAT invoice or credit note, for the people who may see it: the exhibitor's team, show
 * team members who handle orders or reports, and super admins. Issued documents are stored, so this
 * usually points at the stored PDF. One that could not be stored when it was issued (file storage
 * was off or failed) is stored now; while file storage is off it is drawn again from the order, so
 * it can still be downloaded.
 */
export async function orderDocumentPdf(actor: Actor, documentId: string): Promise<{ fileId: string } | { filename: string; body: Uint8Array }> {
  const db = await getDb();
  const [doc] = await db.select().from(invoices).where(eq(invoices.id, documentId)).limit(1);
  if (!doc) throw notFound();
  const [o] = await db.select().from(orders).where(eq(orders.id, doc.orderId)).limit(1);
  if (!o || !(await canReadOrderDocuments(actor, o))) throw notFound();
  if (doc.fileId) return { fileId: doc.fileId };
  const [refund] = doc.refundId ? await db.select().from(refunds).where(eq(refunds.id, doc.refundId)).limit(1) : [];
  if (doc.kind === 'credit_note' && !refund) throw notFound();
  if (storage().kind !== 'off') {
    try {
      const stored = doc.kind === 'credit_note' ? await ensureCreditNote(refund) : await ensureInvoice(o.id);
      if (stored.fileId) return { fileId: stored.fileId };
    } catch (err) {
      console.error('Storing document failed', doc.number, err);
    }
  }
  const ctx = await orderContext(db, o.id);
  const body = await renderInvoice(doc.kind === 'credit_note' ? await creditNoteDocument(db, ctx, doc, refund) : await invoiceDocument(db, ctx, doc));
  return { filename: `${doc.number}.pdf`, body };
}

/** The credit note for a refund, issued once (a refund already credited returns its existing note). */
async function ensureCreditNote(refund: RefundRow) {
  const db = await getDb();
  const orderId = refund.orderId;
  const [head] = await db.select({ editionId: orders.editionId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  const demo = await isDemoEdition(head?.editionId);
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).limit(1).for('update');
    const [existing] = await tx.select().from(invoices).where(eq(invoices.refundId, refund.id)).limit(1);
    if (existing) return existing;
    const number = await nextNumber(tx, 'credit_note', { demo });
    const [created] = await tx.insert(invoices).values({ number, orderId, kind: 'credit_note', refundId: refund.id, totalPence: refund.amountPence }).returning();
    return created;
  });
  if (row.fileId) return row;
  if (storage().kind === 'off' && !demo) return row;
  const ctx = await orderContext(db, orderId);
  const pdf = await renderInvoice(await creditNoteDocument(db, ctx, row, refund));
  const file = await storeDocument(ctx, row.number, pdf);
  await db.update(invoices).set({ fileId: file.id }).where(eq(invoices.id, row.id));
  return { ...row, fileId: file.id };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * A card refund Stripe accepted can still fail later (for example, an expired card). The order
 * already shows the refund, so the people who handle orders are told straight away to repay the
 * exhibitor another way.
 */
async function alertFailedRefund(orderId: string, amountPence: number, alreadyShown: boolean) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) return;
  let team = await editionStaffWith(o.editionId, 'manage_orders');
  if (!team.length) {
    // Nobody at the show handles orders: tell the super admins instead.
    team = (await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(and(eq(users.isSuperAdmin, true), eq(users.status, 'active')))).map((u) => ({
      ...u,
      role: 'show_admin' as const,
      permissions: [],
    }));
  }
  const amount = `£${(amountPence / 100).toFixed(2)}`;
  const { html, text } = renderSimpleEmail({
    heading: `A card refund failed: ${o.number}`,
    paragraphs: [
      `Stripe could not complete the ${amount} card refund on order ${o.number}.`,
      alreadyShown
        ? 'The order and its credit note already show this refund, so the exhibitor is expecting the money. Refund them another way (for example by bank transfer) and note it on the order.'
        : 'Refund the exhibitor another way (for example by bank transfer) and note it on the order.',
    ],
    button: { label: 'Open the order', url: appUrl(`/manage/${o.editionId}/orders/${o.id}`) },
    footer: 'BluePrint, the online exhibitor manual.',
  });
  for (const p of team) {
    await sendEmail({ to: p.email, toUserId: p.id, editionId: o.editionId, templateKey: 'refund_failed', category: 'transactional', subject: `A card refund failed: ${o.number}`, html, text });
  }
}

async function exhibitorRecipients(db: DbLike, order: OrderRow) {
  if (!order.companyId) return [];
  const rows = await db
    .select({ id: users.id, email: users.email, role: companyMembers.role })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(and(eq(companyMembers.companyId, order.companyId), eq(users.status, 'active'), memberCovers(order.editionId)));
  return rows.filter((r) => r.role === 'main_contact' || r.id === order.placedBy);
}

async function emailExhibitor(ctx: OrderContext, subject: string, paragraphs: string[], templateKey: string) {
  const db = await getDb();
  const { html, text } = renderSimpleEmail({
    heading: subject,
    paragraphs,
    button: { label: 'View your order', url: appUrl(`/portal/${ctx.edition.slug}/orders/${ctx.order.id}`) },
    brandColor: ctx.edition.branding.primaryColor,
    footer: ctx.edition.branding.footerText || `${ctx.edition.name} · stand ${ctx.stand.number}`,
  });
  for (const r of await exhibitorRecipients(db, ctx.order)) {
    await sendEmail({ to: r.email, toUserId: r.id, editionId: ctx.edition.id, companyId: ctx.order.companyId, standId: ctx.stand.id, templateKey, category: 'transactional', subject, html, text });
  }
}

function linesSummary(lines: LineRow[]) {
  return lines.map((l) => `${l.quantity} × ${lineDescription(l)}: ${money(lineGross(l))}`);
}

async function notifyOrderPlaced(orderId: string) {
  const db = await getDb();
  const ctx = await orderContext(db, orderId);
  const o = ctx.order;
  const paid = o.status === 'paid';
  // The exhibitor's confirmation uses the show's own wording (editable under Emails).
  for (const r of await exhibitorRecipients(db, o)) {
    const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, r.id)).limit(1);
    const m = await renderTemplate(ctx.edition, 'order_confirmation', {
      first_name: (person?.name || '').split(' ')[0] || 'there',
      name: person?.name ?? '',
      company: ctx.company?.name ?? '',
      stand: ctx.stand.number,
      order_number: o.number,
      order_total: money(o.totalPence),
      order_link: appUrl(`/portal/${ctx.edition.slug}/orders/${o.id}`),
      // The card fee is part of the total, so it is listed with the lines and they add up.
      order_lines: [...linesSummary(ctx.lines), ...(o.cardFeePence ? [`Card processing fee: ${money(o.cardFeePence)}`] : [])].join('\n'),
      payment_note: paid
        ? `We have received your payment of ${money(o.totalPence)} for stand ${ctx.stand.number}. Your VAT invoice is on the order page.`
        : `Your order for stand ${ctx.stand.number} is confirmed. A VAT invoice for ${money(o.totalPence)} is on the order page${o.dueAt ? `, with payment due by ${o.dueAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ctx.edition.timezone })}` : ''}.`,
    });
    await sendEmail({ to: r.email, toUserId: r.id, editionId: ctx.edition.id, companyId: o.companyId, standId: ctx.stand.id, templateKey: 'order_confirmation', category: 'transactional', subject: m.subject, html: m.html, text: m.text });
  }
  const bySupplier = new Map<string, LineRow[]>();
  for (const l of ctx.lines) if (l.supplierId) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), l]);
  for (const [supplierId, lines] of bySupplier) {
    await notifySupplier(
      supplierId,
      ctx.edition.id,
      `New order ${o.number}: stand ${ctx.stand.number}, ${ctx.edition.name}`,
      [`${ctx.company?.name ?? 'An exhibitor'} (stand ${ctx.stand.number}${ctx.hall ? `, hall ${ctx.hall.name}` : ''}) has ordered:`, ...lines.map((l) => `${l.quantity} × ${lineDescription(l)}`), 'Please confirm the order in the supplier portal.'],
      `/supplier/${supplierId}/orders`,
    );
  }
}

// ---------------------------------------------------------------------------
// Payment, transfers and follow-up
// ---------------------------------------------------------------------------

export type PaymentConfirmation = {
  paymentIntentId: string | null;
  /** What the payment provider says was charged; checked against the order total. */
  amountPence?: number | null;
  currency?: string | null;
  via: 'webhook' | 'return' | 'simulator' | 'free';
};

/**
 * Marks a card order paid. Idempotent: webhooks, the return page and retries can all call it,
 * and only the first call changes anything or sends emails.
 */
export async function markOrderPaid(orderId: string, payment: PaymentConfirmation) {
  const db = await getDb();
  const outcome = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for('update');
    if (!o) throw notFound();
    if (['paid', 'partially_refunded', 'refunded'].includes(o.status)) return { changed: false as const, order: o, problem: null };
    if (o.paymentMethod !== 'card') return { changed: false as const, order: o, problem: 'not_card' };
    if (payment.amountPence !== null && payment.amountPence !== undefined && payment.amountPence !== o.totalPence) {
      return { changed: false as const, order: o, problem: 'amount_mismatch' };
    }
    if (payment.currency && payment.currency.toLowerCase() !== o.currency.toLowerCase()) return { changed: false as const, order: o, problem: 'currency_mismatch' };
    const [updated] = await tx
      .update(orders)
      .set({ status: 'paid', paidAt: new Date(), stripePaymentIntentId: payment.paymentIntentId ?? o.stripePaymentIntentId, cancelledAt: null })
      .where(eq(orders.id, orderId))
      .returning();
    return { changed: true as const, order: updated, problem: null, wasCancelled: o.status === 'cancelled' };
  });
  if (outcome.problem) {
    await audit(SYSTEM_ACTOR, 'shop.payment_problem', {
      entityType: 'order',
      entityId: orderId,
      editionId: outcome.order.editionId,
      details: { problem: outcome.problem, expected: outcome.order.totalPence, received: payment.amountPence ?? null, via: payment.via },
    });
    return { changed: false, problem: outcome.problem };
  }
  if (outcome.changed) {
    await audit(SYSTEM_ACTOR, 'shop.order_paid', {
      entityType: 'order',
      entityId: orderId,
      editionId: outcome.order.editionId,
      companyId: outcome.order.companyId,
      details: { number: outcome.order.number, totalPence: outcome.order.totalPence, via: payment.via, afterCancellation: Boolean('wasCancelled' in outcome && outcome.wasCancelled) },
    });
  }
  await completePaidOrder(orderId, { notify: outcome.changed });
  return { changed: outcome.changed, problem: null };
}

/** Everything that follows a payment. Each step is safe to repeat, so a retry finishes anything left undone. */
async function completePaidOrder(orderId: string, opts: { notify: boolean }) {
  const db = await getDb();
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`Order ${orderId}: ${name} failed`, err);
      await audit(SYSTEM_ACTOR, 'shop.follow_up_failed', { entityType: 'order', entityId: orderId, details: { step: name, error: err instanceof Error ? err.message.slice(0, 300) : 'unknown' } });
    }
  };
  await step('charge', async () => {
    const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const p = o ? await paymentsForEdition(o.editionId) : null;
    if (o?.stripePaymentIntentId && !o.stripeChargeId && p) {
      const { chargeId } = await p.paymentDetails(o.stripePaymentIntentId);
      if (chargeId) await db.update(orders).set({ stripeChargeId: chargeId }).where(eq(orders.id, orderId));
    }
  });
  await step('basket', async () => {
    const lines = await db.select({ cartItemId: orderLines.cartItemId }).from(orderLines).where(and(eq(orderLines.orderId, orderId), isNotNull(orderLines.cartItemId)));
    const ids = lines.map((l) => l.cartItemId!);
    if (ids.length) await db.delete(cartItems).where(inArray(cartItems.id, ids));
  });
  await step('transfers', () => createSupplierTransfers(orderId));
  await step('invoice', () => ensureInvoice(orderId));
  await step('tasks', async () => {
    const [o] = await db.select({ standId: orders.standId }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (o) await syncOrderTasks(o.standId);
  });
  if (opts.notify) await step('emails', () => notifyOrderPlaced(orderId));
}

/** An order placed on invoice: clears the basket, issues the invoice, completes order tasks and tells everyone. */
export async function finishInvoiceOrder(orderId: string) {
  const db = await getDb();
  const lines = await db.select({ cartItemId: orderLines.cartItemId }).from(orderLines).where(and(eq(orderLines.orderId, orderId), isNotNull(orderLines.cartItemId)));
  const ids = lines.map((l) => l.cartItemId!);
  if (ids.length) await db.delete(cartItems).where(inArray(cartItems.id, ids));
  await ensureInvoice(orderId).catch((err) => console.error('Invoice failed', orderId, err));
  const [o] = await db.select({ standId: orders.standId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (o) await syncOrderTasks(o.standId);
  await notifyOrderPlaced(orderId).catch((err) => console.error('Order emails failed', orderId, err));
}

/** Records what each supplier is owed for a paid card order, then pays them through Stripe. */
export async function createSupplierTransfers(orderId: string) {
  const db = await getDb();
  const ctx = await orderContext(db, orderId);
  if (ctx.order.paymentMethod !== 'card' || !['paid', 'partially_refunded', 'refunded'].includes(ctx.order.status)) return;
  const owed = new Map<string, number>();
  for (const l of ctx.lines) if (l.supplierId) owed.set(l.supplierId, (owed.get(l.supplierId) ?? 0) + linePayoutAfterRefunds(l));
  for (const [supplierId, amount] of owed) {
    if (amount <= 0) continue;
    await db.insert(supplierTransfers).values({ orderId, supplierId, amountPence: amount, status: 'pending' }).onConflictDoNothing();
  }
  await processTransfers({ orderId });
}

/**
 * Sends pending supplier payouts. Suppliers who have not finished Stripe set-up stay pending
 * until they do (the account webhook or the supplier's own refresh retries them).
 */
export async function processTransfers(filter: { orderId?: string; supplierId?: string; transferId?: string; includeFailed?: boolean }) {
  const db = await getDb();
  const statuses: ('pending' | 'failed')[] = filter.includeFailed ? ['pending', 'failed'] : ['pending'];
  const conds = [inArray(supplierTransfers.status, statuses), eq(orders.paymentMethod, 'card')];
  if (filter.orderId) conds.push(eq(supplierTransfers.orderId, filter.orderId));
  if (filter.supplierId) conds.push(eq(supplierTransfers.supplierId, filter.supplierId));
  if (filter.transferId) conds.push(eq(supplierTransfers.id, filter.transferId));
  const rows = await db
    .select({ t: supplierTransfers, s: suppliers, o: orders })
    .from(supplierTransfers)
    .innerJoin(suppliers, eq(suppliers.id, supplierTransfers.supplierId))
    .innerJoin(orders, eq(orders.id, supplierTransfers.orderId))
    .where(and(...conds))
    .limit(200);
  let sent = 0;
  for (const { t, s, o } of rows) {
    // The demo shows pay their invented suppliers with practice payouts.
    const p = await paymentsForEdition(o.editionId);
    if (t.amountPence <= 0) {
      await db.update(supplierTransfers).set({ status: 'reversed', error: null }).where(eq(supplierTransfers.id, t.id));
      continue;
    }
    if (!p) {
      await db.update(supplierTransfers).set({ error: 'Card payments are not set up, so this payout must be made by hand.' }).where(eq(supplierTransfers.id, t.id));
      continue;
    }
    if (!s.stripeAccountId || !s.stripePayoutsEnabled) {
      await db.update(supplierTransfers).set({ status: 'pending', error: WAITING_FOR_SUPPLIER }).where(eq(supplierTransfers.id, t.id));
      continue;
    }
    try {
      let charge = o.stripeChargeId;
      if (!charge && o.stripePaymentIntentId) charge = (await p.paymentDetails(o.stripePaymentIntentId)).chargeId;
      const tr = await p.createTransfer({
        amountPence: t.amountPence,
        destination: s.stripeAccountId,
        transferGroup: o.id,
        sourceTransaction: charge,
        idempotencyKey: `transfer-${t.id}-${t.amountPence}`,
        description: `BluePrint order ${o.number}`,
      });
      await db.update(supplierTransfers).set({ status: 'created', stripeTransferId: tr.id, error: null }).where(eq(supplierTransfers.id, t.id));
      sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 300) : 'Transfer failed';
      await db.update(supplierTransfers).set({ status: 'failed', error: message }).where(eq(supplierTransfers.id, t.id));
      await audit(SYSTEM_ACTOR, 'shop.transfer_failed', { entityType: 'supplier_transfer', entityId: t.id, editionId: o.editionId, details: { orderId: o.id, supplierId: s.id, error: message } });
    }
  }
  return { attempted: rows.length, sent };
}

export async function retryTransfer(actor: Actor, transferId: string) {
  const db = await getDb();
  const [row] = await db.select({ t: supplierTransfers, o: orders }).from(supplierTransfers).innerJoin(orders, eq(orders.id, supplierTransfers.orderId)).where(eq(supplierTransfers.id, transferId)).limit(1);
  if (!row) throw notFound();
  await requireEditionPermission(actor, row.o.editionId, 'manage_orders', { write: true });
  if (!['pending', 'failed'].includes(row.t.status)) throw conflict('This payout has already been made.');
  await audit(actor, 'shop.transfer_retried', { entityType: 'supplier_transfer', entityId: transferId, editionId: row.o.editionId });
  return processTransfers({ transferId, includeFailed: true });
}

/** Finance has paid a supplier by hand (invoice orders): records when and their reference. */
export async function settleManualTransfer(actor: Actor, transferId: string, reference: string) {
  const db = await getDb();
  const [row] = await db.select({ t: supplierTransfers, o: orders }).from(supplierTransfers).innerJoin(orders, eq(orders.id, supplierTransfers.orderId)).where(eq(supplierTransfers.id, transferId)).limit(1);
  if (!row) throw notFound();
  await requireEditionPermission(actor, row.o.editionId, 'manage_orders', { write: true });
  if (row.t.status !== 'manual') throw conflict('Only payouts made by hand can be marked as paid here.');
  const ref = reference.trim().slice(0, 120);
  if (!ref) throw invalid('Enter the payment reference.');
  await db.update(supplierTransfers).set({ settledAt: new Date(), reference: ref }).where(eq(supplierTransfers.id, transferId));
  await audit(actor, 'shop.manual_payout_settled', { entityType: 'supplier_transfer', entityId: transferId, editionId: row.o.editionId, details: { reference: ref, amountPence: row.t.amountPence - row.t.reversedPence } });
}

/** Marks or clears order tasks: a task linked to a category is done once the stand has a live order in it. */
export async function syncOrderTasks(standId: string) {
  const db = await getDb();
  const [stand] = await db.select().from(stands).where(eq(stands.id, standId)).limit(1);
  if (!stand) return;
  const orderTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.editionId, stand.editionId), eq(tasks.kind, 'order'), isNotNull(tasks.linkedCategoryId)));
  if (!orderTasks.length) return;
  const covered = await db
    .selectDistinct({ categoryId: orderLines.categoryId })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.standId, standId), inArray(orders.status, LIVE_ORDER_STATUSES), ne(orderLines.fulfilmentStatus, 'cancelled')));
  const done = new Set(covered.map((c) => c.categoryId));
  const now = new Date();
  for (const t of orderTasks) {
    const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, t.id), eq(submissions.standId, standId))).limit(1);
    if (done.has(t.linkedCategoryId)) {
      if (!sub) await db.insert(submissions).values({ taskId: t.id, standId, status: 'completed', submittedAt: now }).onConflictDoNothing();
      else if (sub.status !== 'completed') await db.update(submissions).set({ status: 'completed', submittedAt: now }).where(eq(submissions.id, sub.id));
    } else if (sub?.status === 'completed') {
      await db.update(submissions).set({ status: 'draft', submittedAt: null }).where(eq(submissions.id, sub.id));
    }
  }
}

/**
 * Brings one order task up to date for every stand in its show: used when the task is created or
 * its category changes, so stands that have already ordered from that category are not asked again.
 */
export async function syncOrderTaskForAllStands(taskId: string) {
  const db = await getDb();
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || t.kind !== 'order') return;
  const covered = t.linkedCategoryId
    ? await db
        .selectDistinct({ standId: orders.standId })
        .from(orderLines)
        .innerJoin(orders, eq(orders.id, orderLines.orderId))
        .where(
          and(
            eq(orders.editionId, t.editionId),
            eq(orderLines.categoryId, t.linkedCategoryId),
            inArray(orders.status, LIVE_ORDER_STATUSES),
            ne(orderLines.fulfilmentStatus, 'cancelled'),
          ),
        )
    : [];
  const done = new Set(covered.map((c) => c.standId));
  const existing = await db.select({ id: submissions.id, standId: submissions.standId, status: submissions.status }).from(submissions).where(eq(submissions.taskId, taskId));
  const have = new Set(existing.map((s) => s.standId));
  const now = new Date();
  const add = [...done].filter((standId) => !have.has(standId)).map((standId) => ({ taskId, standId, status: 'completed' as const, submittedAt: now }));
  const complete = existing.filter((s) => done.has(s.standId) && s.status !== 'completed').map((s) => s.id);
  const reopen = existing.filter((s) => !done.has(s.standId) && s.status === 'completed').map((s) => s.id);
  if (add.length) await db.insert(submissions).values(add).onConflictDoNothing();
  if (complete.length) await db.update(submissions).set({ status: 'completed', submittedAt: now }).where(inArray(submissions.id, complete));
  if (reopen.length) await db.update(submissions).set({ status: 'draft', submittedAt: null }).where(inArray(submissions.id, reopen));
}

/**
 * Releases card checkouts that were never paid, so their stock is free again. Asks Stripe first:
 * a checkout that was paid after all is marked paid instead.
 */
export async function expireStaleOrders(filter: { standId?: string } = {}) {
  const db = await getDb();
  const cutoff = new Date(Date.now() - PENDING_ORDER_TTL_MS);
  const conds = [eq(orders.status, 'pending_payment'), lt(orders.createdAt, cutoff)];
  if (filter.standId) conds.push(eq(orders.standId, filter.standId));
  const stale = await db.select().from(orders).where(and(...conds)).limit(200);
  let cancelled = 0;
  for (const o of stale) {
    if (await closeCheckout(o)) cancelled += 1;
  }
  return { cancelled };
}

/**
 * Closes an unpaid card checkout. Returns true when the order was cancelled, false when it turned
 * out to be paid (it is then marked paid).
 */
export async function closeCheckout(o: OrderRow) {
  const db = await getDb();
  const p = await paymentsForEdition(o.editionId);
  if (o.stripeCheckoutSessionId && p) {
    try {
      const status = await p.checkoutStatus(o.stripeCheckoutSessionId);
      if (status.paid) {
        await markOrderPaid(o.id, { paymentIntentId: status.paymentIntentId, amountPence: status.amountTotal, currency: status.currency, via: 'return' });
        return false;
      }
      const closed = await p.expireCheckout(o.stripeCheckoutSessionId);
      if (!closed) return false;
    } catch (err) {
      // If Stripe cannot be reached, leave the order for the next attempt rather than guess.
      console.error('Could not close checkout', o.id, err);
      return false;
    }
  }
  const [updated] = await db
    .update(orders)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(and(eq(orders.id, o.id), eq(orders.status, 'pending_payment')))
    .returning();
  if (updated) await audit(SYSTEM_ACTOR, 'shop.checkout_expired', { entityType: 'order', entityId: o.id, editionId: o.editionId, details: { number: o.number } });
  return Boolean(updated);
}

// ---------------------------------------------------------------------------
// Show team: refunds, cancellations, invoice payments
// ---------------------------------------------------------------------------

export const refundSchema = z.object({
  lines: z.array(z.object({ lineId: z.string().uuid(), amountPence: z.number().int().min(0).max(100_000_000) })).max(200),
  cardFeePence: z.number().int().min(0).max(100_000_000).default(0),
  reason: z.string().trim().min(3, 'Give a reason; it is printed on the credit note.').max(500),
});

async function staffOrder(actor: Actor, orderId: string, write: boolean) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) throw notFound();
  await requireEditionPermission(actor, o.editionId, 'manage_orders', { write });
  return o;
}

/**
 * Refunds some or all of an order. Card orders are refunded through Stripe, and each supplier's
 * payout is reversed in proportion; invoice orders get a credit note for finance to settle.
 */
export async function refundOrder(actor: Actor, orderId: string, raw: z.input<typeof refundSchema>) {
  const o = await staffOrder(actor, orderId, true);
  await requireEditionPermission(actor, o.editionId, 'refunds', { write: true });
  return makeRefund(actor, orderId, raw);
}

/** The refund itself, once the caller has checked who may do it (see refundOrder and cancelOrder). */
async function makeRefund(actor: Actor, orderId: string, raw: z.input<typeof refundSchema>) {
  const input = refundSchema.parse(raw);
  const db = await getDb();

  const prepared = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for('update');
    const refundable: OrderStatus[] = o.paymentMethod === 'card' ? ['paid', 'partially_refunded'] : ['invoiced', 'paid', 'partially_refunded'];
    if (!refundable.includes(o.status)) throw conflict('This order cannot be refunded in its current state.');
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    // Count every refund already started on this order (not just completed ones), so two people
    // refunding at the same moment cannot both refund the same line.
    const earlier = await tx.select().from(refunds).where(and(eq(refunds.orderId, orderId), ne(refunds.status, 'failed')));
    const taken = (lineId: string) => earlier.reduce((a, r) => a + (r.lineAmounts[lineId] ?? 0), 0);
    const lineAmounts: Record<string, number> = {};
    for (const r of input.lines) {
      if (!r.amountPence) continue;
      const l = lines.find((x) => x.id === r.lineId);
      if (!l) throw notFound();
      const left = lineGross(l) - Math.max(l.refundedPence, taken(l.id)) - (lineAmounts[l.id] ?? 0);
      if (r.amountPence > left) throw invalid(`You can refund at most ${money(Math.max(0, left))} on ${l.description}.`);
      lineAmounts[l.id] = (lineAmounts[l.id] ?? 0) + r.amountPence;
    }
    const feeLeft = o.cardFeePence - Math.max(cardFeeRefunded(o, lines), earlier.reduce((a, r) => a + r.cardFeePence, 0));
    if (input.cardFeePence > feeLeft) throw invalid(`You can refund at most ${money(Math.max(0, feeLeft))} of the card fee.`);
    const amount = Object.values(lineAmounts).reduce((a, b) => a + b, 0) + input.cardFeePence;
    if (amount <= 0) throw invalid('Choose what to refund.');
    const viaStripe = o.paymentMethod === 'card' && Boolean(o.stripePaymentIntentId);
    const [refund] = await tx
      .insert(refunds)
      .values({ orderId, amountPence: amount, lineAmounts, cardFeePence: input.cardFeePence, reason: input.reason, status: viaStripe ? 'pending' : 'manual', createdBy: actor.realUserId })
      .returning();
    return { order: o, refund, viaStripe };
  });

  let refund = prepared.refund;
  if (prepared.viaStripe) {
    const p = await paymentsForEdition(prepared.order.editionId);
    if (!p) {
      await db.update(refunds).set({ status: 'failed', error: 'Card payments are not set up.' }).where(eq(refunds.id, refund.id));
      throw conflict('Card payments are not set up, so this refund cannot be made here.');
    }
    try {
      const r = await p.refund({ paymentIntentId: prepared.order.stripePaymentIntentId!, amountPence: refund.amountPence, idempotencyKey: `refund-${refund.id}`, refundId: refund.id });
      if (r.status === 'failed') throw new Error('The card refund was declined.');
      [refund] = await db.update(refunds).set({ status: r.status, stripeRefundId: r.id }).where(eq(refunds.id, refund.id)).returning();
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 300) : 'Refund failed';
      await db.update(refunds).set({ status: 'failed', error: message }).where(eq(refunds.id, refund.id));
      await audit(actor, 'shop.refund_failed', { entityType: 'order', entityId: orderId, editionId: prepared.order.editionId, details: { amountPence: refund.amountPence, error: message } });
      throw conflict(`Stripe did not accept the refund: ${message}`);
    }
  }

  await applyRefund(refund.id);
  const note = await finishRefund(refund.id, { notify: true });
  await audit(actor, 'shop.order_refunded', {
    entityType: 'order',
    entityId: orderId,
    editionId: prepared.order.editionId,
    companyId: prepared.order.companyId,
    details: { number: prepared.order.number, amountPence: refund.amountPence, cardFeePence: refund.cardFeePence, reason: input.reason, creditNote: note?.number ?? null },
  });
  return { refundId: refund.id, creditNote: note?.number ?? null };
}

/**
 * Applies a refund to the order and its lines, exactly once (the refund row is marked applied in
 * the same transaction). Returns false if it had already been applied or failed.
 */
async function applyRefund(refundId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [first] = await tx.select({ orderId: refunds.orderId }).from(refunds).where(eq(refunds.id, refundId)).limit(1);
    if (!first) throw notFound();
    const [o] = await tx.select().from(orders).where(eq(orders.id, first.orderId)).limit(1).for('update');
    const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);
    if (refund.appliedAt || refund.status === 'failed') return false;
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id));
    for (const [lineId, amount] of Object.entries(refund.lineAmounts)) {
      const l = lines.find((x) => x.id === lineId);
      if (!l) continue;
      const refunded = Math.min(lineGross(l), l.refundedPence + amount);
      await tx
        .update(orderLines)
        .set({ refundedPence: refunded, fulfilmentStatus: refunded >= lineGross(l) ? 'cancelled' : l.fulfilmentStatus })
        .where(eq(orderLines.id, lineId));
    }
    const refundedPence = Math.min(o.totalPence, o.refundedPence + refund.amountPence);
    let status: OrderStatus;
    if (o.status === 'invoiced') status = refundedPence >= o.totalPence ? 'cancelled' : 'invoiced';
    else status = refundedPence >= o.totalPence ? 'refunded' : 'partially_refunded';
    await tx
      .update(orders)
      .set({ refundedPence, status, cancelledAt: status === 'cancelled' ? new Date() : o.cancelledAt })
      .where(eq(orders.id, o.id));
    await tx.update(refunds).set({ appliedAt: new Date() }).where(eq(refunds.id, refundId));
    return true;
  });
}

/**
 * Everything after a refund is applied: supplier payouts, the credit note, order tasks and the
 * exhibitor's email. Safe to repeat: the credit note is issued once per refund.
 */
async function finishRefund(refundId: string, opts: { notify: boolean }) {
  const db = await getDb();
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);
  if (!refund?.appliedAt) return null;
  const [o] = await db.select().from(orders).where(eq(orders.id, refund.orderId)).limit(1);
  await applySupplierReversals(o.id, refund.id).catch((err) => console.error('Supplier reversal failed', refund.id, err));
  const note = await ensureCreditNote(refund).catch(async (err) => {
    console.error('Credit note failed', err);
    await audit(SYSTEM_ACTOR, 'shop.follow_up_failed', { entityType: 'order', entityId: o.id, details: { step: 'credit_note', refundId } });
    return null;
  });
  await syncOrderTasks(o.standId);
  if (opts.notify) {
    const ctx = await orderContext(db, o.id);
    const wasInvoice = o.paymentMethod === 'invoice' && !o.paidAt;
    const viaStripe = Boolean(refund.stripeRefundId);
    await emailExhibitor(
      ctx,
      wasInvoice ? `Credit note for order ${o.number}` : `Refund for order ${o.number}`,
      [
        wasInvoice
          ? `We have issued a credit note of ${money(refund.amountPence)} against your invoice for order ${o.number}.`
          : viaStripe
            ? `We have refunded ${money(refund.amountPence)} to the card you paid with. It usually reaches your account within 5 to 10 working days.`
            : `We have issued a credit of ${money(refund.amountPence)} for order ${o.number}. Our finance team will be in touch about repayment.`,
        ...(refund.reason ? [`Reason: ${refund.reason}`] : []),
      ],
      'order_refund',
    ).catch((err) => console.error('Refund email failed', err));
  }
  return note;
}

/**
 * Brings each supplier's payout in line with what is still owed after refunds: reverses Stripe
 * transfers already made, reduces payouts not yet sent, and records the change on manual payouts.
 */
async function applySupplierReversals(orderId: string, refundId: string) {
  const db = await getDb();
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const owed = new Map<string, number>();
  for (const l of lines) if (l.supplierId) owed.set(l.supplierId, (owed.get(l.supplierId) ?? 0) + linePayoutAfterRefunds(l));
  const transfers = await db.select().from(supplierTransfers).where(eq(supplierTransfers.orderId, orderId));
  const [order] = await db.select({ editionId: orders.editionId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  const p = order ? await paymentsForEdition(order.editionId) : null;
  for (const t of transfers) {
    const target = Math.max(0, owed.get(t.supplierId) ?? 0);
    if (t.status === 'pending' || t.status === 'failed') {
      if (t.amountPence !== target) await db.update(supplierTransfers).set({ amountPence: target, status: target === 0 ? 'reversed' : t.status }).where(eq(supplierTransfers.id, t.id));
      continue;
    }
    const net = t.amountPence - t.reversedPence;
    const reverse = net - target;
    if (reverse <= 0) continue;
    if (t.status === 'manual') {
      await db.update(supplierTransfers).set({ reversedPence: t.reversedPence + reverse }).where(eq(supplierTransfers.id, t.id));
      continue;
    }
    if ((t.status === 'created' || t.status === 'partially_reversed') && t.stripeTransferId && p) {
      try {
        await p.reverseTransfer(t.stripeTransferId, reverse, `reversal-${refundId}-${t.id}`);
        const reversed = t.reversedPence + reverse;
        await db
          .update(supplierTransfers)
          .set({ reversedPence: reversed, status: reversed >= t.amountPence ? 'reversed' : 'partially_reversed', error: null })
          .where(eq(supplierTransfers.id, t.id));
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 300) : 'Reversal failed';
        await db.update(supplierTransfers).set({ error: `Could not take back ${money(reverse)}: ${message}` }).where(eq(supplierTransfers.id, t.id));
        await audit(SYSTEM_ACTOR, 'shop.transfer_reversal_failed', { entityType: 'supplier_transfer', entityId: t.id, details: { orderId, amountPence: reverse, error: message } });
      }
    }
  }
}

/** Cancels an order that has not been paid: closes an open card checkout, or credits an unpaid invoice in full. */
export async function cancelOrder(actor: Actor, orderId: string, reason: string) {
  const o = await staffOrder(actor, orderId, true);
  const why = reason.trim().slice(0, 500);
  if (why.length < 3) throw invalid('Give a reason.');
  if (o.status === 'pending_payment') {
    const cancelled = await closeCheckout(o);
    if (!cancelled) throw conflict('This order has just been paid, so it cannot be cancelled. Refund it instead.');
    await audit(actor, 'shop.order_cancelled', { entityType: 'order', entityId: orderId, editionId: o.editionId, details: { number: o.number, reason: why } });
    return;
  }
  if (o.status === 'invoiced') {
    const db = await getDb();
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    // Crediting an invoice nobody has paid moves no money, so it does not need the refunds right.
    await makeRefund(actor, orderId, {
      lines: lines.map((l) => ({ lineId: l.id, amountPence: lineGross(l) - l.refundedPence })),
      cardFeePence: o.cardFeePence - cardFeeRefunded(o, lines),
      reason: why,
    });
    for (const supplierId of new Set(lines.map((l) => l.supplierId).filter((x): x is string => Boolean(x)))) {
      await notifySupplier(supplierId, o.editionId, `Order ${o.number} cancelled`, [`Order ${o.number} has been cancelled by the show team. Please do not supply it.`], `/supplier/${supplierId}/orders`);
    }
    return;
  }
  throw conflict('Paid orders are refunded rather than cancelled.');
}

/** Finance has received payment for an invoice order. */
export async function markInvoicePaid(actor: Actor, orderId: string, reference: string) {
  await staffOrder(actor, orderId, true);
  const ref = reference.trim().slice(0, 120);
  if (!ref) throw invalid('Enter the payment reference from the bank statement.');
  const db = await getDb();
  const o = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for('update');
    if (row.paymentMethod !== 'invoice' || row.status !== 'invoiced') throw conflict('Only unpaid invoice orders can be marked as paid.');
    const [updated] = await tx.update(orders).set({ status: row.refundedPence > 0 ? 'partially_refunded' : 'paid', paidAt: new Date(), paymentReference: ref }).where(eq(orders.id, orderId)).returning();
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const owed = new Map<string, number>();
    for (const l of lines) if (l.supplierId) owed.set(l.supplierId, (owed.get(l.supplierId) ?? 0) + linePayoutAfterRefunds(l));
    for (const [supplierId, amount] of owed) {
      if (amount > 0) await tx.insert(supplierTransfers).values({ orderId, supplierId, amountPence: amount, status: 'manual' }).onConflictDoNothing();
    }
    return updated;
  });
  await audit(actor, 'shop.invoice_paid', { entityType: 'order', entityId: orderId, editionId: o.editionId, companyId: o.companyId, details: { number: o.number, reference: ref } });
  const ctx = await orderContext(db, orderId);
  await emailExhibitor(ctx, `Payment received for order ${o.number}`, [`Thank you. We have received your payment for order ${o.number}.`], 'order_paid').catch((err) => console.error(err));
}

export const FULFILMENT_LABELS = { received: 'New', confirmed: 'Confirmed', delivered: 'Delivered', cancelled: 'Cancelled' } as const;

/** Suppliers (for their own lines) and the show team move a line through received, confirmed and delivered. */
export async function setLineFulfilment(actor: Actor, lineId: string, status: 'received' | 'confirmed' | 'delivered') {
  if (!['received', 'confirmed', 'delivered'].includes(status)) throw invalid('Choose a valid status.');
  const db = await getDb();
  const [row] = await db.select({ l: orderLines, o: orders }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(eq(orderLines.id, lineId)).limit(1);
  if (!row) throw notFound();
  const staff = await getEditionAccess(actor, row.o.editionId);
  if (staff) {
    await requireEditionPermission(actor, row.o.editionId, 'manage_orders', { write: true });
  } else {
    if (!row.l.supplierId || !(await supplierIdsFor(actor)).includes(row.l.supplierId)) throw notFound();
    if (actor.readOnly) throw forbidden('You are viewing as someone else, so changes are switched off.');
  }
  if (!LIVE_ORDER_STATUSES.includes(row.o.status)) throw conflict('This order is not active.');
  if (row.l.fulfilmentStatus === 'cancelled') throw conflict('This line has been refunded.');
  await db.update(orderLines).set({ fulfilmentStatus: status }).where(eq(orderLines.id, lineId));
  await audit(actor, 'shop.line_fulfilment', { entityType: 'order_line', entityId: lineId, editionId: row.o.editionId, details: { order: row.o.number, status } });
}

// ---------------------------------------------------------------------------
// Reading orders
// ---------------------------------------------------------------------------

async function documentsFor(db: DbLike, orderIds: string[]) {
  if (!orderIds.length) return [];
  return db.select().from(invoices).where(inArray(invoices.orderId, orderIds)).orderBy(asc(invoices.issuedAt));
}

/** The exhibitor's orders for one stand. */
export async function ordersForStand(actor: Actor, standId: string) {
  await requireStandAccess(actor, standId);
  const db = await getDb();
  const rows = await db.select().from(orders).where(eq(orders.standId, standId)).orderBy(desc(orders.createdAt));
  const lineCounts = rows.length
    ? await db
        .select({ orderId: orderLines.orderId, n: sql<number>`count(*)::int` })
        .from(orderLines)
        .where(
          inArray(
            orderLines.orderId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(orderLines.orderId)
    : [];
  const counts = new Map(lineCounts.map((c) => [c.orderId, Number(c.n)]));
  return rows.map((o) => ({ ...o, lineCount: counts.get(o.id) ?? 0 }));
}

/** A company's orders at a show, for its record on the show dashboard. */
export async function companyOrdersForStaff(actor: Actor, editionId: string, companyId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports')) throw forbidden();
  const db = await getDb();
  return db
    .select({ id: orders.id, number: orders.number, status: orders.status, paymentMethod: orders.paymentMethod, totalPence: orders.totalPence, refundedPence: orders.refundedPence, createdAt: orders.createdAt, standNumber: stands.number })
    .from(orders)
    .innerJoin(stands, eq(stands.id, orders.standId))
    .where(and(eq(orders.editionId, editionId), eq(orders.companyId, companyId)))
    .orderBy(desc(orders.createdAt));
}

function publicLine(l: LineRow) {
  return {
    id: l.id,
    description: l.description,
    productCode: l.productCode,
    options: l.options,
    details: l.details,
    quantity: l.quantity,
    unitPricePence: l.unitPricePence,
    vatRateBps: l.vatRateBps,
    netPence: l.netPence,
    vatPence: l.vatPence,
    grossPence: lineGross(l),
    refundedPence: l.refundedPence,
    fulfilmentStatus: l.fulfilmentStatus,
    supplierId: l.supplierId,
  };
}

/** One order as the exhibitor sees it: no commission, payouts or supplier finances. */
export async function orderForExhibitor(actor: Actor, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) throw notFound();
  await requireStandAccess(actor, o.standId);
  const ctx = await orderContext(db, orderId);
  const supplierNames = await supplierNameMap(db, ctx.lines);
  return {
    order: {
      id: o.id,
      number: o.number,
      status: o.status,
      paymentMethod: o.paymentMethod,
      netPence: o.netPence,
      vatPence: o.vatPence,
      cardFeePence: o.cardFeePence,
      totalPence: o.totalPence,
      refundedPence: o.refundedPence,
      poNumber: o.poNumber,
      dueAt: o.dueAt,
      paidAt: o.paidAt,
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt,
    },
    lines: ctx.lines.map((l) => ({ ...publicLine(l), supplierName: l.supplierId ? (supplierNames.get(l.supplierId) ?? null) : null })),
    documents: (await documentsFor(db, [orderId])).map((d) => ({ id: d.id, number: d.number, kind: d.kind, totalPence: d.totalPence, fileId: d.fileId, issuedAt: d.issuedAt })),
    placedBy: await placerName(db, o),
    stand: { number: ctx.stand.number, hall: ctx.hall?.name ?? null },
  };
}

async function supplierNameMap(db: DbLike, lines: { supplierId: string | null }[]) {
  const ids = [...new Set(lines.map((l) => l.supplierId).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const ORDER_FILTERS = ['all', 'pending_payment', 'paid', 'invoiced', 'refunded', 'cancelled'] as const;

/** The show team's order list, with totals for what is shown. */
export async function ordersForEdition(actor: Actor, editionId: string, opts: { status?: (typeof ORDER_FILTERS)[number]; q?: string; page?: number } = {}) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports')) throw forbidden();
  const db = await getDb();
  const conds = [eq(orders.editionId, editionId)];
  const status = opts.status ?? 'all';
  if (status === 'refunded') conds.push(inArray(orders.status, ['refunded', 'partially_refunded']));
  else if (status === 'cancelled') conds.push(inArray(orders.status, ['cancelled', 'payment_failed']));
  else if (status !== 'all') conds.push(eq(orders.status, status));
  const q = (opts.q ?? '').trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(orders.number, like), ilike(companies.name, like), ilike(stands.number, like), ilike(orders.poNumber, like))!);
  }
  const pageSize = 50;
  const page = Math.max(1, Math.min(1000, opts.page ?? 1));
  const where = and(...conds);
  const rows = await db
    .select({ order: orders, companyName: companies.name, standNumber: stands.number })
    .from(orders)
    .innerJoin(stands, eq(stands.id, orders.standId))
    .leftJoin(companies, eq(companies.id, orders.companyId))
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [totals] = await db
    .select({
      n: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalPence}), 0)::bigint`,
      refunded: sql<number>`coalesce(sum(${orders.refundedPence}), 0)::bigint`,
    })
    .from(orders)
    .innerJoin(stands, eq(stands.id, orders.standId))
    .leftJoin(companies, eq(companies.id, orders.companyId))
    .where(where);
  const [summary] = await db
    .select({
      paid: sql<number>`coalesce(sum(${orders.totalPence} - ${orders.refundedPence}) filter (where ${orders.status} in ('paid','partially_refunded')), 0)::bigint`,
      invoiced: sql<number>`coalesce(sum(${orders.totalPence} - ${orders.refundedPence}) filter (where ${orders.status} = 'invoiced'), 0)::bigint`,
      awaiting: sql<number>`count(*) filter (where ${orders.status} = 'pending_payment')::int`,
      overdue: sql<number>`count(*) filter (where ${orders.status} = 'invoiced' and ${orders.dueAt} < now())::int`,
    })
    .from(orders)
    .where(eq(orders.editionId, editionId));
  const [transfers] = await db
    .select({
      problems: sql<number>`count(*) filter (where ${supplierTransfers.status} in ('failed','pending'))::int`,
      manualUnsettled: sql<number>`count(*) filter (where ${supplierTransfers.status} = 'manual' and ${supplierTransfers.settledAt} is null)::int`,
    })
    .from(supplierTransfers)
    .innerJoin(orders, eq(orders.id, supplierTransfers.orderId))
    .where(eq(orders.editionId, editionId));
  return {
    rows: rows.map((r) => ({ ...r.order, companyName: r.companyName, standNumber: r.standNumber })),
    total: Number(totals.n),
    page,
    pageSize,
    shownTotalPence: Number(totals.total),
    shownRefundedPence: Number(totals.refunded),
    summary: { paidPence: Number(summary.paid), invoicedPence: Number(summary.invoiced), awaiting: Number(summary.awaiting), overdue: Number(summary.overdue) },
    transferProblems: Number(transfers.problems),
    manualUnsettled: Number(transfers.manualUnsettled),
    canManage: access.permissions.has('manage_orders') && !actor.readOnly,
  };
}

/** Everything about one order for the show team, including payouts and commission. */
export async function orderForStaff(actor: Actor, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) throw notFound();
  const access = await getEditionAccess(actor, o.editionId);
  if (!access || (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports'))) throw notFound();
  const ctx = await orderContext(db, orderId);
  const supplierNames = await supplierNameMap(db, ctx.lines);
  const transfers = await db
    .select({ t: supplierTransfers, supplierName: suppliers.name, stripeReady: suppliers.stripePayoutsEnabled })
    .from(supplierTransfers)
    .innerJoin(suppliers, eq(suppliers.id, supplierTransfers.supplierId))
    .where(eq(supplierTransfers.orderId, orderId));
  const refundRows = await db.select().from(refunds).where(eq(refunds.orderId, orderId)).orderBy(desc(refunds.createdAt));
  const refundBy = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      inArray(
        users.id,
        refundRows.map((r) => r.createdBy).filter((x): x is string => Boolean(x)).concat(['00000000-0000-0000-0000-000000000000']),
      ),
    );
  const placer = o.placedBy ? (await db.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, o.placedBy)).limit(1))[0] : null;
  return {
    order: o,
    edition: ctx.edition,
    stand: ctx.stand,
    hall: ctx.hall,
    company: ctx.company,
    placer: placer ?? null,
    lines: ctx.lines.map((l) => ({ ...l, grossPence: lineGross(l), supplierName: l.supplierId ? (supplierNames.get(l.supplierId) ?? 'Unknown supplier') : null })),
    transfers: transfers.map((r) => ({ ...r.t, supplierName: r.supplierName, stripeReady: r.stripeReady })),
    refunds: refundRows.map((r) => ({ ...r, byName: refundBy.find((u) => u.id === r.createdBy)?.name ?? null })),
    documents: await documentsFor(db, [orderId]),
    cardFeeRefundable: o.cardFeePence - cardFeeRefunded(o, ctx.lines),
    canManage: access.permissions.has('manage_orders') && !actor.readOnly,
    canRefund: access.permissions.has('manage_orders') && access.permissions.has('refunds') && !actor.readOnly,
    paymentsMode: (await paymentsForEdition(o.editionId))?.kind ?? null,
  };
}

/** Commission and payouts by supplier for an edition (finance view). */
export async function commissionReport(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports')) throw forbidden();
  const db = await getDb();
  const rows = await db
    .select({ line: orderLines, order: orders })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orders.editionId, editionId), inArray(orders.status, ['paid', 'invoiced', 'partially_refunded', 'refunded'])));
  const names = await supplierNameMap(
    db,
    rows.map((r) => r.line),
  );
  type Row = { key: string; name: string; orders: Set<string>; grossPence: number; refundedPence: number; netPence: number; vatPence: number; commissionPence: number; cardFeePence: number; payoutPence: number; awaitingPaymentPence: number };
  const by = new Map<string, Row>();
  for (const { line, order } of rows) {
    const key = line.supplierId ?? 'organiser';
    const r =
      by.get(key) ??
      ({ key, name: line.supplierId ? (names.get(line.supplierId) ?? 'Unknown supplier') : 'Provided by the organiser', orders: new Set(), grossPence: 0, refundedPence: 0, netPence: 0, vatPence: 0, commissionPence: 0, cardFeePence: 0, payoutPence: 0, awaitingPaymentPence: 0 } as Row);
    const gross = lineGross(line);
    const keep = gross > 0 ? (gross - line.refundedPence) / gross : 0;
    r.orders.add(order.id);
    r.grossPence += gross;
    r.refundedPence += line.refundedPence;
    r.netPence += Math.round(line.netPence * keep);
    r.vatPence += Math.round(line.vatPence * keep);
    r.commissionPence += Math.round(line.commissionPence * keep);
    r.cardFeePence += line.cardFeeSharePence;
    const payout = line.supplierId ? linePayoutAfterRefunds(line) : 0;
    if (order.status === 'invoiced') r.awaitingPaymentPence += payout;
    else r.payoutPence += payout;
    by.set(key, r);
  }
  const transferRows = await db
    .select({ supplierId: supplierTransfers.supplierId, status: supplierTransfers.status, amount: supplierTransfers.amountPence, reversed: supplierTransfers.reversedPence, settledAt: supplierTransfers.settledAt })
    .from(supplierTransfers)
    .innerJoin(orders, eq(orders.id, supplierTransfers.orderId))
    .where(eq(orders.editionId, editionId));
  const paidOut = new Map<string, { sent: number; waiting: number; manualOwed: number; manualSettled: number }>();
  for (const t of transferRows) {
    const p = paidOut.get(t.supplierId) ?? { sent: 0, waiting: 0, manualOwed: 0, manualSettled: 0 };
    const net = t.amount - t.reversed;
    if (t.status === 'created' || t.status === 'partially_reversed' || t.status === 'reversed') p.sent += net;
    else if (t.status === 'manual') {
      if (t.settledAt) p.manualSettled += net;
      else p.manualOwed += net;
    } else p.waiting += net;
    paidOut.set(t.supplierId, p);
  }
  const suppliersOut = [...by.values()]
    .map((r) => ({ ...r, orders: r.orders.size, transfers: r.key === 'organiser' ? null : (paidOut.get(r.key) ?? { sent: 0, waiting: 0, manualOwed: 0, manualSettled: 0 }) }))
    .sort((a, b) => b.grossPence - a.grossPence);
  // Card fees charged on paid orders, less any card fee given back in a refund.
  const byOrder = new Map<string, { order: OrderRow; lines: LineRow[] }>();
  for (const { line, order } of rows) {
    const entry = byOrder.get(order.id) ?? { order, lines: [] };
    entry.lines.push(line);
    byOrder.set(order.id, entry);
  }
  let cardFeesCollectedPence = 0;
  for (const { order, lines } of byOrder.values()) {
    if (order.status === 'invoiced') continue;
    cardFeesCollectedPence += Math.max(0, order.cardFeePence - cardFeeRefunded(order, lines));
  }
  const totals = suppliersOut.reduce(
    (a, r) => ({
      grossPence: a.grossPence + r.grossPence,
      refundedPence: a.refundedPence + r.refundedPence,
      commissionPence: a.commissionPence + r.commissionPence,
      payoutPence: a.payoutPence + r.payoutPence + r.awaitingPaymentPence,
    }),
    { grossPence: 0, refundedPence: 0, commissionPence: 0, payoutPence: 0 },
  );
  return { suppliers: suppliersOut, totals: { ...totals, cardFeesCollectedPence } };
}

/** Every order line in an edition as CSV, for finance. Values are made safe for spreadsheets. */
export async function exportOrdersCsv(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports')) throw forbidden();
  const db = await getDb();
  const rows = await db
    .select({ line: orderLines, order: orders, companyName: companies.name, standNumber: stands.number, supplierName: suppliers.name })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(stands, eq(stands.id, orders.standId))
    .leftJoin(companies, eq(companies.id, orders.companyId))
    .leftJoin(suppliers, eq(suppliers.id, orderLines.supplierId))
    .where(eq(orders.editionId, editionId))
    .orderBy(asc(orders.createdAt));
  const header = ['Order', 'Placed', 'Status', 'Payment', 'Company', 'Stand', 'PO number', 'Item', 'Code', 'Options', 'Quantity', 'Unit net', 'VAT rate', 'Net', 'VAT', 'Gross', 'Refunded', 'Supplier', 'Commission', 'Card fee share', 'Supplier payout', 'Fulfilment'];
  const p = (pence: number) => (pence / 100).toFixed(2);
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.order.number,
        spreadsheetDateTime(r.order.createdAt),
        ORDER_STATUS_LABELS[r.order.status],
        r.order.paymentMethod,
        r.companyName ?? '',
        r.standNumber,
        r.order.poNumber ?? '',
        r.line.description,
        r.line.productCode ?? '',
        Object.entries(r.line.options ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('; '),
        String(r.line.quantity),
        p(r.line.unitPricePence),
        `${r.line.vatRateBps / 100}%`,
        p(r.line.netPence),
        p(r.line.vatPence),
        p(lineGross(r.line)),
        p(r.line.refundedPence),
        r.supplierName ?? 'Organiser',
        p(r.line.commissionPence),
        p(r.line.cardFeeSharePence),
        p(r.line.supplierPayoutPence),
        FULFILMENT_LABELS[r.line.fulfilmentStatus],
      ]
        .map(csvCell)
        .join(','),
    );
  }
  await audit(actor, 'shop.orders_exported', { entityType: 'edition', entityId: editionId, editionId, details: { rows: rows.length } });
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Suppliers: their own order lines and payouts only
// ---------------------------------------------------------------------------

async function assertSupplier(actor: Actor, supplierId: string) {
  if (!(await supplierIdsFor(actor)).includes(supplierId)) throw notFound();
}

/** A supplier's order lines, with the exhibitor's stand and contact for delivery. Nothing about other suppliers. */
export async function supplierOrders(actor: Actor, supplierId: string, opts: { editionId?: string | null; status?: 'open' | 'all' } = {}) {
  await assertSupplier(actor, supplierId);
  const db = await getDb();
  const conds = [eq(orderLines.supplierId, supplierId), inArray(orders.status, SUPPLIER_VISIBLE)];
  if (opts.editionId) conds.push(eq(orders.editionId, opts.editionId));
  if (opts.status === 'open') conds.push(inArray(orderLines.fulfilmentStatus, ['received', 'confirmed']));
  const rows = await db
    .select({
      line: orderLines,
      order: { id: orders.id, number: orders.number, status: orders.status, createdAt: orders.createdAt, poNumber: orders.poNumber, placedBy: orders.placedBy, editionId: orders.editionId },
      edition: { id: editions.id, name: editions.name },
      standNumber: stands.number,
      hallName: halls.name,
      companyName: companies.name,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(editions, eq(editions.id, orders.editionId))
    .innerJoin(stands, eq(stands.id, orders.standId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(companies, eq(companies.id, orders.companyId))
    .where(and(...conds))
    .orderBy(desc(orders.createdAt))
    .limit(1000);
  const placerIds = [...new Set(rows.map((r) => r.order.placedBy).filter((x): x is string => Boolean(x)))];
  const placers = placerIds.length ? await db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone }).from(users).where(inArray(users.id, placerIds)) : [];
  const editionsSeen = new Map<string, string>();
  for (const r of rows) editionsSeen.set(r.edition.id, r.edition.name);
  return {
    lines: rows.map((r) => ({
      id: r.line.id,
      description: r.line.description,
      productCode: r.line.productCode,
      options: r.line.options,
      details: r.line.details,
      quantity: r.line.quantity,
      unitPricePence: r.line.unitPricePence,
      netPence: r.line.netPence,
      refundedPence: r.line.refundedPence,
      payoutPence: linePayoutAfterRefunds(r.line),
      fulfilmentStatus: r.line.fulfilmentStatus,
      order: { id: r.order.id, number: r.order.number, status: r.order.status, createdAt: r.order.createdAt, poNumber: r.order.poNumber },
      edition: r.edition,
      stand: { number: r.standNumber, hall: r.hallName },
      companyName: r.companyName,
      contact: placers.find((p) => p.id === r.order.placedBy) ?? null,
    })),
    editions: [...editionsSeen.entries()].map(([id, name]) => ({ id, name })),
  };
}

/** The shows a supplier has orders in, newest first, for choosing one. */
export async function supplierOrderShows(actor: Actor, supplierId: string) {
  await assertSupplier(actor, supplierId);
  const db = await getDb();
  return db
    .selectDistinct({ id: editions.id, name: editions.name, buildUpStartsAt: editions.buildUpStartsAt })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(editions, eq(editions.id, orders.editionId))
    .where(and(eq(orderLines.supplierId, supplierId), inArray(orders.status, SUPPLIER_VISIBLE)))
    .orderBy(desc(editions.buildUpStartsAt));
}

export async function supplierOrdersCsv(actor: Actor, supplierId: string, editionId: string | null) {
  const { lines } = await supplierOrders(actor, supplierId, { editionId });
  const header = ['Order', 'Placed', 'Show', 'Company', 'Stand', 'Hall', 'Contact', 'Email', 'Phone', 'Item', 'Code', 'Options', 'Details', 'Quantity', 'Your payout', 'Status'];
  const out = [header.map(csvCell).join(',')];
  for (const l of lines) {
    out.push(
      [
        l.order.number,
        spreadsheetDateTime(l.order.createdAt),
        l.edition.name,
        l.companyName ?? '',
        l.stand.number,
        l.stand.hall ?? '',
        l.contact?.name ?? '',
        l.contact?.email ?? '',
        l.contact?.phone ?? '',
        l.description,
        l.productCode ?? '',
        Object.entries(l.options ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('; '),
        Object.entries(l.details ?? {})
          .map(([k, v]) => `${k}: ${answerText(v)}`)
          .join('; '),
        String(l.quantity),
        (l.payoutPence / 100).toFixed(2),
        FULFILMENT_LABELS[l.fulfilmentStatus],
      ]
        .map(csvCell)
        .join(','),
    );
  }
  await audit(actor, 'supplier.orders_exported', { entityType: 'supplier', entityId: supplierId, details: { rows: lines.length } });
  return out.join('\r\n');
}

export async function supplierPayouts(actor: Actor, supplierId: string) {
  await assertSupplier(actor, supplierId);
  const db = await getDb();
  const rows = await db
    .select({ t: supplierTransfers, orderNumber: orders.number, editionName: editions.name, paidAt: orders.paidAt })
    .from(supplierTransfers)
    .innerJoin(orders, eq(orders.id, supplierTransfers.orderId))
    .innerJoin(editions, eq(editions.id, orders.editionId))
    .where(eq(supplierTransfers.supplierId, supplierId))
    .orderBy(desc(supplierTransfers.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.t.id,
    orderNumber: r.orderNumber,
    editionName: r.editionName,
    amountPence: r.t.amountPence,
    reversedPence: r.t.reversedPence,
    status: r.t.status,
    settledAt: r.t.settledAt,
    createdAt: r.t.createdAt,
    // Said to the supplier themselves.
    waitingReason: r.t.status === 'pending' ? (r.t.error === WAITING_FOR_SUPPLIER ? 'Waiting for you to finish setting up payouts.' : r.t.error) : null,
  }));
}

// ---------------------------------------------------------------------------
// Stripe webhooks
// ---------------------------------------------------------------------------

type StripeObject = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

/**
 * Applies one verified Stripe event. Each event is processed once: its id is recorded first,
 * and an event that was already processed is acknowledged without doing anything again.
 */
export async function handleStripeEvent(event: WebhookEvent) {
  const db = await getDb();
  const [fresh] = await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  if (!fresh) {
    const [seen] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, event.id)).limit(1);
    if (seen?.processedAt) return { duplicate: true };
  }
  try {
    const obj = event.data.object as StripeObject;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (obj.payment_status !== 'paid') break;
        const order = await orderForSession(str(obj.id), str(obj.client_reference_id));
        if (order) await markOrderPaid(order.id, { paymentIntentId: str(obj.payment_intent), amountPence: num(obj.amount_total), currency: str(obj.currency), via: 'webhook' });
        break;
      }
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const order = await orderForSession(str(obj.id), str(obj.client_reference_id));
        if (order && order.status === 'pending_payment') {
          await db
            .update(orders)
            .set({ status: event.type === 'checkout.session.expired' ? 'cancelled' : 'payment_failed', cancelledAt: new Date() })
            .where(and(eq(orders.id, order.id), eq(orders.status, 'pending_payment')));
          await audit(SYSTEM_ACTOR, event.type === 'checkout.session.expired' ? 'shop.checkout_expired' : 'shop.payment_failed', { entityType: 'order', entityId: order.id, editionId: order.editionId });
        }
        break;
      }
      case 'account.updated': {
        const accountId = str(obj.id);
        if (!accountId) break;
        const [s] = await db.select().from(suppliers).where(eq(suppliers.stripeAccountId, accountId)).limit(1);
        if (!s) break;
        const payoutsEnabled = obj.payouts_enabled === true;
        await db
          .update(suppliers)
          .set({ stripeChargesEnabled: obj.charges_enabled === true, stripePayoutsEnabled: payoutsEnabled, stripeDetailsSubmitted: obj.details_submitted === true })
          .where(eq(suppliers.id, s.id));
        if (payoutsEnabled && !s.stripePayoutsEnabled) await processTransfers({ supplierId: s.id });
        break;
      }
      case 'refund.updated':
      case 'refund.failed': {
        const stripeRefundId = str(obj.id);
        const status = str(obj.status);
        const ours = str((obj.metadata as Record<string, unknown> | undefined)?.blueprintRefundId);
        if (!stripeRefundId || !status) break;
        // Find the refund by Stripe's id, or by our own id in its metadata (if BluePrint stopped
        // before it could record Stripe's id, the webhook still completes the refund).
        let [r] = await db.select().from(refunds).where(eq(refunds.stripeRefundId, stripeRefundId)).limit(1);
        if (!r && ours && /^[0-9a-f-]{36}$/i.test(ours)) [r] = await db.select().from(refunds).where(eq(refunds.id, ours)).limit(1);
        if (!r) break;
        if (status === 'succeeded' || status === 'pending' || status === 'requires_action') {
          await db
            .update(refunds)
            .set({ status: status === 'succeeded' ? 'succeeded' : 'pending', stripeRefundId, error: null })
            .where(and(eq(refunds.id, r.id), ne(refunds.status, 'failed')));
          if (!r.appliedAt && (await applyRefund(r.id))) await finishRefund(r.id, { notify: true });
        }
        if ((status === 'failed' || status === 'canceled') && r.status !== 'failed') {
          await db.update(refunds).set({ status: 'failed', error: `Stripe reported the refund ${status}. Contact the exhibitor and refund them another way.` }).where(eq(refunds.id, r.id));
          await audit(SYSTEM_ACTOR, 'shop.refund_failed', { entityType: 'order', entityId: r.orderId, details: { refundId: r.id, status } });
          await alertFailedRefund(r.orderId, r.amountPence, Boolean(r.appliedAt));
        }
        break;
      }
      default:
        break;
    }
    await db.update(stripeEvents).set({ processedAt: new Date(), error: null }).where(eq(stripeEvents.id, event.id));
    return { duplicate: false };
  } catch (err) {
    await db
      .update(stripeEvents)
      .set({ error: err instanceof Error ? err.message.slice(0, 500) : 'failed' })
      .where(eq(stripeEvents.id, event.id));
    throw err;
  }
}

async function orderForSession(sessionId: string | null, orderId: string | null) {
  if (!sessionId) return null;
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  // The session must be the one BluePrint created for that order.
  if (!o || (orderId && o.id !== orderId)) return null;
  return o;
}

/** Payment health for the super admin: mode, recent webhook activity and payouts needing attention. */
export async function paymentsHealth() {
  const db = await getDb();
  const p = payments();
  const [lastEvent] = await db.select().from(stripeEvents).orderBy(desc(stripeEvents.receivedAt)).limit(1);
  const failedEvents = await db
    .select()
    .from(stripeEvents)
    .where(and(isNotNull(stripeEvents.error), sql`${stripeEvents.processedAt} is null`))
    .orderBy(desc(stripeEvents.receivedAt))
    .limit(20);
  const attention = await db
    .select({ t: supplierTransfers, supplierName: suppliers.name, orderNumber: orders.number, editionId: orders.editionId, editionName: editions.name })
    .from(supplierTransfers)
    .innerJoin(suppliers, eq(suppliers.id, supplierTransfers.supplierId))
    .innerJoin(orders, eq(orders.id, supplierTransfers.orderId))
    .innerJoin(editions, eq(editions.id, orders.editionId))
    .where(or(inArray(supplierTransfers.status, ['failed', 'pending']), and(eq(supplierTransfers.status, 'manual'), sql`${supplierTransfers.settledAt} is null`)))
    .orderBy(desc(supplierTransfers.createdAt))
    .limit(200);
  const failedRefunds = await db
    .select({ r: refunds, orderNumber: orders.number, editionId: orders.editionId })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(eq(refunds.status, 'failed'))
    .orderBy(desc(refunds.createdAt))
    .limit(50);
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  return {
    mode: p?.kind === 'stripe' ? (/_test_/.test(key) ? 'stripe_test' : 'stripe_live') : p?.kind === 'simulator' ? 'simulator' : 'off',
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    lastEvent: lastEvent ?? null,
    failedEvents,
    attention: attention.map((a) => ({ ...a.t, supplierName: a.supplierName, orderNumber: a.orderNumber, editionId: a.editionId, editionName: a.editionName })),
    failedRefunds: failedRefunds.map((f) => ({ ...f.r, orderNumber: f.orderNumber, editionId: f.editionId })),
  };
}
