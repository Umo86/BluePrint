import 'server-only';
import { and, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import {
  EDITION_PERMISSIONS,
  companyMembers,
  editionStaff,
  editions,
  standContractors,
  stands,
  supplierUsers,
  users,
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

/**
 * True while an admin is viewing the portal as an exhibitor. The view is limited to that exhibitor's
 * stands in the one show the admin may view (`viewAsEditionId`); everything else they can reach is off.
 */
export function isViewingAs(actor: Actor) {
  return actor.viewAsEditionId !== undefined && actor.viewAsEditionId !== null ? true : actor.userId !== actor.realUserId;
}

/** Whether exhibitor data in this edition is in reach (always, unless viewing as someone in another show). */
export function inViewedEdition(actor: Actor, editionId: string) {
  return !isViewingAs(actor) || (Boolean(actor.viewAsEditionId) && actor.viewAsEditionId === editionId);
}

export function assertSuperAdmin(actor: Actor) {
  if (!actor.isSuperAdmin || actor.readOnly) throw forbidden();
}

/** What the actor may do in an edition, or null when they have no staff role there. */
export async function getEditionAccess(actor: Actor, editionId: string, db?: DbLike): Promise<EditionAccess | null> {
  if (actor.isSuperAdmin && !actor.readOnly) return { role: 'super_admin', permissions: ALL_PERMISSIONS };
  // Viewing as an exhibitor never carries anyone's staff rights.
  if (isViewingAs(actor)) return null;
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

/** Active staff in an edition who hold a permission (show admins hold them all), for notifications. */
export async function editionStaffWith(editionId: string, permission: EditionPermission, db?: DbLike) {
  const d = db ?? (await getDb());
  const rows = await d
    .select({ id: users.id, email: users.email, name: users.name, role: editionStaff.role, permissions: editionStaff.permissions })
    .from(editionStaff)
    .innerJoin(users, eq(users.id, editionStaff.userId))
    .where(and(eq(editionStaff.editionId, editionId), eq(users.status, 'active')));
  return rows.filter((r) =>
    r.role === 'show_admin' ? true : r.role === 'hs_reviewer' ? HS_REVIEWER_PERMISSIONS.has(permission) : permission === 'view' || r.permissions.includes(permission),
  );
}

/** Editions where the actor is on the staff (all editions for super admins). */
export async function staffEditionIds(actor: Actor, db?: DbLike): Promise<string[] | 'all'> {
  if (actor.isSuperAdmin && !actor.readOnly) return 'all';
  if (isViewingAs(actor)) return [];
  const d = db ?? (await getDb());
  const rows = await d.select({ editionId: editionStaff.editionId }).from(editionStaff).where(eq(editionStaff.userId, actor.userId));
  return rows.map((r) => r.editionId);
}

// ---------------------------------------------------------------------------
// Exhibitors
// ---------------------------------------------------------------------------

export type Membership = typeof companyMembers.$inferSelect;

/** A membership with no list of shows covers every show the company exhibits at; otherwise only those listed. */
export function membershipCovers(m: { editionIds: string[] | null }, editionId: string) {
  return !m.editionIds || m.editionIds.includes(editionId);
}

/** The same rule as SQL, for queries that join `company_members`. */
export function memberCovers(editionId: string | SQL | AnyColumn) {
  const value = typeof editionId === 'string' ? sql`${editionId}::uuid` : editionId;
  return sql`(${companyMembers.editionIds} is null or ${value} = any(${companyMembers.editionIds}))`;
}

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
  if (!inViewedEdition(actor, stand.editionId)) throw notFound();
  const [membership] = await d
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, stand.companyId), eq(companyMembers.userId, actor.userId)))
    .limit(1);
  if (!membership || !membershipCovers(membership, stand.editionId)) throw notFound();
  if (opts.write || opts.pay) assertWritable(actor);
  if (opts.pay && membership.role !== 'main_contact' && !membership.canPay) {
    throw forbidden('Your company has not given you permission to pay. Ask your main contact.');
  }
  return { stand, membership };
}

/** Stands the actor can act on as an exhibitor in one edition. */
export async function exhibitorStands(actor: Actor, editionId: string, db?: DbLike) {
  if (!inViewedEdition(actor, editionId)) return [];
  const d = db ?? (await getDb());
  const memberships = (await getMemberships(actor, d)).filter((m) => membershipCovers(m, editionId));
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
    .selectDistinct({ edition: editions, companyId: stands.companyId })
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
  const out = new Map<string, (typeof rows)[number]['edition']>();
  for (const r of rows) {
    const m = memberships.find((x) => x.companyId === r.companyId);
    if (m && membershipCovers(m, r.edition.id) && inViewedEdition(actor, r.edition.id)) out.set(r.edition.id, r.edition);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Contractors and suppliers
// ---------------------------------------------------------------------------

export async function requireContractorStand(actor: Actor, standId: string, opts: { write?: boolean; db?: DbLike } = {}) {
  // Viewing as covers the exhibitor portal only.
  if (isViewingAs(actor)) throw notFound();
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
  if (isViewingAs(actor)) return [];
  const d = db ?? (await getDb());
  const rows = await d
    .select({ standId: standContractors.standId })
    .from(standContractors)
    .where(and(eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active')));
  return rows.map((r) => r.standId);
}

export async function supplierIdsFor(actor: Actor, db?: DbLike) {
  if (isViewingAs(actor)) return [];
  const d = db ?? (await getDb());
  const rows = await d.select({ supplierId: supplierUsers.supplierId }).from(supplierUsers).where(eq(supplierUsers.userId, actor.userId));
  return rows.map((r) => r.supplierId);
}

export async function requireSupplierMember(actor: Actor, supplierId: string, opts: { write?: boolean; db?: DbLike } = {}) {
  const ids = await supplierIdsFor(actor, opts.db);
  if (!ids.includes(supplierId)) throw notFound();
  if (opts.write) assertWritable(actor);
}
