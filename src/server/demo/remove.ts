import 'server-only';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import {
  auditLog,
  companies,
  companyMembers,
  counters,
  editionStaff,
  editions,
  emailOutbox,
  fileBlobs,
  files,
  invitations,
  libraryItems,
  orderLines,
  orders,
  platformSettings,
  products,
  reminderLog,
  serviceCategories,
  shows,
  standContractors,
  stands,
  supplierUsers,
  suppliers,
  tickets,
  unsubscribes,
  users,
} from '../db/schema';
import { assertSuperAdmin } from '../authz';
import { audit } from '../audit';
import { invalid } from '../errors';
import { PRACTICE_KEY_PREFIX, storageForKey } from '../storage';
import { clearDemoFlags } from './flags';
import type { Actor } from '../auth/actor';

/**
 * Removing the demo data: the demo shows with everything in them, the invented companies,
 * suppliers and people, and anything testers added that only ever belonged to the demo shows.
 * Super admins, real shows and anything used by a real show are never touched.
 */

const STATE_KEY = 'demo_data';

export type DemoState = {
  /** Which version of the demo data was loaded. */
  version: number;
  loadedAt: string;
  /** Once removed, the build does not add it again (even if DEMO_DATA is still set). */
  removedAt?: string;
  removedBy?: string;
  counts?: Record<string, number>;
};

export async function getDemoState(db?: DbLike): Promise<DemoState | null> {
  const d = db ?? (await getDb());
  const [row] = await d.select().from(platformSettings).where(eq(platformSettings.key, STATE_KEY)).limit(1);
  return (row?.value as DemoState | undefined) ?? null;
}

export async function setDemoState(state: DemoState | null, db?: DbLike, by?: string | null) {
  const d = db ?? (await getDb());
  if (!state) {
    await d.delete(platformSettings).where(eq(platformSettings.key, STATE_KEY));
    return;
  }
  await d
    .insert(platformSettings)
    .values({ key: STATE_KEY, value: state, updatedBy: by ?? null })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: state, updatedBy: by ?? null, updatedAt: new Date() } });
}

const NONE = ['00000000-0000-0000-0000-000000000000'];
const ids = (list: string[]) => (list.length ? list : NONE);

export type RemovalPlan = Awaited<ReturnType<typeof planDemoRemoval>>;

/** Works out exactly what removing the demo data would delete, and what it keeps. Changes nothing. */
export async function planDemoRemoval(opts: { keepUserId?: string | null } = {}) {
  const db = await getDb();
  const demoShows = await db.select({ id: shows.id, name: shows.name }).from(shows).where(eq(shows.isDemo, true));
  const showIds = demoShows.map((s) => s.id);
  const demoEditions = await db
    .select({ id: editions.id, name: editions.name, status: editions.status, showId: editions.showId })
    .from(editions)
    .where(inArray(editions.showId, ids(showIds)));
  const editionIds = demoEditions.map((e) => e.id);
  const standRows = await db.select({ id: stands.id, companyId: stands.companyId, editionId: stands.editionId }).from(stands);
  const demoEditionSet = new Set(editionIds);
  const standIds = standRows.filter((s) => demoEditionSet.has(s.editionId)).map((s) => s.id);

  // Companies: the invented ones, and any that only ever had stands in the demo shows. A company
  // with a stand in a real show is kept, whatever it is marked.
  const companyRows = await db.select({ id: companies.id, name: companies.name, isDemo: companies.isDemo }).from(companies);
  const standsByCompany = new Map<string, { demo: number; real: number }>();
  for (const s of standRows) {
    if (!s.companyId) continue;
    const c = standsByCompany.get(s.companyId) ?? { demo: 0, real: 0 };
    if (demoEditionSet.has(s.editionId)) c.demo += 1;
    else c.real += 1;
    standsByCompany.set(s.companyId, c);
  }
  const removeCompanies: { id: string; name: string }[] = [];
  const keptCompanies: { id: string; name: string }[] = [];
  for (const c of companyRows) {
    const counts = standsByCompany.get(c.id) ?? { demo: 0, real: 0 };
    if (!c.isDemo && !counts.demo) continue;
    if (!c.isDemo && counts.real) continue;
    if (counts.real) keptCompanies.push({ id: c.id, name: c.name });
    else removeCompanies.push({ id: c.id, name: c.name });
  }
  const companyIds = removeCompanies.map((c) => c.id);
  const companySet = new Set(companyIds);

  // Suppliers: the invented ones, unless a real show uses them (then they stay, and say why).
  const demoSuppliers = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.isDemo, true));
  const usedByReal = new Set<string>();
  if (demoSuppliers.length) {
    const sIds = demoSuppliers.map((s) => s.id);
    const realEditionIds = (await db.select({ id: editions.id }).from(editions)).map((e) => e.id).filter((id) => !demoEditionSet.has(id));
    if (realEditionIds.length) {
      for (const r of await db
        .selectDistinct({ id: serviceCategories.supplierId })
        .from(serviceCategories)
        .where(and(inArray(serviceCategories.supplierId, sIds), inArray(serviceCategories.editionId, realEditionIds))))
        if (r.id) usedByReal.add(r.id);
      for (const r of await db
        .selectDistinct({ id: products.supplierId })
        .from(products)
        .where(and(inArray(products.supplierId, sIds), inArray(products.editionId, realEditionIds))))
        if (r.id) usedByReal.add(r.id);
      for (const r of await db
        .selectDistinct({ id: orderLines.supplierId })
        .from(orderLines)
        .innerJoin(orders, eq(orders.id, orderLines.orderId))
        .where(and(inArray(orderLines.supplierId, sIds), inArray(orders.editionId, realEditionIds))))
        if (r.id) usedByReal.add(r.id);
    }
  }
  const removeSuppliers = demoSuppliers.filter((s) => !usedByReal.has(s.id));
  const keptSuppliers = demoSuppliers.filter((s) => usedByReal.has(s.id));
  const supplierIds = removeSuppliers.map((s) => s.id);
  const supplierSet = new Set(supplierIds);

  // People: the invented ones, and anyone whose every link was to the demo data (for example a
  // colleague a tester invited in a demo show). Super admins always stay.
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, isDemo: users.isDemo, isSuperAdmin: users.isSuperAdmin })
    .from(users);
  const standSet = new Set(standIds);
  const links = new Map<string, { demo: number; real: number }>();
  const bump = (userId: string | null, demo: boolean) => {
    if (!userId) return;
    const l = links.get(userId) ?? { demo: 0, real: 0 };
    if (demo) l.demo += 1;
    else l.real += 1;
    links.set(userId, l);
  };
  for (const r of await db.select({ userId: editionStaff.userId, editionId: editionStaff.editionId }).from(editionStaff)) bump(r.userId, demoEditionSet.has(r.editionId));
  for (const r of await db.select({ userId: companyMembers.userId, companyId: companyMembers.companyId }).from(companyMembers)) bump(r.userId, companySet.has(r.companyId));
  for (const r of await db.select({ userId: supplierUsers.userId, supplierId: supplierUsers.supplierId }).from(supplierUsers)) bump(r.userId, supplierSet.has(r.supplierId));
  for (const r of await db.select({ userId: standContractors.userId, standId: standContractors.standId }).from(standContractors)) bump(r.userId, standSet.has(r.standId));
  const removePeople: { id: string; name: string; email: string; why: string }[] = [];
  const keptSuperAdmins: { id: string; name: string; email: string; isDemo: boolean }[] = [];
  for (const p of people) {
    const l = links.get(p.id) ?? { demo: 0, real: 0 };
    if (p.isSuperAdmin) {
      if (p.isDemo || l.demo) keptSuperAdmins.push({ id: p.id, name: p.name, email: p.email, isDemo: p.isDemo });
      continue;
    }
    if (p.id === opts.keepUserId) continue;
    if (p.isDemo) removePeople.push({ id: p.id, name: p.name, email: p.email, why: 'Demo account' });
    else if (l.demo && !l.real) removePeople.push({ id: p.id, name: p.name, email: p.email, why: 'Only used in the demo shows' });
  }
  const userIds = removePeople.map((p) => p.id);

  const library = await db.select({ id: libraryItems.id, name: libraryItems.name }).from(libraryItems).where(eq(libraryItems.isDemo, true));

  const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const n = sql<number>`count(*)::int`;
  const fileScope = or(
    inArray(files.editionId, ids(editionIds)),
    inArray(files.standId, ids(standIds)),
    inArray(files.companyId, ids(companyIds)),
    inArray(files.supplierId, ids(supplierIds)),
  );
  const counts = {
    shows: demoShows.length,
    editions: editionIds.length,
    stands: standIds.length,
    companies: companyIds.length,
    suppliers: supplierIds.length,
    people: userIds.length,
    orders: await count(db.select({ n }).from(orders).where(inArray(orders.editionId, ids(editionIds)))),
    questions: await count(db.select({ n }).from(tickets).where(inArray(tickets.editionId, ids(editionIds)))),
    files: await count(db.select({ n }).from(files).where(fileScope)),
    library: library.length,
  };
  const realShows = await db.select({ id: shows.id, name: shows.name }).from(shows).where(eq(shows.isDemo, false));
  return {
    showIds,
    editionIds,
    standIds,
    companyIds,
    supplierIds,
    userIds,
    libraryIds: library.map((l) => l.id),
    shows: demoShows.map((s) => ({ ...s, editions: demoEditions.filter((e) => e.showId === s.id) })),
    people: removePeople,
    companies: removeCompanies,
    suppliers: removeSuppliers,
    library,
    kept: { superAdmins: keptSuperAdmins, suppliers: keptSuppliers, companies: keptCompanies, shows: realShows },
    counts,
    empty: !demoShows.length && !companyIds.length && !supplierIds.length && !userIds.length && !library.length,
  };
}

/** What the super admin's Demo data page shows. */
export async function demoOverview(actor: Actor) {
  assertSuperAdmin(actor);
  const [state, plan] = await Promise.all([getDemoState(), planDemoRemoval({ keepUserId: actor.realUserId })]);
  return { state, plan };
}

export const REMOVE_CONFIRMATION = 'remove demo data';

/** The super admin removes the demo data. Typed confirmation, one transaction, recorded in the audit log. */
export async function removeDemoData(actor: Actor, confirmation: string) {
  assertSuperAdmin(actor);
  if (confirmation.trim().toLowerCase() !== REMOVE_CONFIRMATION) throw invalid(`Type “${REMOVE_CONFIRMATION}” to confirm.`, { confirmation: `Type “${REMOVE_CONFIRMATION}” to confirm.` });
  return removeAll({ actor, keepUserId: actor.realUserId });
}

/**
 * Removes the demo data. Used by the super admin's button and by the build when a newer version of
 * the demo data replaces an older one (`markRemoved: false`, so it can be loaded again).
 */
export async function removeAll(opts: { actor: Actor | null; keepUserId?: string | null; markRemoved?: boolean }) {
  const plan = await planDemoRemoval({ keepUserId: opts.keepUserId ?? null });
  const db = await getDb();
  const { editionIds, standIds, companyIds, supplierIds, userIds, showIds, libraryIds } = plan;
  const removedEmails = plan.people.map((p) => p.email.toLowerCase());
  const keys: string[] = [];

  await db.transaction(async (tx) => {
    // Orders first: they hold on to their show and stand. Lines, payouts, refunds and invoices go with them.
    await tx.delete(orders).where(inArray(orders.editionId, ids(editionIds)));
    const fileRows = await tx
      .delete(files)
      .where(or(inArray(files.editionId, ids(editionIds)), inArray(files.standId, ids(standIds)), inArray(files.companyId, ids(companyIds)), inArray(files.supplierId, ids(supplierIds))))
      .returning({ key: files.storageKey });
    keys.push(...fileRows.map((f) => f.key));
    const practiceKeys = keys.filter((k) => k.startsWith(PRACTICE_KEY_PREFIX));
    for (let i = 0; i < practiceKeys.length; i += 500) await tx.delete(fileBlobs).where(inArray(fileBlobs.storageKey, practiceKeys.slice(i, i + 500)));
    await tx
      .delete(emailOutbox)
      .where(or(inArray(emailOutbox.editionId, ids(editionIds)), inArray(emailOutbox.toUserId, ids(userIds)), inArray(emailOutbox.companyId, ids(companyIds))));
    await tx.delete(reminderLog).where(inArray(reminderLog.editionId, ids(editionIds)));
    await tx.delete(unsubscribes).where(inArray(unsubscribes.editionId, ids(editionIds)));
    await tx
      .delete(invitations)
      .where(
        or(
          inArray(invitations.editionId, ids(editionIds)),
          inArray(invitations.standId, ids(standIds)),
          inArray(invitations.companyId, ids(companyIds)),
          inArray(invitations.supplierId, ids(supplierIds)),
          removedEmails.length ? inArray(sql`lower(${invitations.email})`, removedEmails) : sql`false`,
        ),
      );
    // The invented activity goes from the audit log too, so it starts clean for real use.
    const entity = (type: string, list: string[]) => and(eq(auditLog.entityType, type), inArray(auditLog.entityId, list.length ? list : ['-']));
    await tx
      .delete(auditLog)
      .where(
        or(
          inArray(auditLog.editionId, ids(editionIds)),
          inArray(auditLog.actorUserId, ids(userIds)),
          inArray(auditLog.companyId, ids(companyIds)),
          entity('show', showIds),
          entity('edition', editionIds),
          entity('supplier', supplierIds),
          entity('user', userIds),
          entity('company', companyIds),
          entity('library_item', libraryIds),
        ),
      );
    // Stands before their shows: each stand also points at its stand type, which goes with the show.
    await tx.delete(stands).where(inArray(stands.editionId, ids(editionIds)));
    await tx.delete(tickets).where(inArray(tickets.editionId, ids(editionIds)));
    await tx.delete(editions).where(inArray(editions.id, ids(editionIds)));
    await tx.delete(shows).where(inArray(shows.id, ids(showIds)));
    await tx.delete(companies).where(inArray(companies.id, ids(companyIds)));
    await tx.delete(suppliers).where(inArray(suppliers.id, ids(supplierIds)));
    await tx.delete(users).where(inArray(users.id, ids(userIds)));
    await tx.delete(libraryItems).where(inArray(libraryItems.id, ids(libraryIds)));
    // The demo shows' own number sequences (DEMO-ORD-000001 and so on).
    await tx.delete(counters).where(like(counters.key, 'demo\\_%'));
    const state = await getDemoState(tx);
    if (opts.markRemoved === false) await setDemoState(null, tx);
    else
      await setDemoState(
        { version: state?.version ?? 0, loadedAt: state?.loadedAt ?? '', removedAt: new Date().toISOString(), removedBy: opts.actor?.realEmail ?? 'system', counts: plan.counts },
        tx,
        opts.actor?.realUserId ?? null,
      );
  });
  clearDemoFlags();
  // Files kept outside the database (R2 or a local folder) go after the database has let them go.
  for (const key of keys.filter((k) => !k.startsWith(PRACTICE_KEY_PREFIX))) await storageForKey(key).delete(key).catch(() => undefined);
  if (opts.actor) await audit(opts.actor, 'demo.removed', { entityType: 'platform_settings', entityId: STATE_KEY, details: plan.counts });
  return plan.counts;
}
