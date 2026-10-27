import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import { cartItems, companies, editions, orderLines, orders, products, serviceCategories, stands, suppliers, type ProductDetailField } from '../db/schema';
import { requireStandAccess } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { assertRateLimit } from '../security/rate-limit';
import { appUrl } from '../auth/login';
import { paymentsForEdition, SimulatedPayments } from '../payments/provider';
import { isDemoEdition } from '../demo/flags';
import { getPlatformSettings, type PlatformSettings } from './settings';
import { assertEditionOpen } from './portal';
import { soldQuantities } from './catalogue';
import { closeCheckout, expireStaleOrders, finishInvoiceOrder, markOrderPaid, nextNumber } from './orders';
import { currentUnitPrice, priceOrder, resolveCommission, type LineInput } from '@/lib/pricing';
import { isFileAnswer, type FileAnswer } from '@/lib/order-details';
import { requireOwnVerifiedFile } from './files';
import type { Actor } from '../auth/actor';

/**
 * The exhibitor side of the services shop: what a stand can buy, its basket and checkout.
 * Prices are always worked out here from the catalogue; the browser only says what and how many.
 */

const DAY = 86_400_000;
const MAX_BASKET_ITEMS = 100;

type EditionRow = typeof editions.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type CategoryRow = typeof serviceCategories.$inferSelect;

const visibleTo = (typeIds: string[], typeId: string) => typeIds.length === 0 || typeIds.includes(typeId);

function orderByDate(category: CategoryRow, edition: EditionRow) {
  if (category.orderByOffsetDays === null || !edition.buildUpStartsAt) return null;
  return new Date(edition.buildUpStartsAt.getTime() - category.orderByOffsetDays * DAY);
}

/** What the exhibitor sees about a product: never commission or supplier finances. */
function productView(p: ProductRow, edition: EditionRow, stockLeft: number | null, supplierName: string | null, now = new Date()) {
  const price = currentUnitPrice(p, edition.buildUpStartsAt, now);
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: p.name,
    code: p.code,
    description: p.description,
    imageUrl: p.imageFileId ? `/files/${p.imageFileId}` : null,
    unit: p.unit,
    unitPence: price.unitPence,
    band: price.band,
    bandUntil: price.until,
    standardPence: p.pricePence,
    latePence: p.latePricePence,
    lateFrom: p.latePricePence !== null && p.lateFromOffsetDays !== null && edition.buildUpStartsAt ? new Date(edition.buildUpStartsAt.getTime() - p.lateFromOffsetDays * DAY) : null,
    vatRateBps: p.vatRateBps,
    options: p.options,
    requiredDetails: p.requiredDetails,
    stockLeft,
    supplierName,
  };
}
export type ShopProduct = ReturnType<typeof productView>;

async function standContext(db: DbLike, standId: string) {
  const [row] = await db
    .select({ stand: stands, edition: editions, company: companies })
    .from(stands)
    .innerJoin(editions, eq(editions.id, stands.editionId))
    .innerJoin(companies, eq(companies.id, stands.companyId))
    .where(eq(stands.id, standId))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/** The categories and products this stand can buy, in the show team's order. */
export async function shopForStand(actor: Actor, standId: string) {
  await requireStandAccess(actor, standId);
  const db = await getDb();
  const { stand, edition } = await standContext(db, standId);
  const cats = (await db.select().from(serviceCategories).where(eq(serviceCategories.editionId, edition.id)).orderBy(asc(serviceCategories.sort), asc(serviceCategories.name))).filter((c) =>
    visibleTo(c.visibleToTypes, stand.exhibitorTypeId),
  );
  const rows = cats.length
    ? (
        await db
          .select({ product: products, supplierName: suppliers.name })
          .from(products)
          .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
          .where(
            and(
              eq(products.status, 'approved'),
              inArray(
                products.categoryId,
                cats.map((c) => c.id),
              ),
            ),
          )
          .orderBy(asc(products.sort), asc(products.name))
      ).filter((r) => visibleTo(r.product.visibleToTypes, stand.exhibitorTypeId))
    : [];
  const limited = rows.filter((r) => r.product.stockLimit !== null).map((r) => r.product.id);
  const sold = await soldQuantities(db, limited);
  const now = new Date();
  const categories = cats
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      orderBy: orderByDate(c, edition),
      products: rows
        .filter((r) => r.product.categoryId === c.id)
        .map((r) => productView(r.product, edition, r.product.stockLimit === null ? null : Math.max(0, r.product.stockLimit - (sold.get(r.product.id) ?? 0)), r.supplierName, now)),
    }))
    .filter((c) => c.products.length > 0);
  const [{ n: basketCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(cartItems).where(eq(cartItems.standId, standId));
  return { categories, basketCount, buildUpStartsAt: edition.buildUpStartsAt };
}

export async function basketCountForStand(actor: Actor, standId: string) {
  await requireStandAccess(actor, standId);
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(cartItems).where(eq(cartItems.standId, standId));
  return Number(r?.n ?? 0);
}

export const addToBasketSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, 'Choose at least one.').max(999, 'For more than 999, contact the show team.'),
  options: z.record(z.string().max(80), z.string().max(80)).default({}),
  details: z.record(z.string().max(40), z.string().max(2000)).default({}),
});

/**
 * Checks chosen options and answers against the product, returning only what it asks for.
 * A file answer must be a checked upload the person made for this stand; it is kept as `{ file, name }`.
 */
async function cleanChoices(actor: Actor, standId: string, p: ProductRow, options: Record<string, string>, details: Record<string, string>) {
  const cleanOptions: Record<string, string> = {};
  for (const o of p.options) {
    const v = options[o.name];
    if (!v || !o.values.includes(v)) throw invalid(`Choose a ${o.name.toLowerCase()}.`, { [`options.${o.name}`]: `Choose a ${o.name.toLowerCase()}.` });
    cleanOptions[o.name] = v;
  }
  const cleanDetails: Record<string, string | FileAnswer> = {};
  for (const q of p.requiredDetails as ProductDetailField[]) {
    const v = (details[q.id] ?? '').toString().trim();
    if (q.required && !v) throw invalid(q.type === 'file' ? `Upload: ${q.label}` : `Answer: ${q.label}`, { [`details.${q.id}`]: q.type === 'file' ? 'Please upload the file.' : 'Please answer this.' });
    if (!v) continue;
    if (q.type === 'file') {
      const problem = { [`details.${q.id}`]: 'Please upload the file again.' };
      if (!/^[0-9a-f-]{36}$/i.test(v)) throw invalid('That upload could not be found. Please upload it again.', problem);
      const f = await requireOwnVerifiedFile(actor, v, 'order').catch(() => {
        throw invalid('That upload could not be found. Please upload it again.', problem);
      });
      if (f.standId !== standId) throw invalid('That upload could not be found. Please upload it again.', problem);
      cleanDetails[q.id] = { file: f.id, name: f.originalName };
      continue;
    }
    const max = q.type === 'textarea' ? 2000 : 300;
    if (v.length > max) throw invalid(`${q.label} is too long.`, { [`details.${q.id}`]: `Use at most ${max} characters.` });
    cleanDetails[q.id] = v;
  }
  return { options: cleanOptions, details: cleanDetails };
}

async function buyableProduct(db: DbLike, productId: string, stand: typeof stands.$inferSelect) {
  const [row] = await db
    .select({ product: products, category: serviceCategories })
    .from(products)
    .innerJoin(serviceCategories, eq(serviceCategories.id, products.categoryId))
    .where(eq(products.id, productId))
    .limit(1);
  if (!row || row.product.editionId !== stand.editionId) throw notFound();
  if (row.product.status !== 'approved' || !visibleTo(row.product.visibleToTypes, stand.exhibitorTypeId) || !visibleTo(row.category.visibleToTypes, stand.exhibitorTypeId)) {
    throw invalid('That item is no longer available.');
  }
  return row;
}

export async function addToBasket(actor: Actor, standId: string, raw: z.input<typeof addToBasketSchema>) {
  const { stand } = await requireStandAccess(actor, standId, { write: true });
  await assertEditionOpen(actor, stand.editionId);
  await assertRateLimit(`basket:${actor.realUserId}`, 300, 3600);
  const input = addToBasketSchema.parse(raw);
  const db = await getDb();
  const { product } = await buyableProduct(db, input.productId, stand);
  const choice = await cleanChoices(actor, standId, product, input.options, input.details);
  const existing = await db.select().from(cartItems).where(eq(cartItems.standId, standId));
  if (existing.length >= MAX_BASKET_ITEMS) throw conflict('Your basket is full. Please check out before adding more.');
  const same = existing.find((i) => i.productId === product.id && JSON.stringify(i.options) === JSON.stringify(choice.options) && JSON.stringify(i.details) === JSON.stringify(choice.details));
  if (product.stockLimit !== null) {
    const sold = (await soldQuantities(db, [product.id])).get(product.id) ?? 0;
    const inBasket = existing.filter((i) => i.productId === product.id).reduce((a, i) => a + i.quantity, 0);
    const left = product.stockLimit - sold - inBasket;
    if (input.quantity > left) throw conflict(left > 0 ? `Only ${left} more available.` : 'Sorry, this has sold out.');
  }
  if (same) {
    const quantity = Math.min(999, same.quantity + input.quantity);
    await db.update(cartItems).set({ quantity }).where(eq(cartItems.id, same.id));
  } else {
    await db.insert(cartItems).values({ standId, productId: product.id, quantity: input.quantity, options: choice.options, details: choice.details, addedBy: actor.userId });
  }
  return { count: existing.length + (same ? 0 : 1) };
}

async function ownItem(actor: Actor, standId: string, itemId: string) {
  const { stand } = await requireStandAccess(actor, standId, { write: true });
  await assertEditionOpen(actor, stand.editionId);
  const db = await getDb();
  const [item] = await db.select().from(cartItems).where(and(eq(cartItems.id, itemId), eq(cartItems.standId, standId))).limit(1);
  if (!item) throw notFound();
  return { db, item };
}

export async function updateBasketItem(actor: Actor, standId: string, itemId: string, quantity: number) {
  const { db, item } = await ownItem(actor, standId, itemId);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) throw invalid('Choose a quantity between 0 and 999.');
  if (quantity === 0) await db.delete(cartItems).where(eq(cartItems.id, item.id));
  else await db.update(cartItems).set({ quantity }).where(eq(cartItems.id, item.id));
}

export async function removeBasketItem(actor: Actor, standId: string, itemId: string) {
  const { db, item } = await ownItem(actor, standId, itemId);
  await db.delete(cartItems).where(eq(cartItems.id, item.id));
}

type BasketProblem = 'unavailable' | 'stock';

/** Prices the basket exactly as checkout will, and says what (if anything) stops it being bought. */
async function priceBasket(db: DbLike, standId: string, method: 'card' | 'invoice', settings: PlatformSettings, now = new Date()) {
  const { stand, edition, company } = await standContext(db, standId);
  const items = await db
    .select({ item: cartItems, product: products, category: serviceCategories, supplier: suppliers })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .innerJoin(serviceCategories, eq(serviceCategories.id, products.categoryId))
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(eq(cartItems.standId, standId))
    .orderBy(asc(cartItems.createdAt));
  const sold = await soldQuantities(
    db,
    items.filter((i) => i.product.stockLimit !== null).map((i) => i.product.id),
  );
  const wanted = new Map<string, number>();
  for (const i of items) wanted.set(i.product.id, (wanted.get(i.product.id) ?? 0) + i.item.quantity);

  const view = items.map((i) => {
    let problem: BasketProblem | null = null;
    const p = i.product;
    if (p.editionId !== edition.id || p.status !== 'approved' || !visibleTo(p.visibleToTypes, stand.exhibitorTypeId) || !visibleTo(i.category.visibleToTypes, stand.exhibitorTypeId) || (i.supplier && i.supplier.status !== 'active')) {
      problem = 'unavailable';
    } else if (p.stockLimit !== null && (wanted.get(p.id) ?? 0) > p.stockLimit - (sold.get(p.id) ?? 0)) {
      problem = 'stock';
    }
    const price = currentUnitPrice(p, edition.buildUpStartsAt, now);
    return {
      itemId: i.item.id,
      productId: p.id,
      categoryId: i.category.id,
      name: p.name,
      code: p.code,
      unit: p.unit,
      imageUrl: p.imageFileId ? `/files/${p.imageFileId}` : null,
      options: i.item.options,
      details: i.item.details,
      quantity: i.item.quantity,
      unitPence: price.unitPence,
      band: price.band,
      vatRateBps: p.vatRateBps,
      supplierId: p.supplierId,
      stockLeft: p.stockLimit === null ? null : Math.max(0, p.stockLimit - (sold.get(p.id) ?? 0)),
      problem,
      commission: resolveCommission(
        { type: p.commissionType, value: p.commissionValue },
        { type: i.category.commissionType, value: i.category.commissionValue },
        i.supplier ? { type: i.supplier.commissionType, value: i.supplier.commissionValue } : null,
        { type: edition.defaultCommissionType, value: edition.defaultCommissionValue },
        { type: settings.defaultCommissionType, value: settings.defaultCommissionValue },
      ),
      supplierChargesVat: i.supplier ? i.supplier.vatRegistered : true,
      // Answers stored on the order under the question asked, so they read well everywhere later.
      detailLabels: Object.fromEntries(
        Object.entries(i.item.details).map(([k, val]) => [(p.requiredDetails as ProductDetailField[]).find((q) => q.id === k)?.label ?? k, isFileAnswer(val) ? val : String(val)]),
      ) as Record<string, string | FileAnswer>,
    };
  });
  const buyable = view.filter((v) => !v.problem);
  const feeMode = edition.feeMode ?? settings.feeMode;
  const lines: LineInput[] = buyable.map((v) => ({
    key: v.itemId,
    unitPence: v.unitPence,
    quantity: v.quantity,
    vatRateBps: v.vatRateBps,
    supplierId: v.supplierId,
    supplierChargesVat: v.supplierChargesVat,
    commission: v.commission,
  }));
  const priced = priceOrder(lines, { method, feeMode, cardFee: { percentBps: settings.stripeFeePercentBps, fixedPence: settings.stripeFeeFixedPence } });
  return { stand, edition, company, settings, items: view, buyable, priced, feeMode };
}

/** The basket as the exhibitor sees it, priced for the chosen way of paying. */
export async function basketForStand(actor: Actor, standId: string, method: 'card' | 'invoice' = 'card') {
  const { membership, stand } = await requireStandAccess(actor, standId);
  const db = await getDb();
  const b = await priceBasket(db, standId, method, await getPlatformSettings());
  const p = await paymentsForEdition(stand.editionId);
  const canPay = membership.role === 'main_contact' || membership.canPay;
  return {
    items: b.items.map((i) => {
      const line = b.priced.lines.find((l) => l.key === i.itemId);
      return {
        itemId: i.itemId,
        productId: i.productId,
        name: i.name,
        code: i.code,
        unit: i.unit,
        imageUrl: i.imageUrl,
        options: i.options,
        // Under the question asked, as on the order, so the basket reads the same.
        details: i.detailLabels,
        quantity: i.quantity,
        unitPence: i.unitPence,
        band: i.band,
        vatRateBps: i.vatRateBps,
        stockLeft: i.stockLeft,
        problem: i.problem,
        netPence: line?.netPence ?? i.unitPence * i.quantity,
        vatPence: line?.vatPence ?? 0,
      };
    }),
    totals: { netPence: b.priced.netPence, vatPence: b.priced.vatPence, cardFeePence: b.priced.cardFeePence, totalPence: b.priced.totalPence },
    methods: { card: Boolean(p), invoice: b.company.invoiceAllowed },
    /** A demo show: card payments go to the practice payment page. */
    practice: await isDemoEdition(stand.editionId),
    method,
    feeMode: b.feeMode,
    canPay,
    terms: b.settings.orderTerms,
    hasProblems: b.items.some((i) => i.problem),
  };
}

export const checkoutSchema = z.object({
  method: z.enum(['card', 'invoice']),
  poNumber: z.string().trim().max(60).optional().nullable(),
  acceptTerms: z.boolean().default(false),
  /** The total the exhibitor saw; checkout stops if prices changed in the meantime. */
  expectedTotalPence: z.number().int().min(0),
});

/**
 * Places the order. Stock is checked with the products locked, so two exhibitors cannot buy the
 * last item at once. Card orders return the payment page to send the exhibitor to.
 */
export async function checkout(actor: Actor, standId: string, raw: z.input<typeof checkoutSchema>) {
  const { stand } = await requireStandAccess(actor, standId, { pay: true });
  await assertEditionOpen(actor, stand.editionId);
  await assertRateLimit(`checkout:${actor.realUserId}`, 20, 3600);
  const input = checkoutSchema.parse(raw);
  const db = await getDb();
  const settings = await getPlatformSettings();
  if (settings.orderTerms && !input.acceptTerms) throw invalid('Please accept the terms to place your order.', { acceptTerms: 'Please accept the terms.' });
  // Return addresses come from the stand's own show, never from anything the browser sent.
  const { company, edition: standEdition } = await standContext(db, standId);
  if (input.method === 'invoice' && !company.invoiceAllowed) throw forbidden('Paying by invoice has not been set up for your company. Please pay by card.');

  // Release this stand's abandoned checkouts, and close any still open so nothing can be paid twice.
  await expireStaleOrders({ standId });
  const open = await db.select().from(orders).where(and(eq(orders.standId, standId), eq(orders.status, 'pending_payment')));
  for (const o of open) {
    const cancelled = await closeCheckout(o);
    if (!cancelled) {
      const [now] = await db.select().from(orders).where(eq(orders.id, o.id)).limit(1);
      if (now?.status === 'paid') throw conflict(`Your earlier payment for order ${o.number} has gone through. Check your orders before buying again.`);
      throw conflict('An earlier payment is still being processed. Please try again in a minute.');
    }
  }

  const provider = await paymentsForEdition(stand.editionId);
  const demo = await isDemoEdition(stand.editionId);
  const created = await db.transaction(async (tx) => {
    const ids = (await tx.select({ productId: cartItems.productId }).from(cartItems).where(eq(cartItems.standId, standId))).map((r) => r.productId);
    if (!ids.length) throw invalid('Your basket is empty.');
    // Lock the products in a fixed order, then check stock and prices with nobody else buying them.
    await tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, [...new Set(ids)].sort()))
      .orderBy(asc(products.id))
      .for('update');
    // Everything inside the transaction reads through it (settings were read before it began).
    const b = await priceBasket(tx, standId, input.method, settings);
    if (b.items.some((i) => i.problem)) throw conflict('Something in your basket is no longer available or has sold out. Please review your basket.');
    if (b.priced.totalPence !== input.expectedTotalPence) throw conflict('Prices have changed since you opened your basket. Please check the new total.');
    if (input.method === 'card' && b.priced.totalPence > 0 && !provider) throw conflict('Card payments are not available at the moment. Please contact the show team.');
    const free = b.priced.totalPence === 0;
    const number = await nextNumber(tx, 'order', { demo });
    const now = new Date();
    const [order] = await tx
      .insert(orders)
      .values({
        number,
        editionId: b.edition.id,
        standId,
        companyId: b.stand.companyId,
        placedBy: actor.userId,
        status: input.method === 'invoice' ? 'invoiced' : free ? 'paid' : 'pending_payment',
        paymentMethod: input.method,
        feeMode: b.feeMode,
        netPence: b.priced.netPence,
        vatPence: b.priced.vatPence,
        commissionPence: b.priced.commissionPence,
        cardFeePence: b.priced.cardFeePence,
        totalPence: b.priced.totalPence,
        poNumber: input.poNumber || null,
        dueAt: input.method === 'invoice' ? new Date(now.getTime() + settings.invoicing.dueDays * DAY) : null,
        paidAt: free && input.method === 'card' ? now : null,
      })
      .returning();
    for (const v of b.buyable) {
      const l = b.priced.lines.find((x) => x.key === v.itemId)!;
      await tx.insert(orderLines).values({
        orderId: order.id,
        productId: v.productId,
        supplierId: v.supplierId,
        categoryId: v.categoryId,
        description: v.name,
        productCode: v.code,
        quantity: v.quantity,
        unitPricePence: v.unitPence,
        vatRateBps: v.vatRateBps,
        netPence: l.netPence,
        vatPence: l.vatPence,
        commissionPence: l.commissionPence,
        cardFeeSharePence: l.cardFeeSharePence,
        supplierPayoutPence: l.supplierPayoutPence,
        options: v.options,
        details: v.detailLabels,
        cartItemId: v.itemId,
      });
    }
    return order;
  });
  await audit(actor, 'shop.order_placed', {
    entityType: 'order',
    entityId: created.id,
    editionId: created.editionId,
    companyId: created.companyId,
    details: { number: created.number, method: created.paymentMethod, totalPence: created.totalPence },
  });

  if (created.status === 'pending_payment') {
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, created.id));
    try {
      const session = await provider!.createCheckout({
        orderId: created.id,
        orderNumber: created.number,
        lines: [
          ...lines.map((l) => ({ name: `${l.quantity} × ${l.description}${Object.keys(l.options).length ? ` (${Object.values(l.options).join(', ')})` : ''}`, amountPence: l.netPence + l.vatPence, quantity: 1 })),
          ...(created.cardFeePence ? [{ name: 'Card processing fee', amountPence: created.cardFeePence, quantity: 1 }] : []),
        ].filter((l) => l.amountPence > 0),
        customerEmail: actor.email,
        successUrl: appUrl(`/portal/${standEdition.slug}/orders/${created.id}?checkout=done`),
        cancelUrl: appUrl(`/portal/${standEdition.slug}/shop/basket?checkout=cancelled&order=${created.id}`),
      });
      await db.update(orders).set({ stripeCheckoutSessionId: session.id }).where(eq(orders.id, created.id));
      return { orderId: created.id, number: created.number, redirectUrl: session.url };
    } catch (err) {
      console.error('Checkout session failed', err);
      await db.update(orders).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(orders.id, created.id));
      throw conflict('We could not start the card payment. Nothing has been charged. Please try again.');
    }
  }

  // Free orders and invoice orders are complete now.
  if (created.status === 'paid') {
    await markOrderPaid(created.id, { paymentIntentId: null, via: 'free' });
  } else {
    await finishInvoiceOrder(created.id);
  }
  return { orderId: created.id, number: created.number, redirectUrl: null };
}

/**
 * The exhibitor is back from the payment page. Asks the payment provider directly, so the order
 * shows as paid straight away even if the webhook is still on its way.
 */
export async function confirmCheckoutReturn(actor: Actor, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) throw notFound();
  await requireStandAccess(actor, o.standId);
  if (o.status !== 'pending_payment' || !o.stripeCheckoutSessionId) return o.status;
  const p = await paymentsForEdition(o.editionId);
  if (!p) return o.status;
  try {
    const s = await p.checkoutStatus(o.stripeCheckoutSessionId);
    if (s.paid) {
      await markOrderPaid(o.id, { paymentIntentId: s.paymentIntentId, amountPence: s.amountTotal, currency: s.currency, via: 'return' });
      return 'paid';
    }
  } catch (err) {
    console.error('Could not check payment', err);
  }
  return o.status;
}

/** The exhibitor gives up on an unpaid card checkout; its stock is released straight away. */
export async function cancelMyCheckout(actor: Actor, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) throw notFound();
  await requireStandAccess(actor, o.standId, { write: true });
  if (o.status !== 'pending_payment') throw conflict('This order is not waiting for payment.');
  const cancelled = await closeCheckout(o);
  if (!cancelled) throw conflict('This order has just been paid.');
  await audit(actor, 'shop.checkout_cancelled', { entityType: 'order', entityId: o.id, editionId: o.editionId, details: { number: o.number } });
}

/** Test and practice payments only (a local machine, or a demo show): pays or abandons a checkout in the payment simulator. */
export async function simulateCheckout(actor: Actor, orderId: string, outcome: 'pay' | 'cancel') {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o || !o.stripeCheckoutSessionId) throw notFound();
  const p = await paymentsForEdition(o.editionId);
  if (!(p instanceof SimulatedPayments)) throw notFound();
  await requireStandAccess(actor, o.standId, { pay: true });
  if (outcome === 'cancel') {
    // Leaving the payment page cancels the checkout, so no "awaiting payment" order is left behind.
    if (o.status === 'pending_payment' && (await closeCheckout(o))) {
      await audit(actor, 'shop.checkout_cancelled', { entityType: 'order', entityId: o.id, editionId: o.editionId, details: { number: o.number } });
    }
    return o;
  }
  if (o.status !== 'pending_payment') throw conflict('This order is not waiting for payment.');
  const intent = `sim_pi_${o.id.replace(/-/g, '')}`;
  p.paidSessions.set(o.stripeCheckoutSessionId, intent);
  await markOrderPaid(o.id, { paymentIntentId: intent, amountPence: o.totalPence, currency: 'gbp', via: 'simulator' });
  return o;
}

/** For the simulator page: the order being paid, if this person may pay it. */
export async function simulatorOrder(actor: Actor, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) throw notFound();
  const p = await paymentsForEdition(o.editionId);
  if (!(p instanceof SimulatedPayments)) throw notFound();
  await requireStandAccess(actor, o.standId);
  const [e] = await db.select({ slug: editions.slug, name: editions.name }).from(editions).where(eq(editions.id, o.editionId)).limit(1);
  return { order: o, edition: e, practice: await isDemoEdition(o.editionId) };
}
