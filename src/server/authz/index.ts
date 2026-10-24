import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import {
  EDITION_PERMISSIONS,
  companyMembers,
  editionStaff,
  editions,
  standContractors,
  stands,
  supplierUsers,
  type EditionPermission,
  type EditionRole,
} from '../db/schema';
import { forbidden, notFound, readOnly } from '../errors';
import type { Actor } from '../auth/actor';

export type EditionAccess = {
  role: 'super_admin' | EditionRole;
  permissions: ReadonlySet<EditionPermission>;
};

const ALL_PERMISSIONS: ReadonlySet<EditionPermission> = new Set(EDITION_PERMISSIONS);
/** H&S reviewers only ever see the space-only review queue. */
const HS_REVIEWER_PERMISSIONS: ReadonlySet<EditionPermission> = new Set(['review_space_only']);

/** Refuses any write while an admin is viewing as someone else. */
export function assertWritable(actor: Actor) {
  if (actor.readOnly) throw readOnly();
}

export function assertSuperAdmin(actor: Actor) {
  if (!actor.isSuperAdmin || actor.readOnly) throw forbidden();
}

/** What the actor may do in an edition, or null when they have no staff role there. */
export async function getEditionAccess(actor: Actor, editionId: string, db?: DbLike): Promise<EditionAccess | null> {
  if (actor.isSuperAdmin && !actor.readOnly) return { role: 'super_admin', permissions: ALL_PERMISSIONS };
  const d = db ?? (await getDb());
  const [row] = await d
    .select()
    .from(editionStaff)
    .where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.userId, actor.userId)))
    .limit(1);
  if (!row) return null;
  if (row.role === 'show_admin') return { role: 'show_admin', permissions: ALL_PERMISSIONS };
  if (row.role === 'hs_reviewer') return { role: 'hs_reviewer', permissions: HS_REVIEWER_PERMISSIONS };
  const perms = new Set<EditionPermission>(row.permissions.filter((p): p is EditionPermission => ALL_PERMISSIONS.has(p as EditionPermission)));
  perms.add('view');
  return { role: 'show_team', permissions: perms };
}

/**
 * Throws unless the actor holds `permission` in the edition. People with no role in the edition
 * get "not found" so they cannot learn which editions exist.
 */
export async function requireEditionPermission(
  actor: Actor,
  editionId: string,
  permission: EditionPermission,
  opts: { write?: boolean; db?: DbLike } = {},
): Promise<EditionAccess> {
  const access = await getEditionAccess(actor, editionId, opts.db);
  if (!access) throw notFound();
  if (!access.permissions.has(permission)) throw forbidden();
  if (opts.write) assertWritable(actor);
  return access;
}

export async function requireShowAdmin(actor: Actor, editionId: string, opts: { write?: boolean; db?: DbLike } = {}) {
  const access = await getEditionAccess(actor, editionId, opts.db);
  if (!access) throw notFound();
  if (access.role !== 'super_admin' && access.role !== 'show_admin') throw forbidden();
  if (opts.write) assertWritable(actor);
  return access;
}

/** Editions where the actor is on the staff (all editions for super admins). */
export async function staffEditionIds(actor: Actor, db?: DbLike): Promise<string[] | 'all'> {
  if (actor.isSuperAdmin && !actor.readOnly) return 'all';
  const d = db ?? (await getDb());
  const rows = await d.select({ editionId: editionStaff.editionId }).from(editionStaff).where(eq(editionStaff.userId, actor.userId));
  return rows.map((r) => r.editionId);
}

// ---------------------------------------------------------------------------
// Exhibitors
// ---------------------------------------------------------------------------

export type Membership = typeof companyMembers.$inferSelect;

export async function getMemberships(actor: Actor, db?: DbLike): Promise<Membership[]> {
  const d = db ?? (await getDb());
  return d.select().from(companyMembers).where(eq(companyMembers.userId, actor.userId));
}

export type StandAccess = { stand: typeof stands.$inferSelect; membership: Membership };

/**
 * An exhibitor may act on a stand only if they belong to the company holding it.
 * `pay` additionally needs payment rights; any write is refused in read-only view-as mode.
 */
export async function requireStandAccess(
  actor: Actor,
  standId: string,
  opts: { write?: boolean; pay?: boolean; db?: DbLike } = {},
): Promise<StandAccess> {
  const d = opts.db ?? (await getDb());
  const [stand] = await d.select().from(stands).where(eq(stands.id, standId)).limit(1);
  if (!stand || !stand.companyId || stand.status !== 'active') throw notFound();
  const [membership] = await d
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, stand.companyId), eq(companyMembers.userId, actor.userId)))
    .limit(1);
  if (!membership) throw notFound();
  if (opts.write || opts.pay) assertWritable(actor);
  if (opts.pay && membership.role !== 'main_contact' && !membership.canPay) {
    throw forbidden('Your company has not given you permission to pay. Ask your main contact.');
  }
  return { stand, membership };
}

/** Stands the actor can act on as an exhibitor in one edition. */
export async function exhibitorStands(actor: Actor, editionId: string, db?: DbLike) {
  const d = db ?? (await getDb());
  const memberships = await getMemberships(actor, d);
  if (!memberships.length) return [];
  return d
    .select()
    .from(stands)
    .where(
      and(
        eq(stands.editionId, editionId),
        eq(stands.status, 'active'),
        inArray(
          stands.companyId,
          memberships.map((m) => m.companyId),
        ),
      ),
    );
}

/** Live editions where the actor exhibits. */
export async function exhibitorEditions(actor: Actor, db?: DbLike) {
  const d = db ?? (await getDb());
  const memberships = await getMemberships(actor, d);
  if (!memberships.length) return [];
  const rows = await d
    .selectDistinct({ edition: editions })
    .from(stands)
    .innerJoin(editions, eq(editions.id, stands.editionId))
    .where(
      and(
        eq(stands.status, 'active'),
        inArray(
          stands.companyId,
          memberships.map((m) => m.companyId),
        ),
        inArray(editions.status, ['live', 'onsite', 'closed']),
      ),
    );
  return rows.map((r) => r.edition);
}

// ---------------------------------------------------------------------------
// Contractors and suppliers
// ---------------------------------------------------------------------------

export async function requireContractorStand(actor: Actor, standId: string, opts: { write?: boolean; db?: DbLike } = {}) {
  const d = opts.db ?? (await getDb());
  const [row] = await d
    .select({ contractor: standContractors, stand: stands })
    .from(standContractors)
    .innerJoin(stands, eq(stands.id, standContractors.standId))
    .where(and(eq(standContractors.standId, standId), eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active')))
    .limit(1);
  if (!row || row.stand.status !== 'active') throw notFound();
  if (opts.write) assertWritable(actor);
  return row;
}

export async function contractorStandIds(actor: Actor, db?: DbLike) {
  const d = db ?? (await getDb());
  const rows = await d
    .select({ standId: standContractors.standId })
    .from(standContractors)
    .where(and(eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active')));
  return rows.map((r) => r.standId);
}

export async function supplierIdsFor(actor: Actor, db?: DbLike) {
  const d = db ?? (await getDb());
  const rows = await d.select({ supplierId: supplierUsers.supplierId }).from(supplierUsers).where(eq(supplierUsers.userId, actor.userId));
  return rows.map((r) => r.supplierId);
}

export async function requireSupplierMember(actor: Actor, supplierId: string, opts: { write?: boolean; db?: DbLike } = {}) {
  const ids = await supplierIdsFor(actor, opts.db);
  if (!ids.includes(supplierId)) throw notFound();
  if (opts.write) assertWritable(actor);
}
