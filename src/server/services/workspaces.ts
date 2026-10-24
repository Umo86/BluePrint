import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { editionStaff, editions, shows } from '../db/schema';
import { contractorStandIds, exhibitorEditions, isViewingAs, supplierIdsFor } from '../authz';
import type { Actor } from '../auth/actor';

export type Workspace = {
  kind: 'admin' | 'manage' | 'portal' | 'contractor' | 'supplier';
  label: string;
  description: string;
  href: string;
};

const ROLE_LABEL = { show_admin: 'Show admin', show_team: 'Show team', hs_reviewer: 'Health and safety reviewer' } as const;

/** Every area of BluePrint the person can open. */
export async function getWorkspaces(actor: Actor): Promise<Workspace[]> {
  const db = await getDb();
  const out: Workspace[] = [];
  if (actor.isSuperAdmin && !actor.readOnly) {
    out.push({ kind: 'admin', label: 'Super admin', description: 'Every show, user and setting', href: '/admin' });
  }

  // Viewing as an exhibitor shows only that exhibitor's portal, never their staff work.
  const staffRows = isViewingAs(actor)
    ? []
    : await db
        .select({ edition: editions, show: shows, role: editionStaff.role })
        .from(editionStaff)
        .innerJoin(editions, eq(editions.id, editionStaff.editionId))
        .innerJoin(shows, eq(shows.id, editions.showId))
        .where(eq(editionStaff.userId, actor.userId))
        .orderBy(asc(editions.name));
  for (const r of staffRows) {
    if (r.edition.status === 'archived') continue;
    out.push({
      kind: 'manage',
      label: r.edition.name,
      description: ROLE_LABEL[r.role],
      href: r.role === 'hs_reviewer' ? `/manage/${r.edition.id}/space-only` : `/manage/${r.edition.id}`,
    });
  }

  for (const e of await exhibitorEditions(actor, db)) {
    out.push({ kind: 'portal', label: e.name, description: 'Exhibitor portal', href: `/portal/${e.slug}` });
  }

  if ((await contractorStandIds(actor, db)).length) {
    out.push({ kind: 'contractor', label: 'Stand contractor', description: 'Space-only packs for the stands you build', href: '/contractor' });
  }
  if ((await supplierIdsFor(actor, db)).length) {
    out.push({ kind: 'supplier', label: 'Supplier portal', description: 'Your catalogue, orders and payouts', href: '/supplier' });
  }
  return out;
}

export async function editionsByIds(ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  return db.select().from(editions).where(inArray(editions.id, ids));
}
