import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { qualified } from '../db/qualified';
import {
  companies,
  companyMembers,
  editionStaff,
  editions,
  invitations,
  sessions,
  standContractors,
  stands,
  supplierUsers,
  suppliers,
  users,
} from '../db/schema';
import { assertSuperAdmin } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { revokeAllSessions } from '../auth/sessions';
import { isValidEmail, normaliseEmail } from '../auth/login';
import type { Actor } from '../auth/actor';

export const USER_FILTERS = ['all', 'super_admins', 'staff', 'exhibitors', 'suppliers', 'contractors', 'disabled'] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

const PAGE_SIZE = 50;

export async function listUsers(actor: Actor, opts: { q?: string; filter?: UserFilter; page?: number }) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const page = Math.max(1, opts.page ?? 1);
  const conditions = [isNull(users.anonymisedAt)];
  const q = opts.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conditions.push(or(ilike(users.email, like), ilike(users.name, like))!);
  }
  switch (opts.filter) {
    case 'super_admins':
      conditions.push(eq(users.isSuperAdmin, true));
      break;
    case 'disabled':
      conditions.push(eq(users.status, 'disabled'));
      break;
    case 'staff':
      conditions.push(sql`exists (select 1 from ${editionStaff} where ${editionStaff.userId} = ${qualified(users.id)})`);
      break;
    case 'exhibitors':
      conditions.push(sql`exists (select 1 from ${companyMembers} where ${companyMembers.userId} = ${qualified(users.id)})`);
      break;
    case 'suppliers':
      conditions.push(sql`exists (select 1 from ${supplierUsers} where ${supplierUsers.userId} = ${qualified(users.id)})`);
      break;
    case 'contractors':
      conditions.push(sql`exists (select 1 from ${standContractors} where ${standContractors.userId} = ${qualified(users.id)})`);
      break;
  }
  const where = and(...conditions);
  const [{ total }] = await db.select({ total: count() }).from(users).where(where);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      status: users.status,
      isSuperAdmin: users.isSuperAdmin,
      totpEnabledAt: users.totpEnabledAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      staffCount: sql<number>`(select count(*)::int from ${editionStaff} where ${editionStaff.userId} = ${qualified(users.id)})`,
      companyCount: sql<number>`(select count(*)::int from ${companyMembers} where ${companyMembers.userId} = ${qualified(users.id)})`,
      supplierCount: sql<number>`(select count(*)::int from ${supplierUsers} where ${supplierUsers.userId} = ${qualified(users.id)})`,
    })
    .from(users)
    .where(where)
    .orderBy(asc(users.email))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { rows, total: Number(total), page, pageSize: PAGE_SIZE };
}

export async function getUserDetail(actor: Actor, userId: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound();
  const memberships = await db
    .select({ company: companies, role: companyMembers.role, canPay: companyMembers.canPay })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, userId));
  const staff = await db
    .select({ edition: editions, role: editionStaff.role, permissions: editionStaff.permissions })
    .from(editionStaff)
    .innerJoin(editions, eq(editions.id, editionStaff.editionId))
    .where(eq(editionStaff.userId, userId));
  const supplierRows = await db
    .select({ supplier: suppliers })
    .from(supplierUsers)
    .innerJoin(suppliers, eq(suppliers.id, supplierUsers.supplierId))
    .where(eq(supplierUsers.userId, userId));
  const contractorRows = await db
    .select({ stand: stands, edition: editions, contractor: standContractors })
    .from(standContractors)
    .innerJoin(stands, eq(stands.id, standContractors.standId))
    .innerJoin(editions, eq(editions.id, stands.editionId))
    .where(eq(standContractors.userId, userId));
  // Stands the person can see as an exhibitor, so an admin can open the portal as them.
  const companyIds = memberships.map((m) => m.company.id);
  const exhibitorStands = companyIds.length
    ? await db
        .select({ standId: stands.id, standNumber: stands.number, editionId: editions.id, editionName: editions.name, companyName: companies.name })
        .from(stands)
        .innerJoin(editions, eq(editions.id, stands.editionId))
        .innerJoin(companies, eq(companies.id, stands.companyId))
        .where(and(inArray(stands.companyId, companyIds), eq(stands.status, 'active')))
        .orderBy(desc(editions.openStartsAt))
    : [];
  const activeSessions = await db
    .select({ n: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`));
  const pendingInvites = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, user.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(desc(invitations.createdAt));
  return {
    user,
    memberships,
    staff,
    suppliers: supplierRows.map((r) => r.supplier),
    contractorStands: contractorRows,
    exhibitorStands,
    activeSessionCount: Number(activeSessions[0]?.n ?? 0),
    pendingInvites,
  };
}

async function superAdminCount() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(users).where(and(eq(users.isSuperAdmin, true), eq(users.status, 'active')));
  return Number(n);
}

export async function setUserStatus(actor: Actor, userId: string, status: 'active' | 'disabled') {
  assertSuperAdmin(actor);
  if (userId === actor.realUserId) throw forbidden('You cannot disable your own account.');
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.anonymisedAt) throw notFound();
  if (status === 'disabled' && u.isSuperAdmin && (await superAdminCount()) <= 1) {
    throw conflict('BluePrint must keep at least one active super admin.');
  }
  await db.update(users).set({ status }).where(eq(users.id, userId));
  if (status === 'disabled') await revokeAllSessions(userId);
  await audit(actor, status === 'disabled' ? 'user.disabled' : 'user.enabled', { entityType: 'user', entityId: userId, details: { email: u.email } });
}

export async function setSuperAdmin(actor: Actor, userId: string, value: boolean) {
  assertSuperAdmin(actor);
  if (userId === actor.realUserId && !value) throw forbidden('You cannot remove your own super admin rights.');
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.anonymisedAt) throw notFound();
  if (!value && u.isSuperAdmin && (await superAdminCount()) <= 1) throw conflict('BluePrint must keep at least one super admin.');
  await db.update(users).set({ isSuperAdmin: value }).where(eq(users.id, userId));
  // New rights take effect at the next sign-in, which then requires two-factor.
  await revokeAllSessions(userId);
  await audit(actor, value ? 'user.super_admin_granted' : 'user.super_admin_removed', { entityType: 'user', entityId: userId, details: { email: u.email } });
}

/** Gives or takes away the right to save tasks and manual pages into the shared library. */
export async function setLibraryRight(actor: Actor, userId: string, value: boolean) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.anonymisedAt) throw notFound();
  if (u.canAddToLibrary === value) return;
  await db.update(users).set({ canAddToLibrary: value }).where(eq(users.id, userId));
  await audit(actor, value ? 'user.library_right_granted' : 'user.library_right_removed', { entityType: 'user', entityId: userId, details: { email: u.email } });
}

export const adminUserSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  email: z.string().trim().max(254),
  phone: z.string().trim().max(40).optional().nullable(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
});

export async function adminUpdateUser(actor: Actor, userId: string, input: z.input<typeof adminUserSchema>) {
  assertSuperAdmin(actor);
  const data = adminUserSchema.parse(input);
  const email = normaliseEmail(data.email);
  if (!isValidEmail(email)) throw invalid('Enter a valid email address.', { email: 'Enter a valid email address.' });
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.anonymisedAt) throw notFound();
  if (email !== u.email) {
    const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (clash) throw invalid('Another account already uses that email.', { email: 'Already in use.' });
  }
  await db.update(users).set({ name: data.name, email, phone: data.phone || null, jobTitle: data.jobTitle || null }).where(eq(users.id, userId));
  if (email !== u.email) await revokeAllSessions(userId);
  await audit(actor, 'user.updated', { entityType: 'user', entityId: userId, details: { emailChanged: email !== u.email } });
}

export async function revokeUserSessions(actor: Actor, userId: string) {
  assertSuperAdmin(actor);
  await revokeAllSessions(userId);
  await audit(actor, 'user.sessions_revoked', { entityType: 'user', entityId: userId });
}

export async function removeCompanyMembership(actor: Actor, userId: string, companyId: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.delete(companyMembers).where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId)));
  await audit(actor, 'company.member_removed', { entityType: 'user', entityId: userId, companyId });
}

export async function removeSupplierMembership(actor: Actor, userId: string, supplierId: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.delete(supplierUsers).where(and(eq(supplierUsers.userId, userId), eq(supplierUsers.supplierId, supplierId)));
  await audit(actor, 'supplier.user_removed', { entityType: 'user', entityId: userId, details: { supplierId } });
}

export async function platformCounts(actor: Actor) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const [u] = await db.select({ n: count() }).from(users).where(and(isNull(users.anonymisedAt), eq(users.status, 'active')));
  const [c] = await db.select({ n: count() }).from(companies).where(isNull(companies.archivedAt));
  const [e] = await db.select({ n: count() }).from(editions).where(inArray(editions.status, ['live', 'onsite']));
  const [s] = await db.select({ n: count() }).from(suppliers).where(eq(suppliers.status, 'active'));
  return { users: Number(u.n), companies: Number(c.n), liveEditions: Number(e.n), suppliers: Number(s.n) };
}
