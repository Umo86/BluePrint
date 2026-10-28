import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray, like } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import {
  assistantConversations,
  assistantFaqs,
  auditLog,
  cartItems,
  companies,
  counters,
  editions,
  editionStaff,
  emailOutbox,
  fileBlobs,
  files,
  invoices,
  orders,
  serviceCategories,
  shows,
  spaceOnlyPacks,
  stands,
  supplierTransfers,
  suppliers,
  tickets,
  users,
} from '@/server/db/schema';
import { DEMO_ACCOUNTS, DEMO_EDITION_SLUG, DEMO_VERSION, loadDemoData, resetDemoData } from '@/server/demo/data';
import { getDemoState, planDemoRemoval, removeDemoData, setDemoState } from '@/server/demo/remove';
import { clearDemoFlags, isDemoEdition } from '@/server/demo/flags';
import { signInWithPassword } from '@/server/auth/login';
import { NoStorage, setStorageForTests } from '@/server/storage';
import { beginUpload, completeUpload, receiveLocalUpload } from '@/server/services/files';
import { paymentsForEdition, payments, setPaymentsForTests, type PaymentsProvider } from '@/server/payments/provider';
import { sendEmail } from '@/server/email/send';
import { setEmailProviderForTests } from '@/server/email/provider';
import { basketsForStaff } from '@/server/services/baskets';
import { actorFor, makeEdition, makeExhibitor, makeUser } from '../support/factories';

const ctx = { ip: '10.9.0.1', userAgent: 'vitest' };

const logins = [
  { role: 'Super admin', email: 'demo.admin@blueprint.test', password: 'a long demo password one' },
  { role: 'Show admin', email: DEMO_ACCOUNTS.showAdmin.email, password: 'a long demo password two' },
  { role: 'Exhibitor (space only)', email: DEMO_ACCOUNTS.spaceExhibitor.email, password: 'a long demo password three' },
  { role: 'Stand contractor', email: DEMO_ACCOUNTS.contractor.email, password: 'a long demo password four' },
  { role: 'Supplier', email: DEMO_ACCOUNTS.supplier.email, password: 'a long demo password five' },
];

const pdf = () => new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
  // Like a new live site: no file storage yet.
  setStorageForTests(new NoStorage());
});
afterEach(() => setEmailProviderForTests(null));
afterAll(async () => {
  setStorageForTests(null);
  await closeDb();
});

async function demoEdition() {
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG));
  return edition;
}

describe('demo data', () => {
  it('adds a live show with every kind of account, at every stage', async () => {
    const notes = await loadDemoData(logins);
    expect(notes[0]).toMatch(/Added version 3/);
    expect(notes.filter((n) => n.startsWith('Password set'))).toHaveLength(logins.length);

    const db = await getDb();
    const edition = await demoEdition();
    expect(edition.status).toBe('live');
    // Build-up is a few weeks away, so deadlines fall either side of today.
    const weeks = (edition.buildUpStartsAt!.getTime() - Date.now()) / (7 * 86_400_000);
    expect(weeks).toBeGreaterThan(4.5);
    expect(weeks).toBeLessThan(6.5);
    expect(await isDemoEdition(edition.id)).toBe(true);
    const [{ n: standCount }] = await db.select({ n: count() }).from(stands).where(eq(stands.editionId, edition.id));
    expect(standCount).toBe(36);
    const roles = (await db.select({ role: editionStaff.role }).from(editionStaff).where(eq(editionStaff.editionId, edition.id))).map((r) => r.role);
    expect(new Set(roles)).toEqual(new Set(['hs_reviewer', 'show_admin', 'show_team']));

    // Orders in every state, numbered in their own DEMO- sequence.
    const orderRows = await db.select().from(orders).where(eq(orders.editionId, edition.id));
    expect(new Set(orderRows.map((o) => o.status))).toEqual(new Set(['paid', 'invoiced', 'partially_refunded', 'refunded', 'cancelled']));
    expect(orderRows.every((o) => o.number.startsWith('DEMO-ORD-'))).toBe(true);
    expect((await db.select().from(invoices)).every((i) => i.number.startsWith('DEMO-'))).toBe(true);
    expect((await db.select().from(counters)).every((c) => c.key.startsWith('demo_'))).toBe(true);
    // Card payments went through practice payments, and the suppliers' payouts are at different stages.
    expect(orderRows.filter((o) => o.paymentMethod === 'card' && o.stripePaymentIntentId?.startsWith('sim_pi_')).length).toBeGreaterThan(5);
    expect(new Set((await db.select().from(supplierTransfers)).map((t) => t.status))).toEqual(new Set(['created', 'pending', 'manual', 'reversed']));

    // Space-only packs in every review state, with their documents kept in the database.
    const packs = await db.select().from(spaceOnlyPacks);
    expect(new Set(packs.map((p) => p.status))).toEqual(new Set(['not_started', 'submitted', 'under_review', 'changes_needed', 'approved', 'approved_with_conditions', 'rejected']));
    expect(packs.filter((p) => p.certificateFileId)).toHaveLength(2);
    const stored = await db.select().from(files);
    expect(stored.length).toBeGreaterThan(40);
    expect(stored.every((f) => f.storageKey.startsWith('demo/'))).toBe(true);
    const [{ n: blobs }] = await db.select({ n: count() }).from(fileBlobs);
    expect(blobs).toBe(stored.length);

    const ticketRows = await db.select().from(tickets).where(eq(tickets.editionId, edition.id));
    expect(new Set(ticketRows.map((t) => t.status))).toEqual(new Set(['open', 'pending', 'closed']));
    expect(ticketRows.every((t) => t.number?.startsWith('DEMO-HD-'))).toBe(true);
    expect(await db.select().from(assistantConversations).where(eq(assistantConversations.editionId, edition.id))).toHaveLength(5);
    expect(edition.assistantSettings).toMatchObject({ name: 'BuildExpo helper', dailyLimit: 100, replyTime: 'hours4' });
    expect(await db.select().from(assistantFaqs).where(eq(assistantFaqs.editionId, edition.id))).toHaveLength(4);
    // The second show is still being set up.
    const all = await db.select().from(editions);
    expect(all.map((e) => e.status).sort()).toEqual(['draft', 'live']);
    // Every invented person, company and supplier is marked as demo data, and every address ends in .test.
    const people = await db.select().from(users);
    expect(people.every((u) => u.isDemo && u.email.endsWith('.test'))).toBe(true);
    expect((await db.select().from(companies)).every((c) => c.isDemo)).toBe(true);
    expect((await db.select().from(suppliers)).every((s) => s.isDemo)).toBe(true);
    expect((await getDemoState())?.version).toBe(DEMO_VERSION);

    // Baskets left without ordering, at different stages, for the basket reminders. Vantage's is
    // the card checkout they gave up on: the items stay in the basket.
    const team = await basketsForStaff(actorFor(people.find((u) => u.email === DEMO_ACCOUNTS.showAdmin.email)!), edition.id);
    expect(team.rows.map((r) => r.standNumber).sort()).toEqual(['N1-132', 'N1-156', 'N1-214', 'N2-312', 'N3-620']);
    expect(team.rows.find((r) => r.standNumber === 'N1-132')?.reminders).toHaveLength(2);
    expect(team.totals.recoveredOrders).toBe(1);
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
    expect(notes[0]).toMatch(/up to date/);
    const db = await getDb();
    expect(await db.select().from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG))).toHaveLength(1);
    await expect(signInWithPassword(changed[1].email, 'a different long password', { ...ctx, ip: '10.9.0.2' })).resolves.toMatchObject({ email: changed[1].email });
  });

  it('brings a version 2 demo up to date without starting it again', async () => {
    const db = await getDb();
    const edition = await demoEdition();
    // A version 2 demo had no open baskets; something a tester did is still there afterwards.
    const demoStands = (await db.select({ id: stands.id }).from(stands).where(eq(stands.editionId, edition.id))).map((s) => s.id);
    await db.delete(cartItems).where(inArray(cartItems.standId, demoStands));
    const state = await getDemoState();
    await setDemoState({ ...state!, version: 2 });
    const before = await db.select({ id: orders.id }).from(orders).where(eq(orders.editionId, edition.id));
    const notes = await loadDemoData(logins);
    expect(notes[0]).toMatch(/Added open baskets/);
    expect(notes[1]).toMatch(/up to date/);
    expect((await getDemoState())?.version).toBe(DEMO_VERSION);
    expect((await demoEdition()).id).toBe(edition.id);
    expect(await db.select({ id: orders.id }).from(orders).where(eq(orders.editionId, edition.id))).toHaveLength(before.length);
    const baskets = await db.selectDistinct({ standId: cartItems.standId }).from(cartItems).where(inArray(cartItems.standId, demoStands));
    expect(baskets).toHaveLength(4);
  });
});

describe('practice payments, uploads and emails in the demo shows', () => {
  it('always uses practice payments in a demo show, and the platform’s payments elsewhere', async () => {
    const fakeStripe = { kind: 'stripe' } as unknown as PaymentsProvider;
    setPaymentsForTests(fakeStripe);
    try {
      const real = await makeEdition('Real Expo');
      expect(await paymentsForEdition(real.edition.id)).toBe(fakeStripe);
      expect((await paymentsForEdition((await demoEdition()).id))?.kind).toBe('simulator');
      expect(payments()).toBe(fakeStripe);
    } finally {
      setPaymentsForTests(null);
    }
  });

  it('keeps uploads in the database for a demo show while file storage is off, and refuses them elsewhere', async () => {
    const db = await getDb();
    const edition = await demoEdition();
    const [acme] = await db.select().from(stands).where(and(eq(stands.editionId, edition.id), eq(stands.number, 'N1-110')));
    const [amira] = await db.select().from(users).where(eq(users.email, DEMO_ACCOUNTS.shellExhibitor.email));
    const me = actorFor(amira);
    const body = pdf();
    const started = await beginUpload(me, { purpose: 'ticket', filename: 'photo.pdf', contentType: 'application/pdf', size: body.byteLength, standId: acme.id });
    expect(started.uploadUrl).toBe(`/api/files/upload/${started.fileId}`);
    await receiveLocalUpload(me, started.fileId, body);
    const done = await completeUpload(me, started.fileId);
    expect(done.storageKey.startsWith('demo/ticket/')).toBe(true);
    expect(done.verifiedAt).toBeTruthy();
    await expect(beginUpload(me, { purpose: 'ticket', filename: 'big.pdf', contentType: 'application/pdf', size: 5 * 1024 * 1024, standId: acme.id })).rejects.toThrow(/4 MB/);

    // The demo shows' files have a ceiling, since anyone can sign in to them.
    const [big] = await db
      .insert(files)
      .values({ storageKey: 'demo/ticket/2026-10/ceiling-test', originalName: 'big.pdf', mimeType: 'application/pdf', sizeBytes: 150 * 1024 * 1024, sha256: '', purpose: 'ticket', editionId: edition.id, verifiedAt: new Date() })
      .returning();
    await expect(beginUpload(me, { purpose: 'ticket', filename: 'one-more.pdf', contentType: 'application/pdf', size: body.byteLength, standId: acme.id })).rejects.toThrow(/no room/);
    await db.delete(files).where(eq(files.id, big.id));

    const real = await makeEdition('Real Expo uploads');
    const ex = await makeExhibitor(real.edition.id, real.shell.id);
    await expect(beginUpload(actorFor(ex.user), { purpose: 'ticket', filename: 'a.pdf', contentType: 'application/pdf', size: body.byteLength, standId: ex.stand.id })).rejects.toThrow(/not switched on/);
  });

  it('never sends email from a demo show or to a demo address, and keeps a demo invitation link for testers', async () => {
    const sent: string[] = [];
    setEmailProviderForTests({
      name: 'resend',
      send: async (e) => {
        sent.push(e.to);
        return { id: `fake_${sent.length}_${Date.now()}` };
      },
    });
    const edition = await demoEdition();
    const real = await makeEdition('Real Expo emails');
    const link = 'https://example.test/invite/abcdefghijklmnopqrstuvwxyz123456';
    const mail = (to: string, editionId: string) => sendEmail({ to, editionId, templateKey: 'invite_contractor', category: 'transactional', subject: 'Join', html: link, text: link });
    const demoToTest = await mail('jo@apex-builds.test', edition.id);
    const demoToReal = await mail('someone@example.com', edition.id);
    const realToReal = await mail('someone@example.com', real.edition.id);
    expect(demoToTest.status).toBe('suppressed');
    expect(demoToReal.status).toBe('suppressed');
    expect(realToReal.status).toBe('sent');
    expect(sent).toEqual(['someone@example.com']);
    const db = await getDb();
    const rows = await db.select().from(emailOutbox).where(inArray(emailOutbox.id, [demoToTest.outboxId, demoToReal.outboxId, realToReal.outboxId]));
    const html = (id: string) => rows.find((r) => r.id === id)!.html;
    // Only the invented address keeps its link: anyone can sign in to the demo shows.
    expect(html(demoToTest.outboxId)).toContain('/invite/abcdefghijklmnopqrstuvwxyz123456');
    expect(html(demoToReal.outboxId)).toContain('/invite/[hidden]');
    expect(html(realToReal.outboxId)).toContain('/invite/[hidden]');
    // Sign-in codes are always hidden.
    const code = await sendEmail({ to: 'amira@acme-insulation.test', editionId: edition.id, templateKey: 'sign_in_code', category: 'security', subject: 'Code', html: 'Your code is 123456', text: 'Your code is 123456' });
    const [codeRow] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, code.outboxId));
    expect(codeRow.html).not.toContain('123456');
  });
});

describe('removing the demo data', () => {
  it('needs a super admin and the typed confirmation', async () => {
    const db = await getDb();
    const [olivia] = await db.select().from(users).where(eq(users.email, DEMO_ACCOUNTS.showAdmin.email));
    await expect(removeDemoData(actorFor(olivia), 'remove demo data')).rejects.toThrow();
    const admin = await makeUser({ isSuperAdmin: true, email: 'real.admin@example.com', name: 'Real Admin' });
    await expect(removeDemoData(actorFor(admin), 'yes')).rejects.toThrow(/remove demo data/);
  });

  it('removes every demo record and keeps everything else', async () => {
    const db = await getDb();
    const [admin] = await db.select().from(users).where(eq(users.email, 'real.admin@example.com'));
    // A real show with a real exhibitor, which also uses one of the demo suppliers.
    const real = await makeEdition('UK Construction Week London 2027');
    const realEx = await makeExhibitor(real.edition.id, real.shell.id, 'R-1');
    const [furniture] = await db.select().from(suppliers).where(eq(suppliers.email, 'orders@expofurniture.test'));
    await db.insert(serviceCategories).values({ editionId: real.edition.id, name: 'Furniture', supplierId: furniture.id });
    // Someone a tester invited into a demo show only, and a real person who was also tried out there.
    const edition = await demoEdition();
    const tester = await makeUser({ email: 'colleague@example.com', name: 'Invited Colleague' });
    await db.insert(editionStaff).values({ editionId: edition.id, userId: tester.id, role: 'show_team', permissions: ['helpdesk'] });
    await db.insert(editionStaff).values({ editionId: edition.id, userId: realEx.user.id, role: 'show_team', permissions: ['helpdesk'] });

    const plan = await planDemoRemoval({ keepUserId: admin.id });
    expect(plan.kept.suppliers.map((s) => s.name)).toEqual(['Expo Furniture Hire']);
    expect(plan.people.map((p) => p.email)).toContain('colleague@example.com');
    expect(plan.people.map((p) => p.email)).not.toContain(realEx.user.email);

    const counts = await removeDemoData(actorFor(admin), '  Remove Demo Data ');
    expect(counts.shows).toBe(2);
    clearDemoFlags();

    // Only the real shows made in these tests are left (the test factory names their shows Demo Expo).
    expect(await db.select().from(shows).where(eq(shows.isDemo, true))).toHaveLength(0);
    expect((await db.select().from(editions)).map((e) => e.name).sort()).toEqual(['Real Expo', 'Real Expo emails', 'Real Expo uploads', 'UK Construction Week London 2027']);
    expect(await db.select().from(stands).where(eq(stands.editionId, edition.id))).toHaveLength(0);
    expect(await db.select().from(stands).where(eq(stands.id, realEx.stand.id))).toHaveLength(1);
    expect(await db.select().from(orders).where(eq(orders.editionId, edition.id))).toHaveLength(0);
    expect(await db.select().from(fileBlobs)).toHaveLength(0);
    expect(await db.select().from(files).where(like(files.storageKey, 'demo/%'))).toHaveLength(0);
    expect(await db.select().from(counters).where(like(counters.key, 'demo%'))).toHaveLength(0);
    expect(await db.select().from(companies).where(eq(companies.isDemo, true))).toHaveLength(0);
    // The supplier a real show uses stays; the others go.
    expect((await db.select().from(suppliers)).map((s) => s.name)).toEqual(['Expo Furniture Hire']);
    const left = (await db.select().from(users)).map((u) => u.email).sort();
    expect(left).toContain('real.admin@example.com');
    expect(left).toContain(realEx.user.email);
    // Super admins always stay, even the one the demo data made.
    expect(left).toContain('demo.admin@blueprint.test');
    expect(left).not.toContain('colleague@example.com');
    expect(left.filter((e) => e.endsWith('.test'))).toEqual(['demo.admin@blueprint.test']);
    expect(await db.select().from(auditLog).where(eq(auditLog.editionId, edition.id))).toHaveLength(0);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'demo.removed'));
    expect(entry.actorEmail).toBe('real.admin@example.com');
    expect((await getDemoState())?.removedAt).toBeTruthy();
  });

  it('is not added back by the build once removed, but the super admin can add it again', async () => {
    const notes = await loadDemoData(logins);
    expect(notes[0]).toMatch(/was removed/);
    const db = await getDb();
    expect(await db.select().from(shows).where(eq(shows.isDemo, true))).toHaveLength(0);
    const [admin] = await db.select().from(users).where(eq(users.email, 'real.admin@example.com'));
    await resetDemoData(actorFor(admin), logins);
    expect(await db.select().from(shows).where(eq(shows.isDemo, true))).toHaveLength(2);
    const state = await getDemoState();
    expect(state?.removedAt).toBeUndefined();
    expect(state?.version).toBe(DEMO_VERSION);
  });

  it('replaces the first version of the demo data, which was not marked', async () => {
    const db = await getDb();
    const [admin] = await db.select().from(users).where(eq(users.email, 'real.admin@example.com'));
    await removeDemoData(actorFor(admin), 'remove demo data');
    await setDemoState(null);
    // What version 1 left behind: its shows by slug, an exhibitor and a person, nothing marked.
    const [show] = await db.insert(shows).values({ name: 'BuildExpo', slug: 'buildexpo' }).returning();
    const [old] = await db.insert(editions).values({ showId: show.id, name: 'BuildExpo London 2027', slug: 'buildexpo-london-2027', status: 'live' }).returning();
    const fresh = await makeEdition('Unrelated');
    const ex = await makeExhibitor(old.id, fresh.shell.id, 'N1-110');
    await db.update(users).set({ email: 'ben@brightbuild.test' }).where(eq(users.id, ex.user.id));
    clearDemoFlags();
    const notes = await loadDemoData(logins);
    expect(notes[0]).toMatch(/first version/);
    expect(notes[1]).toMatch(/Removed the older demo data/);
    expect(await db.select().from(editions).where(eq(editions.slug, 'buildexpo-london-2027'))).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.email, 'ben@brightbuild.test'))).toHaveLength(1); // the new version's Ben
    expect(await db.select().from(editions).where(eq(editions.slug, DEMO_EDITION_SLUG))).toHaveLength(1);
    // The unrelated real show is untouched.
    expect(await db.select().from(editions).where(eq(editions.id, fresh.edition.id))).toHaveLength(1);
  });
});
