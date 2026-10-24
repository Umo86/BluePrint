import 'server-only';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { EDITION_PERMISSIONS, EDITION_ROLES, editionStaff, invitations, users, type EditionPermission } from '../db/schema';
import { requireShowAdmin } from '../authz';
import { conflict, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { createInvitation } from '../auth/invitations';
import type { Actor } from '../auth/actor';

export const staffSchema = z.object({
  role: z.enum(EDITION_ROLES),
  permissions: z.array(z.enum(EDITION_PERMISSIONS)).default([]),
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
