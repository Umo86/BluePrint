import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { editions, editionStaff, tickets, orders, spaceOnlyPacks, standContractors, stands, submissions, supplierUsers, users } from '@/server/db/schema';
import { DEMO_ACCOUNTS, DEMO_EDITION_SLUG, loadDemoData } from '@/server/demo/data';
import { signInWithPassword } from '@/server/auth/login';

const ctx = { ip: '10.9.0.1', userAgent: 'vitest' };

const logins = [
  { role: 'Super admin', email: 'demo.admin@blueprint.test', password: 'a long demo password one' },
  { role: 'Show admin', email: DEMO_ACCOUNTS.showAdmin.email, password: 'a long demo password two' },
  { role: 'Exhibitor (space only)', email: DEMO_ACCOUNTS.spaceExhibitor.email, password: 'a long demo password three' },
  { role: 'Stand contractor', email: DEMO_ACCOUNTS.contractor.email, password: 'a long demo password four' },
  { role: 'Supplier', email: DEMO_ACCOUNTS.supplier.email, password: 'a long demo password five' },
];

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

describe('demo data', () => {
  it('adds a live show with every kind of account, and things already happening', async () => {
    const notes = await loadDemoData(logins);
    expect(notes[0]).toMatch(/Added the demo shows/);
    expect(notes.filter((n) => n.startsWith('Password set'))).toHaveLength(logins.length);

    const db = await getDb();
    const [edition] = await db.select().from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG));
    expect(edition.status).toBe('live');
    const [{ n: standCount }] = await db.select({ n: count() }).from(stands).where(eq(stands.editionId, edition.id));
    expect(standCount).toBe(10);
    const roles = (await db.select({ role: editionStaff.role }).from(editionStaff).where(eq(editionStaff.editionId, edition.id))).map((r) => r.role).sort();
    expect(roles).toEqual(['hs_reviewer', 'show_admin', 'show_team']);
    const orderRows = await db.select().from(orders).where(eq(orders.editionId, edition.id));
    expect(orderRows.map((o) => o.status).sort()).toEqual(['invoiced', 'invoiced', 'paid']);
    const [{ n: questions }] = await db.select({ n: count() }).from(tickets).where(eq(tickets.editionId, edition.id));
    expect(questions).toBe(2);
    const [{ n: sent }] = await db.select({ n: count() }).from(submissions);
    expect(sent).toBeGreaterThanOrEqual(8);
    const [contractor] = await db.select().from(users).where(eq(users.email, DEMO_ACCOUNTS.contractor.email));
    const [link] = await db.select().from(standContractors).where(and(eq(standContractors.userId, contractor.id), eq(standContractors.status, 'active')));
    const [pack] = await db.select().from(spaceOnlyPacks).where(eq(spaceOnlyPacks.standId, link.standId));
    // Being prepared: details filled in, nothing sent yet.
    expect(pack.status).toBe('not_started');
    expect(Number(pack.declaredHeightM)).toBe(4);
    expect(pack.insuranceCoverGbp).toBe(5_000_000);
    const [supplier] = await db.select().from(users).where(eq(users.email, DEMO_ACCOUNTS.supplier.email));
    expect(await db.select().from(supplierUsers).where(eq(supplierUsers.userId, supplier.id))).toHaveLength(1);
  });

  it('lets the test logins sign in with their passwords', async () => {
    for (const l of logins) {
      const u = await signInWithPassword(l.email, l.password, ctx);
      expect(u.email).toBe(l.email);
    }
  });

  it('adds the shows only once, and updates the passwords when run again', async () => {
    const changed = logins.map((l, i) => (i === 1 ? { ...l, password: 'a different long password' } : l));
    const notes = await loadDemoData(changed);
    expect(notes[0]).toMatch(/already there/);
    const db = await getDb();
    expect(await db.select().from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG))).toHaveLength(1);
    await expect(signInWithPassword(changed[1].email, 'a different long password', { ...ctx, ip: '10.9.0.2' })).resolves.toMatchObject({ email: changed[1].email });
  });
});
