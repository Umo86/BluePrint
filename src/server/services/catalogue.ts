import 'server-only';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import {
  editions,
  exhibitorTypes,
  orderLines,
  orders,
  products,
  serviceCategories,
  supplierUsers,
  suppliers,
  users,
  type ProductDetailField,
  type ProductOption,
} from '../db/schema';
import { editionStaffWith, getEditionAccess, requireEditionPermission, requireSupplierMember, supplierIdsFor } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { appUrl } from '../auth/login';
import { requireOwnVerifiedFile } from './files';
import { assertRateLimit } from '../security/rate-limit';
import type { Actor } from '../auth/actor';

/**
 * The services shop catalogue: categories (each fulfilled by one supplier, or by Media10 itself)
 * and their products. Show teams with "manage orders" run it; suppliers add their own products,
 * which only go on sale once the show team approves them.
 */

const commissionFields = {
  commissionType: z.enum(['percent', 'fixed']).nullable().optional(),
  commissionValue: z.number().int().min(0).max(1_000_000).nullable().optional(),
};

function checkCommission(d: { commissionType?: 'percent' | 'fixed' | null; commissionValue?: number | null }, ctx: z.RefinementCtx) {
  const hasType = Boolean(d.commissionType);
  const hasValue = d.commissionValue !== null && d.commissionValue !== undefined;
  if (hasType !== hasValue) ctx.addIssue({ code: 'custom', path: ['commissionValue'], message: 'Set both the commission type and amount, or neither.' });
  if (d.commissionType === 'percent' && (d.commissionValue ?? 0) > 10_000) ctx.addIssue({ code: 'custom', path: ['commissionValue'], message: 'A percentage cannot be more than 100%.' });
}

export const categorySchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    description: z.string().trim().max(2000).nullable().optional(),
    supplierId: z.string().uuid().nullable().optional(),
    orderByOffsetDays: z.number().int().min(0).max(365).nullable().optional(),
    visibleToTypes: z.array(z.string().uuid()).max(50).default([]),
    ...commissionFields,
  })
  .superRefine(checkCommission);

const optionSchema = z.object({
  name: z.string().trim().min(1, 'Name the option.').max(60),
  values: z.array(z.string().trim().min(1).max(80)).min(1, 'Add at least one choice.').max(30),
});

const detailSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().trim().min(1, 'Enter the question.').max(200),
  type: z.enum(['text', 'textarea']),
  required: z.boolean().optional(),
});

const pence = z.number().int().min(0).max(100_000_000);
const offset = z.number().int().min(0).max(365);

export const productSchema = z
  .object({
    categoryId: z.string().uuid(),
    name: z.string().trim().min(1, 'Enter a name.').max(200),
    description: z.string().trim().max(4000).nullable().optional(),
    imageFileId: z.string().uuid().nullable().optional(),
    unit: z.string().trim().min(1).max(40).default('each'),
    pricePence: pence,
    earlyPricePence: pence.nullable().optional(),
    earlyUntilOffsetDays: offset.nullable().optional(),
    latePricePence: pence.nullable().optional(),
    lateFromOffsetDays: offset.nullable().optional(),
    vatRateBps: z.number().int().min(0).max(10_000),
    options: z.array(optionSchema).max(5).default([]),
    requiredDetails: z.array(detailSchema).max(10).default([]),
    stockLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
    visibleToTypes: z.array(z.string().uuid()).max(50).default([]),
    ...commissionFields,
  })
  .superRefine((d, ctx) => {
    checkCommission(d, ctx);
    const pair = (a: unknown, b: unknown) => (a === null || a === undefined) === (b === null || b === undefined);
    if (!pair(d.earlyPricePence, d.earlyUntilOffsetDays)) ctx.addIssue({ code: 'custom', path: ['earlyUntilOffsetDays'], message: 'Set both the early price and when it ends, or neither.' });
    if (!pair(d.latePricePence, d.lateFromOffsetDays)) ctx.addIssue({ code: 'custom', path: ['lateFromOffsetDays'], message: 'Set both the late price and when it starts, or neither.' });
    if (d.earlyUntilOffsetDays != null && d.lateFromOffsetDays != null && d.earlyUntilOffsetDays <= d.lateFromOffsetDays) {
      ctx.addIssue({ code: 'custom', path: ['lateFromOffsetDays'], message: 'The late price must start after the early price ends.' });
    }
    const names = d.options.map((o) => o.name.toLowerCase());
    if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Each option needs a different name.' });
    const ids = d.requiredDetails.map((q) => q.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['requiredDetails'], message: 'Each question needs a different id.' });
  });

export type ProductInput = z.input<typeof productSchema>;
export type CategoryInput = z.input<typeof categorySchema>;

type CategoryRow = typeof serviceCategories.$inferSelect;
type ProductRow = typeof products.$inferSelect;

/** Commission overrides are a money decision: show admins and super admins only. */
async function canSetCommission(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  return Boolean(access && (access.role === 'super_admin' || access.role === 'show_admin'));
}

async function checkTypes(db: DbLike, editionId: string, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: exhibitorTypes.id }).from(exhibitorTypes).where(and(eq(exhibitorTypes.editionId, editionId), inArray(exhibitorTypes.id, ids)));
  if (rows.length !== new Set(ids).size) throw invalid('One of the exhibitor types was not found.');
}

async function productHasOrders(db: DbLike, productId: string) {
  const [row] = await db.select({ id: orderLines.id }).from(orderLines).where(eq(orderLines.productId, productId)).limit(1);
  return Boolean(row);
}

/** How many of a product are sold or held in unpaid checkouts (cancelled and refunded lines are released). */
export async function soldQuantities(db: DbLike, productIds: string[]) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await db
    .select({ productId: orderLines.productId, n: sql<number>`coalesce(sum(${orderLines.quantity}), 0)::int` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(
      and(
        inArray(orderLines.productId, productIds),
        inArray(orders.status, ['pending_payment', 'paid', 'invoiced', 'partially_refunded']),
        ne(orderLines.fulfilmentStatus, 'cancelled'),
      ),
    )
    .groupBy(orderLines.productId);
  return new Map(rows.map((r) => [r.productId as string, Number(r.n)]));
}

// ---------------------------------------------------------------------------
// Show team
// ---------------------------------------------------------------------------

/** Shop categories by name, for "has not ordered from" filters. */
export async function shopCategoriesForFilters(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  return db
    .select({ id: serviceCategories.id, name: serviceCategories.name, visibleToTypes: serviceCategories.visibleToTypes })
    .from(serviceCategories)
    .where(eq(serviceCategories.editionId, editionId))
    .orderBy(asc(serviceCategories.sort), asc(serviceCategories.name));
}

export async function catalogueForStaff(actor: Actor, editionId: string) {
  const access = await requireEditionPermission(actor, editionId, 'manage_orders');
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  const categories = await db
    .select({ category: serviceCategories, supplierName: suppliers.name })
    .from(serviceCategories)
    .leftJoin(suppliers, eq(suppliers.id, serviceCategories.supplierId))
    .where(eq(serviceCategories.editionId, editionId))
    .orderBy(asc(serviceCategories.sort), asc(serviceCategories.name));
  const productRows = await db.select().from(products).where(eq(products.editionId, editionId)).orderBy(asc(products.sort), asc(products.name));
  const sold = await soldQuantities(
    db,
    productRows.map((p) => p.id),
  );
  const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId)).orderBy(asc(exhibitorTypes.sort));
  const supplierList = await db.select({ id: suppliers.id, name: suppliers.name, status: suppliers.status }).from(suppliers).orderBy(asc(suppliers.name));
  return {
    edition,
    categories: categories.map((c) => ({ ...c.category, supplierName: c.supplierName })),
    products: productRows.map((p) => ({ ...p, sold: sold.get(p.id) ?? 0 })),
    types,
    suppliers: supplierList,
    canSetCommission: access.role === 'super_admin' || access.role === 'show_admin',
    pendingApproval: productRows.filter((p) => p.status === 'pending_approval').length,
  };
}

async function loadCategory(db: DbLike, categoryId: string) {
  const [c] = await db.select().from(serviceCategories).where(eq(serviceCategories.id, categoryId)).limit(1);
  if (!c) throw notFound();
  return c;
}

export async function createCategory(actor: Actor, editionId: string, input: CategoryInput) {
  await requireEditionPermission(actor, editionId, 'manage_orders', { write: true });
  const data = categorySchema.parse(input);
  const db = await getDb();
  if (data.commissionType && !(await canSetCommission(actor, editionId))) throw forbidden('Only show admins can set commission.');
  await checkTypes(db, editionId, data.visibleToTypes);
  if (data.supplierId) {
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, data.supplierId)).limit(1);
    if (!s) throw invalid('Choose a supplier from the list.');
  }
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${serviceCategories.sort}), 0)::int` }).from(serviceCategories).where(eq(serviceCategories.editionId, editionId));
  const [c] = await db
    .insert(serviceCategories)
    .values({
      editionId,
      name: data.name,
      description: data.description ?? null,
      supplierId: data.supplierId ?? null,
      orderByOffsetDays: data.orderByOffsetDays ?? null,
      visibleToTypes: data.visibleToTypes,
      commissionType: data.commissionType ?? null,
      commissionValue: data.commissionValue ?? null,
      sort: Number(max) + 1,
    })
    .returning();
  await audit(actor, 'shop.category_created', { entityType: 'service_category', entityId: c.id, editionId, details: { name: c.name, supplierId: c.supplierId } });
  return c;
}

export async function updateCategory(actor: Actor, categoryId: string, input: CategoryInput) {
  const db = await getDb();
  const current = await loadCategory(db, categoryId);
  await requireEditionPermission(actor, current.editionId, 'manage_orders', { write: true });
  const data = categorySchema.parse(input);
  const commissionChanged = (data.commissionType ?? null) !== current.commissionType || (data.commissionValue ?? null) !== current.commissionValue;
  if (commissionChanged && !(await canSetCommission(actor, current.editionId))) throw forbidden('Only show admins can change commission.');
  await checkTypes(db, current.editionId, data.visibleToTypes);
  const supplierId = data.supplierId ?? null;
  await db.transaction(async (tx) => {
    await tx
      .update(serviceCategories)
      .set({
        name: data.name,
        description: data.description ?? null,
        supplierId,
        orderByOffsetDays: data.orderByOffsetDays ?? null,
        visibleToTypes: data.visibleToTypes,
        commissionType: data.commissionType ?? null,
        commissionValue: data.commissionValue ?? null,
      })
      .where(eq(serviceCategories.id, categoryId));
    // Products follow their category's supplier. Orders already placed keep the supplier they were placed with.
    if (supplierId !== current.supplierId) await tx.update(products).set({ supplierId }).where(eq(products.categoryId, categoryId));
  });
  await audit(actor, 'shop.category_updated', {
    entityType: 'service_category',
    entityId: categoryId,
    editionId: current.editionId,
    details: { supplierChanged: supplierId !== current.supplierId, commissionChanged },
  });
}

export async function deleteCategory(actor: Actor, categoryId: string) {
  const db = await getDb();
  const current = await loadCategory(db, categoryId);
  await requireEditionPermission(actor, current.editionId, 'manage_orders', { write: true });
  const [ordered] = await db.select({ id: orderLines.id }).from(orderLines).where(eq(orderLines.categoryId, categoryId)).limit(1);
  if (ordered) throw conflict('This category has orders, so it cannot be deleted. Archive its products instead.');
  await db.delete(serviceCategories).where(eq(serviceCategories.id, categoryId));
  await audit(actor, 'shop.category_deleted', { entityType: 'service_category', entityId: categoryId, editionId: current.editionId, details: { name: current.name } });
}

export async function moveCategory(actor: Actor, categoryId: string, direction: 'up' | 'down') {
  const db = await getDb();
  const current = await loadCategory(db, categoryId);
  await requireEditionPermission(actor, current.editionId, 'manage_orders', { write: true });
  const all = await db.select().from(serviceCategories).where(eq(serviceCategories.editionId, current.editionId)).orderBy(asc(serviceCategories.sort), asc(serviceCategories.name));
  const i = all.findIndex((c) => c.id === categoryId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [n, c] of all.entries()) await tx.update(serviceCategories).set({ sort: n + 1 }).where(eq(serviceCategories.id, c.id));
  });
}

async function loadProduct(db: DbLike, productId: string) {
  const [p] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!p) throw notFound();
  return p;
}

async function checkImage(actor: Actor, imageFileId: string | null | undefined, current: string | null) {
  if (!imageFileId || imageFileId === current) return imageFileId ?? null;
  await requireOwnVerifiedFile(actor, imageFileId, 'product');
  return imageFileId;
}

function productValues(data: z.output<typeof productSchema>) {
  return {
    name: data.name,
    description: data.description ?? null,
    unit: data.unit,
    pricePence: data.pricePence,
    earlyPricePence: data.earlyPricePence ?? null,
    earlyUntilOffsetDays: data.earlyUntilOffsetDays ?? null,
    latePricePence: data.latePricePence ?? null,
    lateFromOffsetDays: data.lateFromOffsetDays ?? null,
    vatRateBps: data.vatRateBps,
    options: data.options as ProductOption[],
    requiredDetails: data.requiredDetails as ProductDetailField[],
    stockLimit: data.stockLimit ?? null,
  };
}

/** Show team: adds a product. It goes on sale straight away unless saved as a draft. */
export async function createProduct(actor: Actor, editionId: string, input: ProductInput, opts: { draft?: boolean } = {}) {
  await requireEditionPermission(actor, editionId, 'manage_orders', { write: true });
  const data = productSchema.parse(input);
  const db = await getDb();
  const category = await loadCategory(db, data.categoryId);
  if (category.editionId !== editionId) throw notFound();
  if (data.commissionType && !(await canSetCommission(actor, editionId))) throw forbidden('Only show admins can set commission.');
  await checkTypes(db, editionId, data.visibleToTypes);
  const imageFileId = await checkImage(actor, data.imageFileId, null);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${products.sort}), 0)::int` }).from(products).where(eq(products.categoryId, category.id));
  const [p] = await db
    .insert(products)
    .values({
      editionId,
      categoryId: category.id,
      supplierId: category.supplierId,
      ...productValues(data),
      imageFileId,
      visibleToTypes: data.visibleToTypes,
      commissionType: data.commissionType ?? null,
      commissionValue: data.commissionValue ?? null,
      status: opts.draft ? 'draft' : 'approved',
      sort: Number(max) + 1,
    })
    .returning();
  await audit(actor, 'shop.product_created', { entityType: 'product', entityId: p.id, editionId, details: { name: p.name, pricePence: p.pricePence } });
  return p;
}

export async function getProductForStaff(actor: Actor, productId: string) {
  const db = await getDb();
  const p = await loadProduct(db, productId);
  const access = await requireEditionPermission(actor, p.editionId, 'manage_orders');
  const [supplier] = p.supplierId ? await db.select().from(suppliers).where(eq(suppliers.id, p.supplierId)).limit(1) : [];
  const sold = (await soldQuantities(db, [p.id])).get(p.id) ?? 0;
  return { product: p, supplier: supplier ?? null, sold, hasOrders: await productHasOrders(db, p.id), canSetCommission: access.role === 'super_admin' || access.role === 'show_admin' };
}

export async function updateProduct(actor: Actor, productId: string, input: ProductInput) {
  const db = await getDb();
  const current = await loadProduct(db, productId);
  await requireEditionPermission(actor, current.editionId, 'manage_orders', { write: true });
  const data = productSchema.parse(input);
  const category = await loadCategory(db, data.categoryId);
  if (category.editionId !== current.editionId) throw notFound();
  const commissionChanged = (data.commissionType ?? null) !== current.commissionType || (data.commissionValue ?? null) !== current.commissionValue;
  if (commissionChanged && !(await canSetCommission(actor, current.editionId))) throw forbidden('Only show admins can change commission.');
  await checkTypes(db, current.editionId, data.visibleToTypes);
  const imageFileId = await checkImage(actor, data.imageFileId, current.imageFileId);
  await db
    .update(products)
    .set({
      ...productValues(data),
      categoryId: category.id,
      supplierId: category.supplierId,
      imageFileId,
      visibleToTypes: data.visibleToTypes,
      commissionType: data.commissionType ?? null,
      commissionValue: data.commissionValue ?? null,
    })
    .where(eq(products.id, productId));
  await audit(actor, 'shop.product_updated', {
    entityType: 'product',
    entityId: productId,
    editionId: current.editionId,
    details: { priceChanged: data.pricePence !== current.pricePence, from: current.pricePence, to: data.pricePence, commissionChanged },
  });
}

export const PRODUCT_DECISIONS = ['approved', 'rejected', 'archived', 'draft'] as const;

/** Show team: approves or rejects a supplier's product, takes a product off sale, or puts it back. */
export async function setProductStatus(actor: Actor, productId: string, status: (typeof PRODUCT_DECISIONS)[number], reason?: string | null) {
  const db = await getDb();
  const p = await loadProduct(db, productId);
  await requireEditionPermission(actor, p.editionId, 'manage_orders', { write: true });
  if (!PRODUCT_DECISIONS.includes(status)) throw invalid('Choose a valid status.');
  const note = (reason ?? '').trim().slice(0, 1000) || null;
  if (status === 'rejected' && !note) throw invalid('Explain why, so the supplier can fix it.');
  await db
    .update(products)
    .set({ status, rejectionReason: status === 'rejected' ? note : null })
    .where(eq(products.id, productId));
  await audit(actor, `shop.product_${status}`, { entityType: 'product', entityId: productId, editionId: p.editionId, details: { name: p.name, reason: note } });
  if (p.supplierId && p.status === 'pending_approval' && (status === 'approved' || status === 'rejected')) {
    await notifySupplier(p.supplierId, p.editionId, status === 'approved' ? `Approved: ${p.name}` : `Changes needed: ${p.name}`, [
      status === 'approved' ? `${p.name} has been approved and is now on sale to exhibitors.` : `${p.name} was not approved yet.`,
      ...(note ? [`The show team said: ${note}`] : []),
    ]);
  }
}

export async function deleteProduct(actor: Actor, productId: string) {
  const db = await getDb();
  const p = await loadProduct(db, productId);
  await requireEditionPermission(actor, p.editionId, 'manage_orders', { write: true });
  if (await productHasOrders(db, productId)) throw conflict('This product has been ordered, so it cannot be deleted. Archive it to take it off sale.');
  await db.delete(products).where(eq(products.id, productId));
  await audit(actor, 'shop.product_deleted', { entityType: 'product', entityId: productId, editionId: p.editionId, details: { name: p.name } });
}

export async function moveProduct(actor: Actor, productId: string, direction: 'up' | 'down') {
  const db = await getDb();
  const p = await loadProduct(db, productId);
  await requireEditionPermission(actor, p.editionId, 'manage_orders', { write: true });
  const all = await db.select().from(products).where(eq(products.categoryId, p.categoryId)).orderBy(asc(products.sort), asc(products.name));
  const i = all.findIndex((x) => x.id === productId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [n, x] of all.entries()) await tx.update(products).set({ sort: n + 1 }).where(eq(products.id, x.id));
  });
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

/** What a supplier may change on their own products. Prices go back to the show team for approval. */
export const supplierProductSchema = z
  .object({
    categoryId: z.string().uuid(),
    name: z.string().trim().min(1, 'Enter a name.').max(200),
    description: z.string().trim().max(4000).nullable().optional(),
    imageFileId: z.string().uuid().nullable().optional(),
    unit: z.string().trim().min(1).max(40).default('each'),
    pricePence: pence,
    earlyPricePence: pence.nullable().optional(),
    earlyUntilOffsetDays: offset.nullable().optional(),
    latePricePence: pence.nullable().optional(),
    lateFromOffsetDays: offset.nullable().optional(),
    vatRateBps: z.number().int().min(0).max(10_000),
    options: z.array(optionSchema).max(5).default([]),
    requiredDetails: z.array(detailSchema).max(10).default([]),
    stockLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    const r = productSchema.safeParse({ ...d, visibleToTypes: [] });
    if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });

export type SupplierProductInput = z.input<typeof supplierProductSchema>;

/** The categories a supplier fulfils, in shows that are not archived. */
export async function supplierCategories(actor: Actor, supplierId: string) {
  await requireSupplierMember(actor, supplierId);
  const db = await getDb();
  return db
    .select({ category: serviceCategories, edition: { id: editions.id, name: editions.name, status: editions.status, vatRateBps: editions.vatRateBps, buildUpStartsAt: editions.buildUpStartsAt } })
    .from(serviceCategories)
    .innerJoin(editions, eq(editions.id, serviceCategories.editionId))
    .where(and(eq(serviceCategories.supplierId, supplierId), ne(editions.status, 'archived')))
    .orderBy(desc(editions.buildUpStartsAt), asc(serviceCategories.sort));
}

export async function supplierCatalogue(actor: Actor, supplierId: string) {
  const categories = await supplierCategories(actor, supplierId);
  const db = await getDb();
  const ids = categories.map((c) => c.category.id);
  const rows = ids.length
    ? await db
        .select()
        .from(products)
        .where(and(inArray(products.categoryId, ids), eq(products.supplierId, supplierId)))
        .orderBy(asc(products.sort), asc(products.name))
    : [];
  const sold = await soldQuantities(
    db,
    rows.map((p) => p.id),
  );
  return { categories, products: rows.map((p) => ({ ...p, sold: sold.get(p.id) ?? 0 })) };
}

async function supplierCategoryOrThrow(db: DbLike, supplierId: string, categoryId: string) {
  const c = await loadCategory(db, categoryId);
  if (c.supplierId !== supplierId) throw notFound();
  const [e] = await db.select({ status: editions.status }).from(editions).where(eq(editions.id, c.editionId)).limit(1);
  if (!e || e.status === 'archived' || e.status === 'closed') throw forbidden('This show is closed, so its catalogue cannot be changed.');
  return c;
}

async function supplierProductOrThrow(db: DbLike, supplierId: string, productId: string) {
  const p = await loadProduct(db, productId);
  if (p.supplierId !== supplierId) throw notFound();
  return p;
}

export async function getSupplierProduct(actor: Actor, supplierId: string, productId: string) {
  await requireSupplierMember(actor, supplierId);
  const db = await getDb();
  const p = await supplierProductOrThrow(db, supplierId, productId);
  return { product: p, sold: (await soldQuantities(db, [p.id])).get(p.id) ?? 0 };
}

/** Supplier: adds a product as a draft. It is not on sale until they send it for approval and the show team approves it. */
export async function createSupplierProduct(actor: Actor, supplierId: string, input: SupplierProductInput, opts: { submit?: boolean } = {}) {
  await requireSupplierMember(actor, supplierId, { write: true });
  await assertRateLimit(`supplier-product:${actor.realUserId}`, 120, 3600);
  const data = supplierProductSchema.parse(input);
  const db = await getDb();
  const category = await supplierCategoryOrThrow(db, supplierId, data.categoryId);
  const imageFileId = await checkImage(actor, data.imageFileId, null);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${products.sort}), 0)::int` }).from(products).where(eq(products.categoryId, category.id));
  const [p] = await db
    .insert(products)
    .values({
      editionId: category.editionId,
      categoryId: category.id,
      supplierId,
      ...productValues({ ...data, visibleToTypes: [] }),
      imageFileId,
      visibleToTypes: [],
      status: opts.submit ? 'pending_approval' : 'draft',
      sort: Number(max) + 1,
    })
    .returning();
  await audit(actor, 'shop.supplier_product_created', { entityType: 'product', entityId: p.id, editionId: p.editionId, details: { supplierId, name: p.name, submitted: Boolean(opts.submit) } });
  if (opts.submit) await notifyApprovers(p);
  return p;
}

/**
 * Supplier: edits their product. Any change to something already on sale takes it off sale until
 * the show team approves it again, so prices exhibitors see are always ones the team agreed.
 */
export async function updateSupplierProduct(actor: Actor, supplierId: string, productId: string, input: SupplierProductInput, opts: { submit?: boolean } = {}) {
  await requireSupplierMember(actor, supplierId, { write: true });
  await assertRateLimit(`supplier-product:${actor.realUserId}`, 120, 3600);
  const data = supplierProductSchema.parse(input);
  const db = await getDb();
  const current = await supplierProductOrThrow(db, supplierId, productId);
  if (current.status === 'archived') throw forbidden('This product has been archived by the show team.');
  const category = await supplierCategoryOrThrow(db, supplierId, data.categoryId);
  if (category.editionId !== current.editionId) throw notFound();
  const imageFileId = await checkImage(actor, data.imageFileId, current.imageFileId);
  const status = opts.submit || current.status === 'approved' || current.status === 'pending_approval' ? 'pending_approval' : 'draft';
  await db
    .update(products)
    .set({ ...productValues({ ...data, visibleToTypes: [] }), categoryId: category.id, imageFileId, status, rejectionReason: null })
    .where(eq(products.id, productId));
  await audit(actor, 'shop.supplier_product_updated', { entityType: 'product', entityId: productId, editionId: current.editionId, details: { supplierId, status } });
  if (status === 'pending_approval' && current.status !== 'pending_approval') await notifyApprovers({ ...current, name: data.name });
  return { status };
}

export async function submitSupplierProduct(actor: Actor, supplierId: string, productId: string) {
  await requireSupplierMember(actor, supplierId, { write: true });
  await assertRateLimit(`supplier-product:${actor.realUserId}`, 120, 3600);
  const db = await getDb();
  const p = await supplierProductOrThrow(db, supplierId, productId);
  if (p.status !== 'draft' && p.status !== 'rejected') throw conflict('This product is not a draft.');
  await supplierCategoryOrThrow(db, supplierId, p.categoryId);
  await db.update(products).set({ status: 'pending_approval', rejectionReason: null }).where(eq(products.id, productId));
  await audit(actor, 'shop.supplier_product_submitted', { entityType: 'product', entityId: productId, editionId: p.editionId, details: { supplierId } });
  await notifyApprovers(p);
}

/** Supplier: takes their own product off sale. Products never ordered are deleted outright. */
export async function withdrawSupplierProduct(actor: Actor, supplierId: string, productId: string) {
  await requireSupplierMember(actor, supplierId, { write: true });
  const db = await getDb();
  const p = await supplierProductOrThrow(db, supplierId, productId);
  if (await productHasOrders(db, productId)) {
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, productId));
  } else {
    await db.delete(products).where(eq(products.id, productId));
  }
  await audit(actor, 'shop.supplier_product_withdrawn', { entityType: 'product', entityId: productId, editionId: p.editionId, details: { supplierId, name: p.name } });
}

async function notifyApprovers(p: Pick<ProductRow, 'editionId' | 'name' | 'supplierId' | 'id'>) {
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, p.editionId)).limit(1);
  const [supplier] = p.supplierId ? await db.select().from(suppliers).where(eq(suppliers.id, p.supplierId)).limit(1) : [];
  const rows = await editionStaffWith(p.editionId, 'manage_orders', db);
  const subject = `Product to approve: ${p.name}`;
  const { html, text } = renderSimpleEmail({
    heading: subject,
    paragraphs: [`${supplier?.name ?? 'A supplier'} has sent ${p.name} for approval in the ${edition.name} shop.`, 'It is not on sale until someone with order rights approves it.'],
    button: { label: 'Review the catalogue', url: appUrl(`/manage/${p.editionId}/shop?tab=approval`) },
    brandColor: edition.branding.primaryColor,
    footer: edition.name,
  });
  for (const r of rows) {
    await sendEmail({ to: r.email, toUserId: r.id, editionId: p.editionId, templateKey: 'product_for_approval', category: 'transactional', subject, html, text });
  }
}

/** Emails everyone at a supplier (their main address and their BluePrint users). */
export async function notifySupplier(supplierId: string, editionId: string | null, subject: string, paragraphs: string[], path = `/supplier/${supplierId}`) {
  const db = await getDb();
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier || supplier.status !== 'active') return;
  const people = await db
    .select({ email: users.email, id: users.id })
    .from(supplierUsers)
    .innerJoin(users, eq(users.id, supplierUsers.userId))
    .where(and(eq(supplierUsers.supplierId, supplierId), eq(users.status, 'active')));
  const to = new Map<string, string | null>(people.map((p) => [p.email, p.id]));
  if (!to.has(supplier.email)) to.set(supplier.email, null);
  const { html, text } = renderSimpleEmail({ heading: subject, paragraphs, button: { label: 'Open the supplier portal', url: appUrl(path) }, footer: `BluePrint supplier portal · ${supplier.name}` });
  for (const [email, id] of to) {
    await sendEmail({ to: email, toUserId: id, editionId, templateKey: 'supplier_notice', category: 'transactional', subject, html, text });
  }
}

/** Which of an actor's suppliers they belong to (for the supplier portal). */
export async function mySuppliers(actor: Actor) {
  const ids = await supplierIdsFor(actor);
  if (!ids.length) return [];
  const db = await getDb();
  return db.select().from(suppliers).where(inArray(suppliers.id, ids)).orderBy(asc(suppliers.name));
}

export type CatalogueCategory = CategoryRow;
