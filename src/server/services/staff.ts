import 'server-only';
import { and, asc, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { EDITION_PERMISSIONS, EDITION_ROLES, editionStaff, editions, invitations, shows, users, type EditionPermission, type EditionRole } from '../db/schema';
import { assertSuperAdmin, requireShowAdmin } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { createInvitation } from '../auth/invitations';
import type { Actor } from '../auth/actor';

export const staffSchema = z.object({
  role: z.enum(EDITION_ROLES),
  // Refunds are made from the orders pages, so the refunds right brings orders with it.
  permissions: z
    .array(z.enum(EDITION_PERMISSIONS))
    .default([])
    .transform((p) => [...new Set(p.includes('refunds') ? [...p, 'manage_orders' as const] : p)]),
});

export async function listEditionStaff(actor: Actor, editionId: string) {
  await requireShowAdmin(actor, editionId);
  const db = await getDb();
  const staff = await db
    .select({ user: users, role: editionStaff.role, permissions: editionStaff.permissions, since: editionStaff.createdAt })
    .from(editionStaff)
    .innerJoin(users, eq(users.id, editionStaff.userId))
    .where(eq(editionStaff.editionId, editionId))
    .orderBy(asc(users.name));
  const pending = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.editionId, editionId),
        eq(invitations.kind, 'edition_staff'),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  return { staff, pending };
}

export async function inviteStaff(actor: Actor, editionId: string, email: string, input: z.input<typeof staffSchema>) {
  const data = staffSchema.parse(input);
  return createInvitation(actor, {
    kind: 'edition_staff',
    email,
    editionId,
    role: data.role,
    permissions: data.role === 'show_team' ? data.permissions : [],
  });
}

async function showAdminCount(editionId: string) {
  const db = await getDb();
  const rows = await db.select().from(editionStaff).where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.role, 'show_admin')));
  return rows.length;
}

export async function updateStaffRole(actor: Actor, editionId: string, userId: string, input: z.input<typeof staffSchema>) {
  await requireShowAdmin(actor, editionId, { write: true });
  const data = staffSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .select()
    .from(editionStaff)
    .where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.userId, userId)))
    .limit(1);
  if (!row) throw notFound();
  if (row.role === 'show_admin' && data.role !== 'show_admin' && (await showAdminCount(editionId)) <= 1 && !actor.isSuperAdmin) {
    throw conflict('Each edition needs at least one show admin.');
  }
  await db
    .update(editionStaff)
    .set({ role: data.role, permissions: data.role === 'show_team' ? (data.permissions as EditionPermission[]) : [] })
    .where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.userId, userId)));
  await audit(actor, 'staff.role_changed', { entityType: 'user', entityId: userId, editionId, details: data });
}

export async function removeStaff(actor: Actor, editionId: string, userId: string) {
  await requireShowAdmin(actor, editionId, { write: true });
  if (userId === actor.realUserId && !actor.isSuperAdmin) throw forbidden('Ask another show admin to remove you.');
  const db = await getDb();
  const [row] = await db
    .select()
    .from(editionStaff)
    .where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.userId, userId)))
    .limit(1);
  if (!row) throw notFound();
  if (row.role === 'show_admin' && (await showAdminCount(editionId)) <= 1 && !actor.isSuperAdmin) {
    throw conflict('Each edition needs at least one show admin.');
  }
  await db.delete(editionStaff).where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.userId, userId)));
  await audit(actor, 'staff.removed', { entityType: 'user', entityId: userId, editionId });
}

/**
 * Adds someone who already has an account to a show's team, without an invitation. Only super admins:
 * show admins invite people by email instead, so they never see accounts from other organisers.
 */
export async function addStaffMember(actor: Actor, editionId: string, userId: string, input: z.input<typeof staffSchema>) {
  assertSuperAdmin(actor);
  const data = staffSchema.parse(input);
  const db = await getDb();
  const [edition] = await db.select({ id: editions.id }).from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw notFound();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.anonymisedAt) throw notFound();
  if (u.status !== 'active') throw invalid('This account is disabled. Enable it first.');
  await db
    .insert(editionStaff)
    .values({ editionId, userId, role: data.role, permissions: data.role === 'show_team' ? (data.permissions as EditionPermission[]) : [], addedBy: actor.realUserId })
    .onConflictDoNothing();
  await audit(actor, 'staff.added', { entityType: 'user', entityId: userId, editionId, details: data });
}

/** Sets what one person can do in a show: adds them to the team, changes their rights, or (null) takes them off it. */
export async function setStaffAccess(actor: Actor, editionId: string, userId: string, access: z.input<typeof staffSchema> | null) {
  if (access === null) return removeStaff(actor, editionId, userId);
  const db = await getDb();
  const [row] = await db
    .select({ role: editionStaff.role })
    .from(editionStaff)
    .where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.userId, userId)))
    .limit(1);
  if (row) return updateStaffRole(actor, editionId, userId, access);
  return addStaffMember(actor, editionId, userId, access);
}

export type RightsPerson = {
  userId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  status: string;
  isSuperAdmin: boolean;
  canAddToLibrary: boolean;
  /** Their role in the chosen show, or null when they are not on its team. */
  role: EditionRole | null;
  permissions: EditionPermission[];
  showCount: number;
};

/**
 * For the super admin's Rights page: everyone who works on the shows (anyone on a show team, every
 * super admin, and anyone with the library right), with what they can do in the chosen show.
 */
export async function rightsOverview(actor: Actor, editionId: string | null) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const editionRows = await db
    .select({ id: editions.id, name: editions.name, status: editions.status, showName: shows.name, openStartsAt: editions.openStartsAt })
    .from(editions)
    .innerJoin(shows, eq(shows.id, editions.showId))
    .orderBy(asc(shows.name), desc(editions.openStartsAt));
  const order = { live: 0, onsite: 1, draft: 2, closed: 3, archived: 4 } as Record<string, number>;
  const choices = [...editionRows].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const chosen = choices.find((e) => e.id === editionId) ?? choices[0] ?? null;

  const staffLinks = await db.select({ userId: editionStaff.userId, editionId: editionStaff.editionId, role: editionStaff.role, permissions: editionStaff.permissions }).from(editionStaff);
  const staffIds = [...new Set(staffLinks.map((l) => l.userId))];
  const people = await db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.anonymisedAt),
        or(eq(users.isSuperAdmin, true), eq(users.canAddToLibrary, true), staffIds.length ? inArray(users.id, staffIds) : eq(users.id, '00000000-0000-0000-0000-000000000000')),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));
  const here = new Map(staffLinks.filter((l) => chosen && l.editionId === chosen.id).map((l) => [l.userId, l]));
  const showCount = new Map<string, number>();
  for (const l of staffLinks) showCount.set(l.userId, (showCount.get(l.userId) ?? 0) + 1);
  const rows: RightsPerson[] = people.map((u) => {
    const link = here.get(u.id);
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      jobTitle: u.jobTitle,
      status: u.status,
      isSuperAdmin: u.isSuperAdmin,
      canAddToLibrary: u.canAddToLibrary,
      role: link?.role ?? null,
      permissions: link?.role === 'show_team' ? (link.permissions.filter((p) => p !== 'view') as EditionPermission[]) : [],
      showCount: showCount.get(u.id) ?? 0,
    };
  });
  // The chosen show's team first, then everyone else.
  rows.sort((a, b) => Number(b.role !== null) - Number(a.role !== null));
  return { editions: choices.map((e) => ({ id: e.id, name: e.name, showName: e.showName, status: e.status })), edition: chosen, people: rows };
}
