import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { companies, halls, orderLines, orders, stands, suppliers } from '../db/schema';
import { getEditionAccess } from '../authz';
import { forbidden, notFound } from '../errors';
import { lineGross } from './orders';
import type { Actor } from '../auth/actor';
import { answerText } from '@/lib/order-details';

/**
 * What exhibitors have ordered, laid out for delivery: by hall and stand, and totals by product.
 * Only orders that are paid or on invoice count, without cancelled or fully refunded items.
 */

const LIVE_ORDERS = ['paid', 'invoiced', 'partially_refunded'];

/** Every order line in a show, with its order, stand, hall, company and supplier. No permission check. */
export async function orderLinesForEdition(editionId: string) {
  const db = await getDb();
  return db
    .select({ line: orderLines, order: orders, companyName: companies.name, standNumber: stands.number, hallName: halls.name, supplierName: suppliers.name })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(stands, eq(stands.id, orders.standId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(companies, eq(companies.id, orders.companyId))
    .leftJoin(suppliers, eq(suppliers.id, orderLines.supplierId))
    .where(eq(orders.editionId, editionId))
    .orderBy(asc(orders.createdAt));
}

export type OrderLineRow = Awaited<ReturnType<typeof orderLinesForEdition>>[number];

/** Options chosen and answers given for an order line, as one line of text. */
export function describeLineDetails(line: { options: Record<string, string> | null; details: Record<string, unknown> | null }) {
  return [...Object.entries(line.options ?? {}), ...Object.entries(line.details ?? {})]
    .map(([k, v]) => {
      const label = k.trim();
      // Questions already end in "?" or ":", so they do not need another colon.
      return `${label}${/[?:.!]$/.test(label) ? ' ' : ': '}${answerText(v)}`;
    })
    .join('; ');
}

/** Lines to deliver, sorted by hall, then stand, then item. No permission check. */
export async function deliverableLines(editionId: string) {
  const all = await orderLinesForEdition(editionId);
  return all
    .filter((r) => LIVE_ORDERS.includes(r.order.status) && r.line.fulfilmentStatus !== 'cancelled' && r.line.refundedPence < lineGross(r.line))
    .sort(
      (a, b) =>
        (a.hallName ?? '').localeCompare(b.hallName ?? '', 'en-GB') ||
        a.standNumber.localeCompare(b.standNumber, 'en-GB', { numeric: true }) ||
        a.line.description.localeCompare(b.line.description, 'en-GB'),
    );
}

export function totalsByProduct(lines: OrderLineRow[]) {
  const products = new Map<string, { key: string; item: string; supplier: string; quantity: number; delivered: number; stands: string[] }>();
  for (const r of lines) {
    const key = `${r.line.productId ?? r.line.description}|${r.line.supplierId ?? ''}`;
    const p = products.get(key) ?? { key, item: r.line.description, supplier: r.supplierName ?? 'Organiser', quantity: 0, delivered: 0, stands: [] };
    p.quantity += r.line.quantity;
    if (r.line.fulfilmentStatus === 'delivered') p.delivered += r.line.quantity;
    if (!p.stands.includes(r.standNumber)) p.stands.push(r.standNumber);
    products.set(key, p);
  }
  return [...products.values()]
    .map((p) => ({ ...p, stands: p.stands.sort((a, b) => a.localeCompare(b, 'en-GB', { numeric: true })) }))
    .sort((a, b) => a.supplier.localeCompare(b.supplier, 'en-GB') || a.item.localeCompare(b.item, 'en-GB'));
}

/** The services page for the show team. */
export async function servicesForEdition(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports')) throw forbidden();
  const lines = await deliverableLines(editionId);
  return { lines, products: totalsByProduct(lines) };
}
