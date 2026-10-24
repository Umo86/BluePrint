import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { companies, companyMembers, editions, exhibitorTypes, stands, users } from '../db/schema';
import { assertSuperAdmin, assertWritable, getEditionAccess } from '../authz';
import { conflict, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import type { Actor } from '../auth/actor';

export const companySchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name.').max(200),
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : null))
    .refine((v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), 'Enter a valid website.'),
  email: z.string().trim().email('Enter a valid email.').max(254).optional().nullable().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(40).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  postcode: z.string().trim().max(20).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  vatNumber: z.string().trim().max(40).optional().nullable(),
  aspExhibitorId: z.string().trim().max(100).optional().nullable(),
});

/** Who may edit a company: super admins, staff with exhibitor rights at a show it exhibits at, or its main contact. */
export async function canManageCompany(actor: Actor, companyId: string): Promise<'admin' | 'staff' | 'main_contact' | null> {
  if (actor.isSuperAdmin && !actor.readOnly) return 'admin';
  const db = await getDb();
  const editionIds = (await db.selectDistinct({ editionId: stands.editionId }).from(stands).where(eq(stands.companyId, companyId))).map(
    (r) => r.editionId,
  );
  for (const id of editionIds) {
    const access = await getEditionAccess(actor, id, db);
    if (access?.permissions.has('manage_exhibitors')) return 'staff';
  }
  const [m] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, actor.userId)))
    .limit(1);
  if (m?.role === 'main_contact') return 'main_contact';
  return null;
}

export async function listCompanies(actor: Actor, opts: { q?: string; page?: number; includeArchived?: boolean }) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = 50;
  const conds = [eq(companies.kind, 'exhibitor')];
  if (!opts.includeArchived) conds.push(isNull(companies.archivedAt));
  if (opts.q?.trim()) conds.push(ilike(companies.name, `%${opts.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
  const where = and(...conds);
  const [{ total }] = await db.select({ total: count() }).from(companies).where(where);
  const rows = await db
    .select({
      company: companies,
      memberCount: sql<number>`(select count(*)::int from ${companyMembers} where ${companyMembers.companyId} = ${companies.id})`,
      standCount: sql<number>`(select count(*)::int from ${stands} where ${stands.companyId} = ${companies.id} and ${stands.status} = 'active')`,
    })
    .from(companies)
    .where(where)
    .orderBy(asc(companies.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total: Number(total), page, pageSize };
}

export async function getCompanyDetail(actor: Actor, companyId: string) {
  const role = await canManageCompany(actor, companyId);
  if (!role) throw notFound();
  const db = await getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw notFound();
  const members = await db
    .select({ user: users, role: companyMembers.role, canPay: companyMembers.canPay, since: companyMembers.createdAt })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(users.name));
  let standRows = await db
    .select({ stand: stands, edition: editions, type: exhibitorTypes })
    .from(stands)
    .innerJoin(editions, eq(editions.id, stands.editionId))
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .where(eq(stands.companyId, companyId))
    .orderBy(desc(editions.openStartsAt));
  // Staff only see this company's stands at their own shows.
  if (role === 'staff') {
    const visible: typeof standRows = [];
    for (const r of standRows) if (await getEditionAccess(actor, r.edition.id, db)) visible.push(r);
    standRows = visible;
  }
  return { company, members, stands: standRows, role };
}

export async function createCompany(actor: Actor, input: z.input<typeof companySchema>, opts: { editionId?: string } = {}) {
  assertWritable(actor);
  if (!(actor.isSuperAdmin && !actor.readOnly)) {
    if (!opts.editionId) throw forbidden();
    const access = await getEditionAccess(actor, opts.editionId);
    if (!access?.permissions.has('manage_exhibitors')) throw forbidden();
  }
  const data = companySchema.parse(input);
  const db = await getDb();
  const [c] = await db.insert(companies).values({ ...data, kind: 'exhibitor' }).returning();
  await audit(actor, 'company.created', { entityType: 'company', entityId: c.id, companyId: c.id, editionId: opts.editionId ?? null, details: { name: c.name } });
  return c;
}

export async function updateCompany(actor: Actor, companyId: string, input: z.input<typeof companySchema>) {
  assertWritable(actor);
  const role = await canManageCompany(actor, companyId);
  if (!role) throw notFound();
  const data = companySchema.parse(input);
  const db = await getDb();
  const [c] = await db.update(companies).set(data).where(eq(companies.id, companyId)).returning();
  if (!c) throw notFound();
  await audit(actor, 'company.updated', { entityType: 'company', entityId: companyId, companyId });
  return c;
}

export async function setCompanyInvoiceAllowed(actor: Actor, companyId: string, allowed: boolean) {
  assertWritable(actor);
  const role = await canManageCompany(actor, companyId);
  if (role !== 'admin' && role !== 'staff') throw forbidden();
  const db = await getDb();
  await db.update(companies).set({ invoiceAllowed: allowed }).where(eq(companies.id, companyId));
  await audit(actor, 'company.invoice_allowed_changed', { entityType: 'company', entityId: companyId, companyId, details: { allowed } });
}

export async function setCompanyArchived(actor: Actor, companyId: string, archived: boolean) {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.update(companies).set({ archivedAt: archived ? new Date() : null }).where(eq(companies.id, companyId));
  await audit(actor, archived ? 'company.archived' : 'company.restored', { entityType: 'company', entityId: companyId, companyId });
}

/** Removes someone from a company. The last main contact can only be removed by staff. */
export async function removeMember(actor: Actor, companyId: string, userId: string) {
  assertWritable(actor);
  const role = await canManageCompany(actor, companyId);
  if (!role) throw notFound();
  const db = await getDb();
  const members = await db.select().from(companyMembers).where(eq(companyMembers.companyId, companyId));
  const target = members.find((m) => m.userId === userId);
  if (!target) throw notFound();
  if (role === 'main_contact' && userId === actor.userId) throw forbidden('Ask the show team to remove the main contact.');
  const mainContacts = members.filter((m) => m.role === 'main_contact');
  if (target.role === 'main_contact' && mainContacts.length <= 1 && role === 'main_contact') {
    throw conflict('A company needs a main contact.');
  }
  await db.delete(companyMembers).where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  await audit(actor, 'company.member_removed', { entityType: 'user', entityId: userId, companyId });
}

export async function setMemberAccess(actor: Actor, companyId: string, userId: string, input: { role: 'main_contact' | 'colleague'; canPay: boolean }) {
  assertWritable(actor);
  const role = await canManageCompany(actor, companyId);
  if (!role) throw notFound();
  const db = await getDb();
  const members = await db.select().from(companyMembers).where(eq(companyMembers.companyId, companyId));
  const target = members.find((m) => m.userId === userId);
  if (!target) throw notFound();
  if (target.role === 'main_contact' && input.role === 'colleague' && members.filter((m) => m.role === 'main_contact').length <= 1) {
    throw conflict('A company needs a main contact. Make someone else the main contact first.');
  }
  await db
    .update(companyMembers)
    .set({ role: input.role, canPay: input.role === 'main_contact' ? true : input.canPay })
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  await audit(actor, 'company.member_access_changed', { entityType: 'user', entityId: userId, companyId, details: input });
}

export async function companiesByIds(ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  return db.select().from(companies).where(inArray(companies.id, ids));
}
