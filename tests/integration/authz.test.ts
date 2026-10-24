import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { companyMembers, standContractors, supplierUsers, suppliers } from '@/server/db/schema';
import {
  exhibitorEditions,
  exhibitorStands,
  getEditionAccess,
  requireContractorStand,
  requireEditionPermission,
  requireShowAdmin,
  requireStandAccess,
  requireSupplierMember,
} from '@/server/authz';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

describe('exhibitor isolation', () => {
  it('lets an exhibitor reach only their own stand', async () => {
    const { edition, shell } = await makeEdition();
    const a = await makeExhibitor(edition.id, shell.id, 'A1');
    const b = await makeExhibitor(edition.id, shell.id, 'B1');
    await expect(requireStandAccess(actorFor(a.user), a.stand.id)).resolves.toBeTruthy();
    await expect(requireStandAccess(actorFor(a.user), b.stand.id)).rejects.toThrow(/could not find/);
    const mine = await exhibitorStands(actorFor(a.user), edition.id);
    expect(mine.map((s) => s.number)).toEqual(['A1']);
  });

  it('checks payment rights for colleagues', async () => {
    const { edition, shell } = await makeEdition();
    const a = await makeExhibitor(edition.id, shell.id, 'P1');
    const colleague = await makeUser();
    const db = await getDb();
    await db.insert(companyMembers).values({ companyId: a.company.id, userId: colleague.id, role: 'colleague', canPay: false });
    await expect(requireStandAccess(actorFor(colleague), a.stand.id)).resolves.toBeTruthy();
    await expect(requireStandAccess(actorFor(colleague), a.stand.id, { pay: true })).rejects.toThrow(/permission to pay/);
  });

  it('refuses every write while viewing as someone else', async () => {
    const { edition, shell } = await makeEdition();
    const a = await makeExhibitor(edition.id, shell.id, 'V1');
    const viewing = actorFor(a.user, { readOnly: true, realUserId: '11111111-1111-1111-1111-111111111111', viewAsEditionId: edition.id });
    await expect(requireStandAccess(viewing, a.stand.id)).resolves.toBeTruthy();
    await expect(requireStandAccess(viewing, a.stand.id, { write: true })).rejects.toThrow(/viewing as someone else/);
  });

  it('keeps viewing as an exhibitor inside the one show the admin may view', async () => {
    const a = await makeEdition('Show A');
    const b = await makeEdition('Show B');
    const adminA = await makeStaff(a.edition.id, 'show_admin');
    // One company exhibits at both shows; its contact is also a supplier user and on another show's team.
    const atA = await makeExhibitor(a.edition.id, a.shell.id, 'X1');
    const db = await getDb();
    const { stands } = await import('@/server/db/schema');
    const [atB] = await db.insert(stands).values({ editionId: b.edition.id, number: 'X2', exhibitorTypeId: b.shell.id, companyId: atA.company.id }).returning();
    const [sup] = await db.insert(suppliers).values({ name: 'Side Business', email: 'orders@side.example' }).returning();
    await db.insert(supplierUsers).values({ supplierId: sup.id, userId: atA.user.id });
    const { editionStaff } = await import('@/server/db/schema');
    await db.insert(editionStaff).values({ editionId: b.edition.id, userId: atA.user.id, role: 'show_admin', permissions: [] });

    const viewing = actorFor(atA.user, { readOnly: true, realUserId: adminA.id, viewAsEditionId: a.edition.id });
    await expect(requireStandAccess(viewing, atA.stand.id)).resolves.toBeTruthy();
    // The same exhibitor's stand at the other show is out of reach.
    await expect(requireStandAccess(viewing, atB.id)).rejects.toThrow(/could not find/);
    expect(await exhibitorStands(viewing, b.edition.id)).toEqual([]);
    expect((await exhibitorEditions(viewing)).map((e) => e.id)).toEqual(expect.not.arrayContaining([b.edition.id]));
    // So are the exhibitor's staff role and supplier account.
    expect(await getEditionAccess(viewing, b.edition.id)).toBeNull();
    await expect(requireSupplierMember(viewing, sup.id)).rejects.toThrow(/could not find/);
    // Without the view, the exhibitor themself still has all of it.
    await expect(requireStandAccess(actorFor(atA.user), atB.id)).resolves.toBeTruthy();
    expect(await getEditionAccess(actorFor(atA.user), b.edition.id)).not.toBeNull();
  });
});

describe('show staff permissions', () => {
  it('gives show admins everything and show team only what was granted', async () => {
    const { edition } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const team = await makeStaff(edition.id, 'show_team', ['edit_content']);
    await expect(requireEditionPermission(actorFor(admin), edition.id, 'manage_orders')).resolves.toBeTruthy();
    await expect(requireEditionPermission(actorFor(team), edition.id, 'edit_content')).resolves.toBeTruthy();
    await expect(requireEditionPermission(actorFor(team), edition.id, 'view')).resolves.toBeTruthy();
    await expect(requireEditionPermission(actorFor(team), edition.id, 'manage_orders')).rejects.toThrow(/permission/);
    await expect(requireShowAdmin(actorFor(team), edition.id)).rejects.toThrow(/permission/);
  });

  it('limits H&S reviewers to the space-only queue', async () => {
    const { edition } = await makeEdition();
    const hs = await makeStaff(edition.id, 'hs_reviewer');
    await expect(requireEditionPermission(actorFor(hs), edition.id, 'review_space_only')).resolves.toBeTruthy();
    await expect(requireEditionPermission(actorFor(hs), edition.id, 'view')).rejects.toThrow(/permission/);
    await expect(requireEditionPermission(actorFor(hs), edition.id, 'manage_exhibitors')).rejects.toThrow(/permission/);
  });

  it('hides other shows from staff completely', async () => {
    const a = await makeEdition('A');
    const b = await makeEdition('B');
    const adminA = await makeStaff(a.edition.id, 'show_admin');
    expect(await getEditionAccess(actorFor(adminA), b.edition.id)).toBeNull();
    await expect(requireEditionPermission(actorFor(adminA), b.edition.id, 'view')).rejects.toThrow(/could not find/);
  });

  it('gives super admins everything, but not while viewing as someone', async () => {
    const { edition } = await makeEdition();
    const sa = await makeUser({ isSuperAdmin: true });
    expect((await getEditionAccess(actorFor(sa), edition.id))?.role).toBe('super_admin');
    expect(await getEditionAccess(actorFor(sa, { readOnly: true }), edition.id)).toBeNull();
  });

  it('ignores permission names that do not exist', async () => {
    const { edition } = await makeEdition();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sneaky = await makeStaff(edition.id, 'show_team', ['superpowers' as any]);
    const access = await getEditionAccess(actorFor(sneaky), edition.id);
    expect([...access!.permissions]).toEqual(['view']);
  });
});

describe('contractors and suppliers', () => {
  it('lets a contractor reach only the stands they were nominated for', async () => {
    const { edition, space } = await makeEdition();
    const a = await makeExhibitor(edition.id, space.id, 'SO1');
    const b = await makeExhibitor(edition.id, space.id, 'SO2');
    const builder = await makeUser();
    const db = await getDb();
    await db.insert(standContractors).values({
      standId: a.stand.id,
      contractorCompanyName: 'Build',
      contactName: 'B',
      contactEmail: builder.email,
      userId: builder.id,
      status: 'active',
    });
    await expect(requireContractorStand(actorFor(builder), a.stand.id)).resolves.toBeTruthy();
    await expect(requireContractorStand(actorFor(builder), b.stand.id)).rejects.toThrow(/could not find/);
  });

  it('keeps suppliers apart', async () => {
    const db = await getDb();
    const [s1] = await db.insert(suppliers).values({ name: 'Clean Co', email: 'c@example.com' }).returning();
    const [s2] = await db.insert(suppliers).values({ name: 'Power Co', email: 'p@example.com' }).returning();
    const u = await makeUser();
    await db.insert(supplierUsers).values({ supplierId: s1.id, userId: u.id });
    await expect(requireSupplierMember(actorFor(u), s1.id)).resolves.toBeUndefined();
    await expect(requireSupplierMember(actorFor(u), s2.id)).rejects.toThrow(/could not find/);
  });
});
