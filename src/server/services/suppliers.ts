import 'server-only';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { editionStaff, editions, invitations, serviceCategories, supplierUsers, suppliers, users } from '../db/schema';
import { assertSuperAdmin, assertWritable, isViewingAs, requireSupplierMember } from '../authz';
import { forbidden, notFound } from '../errors';
import { audit } from '../audit';
import type { Actor } from '../auth/actor';

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Enter the supplier name.').max(200),
  email: z.string().trim().email('Enter a valid email.').max(254),
  phone: z.string().trim().max(40).optional().nullable(),
  website: z.string().trim().max(300).optional().nullable(),
});

export const supplierCommissionSchema = z.object({
  commissionType: z.enum(['percent', 'fixed']).nullable(),
  commissionValue: z.number().int().min(0).max(1_000_000).nullable(),
  /** Whether the supplier charges VAT on their share (so is paid it). Super admins only. */
  vatRegistered: z.boolean().optional(),
});

/** Super admins, and show admins of any edition (they assign suppliers to categories). */
async function canManageSuppliers(actor: Actor) {
  if (actor.isSuperAdmin && !actor.readOnly) return true;
  if (isViewingAs(actor)) return false;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(editionStaff)
    .where(and(eq(editionStaff.userId, actor.userId), eq(editionStaff.role, 'show_admin')))
    .limit(1);
  return Boolean(row);
}

export async function listSuppliers(actor: Actor) {
  if (!(await canManageSuppliers(actor))) throw forbidden();
  const db = await getDb();
  return db
    .select({
      supplier: suppliers,
      userCount: sql<number>`(select count(*)::int from ${supplierUsers} where ${supplierUsers.supplierId} = ${suppliers.id})`,
      categoryCount: sql<number>`(select count(*)::int from ${serviceCategories} where ${serviceCategories.supplierId} = ${suppliers.id})`,
    })
    .from(suppliers)
    .orderBy(asc(suppliers.name));
}

export async function getSupplierDetail(actor: Actor, supplierId: string) {
  if (!(await canManageSuppliers(actor))) {
    await requireSupplierMember(actor, supplierId);
  }
  const db = await getDb();
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier) throw notFound();
  const people = await db
    .select({ user: users, since: supplierUsers.createdAt })
    .from(supplierUsers)
    .innerJoin(users, eq(users.id, supplierUsers.userId))
    .where(eq(supplierUsers.supplierId, supplierId));
  const pendingInvites = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.supplierId, supplierId),
        eq(invitations.kind, 'supplier'),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  const categories = await db
    .select({ id: serviceCategories.id, name: serviceCategories.name, editionId: editions.id, editionName: editions.name })
    .from(serviceCategories)
    .innerJoin(editions, eq(editions.id, serviceCategories.editionId))
    .where(eq(serviceCategories.supplierId, supplierId))
    .orderBy(asc(editions.name), asc(serviceCategories.name));
  return { supplier, people, pendingInvites, categories };
}

export async function createSupplier(actor: Actor, input: z.input<typeof supplierSchema>) {
  assertWritable(actor);
  if (!(await canManageSuppliers(actor))) throw forbidden();
  const data = supplierSchema.parse(input);
  const db = await getDb();
  const [s] = await db.insert(suppliers).values({ ...data, email: data.email.toLowerCase() }).returning();
  await audit(actor, 'supplier.created', { entityType: 'supplier', entityId: s.id, details: { name: s.name } });
  return s;
}

/**
 * A supplier's details (including the address its order emails go to) are shared by every show,
 * so only super admins or the supplier's own people can change them, not one show's team.
 */
export async function updateSupplier(actor: Actor, supplierId: string, input: z.input<typeof supplierSchema>) {
  assertWritable(actor);
  if (!(actor.isSuperAdmin && !actor.readOnly)) {
    await requireSupplierMember(actor, supplierId, { write: true });
  }
  const data = supplierSchema.parse(input);
  const db = await getDb();
  const [s] = await db.update(suppliers).set({ ...data, email: data.email.toLowerCase() }).where(eq(suppliers.id, supplierId)).returning();
  if (!s) throw notFound();
  await audit(actor, 'supplier.updated', { entityType: 'supplier', entityId: supplierId });
  return s;
}

export async function updateSupplierCommission(actor: Actor, supplierId: string, input: z.input<typeof supplierCommissionSchema>) {
  assertSuperAdmin(actor);
  const data = supplierCommissionSchema.parse(input);
  const db = await getDb();
  await db
    .update(suppliers)
    .set({ commissionType: data.commissionType, commissionValue: data.commissionValue, ...(data.vatRegistered === undefined ? {} : { vatRegistered: data.vatRegistered }) })
    .where(eq(suppliers.id, supplierId));
  await audit(actor, 'supplier.commission_updated', { entityType: 'supplier', entityId: supplierId, details: data });
}

export async function setSupplierStatus(actor: Actor, supplierId: string, status: 'active' | 'disabled') {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.update(suppliers).set({ status }).where(eq(suppliers.id, supplierId));
  await audit(actor, status === 'disabled' ? 'supplier.disabled' : 'supplier.enabled', { entityType: 'supplier', entityId: supplierId });
}

export async function removeSupplierUser(actor: Actor, supplierId: string, userId: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.delete(supplierUsers).where(and(eq(supplierUsers.supplierId, supplierId), eq(supplierUsers.userId, userId)));
  await audit(actor, 'supplier.user_removed', { entityType: 'supplier', entityId: supplierId, details: { userId } });
}
