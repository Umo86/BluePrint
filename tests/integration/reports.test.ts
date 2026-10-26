import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, companies, orderLines, orders, serviceCategories, spaceOnlyPacks, submissions, taskRequirements, tasks, users } from '@/server/db/schema';
import { checklistForCompany, computeEditionProgress } from '@/server/services/progress';
import { companyOrdersForStaff } from '@/server/services/orders';
import { listExhibitors } from '@/server/services/stands';
import { editionOverview, editionsAtAGlance } from '@/server/services/overview';
import { servicesForEdition } from '@/server/services/service-lists';
import { draftCampaignForStands, draftTaskReminder, recipientsFor } from '@/server/services/campaigns';
import { availableReports, buildReport } from '@/server/reports';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

const DAY = 86_400_000;

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

async function readXlsx(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

/**
 * A show with three stands and three tasks:
 * - "Insurance" is required for both stand types and its deadline has passed.
 * - "Stand team" is a form, required for shell scheme only, due in ten days.
 * - "Rigging" is optional for space only.
 */
async function showWithProgress() {
  const { edition, shell, space } = await makeEdition();
  const db = await getDb();
  const [insurance] = await db.insert(tasks).values({ editionId: edition.id, title: 'Insurance', kind: 'upload', deadlineAt: new Date(Date.now() - 2 * DAY), sort: 1 }).returning();
  const [team] = await db
    .insert(tasks)
    .values({
      editionId: edition.id,
      title: 'Stand team',
      kind: 'form',
      requiresApproval: true,
      deadlineAt: new Date(Date.now() + 10 * DAY),
      sort: 2,
      formSchema: [
        { id: 'names', type: 'textarea', label: 'Names', required: true },
        { id: 'arrive', type: 'text', label: 'Arrival time', required: false },
      ] as never,
    })
    .returning();
  const [rigging] = await db.insert(tasks).values({ editionId: edition.id, title: 'Rigging', kind: 'upload', deadlineAt: new Date(Date.now() - DAY), sort: 3 }).returning();
  await db.insert(taskRequirements).values([
    { taskId: insurance.id, exhibitorTypeId: shell.id, requirement: 'required' },
    { taskId: insurance.id, exhibitorTypeId: space.id, requirement: 'required' },
    { taskId: team.id, exhibitorTypeId: shell.id, requirement: 'required' },
    { taskId: rigging.id, exhibitorTypeId: space.id, requirement: 'optional' },
  ]);
  const a = await makeExhibitor(edition.id, shell.id, 'S1');
  const b = await makeExhibitor(edition.id, shell.id, 'S2');
  const c = await makeExhibitor(edition.id, space.id, 'P1');
  await db.update(companies).set({ name: '=HYPERLINK("http://evil.example","Click")' }).where(eq(companies.id, c.company.id));
  await db.insert(submissions).values([
    { taskId: insurance.id, standId: a.stand.id, status: 'completed', submittedAt: new Date() },
    { taskId: team.id, standId: a.stand.id, status: 'submitted', submittedAt: new Date(), data: { names: 'Ann\nBen', arrive: '07:30' } },
    { taskId: insurance.id, standId: c.stand.id, status: 'changes_needed', submittedAt: new Date() },
  ]);
  return { edition, shell, space, insurance, team, rigging, a, b, c };
}

describe('checklist progress', () => {
  it('works out where every stand is with every task', async () => {
    const s = await showWithProgress();
    const p = await computeEditionProgress(s.edition.id);
    const by = Object.fromEntries(p.stands.map((x) => [x.number, x]));
    expect(by.S1).toMatchObject({ required: 2, requiredDone: 1, overdue: 0, awaitingReview: 1, changesNeeded: 0 });
    expect(by.S2).toMatchObject({ required: 2, requiredDone: 0, overdue: 1, awaitingReview: 0 });
    expect(by.S2.nextDeadline?.getTime()).toBe(s.team.deadlineAt!.getTime());
    expect(by.P1).toMatchObject({ required: 1, requiredDone: 0, overdue: 0, changesNeeded: 1 });
    // Optional tasks never count as overdue for the stand.
    expect(by.P1.states[s.rigging.id].state).toBe('overdue');
    const t = Object.fromEntries(p.tasks.map((x) => [x.title, x]));
    expect(t.Insurance).toMatchObject({ applies: 3, required: 3, done: 1, overdue: 1, changesNeeded: 1, notStarted: 1 });
    expect(t['Stand team']).toMatchObject({ applies: 2, done: 0, awaitingReview: 1, notStarted: 1 });
    expect(t.Rigging).toMatchObject({ applies: 1, required: 0, overdue: 0, notStarted: 1 });
    expect(p.totals).toMatchObject({ stands: 3, requiredItems: 5, requiredDone: 1, overdueItems: 1, standsOverdue: 1, standsComplete: 0, awaitingReview: 1, changesNeeded: 1 });
  });

  it('filters the exhibitors list by checklist progress and by a task not done', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const names = async (opts: Parameters<typeof listExhibitors>[2]) => (await listExhibitors(admin, s.edition.id, opts)).rows.map((r) => r.stands[0].number).sort();
    expect(await names({})).toEqual(['P1', 'S1', 'S2']);
    expect(await names({ progress: 'behind' })).toEqual(['S2']);
    expect(await names({ progress: 'review' })).toEqual(['S1']);
    expect(await names({ progress: 'changes' })).toEqual(['P1']);
    expect(await names({ progress: 'not_started' })).toEqual(['P1', 'S2']);
    expect(await names({ progress: 'complete' })).toEqual([]);
    expect(await names({ taskNotDoneId: s.team.id })).toEqual(['S1', 'S2']);
    expect(await names({ taskNotDoneId: s.insurance.id })).toEqual(['P1', 'S2']);
    const row = (await listExhibitors(admin, s.edition.id, {})).rows.find((r) => r.stands[0].number === 'S1')!;
    expect(row.progress).toMatchObject({ required: 2, requiredDone: 1, awaitingReview: 1 });
  });

  it('shows each company its own checklist and orders on its record', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const cl = await checklistForCompany(admin, s.edition.id, s.a.company.id);
    expect(cl.stands.map((x) => x.number)).toEqual(['S1']);
    expect(cl.stands[0]).toMatchObject({ required: 2, requiredDone: 1, awaitingReview: 1 });
    expect(Object.keys(cl.stands[0].states).sort()).toEqual([s.insurance.id, s.team.id].sort());
    expect(await companyOrdersForStaff(admin, s.edition.id, s.a.company.id)).toEqual([]);
    const ops = actorFor(await makeStaff(s.edition.id, 'show_team', ['manage_exhibitors']));
    await expect(companyOrdersForStaff(ops, s.edition.id, s.a.company.id)).rejects.toThrow();
    const other = await makeEdition('Other Expo 2027');
    const otherAdmin = actorFor(await makeStaff(other.edition.id, 'show_admin'));
    await expect(checklistForCompany(otherAdmin, s.edition.id, s.a.company.id)).rejects.toThrow();
  });

  it('shows orders, unpaid invoices and space-only packs, and filters by sign-in and by shop category', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const db = await getDb();
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, s.a.user.id));
    const [cleaning] = await db.insert(serviceCategories).values({ editionId: s.edition.id, name: 'Cleaning', visibleToTypes: [s.shell.id] }).returning();
    const [power] = await db.insert(serviceCategories).values({ editionId: s.edition.id, name: 'Power' }).returning();
    const addOrder = async (number: string, stand: { id: string }, companyId: string, status: 'paid' | 'invoiced', categoryId: string) => {
      const [o] = await db
        .insert(orders)
        .values({ number, editionId: s.edition.id, standId: stand.id, companyId, status, paymentMethod: status === 'paid' ? 'card' : 'invoice', feeMode: 'exhibitor_pays', netPence: 1000, vatPence: 200, commissionPence: 100, totalPence: 1200 })
        .returning();
      await db.insert(orderLines).values({ orderId: o.id, categoryId, description: 'Item', quantity: 1, unitPricePence: 1000, vatRateBps: 2000, netPence: 1000, vatPence: 200, commissionPence: 100, supplierPayoutPence: 0 });
    };
    await addOrder('ORD-100001', s.a.stand, s.a.company.id, 'paid', cleaning.id);
    await addOrder('ORD-100002', s.b.stand, s.b.company.id, 'invoiced', power.id);
    await db.insert(spaceOnlyPacks).values({ standId: s.c.stand.id, status: 'submitted' });

    const { rows, summary } = await listExhibitors(admin, s.edition.id, {});
    const by = Object.fromEntries(rows.map((r) => [r.stands[0].number, r]));
    expect(by.S1.spend).toEqual({ orders: 1, paidPence: 1200, unpaidPence: 0 });
    expect(by.S2.spend).toEqual({ orders: 1, paidPence: 0, unpaidPence: 1200 });
    expect(by.P1.spend).toEqual({ orders: 0, paidPence: 0, unpaidPence: 0 });
    expect(by.P1.stands[0].packStatus).toBe('submitted');
    expect(by.S1.stands[0].packStatus).toBeNull();
    expect(summary.neverSignedIn).toBe(2);

    const names = async (opts: Parameters<typeof listExhibitors>[2]) => (await listExhibitors(admin, s.edition.id, opts)).rows.map((r) => r.stands[0].number).sort();
    expect(await names({ state: 'never_signed_in' })).toEqual(['P1', 'S2']);
    // Cleaning is only for shell scheme stands, so the space-only stand is not "missing" it.
    expect(await names({ notOrderedCategoryId: cleaning.id })).toEqual(['S2']);
    expect(await names({ notOrderedCategoryId: power.id })).toEqual(['P1', 'S1']);
    // Emails to "has not ordered from" go to the same stands.
    expect((await recipientsFor(s.edition.id, { categoryNotOrderedId: cleaning.id })).map((r) => r.standNumber)).toEqual(['S2']);

    const file = await readXlsx((await buildReport(admin, s.edition.id, 'exhibitors')).buffer);
    const sheet = file.getWorksheet('Exhibitors')!;
    const col = (name: string) => (sheet.getRow(1).values as unknown[]).indexOf(name);
    const rowOf = (stand: string) => [2, 3, 4].map((i) => sheet.getRow(i)).find((row) => row.getCell(col('Stands')).value === stand)!;
    expect(rowOf('S2').getCell(col('Unpaid invoices')).value).toBe(12);
    expect(rowOf('P1').getCell(col('Space-only pack')).value).toBe('Sent, waiting for review');
  });

  it('gives the show overview and the super admin summary', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const o = await editionOverview(admin, s.edition.id);
    expect(o.checklist).toMatchObject({ requiredItems: 5, requiredDone: 1, pct: 20, standsOverdue: 1, awaitingReview: 1 });
    expect(o.deadlines.map((d) => d.title)).toEqual(['Insurance', 'Rigging', 'Stand team']);
    expect(o.deadlines[0].past).toBe(true);
    expect(o.nudge.map((n) => n.number)).toEqual(['S2']);
    expect(o.shop).toEqual({ orders: 0, salesPence: 0, awaitingPence: 0 });

    // Someone who only manages exhibitors does not see the shop figures or email problems.
    const ops = actorFor(await makeStaff(s.edition.id, 'show_team', ['manage_exhibitors']));
    const o2 = await editionOverview(ops, s.edition.id);
    expect(o2.shop).toBeNull();
    expect(o2.emails).toBeNull();

    await expect(editionsAtAGlance(admin)).rejects.toThrow();
    const superAdmin = actorFor(await makeUser({ isSuperAdmin: true }));
    const glance = await editionsAtAGlance(superAdmin);
    const mine = glance.find((e) => e.id === s.edition.id)!;
    expect(mine).toMatchObject({ companies: 3, checklistPct: 20, standsOverdue: 1, awaitingReview: 1 });
  });
});

describe('emails started from lists', () => {
  it('drafts an email to chosen stands, only within the show', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const c = await draftCampaignForStands(admin, s.edition.id, [s.a.stand.id, s.b.stand.id, s.a.stand.id]);
    expect(c.status).toBe('draft');
    expect(c.filter.standIds?.sort()).toEqual([s.a.stand.id, s.b.stand.id].sort());
    expect((await recipientsFor(s.edition.id, c.filter)).map((r) => r.standNumber).sort()).toEqual(['S1', 'S2']);

    const other = await makeEdition('Other Expo 2027');
    const outsider = await makeExhibitor(other.edition.id, other.shell.id);
    await expect(draftCampaignForStands(admin, s.edition.id, [s.a.stand.id, outsider.stand.id])).rejects.toThrow(/not in this show/);
    await expect(draftCampaignForStands(admin, s.edition.id, [])).rejects.toThrow();
    const noEmails = actorFor(await makeStaff(s.edition.id, 'show_team', ['manage_exhibitors']));
    await expect(draftCampaignForStands(noEmails, s.edition.id, [s.a.stand.id])).rejects.toThrow();
  });

  it('drafts a reminder about one task to the stands that have not done it', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const c = await draftTaskReminder(admin, s.insurance.id);
    expect(c.subject).toBe('Reminder: Insurance');
    expect(c.filter.taskNotDoneId).toBe(s.insurance.id);
    expect((await recipientsFor(s.edition.id, c.filter)).map((r) => r.standNumber).sort()).toEqual(['P1', 'S2']);
    const other = await makeEdition('Other Expo 2027');
    const otherAdmin = actorFor(await makeStaff(other.edition.id, 'show_admin'));
    await expect(draftTaskReminder(otherAdmin, s.insurance.id)).rejects.toThrow();
  });
});

describe('Excel reports', () => {
  it('only offers each report to people allowed to see it', async () => {
    const s = await showWithProgress();
    const keys = async (actor: ReturnType<typeof actorFor>) => (await availableReports(actor, s.edition.id)).map((r) => r.key);
    expect(await keys(actorFor(await makeStaff(s.edition.id, 'show_admin')))).toEqual(['exhibitors', 'contacts', 'checklist', 'responses', 'orders', 'services', 'space_only', 'commission']);
    expect(await keys(actorFor(await makeStaff(s.edition.id, 'show_team', ['manage_orders'])))).toEqual(['orders', 'services', 'commission']);
    const hs = actorFor(await makeStaff(s.edition.id, 'hs_reviewer'));
    expect(await keys(hs)).toEqual(['space_only']);
    await expect(buildReport(hs, s.edition.id, 'contacts')).rejects.toThrow();
    const other = await makeEdition('Other Expo 2027');
    const otherAdmin = actorFor(await makeStaff(other.edition.id, 'show_admin'));
    await expect(buildReport(otherAdmin, s.edition.id, 'exhibitors')).rejects.toThrow();
    await expect(availableReports(otherAdmin, s.edition.id)).rejects.toThrow();
  });

  it('builds the exhibitors report with progress, safe text and UK times, and records the download', async () => {
    const s = await showWithProgress();
    const adminUser = await makeStaff(s.edition.id, 'show_admin');
    const admin = actorFor(adminUser);
    const db = await getDb();
    await db.update(users).set({ lastLoginAt: new Date('2027-06-01T07:30:00Z') }).where(eq(users.id, s.a.user.id));
    const r = await buildReport(admin, s.edition.id, 'exhibitors', { exhibitors: { progress: 'not_started' } });
    expect(r.filename).toMatch(/^demo-expo-2027-exhibitors-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(r.rows).toBe(2);
    const wb = await readXlsx(r.buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Exhibitors', 'About this file']);
    const ws = wb.getWorksheet('Exhibitors')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(0, 3)).toEqual(['Company', 'Stands', 'Stand types']);
    const rows = [2, 3].map((i) => ws.getRow(i));
    const evil = rows.find((row) => String(row.getCell(1).value).startsWith('='))!;
    // A company name that looks like a formula stays plain text.
    expect(evil.getCell(1).value).toBe('=HYPERLINK("http://evil.example","Click")');
    expect(evil.getCell(1).formula).toBeUndefined();
    expect(evil.getCell(1).type).toBe(ExcelJS.ValueType.String);
    const about = wb.getWorksheet('About this file')!;
    expect(String(about.getRow(5).getCell(2).value)).toContain('Checklist: Not started');

    // All exhibitors: S1's last sign-in shows in UK summer time (08:30), and its progress.
    const all = await readXlsx((await buildReport(admin, s.edition.id, 'exhibitors')).buffer);
    const sheet = all.getWorksheet('Exhibitors')!;
    const col = (name: string) => (sheet.getRow(1).values as unknown[]).indexOf(name);
    const s1 = [2, 3, 4].map((i) => sheet.getRow(i)).find((row) => row.getCell(col('Stands')).value === 'S1')!;
    expect((s1.getCell(col('Last signed in')).value as Date).toISOString()).toBe('2027-06-01T08:30:00.000Z');
    expect(s1.getCell(col('Required tasks done')).value).toBe(1);
    expect(s1.getCell(col('Waiting for review')).value).toBe(1);

    // Chosen companies only.
    const chosen = await buildReport(admin, s.edition.id, 'exhibitors', { exhibitors: { companyIds: [s.b.company.id] }, filterLabels: ['1 chosen companies'] });
    expect(chosen.rows).toBe(1);

    const logged = await db.select().from(auditLog).where(and(eq(auditLog.actorUserId, adminUser.id), eq(auditLog.action, 'report.downloaded')));
    expect(logged).toHaveLength(3);
    expect(logged.map((l) => (l.details as { rows: number }).rows).sort()).toEqual([1, 2, 3]);
  });

  it('builds the checklist, form answers, contacts and space-only reports', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const checklist = await readXlsx((await buildReport(admin, s.edition.id, 'checklist')).buffer);
    const byStand = checklist.getWorksheet('Checklist by stand')!;
    const header = (byStand.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(['Stand', 'Company', 'Stand type', 'Hall', 'Required done', 'Required tasks', 'Overdue', 'Insurance', 'Stand team', 'Rigging']);
    const p1 = [2, 3, 4].map((i) => byStand.getRow(i)).find((row) => row.getCell(1).value === 'P1')!;
    expect([p1.getCell(8).value, p1.getCell(9).value, p1.getCell(10).value]).toEqual(['Changes needed', 'Does not apply', 'Overdue']);

    const answers = await readXlsx((await buildReport(admin, s.edition.id, 'responses')).buffer);
    expect(answers.worksheets.map((w) => w.name)).toEqual(['Stand team', 'About this file']);
    const team = answers.getWorksheet('Stand team')!;
    expect((team.getRow(1).values as unknown[]).slice(1)).toEqual(['Stand', 'Company', 'Status', 'Sent', 'Names', 'Arrival time']);
    const s1 = [2, 3].map((i) => team.getRow(i)).find((row) => row.getCell(1).value === 'S1')!;
    expect(s1.getCell(5).value).toBe('Ann\nBen');
    expect(s1.getCell(3).value).toBe('Waiting for review');
    const onlyOne = await buildReport(admin, s.edition.id, 'responses', { taskId: s.insurance.id });
    expect((await readXlsx(onlyOne.buffer)).worksheets[0].name).toBe('No forms');

    const contacts = await readXlsx((await buildReport(admin, s.edition.id, 'contacts')).buffer);
    expect(contacts.getWorksheet('Contacts')!.rowCount).toBe(4);

    const so = await readXlsx((await buildReport(admin, s.edition.id, 'space_only')).buffer);
    const soSheet = so.getWorksheet('Space-only approvals')!;
    const soCol = (name: string) => (soSheet.getRow(1).values as unknown[]).indexOf(name);
    expect(soSheet.getRow(2).getCell(soCol('Stand')).value).toBe('P1');
    expect(soSheet.getRow(2).getCell(soCol('Contractor')).value).toBe('Not nominated');
    expect(soCol('Width (m)')).toBeLessThan(soCol('Size (sqm)'));
  });

  it('builds the orders and services reports, and the services page, from live orders only', async () => {
    const s = await showWithProgress();
    const admin = actorFor(await makeStaff(s.edition.id, 'show_admin'));
    const db = await getDb();
    const order = async (number: string, standId: string, companyId: string, status: 'paid' | 'cancelled', lines: { description: string; quantity: number; refunded?: number; fulfilment?: 'received' | 'delivered' | 'cancelled' }[]) => {
      const [o] = await db
        .insert(orders)
        .values({ number, editionId: s.edition.id, standId, companyId, status, paymentMethod: 'card', feeMode: 'exhibitor_pays', netPence: 10000, vatPence: 2000, commissionPence: 1000, totalPence: 12000 })
        .returning();
      for (const l of lines) {
        await db.insert(orderLines).values({
          orderId: o.id,
          description: l.description,
          quantity: l.quantity,
          unitPricePence: 5000,
          vatRateBps: 2000,
          netPence: 5000,
          vatPence: 1000,
          commissionPence: 500,
          supplierPayoutPence: 0,
          refundedPence: l.refunded ?? 0,
          fulfilmentStatus: l.fulfilment ?? 'received',
          options: { Colour: 'Black' },
        });
      }
    };
    await order('ORD-000001', s.a.stand.id, s.a.company.id, 'paid', [
      { description: 'Spotlight', quantity: 2, fulfilment: 'delivered' },
      { description: 'Power socket', quantity: 1, refunded: 6000 },
    ]);
    await order('ORD-000002', s.b.stand.id, s.b.company.id, 'paid', [{ description: 'Spotlight', quantity: 3 }]);
    await order('ORD-000003', s.b.stand.id, s.b.company.id, 'cancelled', [{ description: 'Sofa', quantity: 1 }]);

    const page = await servicesForEdition(admin, s.edition.id);
    expect(page.lines.map((l) => `${l.standNumber} ${l.line.description}`)).toEqual(['S1 Spotlight', 'S2 Spotlight']);
    expect(page.products).toEqual([expect.objectContaining({ item: 'Spotlight', supplier: 'Organiser', quantity: 5, delivered: 2, stands: ['S1', 'S2'] })]);
    const ops = actorFor(await makeStaff(s.edition.id, 'show_team', ['manage_exhibitors']));
    await expect(servicesForEdition(ops, s.edition.id)).rejects.toThrow();

    const services = await readXlsx((await buildReport(admin, s.edition.id, 'services')).buffer);
    expect(services.worksheets.map((w) => w.name)).toEqual(['By stand', 'By product', 'About this file']);
    const byStandSheet = services.getWorksheet('By stand')!;
    const optionsCol = (byStandSheet.getRow(1).values as unknown[]).indexOf('Options and details');
    expect(byStandSheet.getRow(2).getCell(optionsCol).value).toBe('Colour: Black');

    const ordersFile = await readXlsx((await buildReport(admin, s.edition.id, 'orders')).buffer);
    const items = ordersFile.getWorksheet('Items')!;
    expect(items.rowCount).toBe(5);
    // Money is in pounds with a currency format.
    const gross = (items.getRow(1).values as unknown[]).indexOf('Gross');
    expect(items.getRow(2).getCell(gross).value).toBe(60);
    expect(items.getColumn(gross).numFmt).toBe('£#,##0.00');
  });

  it('limits downloads per person', async () => {
    const s = await showWithProgress();
    const adminUser = await makeStaff(s.edition.id, 'show_admin');
    await consumeRateLimit(`report:${adminUser.id}`, 60, 3600, 60);
    await expect(buildReport(actorFor(adminUser), s.edition.id, 'checklist')).rejects.toThrow(/Too many/);
  });
});
