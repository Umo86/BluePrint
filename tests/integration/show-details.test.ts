import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { editions, halls, stands } from '@/server/db/schema';
import { cloneEdition, updateEditionContacts } from '@/server/services/editions';
import { resolvePortal } from '@/server/services/portal';
import { addExhibitor, createStand, updateStand } from '@/server/services/stands';
import { planImport, readSpreadsheet, runImport } from '@/server/services/exhibitor-import';
import { standSize } from '@/lib/format';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

const OPS = { id: 'ops', team: 'Operations', name: 'Media10 operations', email: 'Ops@Show.example', phone: '+44 (0)20 7946 0000' };

describe('show contacts', () => {
  it('lets the show team set who exhibitors can contact, and shows them in the portal', async () => {
    const { edition, shell } = await makeEdition();
    const content = actorFor(await makeStaff(edition.id, 'show_team', ['edit_content']));
    await updateEditionContacts(content, edition.id, {
      contacts: [OPS, { id: 'venue', team: 'Venue', name: 'NEC', note: 'Hall 4, National Exhibition Centre, Birmingham B40 1NT' }],
    });
    const ex = await makeExhibitor(edition.id, shell.id);
    const portal = await resolvePortal(actorFor(ex.user), edition.slug);
    expect(portal.edition.contacts).toEqual([
      { id: 'ops', team: 'Operations', name: 'Media10 operations', email: 'ops@show.example', phone: '+44 (0)20 7946 0000' },
      { id: 'venue', team: 'Venue', name: 'NEC', note: 'Hall 4, National Exhibition Centre, Birmingham B40 1NT' },
    ]);
  });

  it('checks each contact and who may change them', async () => {
    const { edition, shell } = await makeEdition();
    const admin = actorFor(await makeStaff(edition.id, 'show_admin'));
    await expect(updateEditionContacts(admin, edition.id, { contacts: [{ id: 'a', team: 'Sales' }] })).rejects.toThrow();
    await expect(updateEditionContacts(admin, edition.id, { contacts: [{ ...OPS, email: 'not-an-email' }] })).rejects.toThrow();
    await expect(updateEditionContacts(admin, edition.id, { contacts: [{ ...OPS, phone: 'call me' }] })).rejects.toThrow();
    await expect(updateEditionContacts(admin, edition.id, { contacts: Array.from({ length: 9 }, (_, i) => ({ ...OPS, id: `c${i}` })) })).rejects.toThrow();
    await expect(updateEditionContacts(admin, edition.id, { contacts: [OPS, OPS] })).rejects.toThrow(/own id/);
    // Team members without content rights, exhibitors and other shows' admins cannot change them.
    const sales = actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors']));
    await expect(updateEditionContacts(sales, edition.id, { contacts: [OPS] })).rejects.toThrow();
    const ex = await makeExhibitor(edition.id, shell.id);
    await expect(updateEditionContacts(actorFor(ex.user), edition.id, { contacts: [OPS] })).rejects.toThrow();
    const other = await makeEdition();
    await expect(updateEditionContacts(actorFor(await makeStaff(other.edition.id, 'show_admin')), edition.id, { contacts: [OPS] })).rejects.toThrow();
    // An empty list clears them.
    await updateEditionContacts(admin, edition.id, { contacts: [OPS] });
    await updateEditionContacts(admin, edition.id, { contacts: [] });
    const db = await getDb();
    const [row] = await db.select().from(editions).where(eq(editions.id, edition.id));
    expect(row.contacts).toEqual([]);
  });

  it('copies the contacts to next year’s edition', async () => {
    const { edition } = await makeEdition();
    const superAdmin = actorFor(await makeUser({ isSuperAdmin: true }));
    await updateEditionContacts(superAdmin, edition.id, { contacts: [OPS] });
    const clone = await cloneEdition(superAdmin, edition.id, { name: 'Next year', buildUpStartsAt: '2028-05-01T08:00:00Z' });
    const db = await getDb();
    const [row] = await db.select().from(editions).where(eq(editions.id, clone.id));
    expect(row.contacts.map((c) => c.team)).toEqual(['Operations']);
  });
});

describe('stand width and depth', () => {
  it('works out the area from width and depth, and shows the size to the exhibitor', async () => {
    const { edition, shell } = await makeEdition();
    const team = actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors']));
    const ex = await makeExhibitor(edition.id, shell.id, 'D1');
    // An area sent alongside is ignored: width × depth wins, so the three never disagree.
    await updateStand(team, ex.stand.id, { number: 'D1', exhibitorTypeId: shell.id, widthM: 6, depthM: 3, sizeSqm: 20, openSides: 2 });
    const db = await getDb();
    const [s] = await db.select().from(stands).where(eq(stands.id, ex.stand.id));
    expect(s).toMatchObject({ widthM: '6.00', depthM: '3.00', sizeSqm: '18.00' });
    const portal = await resolvePortal(actorFor(ex.user), edition.slug);
    expect(standSize(portal.stand)).toBe('6 m × 3 m (18 sqm)');
    // An odd-shaped stand gives just its area, which clears the old width and depth.
    await updateStand(team, ex.stand.id, { number: 'D1', exhibitorTypeId: shell.id, sizeSqm: 25.5, openSides: 2 });
    const [t] = await db.select().from(stands).where(eq(stands.id, ex.stand.id));
    expect(t).toMatchObject({ widthM: null, depthM: null, sizeSqm: '25.50' });
    expect(standSize(t)).toBe('25.5 sqm');
    // Adding an exhibitor or a stand works the same way.
    const added = await addExhibitor(team, edition.id, { company: { name: 'Island Stand Co' }, stand: { number: 'D2', exhibitorTypeId: shell.id, widthM: 12.5, depthM: 8, openSides: 4 } });
    expect(added.stand).toMatchObject({ widthM: '12.50', depthM: '8.00', sizeSqm: '100.00' });
    const spare = await createStand(team, edition.id, { number: 'D3', exhibitorTypeId: shell.id, widthM: 3, depthM: 2 });
    expect(standSize(spare)).toBe('3 m × 2 m (6 sqm)');
  });

  it('needs both measurements, within sensible limits', async () => {
    const { edition, shell } = await makeEdition();
    const team = actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors']));
    const { stand } = await makeExhibitor(edition.id, shell.id, 'E1');
    const base = { number: 'E1', exhibitorTypeId: shell.id, openSides: 1 };
    await expect(updateStand(team, stand.id, { ...base, widthM: 6 })).rejects.toThrow(/Enter the depth as well/);
    await expect(updateStand(team, stand.id, { ...base, depthM: 6 })).rejects.toThrow(/Enter the width as well/);
    await expect(updateStand(team, stand.id, { ...base, widthM: 0, depthM: 3 })).rejects.toThrow();
    await expect(updateStand(team, stand.id, { ...base, widthM: 501, depthM: 3 })).rejects.toThrow();
    await expect(updateStand(team, stand.id, { ...base, widthM: 400, depthM: 400 })).rejects.toThrow(/over 100,000 sqm/);
  });

  it('imports widths and depths, and keeps what a later file leaves out', async () => {
    const { edition } = await makeEdition();
    const team = actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors']));
    const csv = [
      'Company,Stand,Type,Hall,Width (m),Depth (m),Size (sqm),Open sides',
      'Acme Insulation,W1,shell,N1,6,3,20,2',
      'Bravo Glazing,W2,shell,N1,,,6 x 4,1',
      'Charlie Doors,W3,shell,N1,6,,,1',
      'Delta Roofing,W4,shell,N1,,,9 m2,3',
    ].join('\n');
    const rows = await readSpreadsheet('stands.csv', new TextEncoder().encode(csv));
    const plan = await planImport(team, edition.id, rows, { defaultTypeId: null });
    expect(plan.rows.map((r) => [r.widthM, r.depthM, r.sizeSqm, r.action])).toEqual([
      [6, 3, 18, 'create'],
      [6, 4, 24, 'create'],
      [null, null, null, 'error'],
      [null, null, 9, 'create'],
    ]);
    expect(plan.rows[0].messages).toContain('Size worked out from width × depth: 18 sqm.');
    expect(plan.rows[2].messages).toContain('Give both the width and the depth, or neither.');
    const first = await runImport(team, edition.id, rows, { defaultTypeId: null, sendInvites: false });
    expect(first).toMatchObject({ created: 3, skipped: [4] });

    const db = await getDb();
    const w1 = async () => (await db.select().from(stands).where(and(eq(stands.editionId, edition.id), eq(stands.number, 'W1'))))[0];
    const [n1] = await db.select().from(halls).where(eq(halls.editionId, edition.id));
    expect(await w1()).toMatchObject({ widthM: '6.00', depthM: '3.00', sizeSqm: '18.00', openSides: 2, hallId: n1.id });

    // A later file with just the company and stand (say, to add a contact) changes nothing else.
    const again = await readSpreadsheet('contacts.csv', new TextEncoder().encode('Company,Stand,Type,Email\nAcme Insulation,W1,shell,amira@acme.example'));
    expect(await runImport(team, edition.id, again, { defaultTypeId: null, sendInvites: false })).toMatchObject({ updated: 1 });
    expect(await w1()).toMatchObject({ widthM: '6.00', depthM: '3.00', sizeSqm: '18.00', openSides: 2, hallId: n1.id });
  });
});
