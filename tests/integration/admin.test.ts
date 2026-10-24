import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import {
  auditLog,
  companyMembers,
  editionStaff,
  exhibitorTypes,
  manualPages,
  orders,
  serviceCategories,
  products,
  taskRequirements,
  tasks,
  users,
} from '@/server/db/schema';
import { cloneEdition, createEdition, createShow, deleteEdition, updateEditionBasics, updateEditionCommercial } from '@/server/services/editions';
import { getPlatformSettings, updatePlatformSettings } from '@/server/services/settings';
import { listUsers, setSuperAdmin, setUserStatus } from '@/server/services/users';
import { anonymisePerson, exportPersonData } from '@/server/services/gdpr';
import { canManageCompany, removeMember, setMemberAccess, updateCompany } from '@/server/services/companies';
import { removeStaff, updateStaffRole } from '@/server/services/staff';
import { createSupplier, listSuppliers } from '@/server/services/suppliers';
import { queryAuditLog } from '@/server/services/audit-log';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

let superAdmin: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
  superAdmin = await makeUser({ email: 'root@example.com', isSuperAdmin: true });
});
afterAll(closeDb);

describe('shows and editions', () => {
  it('creates an edition with shell scheme and space-only types', async () => {
    const show = await createShow(actorFor(superAdmin), { name: 'UK Construction Week' });
    expect(show.slug).toBe('uk-construction-week');
    const e = await createEdition(actorFor(superAdmin), show.id, { name: 'UKCW London 2027', buildUpStartsAt: '2027-05-01T08:00:00Z' });
    const db = await getDb();
    const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, e.id));
    expect(types.map((t) => t.key).sort()).toEqual(['shell_scheme', 'space_only']);
    expect(e.spaceOnlyRules?.maxHeightM).toBe(4);
  });

  it('only lets super admins create shows or change commercial terms', async () => {
    const { edition } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    await expect(createShow(actorFor(admin), { name: 'Sneaky' })).rejects.toThrow(/permission/);
    await expect(updateEditionCommercial(actorFor(admin), edition.id, { feeMode: 'deduct_from_supplier', defaultCommissionType: null, defaultCommissionValue: null })).rejects.toThrow(/permission/);
    await expect(updateEditionBasics(actorFor(admin), edition.id, { name: 'Renamed', status: 'archived' })).rejects.toThrow(/super admin/);
    await expect(updateEditionBasics(actorFor(admin), edition.id, { name: 'Renamed' })).resolves.toBeTruthy();
  });

  it('clones an edition with its content but no exhibitors, and moves fixed deadlines', async () => {
    const db = await getDb();
    const { edition, shell, space } = await makeEdition('Source 2026');
    await db.update((await import('@/server/db/schema')).editions).set({ buildUpStartsAt: new Date('2026-05-01T08:00:00Z') }).where(eq((await import('@/server/db/schema')).editions.id, edition.id));
    const [page] = await db.insert(manualPages).values({ editionId: edition.id, title: 'Build rules', slug: 'build-rules', visibleToTypes: [space.id] }).returning();
    const [task] = await db
      .insert(tasks)
      .values({ editionId: edition.id, title: 'Fascia name', deadlineAt: new Date('2026-04-01T12:00:00Z'), linkedPageId: page.id })
      .returning();
    await db.insert(taskRequirements).values({ taskId: task.id, exhibitorTypeId: shell.id, requirement: 'required' });
    const [cat] = await db.insert(serviceCategories).values({ editionId: edition.id, name: 'Furniture' }).returning();
    await db.insert(products).values({ editionId: edition.id, categoryId: cat.id, name: 'Chair', pricePence: 2500, status: 'approved' });
    await makeExhibitor(edition.id, shell.id, 'Z1');

    const clone = await cloneEdition(actorFor(superAdmin), edition.id, { name: 'Clone 2027', buildUpStartsAt: '2027-05-01T08:00:00Z' });
    const clonedTasks = await db.select().from(tasks).where(eq(tasks.editionId, clone.id));
    expect(clonedTasks).toHaveLength(1);
    // 365 days later
    expect(clonedTasks[0].deadlineAt?.toISOString()).toBe('2027-04-01T12:00:00.000Z');
    const clonedPages = await db.select().from(manualPages).where(eq(manualPages.editionId, clone.id));
    expect(clonedTasks[0].linkedPageId).toBe(clonedPages[0].id);
    const clonedTypes = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, clone.id));
    const clonedSpace = clonedTypes.find((t) => t.key === 'space_only')!;
    expect(clonedPages[0].visibleToTypes).toEqual([clonedSpace.id]);
    const req = await db.select().from(taskRequirements).where(eq(taskRequirements.taskId, clonedTasks[0].id));
    expect(req[0].exhibitorTypeId).toBe(clonedTypes.find((t) => t.key === 'shell_scheme')!.id);
    expect((await db.select().from(products).where(eq(products.editionId, clone.id)))[0].pricePence).toBe(2500);
    const standsInClone = await db.select().from((await import('@/server/db/schema')).stands).where(eq((await import('@/server/db/schema')).stands.editionId, clone.id));
    expect(standsInClone).toHaveLength(0);
  });

  it('refuses to delete an edition with orders and needs the exact name', async () => {
    const { edition, shell } = await makeEdition('Has Orders');
    const ex = await makeExhibitor(edition.id, shell.id, 'O1');
    await expect(deleteEdition(actorFor(superAdmin), edition.id, 'wrong')).rejects.toThrow(/exactly/);
    const db = await getDb();
    await db.insert(orders).values({
      number: 'T-1',
      editionId: edition.id,
      standId: ex.stand.id,
      paymentMethod: 'card',
      feeMode: 'exhibitor_pays',
      netPence: 100,
      vatPence: 20,
      commissionPence: 10,
      totalPence: 130,
    });
    await expect(deleteEdition(actorFor(superAdmin), edition.id, 'Has Orders')).rejects.toThrow(/Archive it instead/);
    const empty = await makeEdition('Empty One');
    await expect(deleteEdition(actorFor(superAdmin), empty.edition.id, 'Empty One')).resolves.toBeUndefined();
  });
});

describe('platform settings', () => {
  it('validates and stores settings', async () => {
    const s = await updatePlatformSettings(actorFor(superAdmin), { feeMode: 'deduct_from_supplier', defaultCommissionValue: 1250 });
    expect(s.feeMode).toBe('deduct_from_supplier');
    expect((await getPlatformSettings()).defaultCommissionValue).toBe(1250);
    await expect(updatePlatformSettings(actorFor(superAdmin), { stripeFeePercentBps: 99999 })).rejects.toThrow();
  });
});

describe('users', () => {
  it('protects the last super admin and the admin’s own account', async () => {
    const db = await getDb();
    const others = await db.select().from(users).where(eq(users.isSuperAdmin, true));
    expect(others).toHaveLength(1);
    await expect(setSuperAdmin(actorFor(superAdmin), superAdmin.id, false)).rejects.toThrow(/own super admin/);
    await expect(setUserStatus(actorFor(superAdmin), superAdmin.id, 'disabled')).rejects.toThrow(/your own/);
    const second = await makeUser();
    await setSuperAdmin(actorFor(superAdmin), second.id, true);
    await setSuperAdmin(actorFor(superAdmin), second.id, false);
  });

  it('searches users safely, treating wildcards literally', async () => {
    await makeUser({ email: 'percent%sign@example.com', name: 'Percent' });
    const r = await listUsers(actorFor(superAdmin), { q: '%' });
    expect(r.rows.every((u) => u.email.includes('%') || u.name.includes('%'))).toBe(true);
  });

  it('refuses non super admins', async () => {
    const someone = await makeUser();
    await expect(listUsers(actorFor(someone), {})).rejects.toThrow(/permission/);
  });
});

describe('GDPR', () => {
  it('exports and then erases a person but keeps the records the law needs', async () => {
    const { edition, shell } = await makeEdition();
    const ex = await makeExhibitor(edition.id, shell.id, 'G1');
    const data = await exportPersonData(actorFor(superAdmin), ex.user.id);
    expect(data.profile.email).toBe(ex.user.email);
    expect(data.companyMemberships).toHaveLength(1);
    await anonymisePerson(actorFor(superAdmin), ex.user.id);
    const db = await getDb();
    const [u] = await db.select().from(users).where(eq(users.id, ex.user.id));
    expect(u.email).toMatch(/anonymised\.invalid$/);
    expect(u.name).toBe('Deleted user');
    expect(u.status).toBe('disabled');
    expect(await db.select().from(companyMembers).where(eq(companyMembers.userId, ex.user.id))).toHaveLength(0);
    const logs = await db.select().from(auditLog);
    expect(JSON.stringify(logs)).not.toContain(ex.user.email);
  });
});

describe('companies and staff', () => {
  it('gives company editing to its main contact and the show team, not to strangers', async () => {
    const { edition, shell } = await makeEdition();
    const ex = await makeExhibitor(edition.id, shell.id, 'K1');
    const stranger = await makeUser();
    const staff = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    expect(await canManageCompany(actorFor(ex.user), ex.company.id)).toBe('main_contact');
    expect(await canManageCompany(actorFor(staff), ex.company.id)).toBe('staff');
    expect(await canManageCompany(actorFor(stranger), ex.company.id)).toBeNull();
    await expect(updateCompany(actorFor(stranger), ex.company.id, { name: 'Hacked' })).rejects.toThrow(/could not find/);
    await expect(updateCompany(actorFor(ex.user), ex.company.id, { name: 'New Name Ltd', website: 'example.com' })).resolves.toMatchObject({ website: 'https://example.com' });
  });

  it('keeps at least one main contact and one show admin', async () => {
    const { edition, shell } = await makeEdition();
    const ex = await makeExhibitor(edition.id, shell.id, 'K2');
    await expect(setMemberAccess(actorFor(ex.user), ex.company.id, ex.user.id, { role: 'colleague', canPay: false })).rejects.toThrow(/main contact/);
    await expect(removeMember(actorFor(ex.user), ex.company.id, ex.user.id)).rejects.toThrow(/show team/);

    const admin = await makeStaff(edition.id, 'show_admin');
    await expect(updateStaffRole(actorFor(admin), edition.id, admin.id, { role: 'show_team', permissions: [] })).rejects.toThrow(/at least one show admin/);
    await expect(removeStaff(actorFor(admin), edition.id, admin.id)).rejects.toThrow(/another show admin/);
    const db = await getDb();
    expect(await db.select().from(editionStaff).where(eq(editionStaff.userId, admin.id))).toHaveLength(1);
  });

  it('lets show admins add suppliers but not exhibitors', async () => {
    const { edition, shell } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const ex = await makeExhibitor(edition.id, shell.id, 'K3');
    await expect(createSupplier(actorFor(admin), { name: 'Clean Co', email: 'clean@example.com' })).resolves.toBeTruthy();
    await expect(listSuppliers(actorFor(ex.user))).rejects.toThrow(/permission/);
  });
});

describe('audit log', () => {
  it('records actions and is only readable by super admins (or show admins for their edition)', async () => {
    const r = await queryAuditLog(actorFor(superAdmin), { action: 'edition.' });
    expect(r.rows.length).toBeGreaterThan(0);
    const { edition } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    await expect(queryAuditLog(actorFor(admin), {})).rejects.toThrow(/permission/);
    await expect(queryAuditLog(actorFor(admin), { editionId: edition.id })).resolves.toBeTruthy();
  });
});
