import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { companies, companyMembers, editions, emailOutbox, halls, invitations, orders, stands } from '@/server/db/schema';
import { createExhibitorType, deleteExhibitorType, listExhibitorTypes, updateExhibitorType, createHall, deleteHall, renameHall } from '@/server/services/show-setup';
import {
  addExhibitor,
  addExhibitorNote,
  deleteExhibitorNote,
  deleteStand,
  getExhibitor,
  inviteExhibitorContact,
  listExhibitors,
  sendUnsentInvitations,
  setStandStatus,
  updateStand,
} from '@/server/services/stands';
import { planImport, readSpreadsheet, runImport } from '@/server/services/exhibitor-import';
import { parseDelimited } from '@/lib/csv-parse';
import { assertSafeZip } from '@/server/security/zip';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

describe('exhibitor types and halls', () => {
  it('lets show admins add types, keeps the built-in ones and their meaning', async () => {
    const { edition, shell, space } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const pavilion = await createExhibitorType(actorFor(admin), edition.id, { name: 'Pavilion', isSpaceOnly: false });
    expect(pavilion.key).toBe('pavilion');
    const again = await createExhibitorType(actorFor(admin), edition.id, { name: 'Pavilion' });
    expect(again.key).toBe('pavilion_2');
    await expect(createExhibitorType(actorFor(team), edition.id, { name: 'Nope' })).rejects.toThrow();
    await expect(deleteExhibitorType(actorFor(admin), shell.id)).rejects.toThrow(/cannot be deleted/);
    await updateExhibitorType(actorFor(admin), space.id, { name: 'Raw space', isSpaceOnly: false });
    const types = await listExhibitorTypes(actorFor(team), edition.id);
    const renamed = types.find((t) => t.id === space.id)!;
    expect(renamed.name).toBe('Raw space');
    expect(renamed.isSpaceOnly).toBe(true);
    await makeExhibitor(edition.id, pavilion.id);
    await expect(deleteExhibitorType(actorFor(admin), pavilion.id)).rejects.toThrow(/Stands still use/);
    await deleteExhibitorType(actorFor(admin), again.id);
  });

  it('manages halls without losing stands', async () => {
    const { edition, shell } = await makeEdition();
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const h = await createHall(actorFor(team), edition.id, 'N1');
    await expect(createHall(actorFor(team), edition.id, 'N1')).rejects.toThrow(/already a hall/);
    await renameHall(actorFor(team), h.id, 'North 1');
    const { stand } = await makeExhibitor(edition.id, shell.id);
    const db = await getDb();
    await db.update(stands).set({ hallId: h.id }).where(eq(stands.id, stand.id));
    await deleteHall(actorFor(team), h.id);
    const [after] = await db.select().from(stands).where(eq(stands.id, stand.id));
    expect(after.hallId).toBeNull();
    const viewer = await makeStaff(edition.id, 'show_team', []);
    await expect(createHall(actorFor(viewer), edition.id, 'N2')).rejects.toThrow();
  });
});

describe('exhibitors and stands', () => {
  it('adds an exhibitor with a stand and a saved invitation, and tracks invitation state', async () => {
    const { edition, shell, space } = await makeEdition();
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const r = await addExhibitor(actorFor(team), edition.id, {
      company: { name: 'Acme Doors Ltd', website: 'acmedoors.example' },
      stand: { number: 'B10', exhibitorTypeId: shell.id, sizeSqm: 9, openSides: 2 },
      contact: { email: 'Jo@AcmeDoors.example', sendNow: false },
    });
    let list = await listExhibitors(actorFor(team), edition.id);
    const row = list.rows.find((x) => x.company.id === r.companyId)!;
    expect(row.state).toBe('not_sent');
    expect(row.invite?.email).toBe('jo@acmedoors.example');
    expect(row.company.website).toBe('https://acmedoors.example');

    await expect(
      addExhibitor(actorFor(team), edition.id, { company: { name: 'Other' }, stand: { number: 'b10', exhibitorTypeId: shell.id } }),
    ).rejects.toThrow(/already exists/);
    const other = await makeEdition();
    await expect(
      addExhibitor(actorFor(team), edition.id, { company: { name: 'Other' }, stand: { number: 'B11', exhibitorTypeId: other.shell.id } }),
    ).rejects.toThrow(/Choose a stand type/);

    // Live show: send everything that was saved.
    const sent = await sendUnsentInvitations(actorFor(team), edition.id);
    expect(sent.sent).toBe(1);
    list = await listExhibitors(actorFor(team), edition.id);
    expect(list.rows.find((x) => x.company.id === r.companyId)!.state).toBe('invited');
    const db = await getDb();
    const mail = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, 'jo@acmedoors.example'));
    expect(mail).toHaveLength(1);

    // Joined once someone belongs to the company.
    const u = await makeUser();
    await db.insert(companyMembers).values({ companyId: r.companyId, userId: u.id, role: 'main_contact' });
    list = await listExhibitors(actorFor(team), edition.id, { state: 'joined' });
    expect(list.rows.map((x) => x.company.id)).toContain(r.companyId);

    // Filters.
    await addExhibitor(actorFor(team), edition.id, { company: { name: 'Zed Frames' }, stand: { number: 'S1', exhibitorTypeId: space.id } });
    expect((await listExhibitors(actorFor(team), edition.id, { typeId: space.id })).rows.map((x) => x.company.name)).toEqual(['Zed Frames']);
    expect((await listExhibitors(actorFor(team), edition.id, { q: 'b10' })).rows.map((x) => x.company.name)).toEqual(['Acme Doors Ltd']);
    expect((await listExhibitors(actorFor(team), edition.id, { state: 'no_contact' })).rows.map((x) => x.company.name)).toEqual(['Zed Frames']);
  });

  it('will not send invitations while a show is a draft', async () => {
    const { edition, shell } = await makeEdition();
    const db = await getDb();
    await db.update(editions).set({ status: 'draft' }).where(eq(editions.id, edition.id));
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const { company } = await makeExhibitor(edition.id, shell.id);
    await expect(inviteExhibitorContact(actorFor(team), edition.id, company.id, { email: 'x@y.example', role: 'main_contact' })).rejects.toThrow(/draft/);
    await inviteExhibitorContact(actorFor(team), edition.id, company.id, { email: 'x@y.example', role: 'main_contact', sendNow: false });
    await expect(sendUnsentInvitations(actorFor(team), edition.id)).rejects.toThrow(/live/);
  });

  it('keeps exhibitors private to their own show team', async () => {
    const a = await makeEdition();
    const b = await makeEdition();
    const { company } = await makeExhibitor(a.edition.id, a.shell.id);
    const staffB = await makeStaff(b.edition.id, 'show_admin');
    await expect(getExhibitor(actorFor(staffB), a.edition.id, company.id)).rejects.toThrow();
    await expect(getExhibitor(actorFor(staffB), b.edition.id, company.id)).rejects.toThrow();
    const reviewer = await makeStaff(a.edition.id, 'hs_reviewer');
    await expect(listExhibitors(actorFor(reviewer), a.edition.id)).rejects.toThrow();
    const exhibitorUser = (await makeExhibitor(a.edition.id, a.shell.id)).user;
    await expect(listExhibitors(actorFor(exhibitorUser), a.edition.id)).rejects.toThrow();
  });

  it('edits, cancels and deletes stands safely', async () => {
    const { edition, shell, space } = await makeEdition();
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const { stand, company } = await makeExhibitor(edition.id, shell.id, 'C1');
    await updateStand(actorFor(team), stand.id, { number: 'C1A', exhibitorTypeId: space.id, openSides: 3, sizeSqm: 36 });
    const db = await getDb();
    const [s] = await db.select().from(stands).where(eq(stands.id, stand.id));
    expect(s).toMatchObject({ number: 'C1A', exhibitorTypeId: space.id, openSides: 3, sizeSqm: '36.00' });
    await setStandStatus(actorFor(team), stand.id, 'cancelled');
    await setStandStatus(actorFor(team), stand.id, 'active');
    await db.insert(orders).values({
      number: `T-${Date.now()}`,
      editionId: edition.id,
      standId: stand.id,
      companyId: company.id,
      paymentMethod: 'card',
      feeMode: 'exhibitor_pays',
      netPence: 100,
      vatPence: 20,
      commissionPence: 10,
      totalPence: 120,
    });
    await expect(deleteStand(actorFor(team), stand.id)).rejects.toThrow(/Cancel it instead/);
    const other = await makeExhibitor(edition.id, shell.id, 'C2');
    await expect(updateStand(actorFor(team), stand.id, { number: 'C1A', exhibitorTypeId: space.id, companyId: other.company.id })).rejects.toThrow(/already has orders/);
    await deleteStand(actorFor(team), other.stand.id);
  });

  it('keeps internal notes to the show team', async () => {
    const { edition, shell } = await makeEdition();
    const helpdesk = await makeStaff(edition.id, 'show_team', ['helpdesk']);
    const viewer = await makeStaff(edition.id, 'show_team', []);
    const admin = await makeStaff(edition.id, 'show_admin');
    const { company } = await makeExhibitor(edition.id, shell.id);
    const note = await addExhibitorNote(actorFor(helpdesk), edition.id, company.id, 'Called about late electrics order.');
    await expect(addExhibitorNote(actorFor(viewer), edition.id, company.id, 'Hi')).rejects.toThrow();
    const detail = await getExhibitor(actorFor(viewer), edition.id, company.id);
    expect(detail.notes.map((n) => n.note.body)).toEqual(['Called about late electrics order.']);
    expect(detail.canNote).toBe(false);
    await expect(deleteExhibitorNote(actorFor(viewer), note.id)).rejects.toThrow();
    await deleteExhibitorNote(actorFor(admin), note.id);
  });
});

describe('importing exhibitors', () => {
  const csv = [
    'Company Name,Stand No,Stand Type,Hall,Size (sqm),Open Sides,Contact Name,Email,Website',
    'Acme Insulation Ltd,N1-110,Shell Scheme Package,N1,9,2,Amira Khan,amira@acme.example,acme.example',
    '"Bright, Build & Co",N1-214,shell,N1,12m2,1,Ben,ben@bright.example,',
    'Evergreen Timber,N3-501,Space only,N3,72,3,Ella,ella@evergreen.example,',
    'Bad Row,N1-110,Shell scheme,N1,9,1,,,',
    'No Type Co,X1,,N1,9,1,,not-an-email,',
    'Weird Type Co,X2,Floating,N1,9,1,,,',
  ].join('\n');

  it('plans an import row by row before changing anything', async () => {
    const { edition, shell } = await makeEdition();
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const rows = await readSpreadsheet('list.csv', new TextEncoder().encode(csv));
    const plan = await planImport(actorFor(team), edition.id, rows, { defaultTypeId: null });
    expect(plan.summary).toMatchObject({ total: 6, create: 3, errors: 3, newCompanies: 3, invites: 3 });
    expect(plan.rows[1].company).toBe('Bright, Build & Co');
    expect(plan.rows[1].sizeSqm).toBe(12);
    expect(plan.rows[3].messages.join(' ')).toMatch(/also on line 2/);
    expect(plan.rows[4].messages.join(' ')).toMatch(/not a valid email/);
    expect(plan.rows[5].messages.join(' ')).toMatch(/Unknown stand type/);
    expect(plan.newHalls.sort()).toEqual(['N1', 'N3']);
    const db = await getDb();
    expect(await db.select().from(stands).where(eq(stands.editionId, edition.id))).toHaveLength(0);
    // With a default type, the blank type row becomes valid (its bad email still fails).
    const withDefault = await planImport(actorFor(team), edition.id, rows, { defaultTypeId: shell.id });
    expect(withDefault.rows[4].messages.join(' ')).not.toMatch(/Stand type is missing/);
  });

  it('imports valid rows, reuses existing companies and can be run again safely', async () => {
    const { edition } = await makeEdition();
    const db = await getDb();
    const [existing] = await db.insert(companies).values({ name: 'Acme  Insulation ltd' }).returning();
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const rows = await readSpreadsheet('list.csv', new TextEncoder().encode(csv));
    const first = await runImport(actorFor(team), edition.id, rows, { defaultTypeId: null, sendInvites: false });
    expect(first).toMatchObject({ created: 3, updated: 0, newCompanies: 2, newHalls: 2, invitations: 3, invitationsSent: false });
    expect(first.skipped).toEqual([5, 6, 7]);
    const [acmeStand] = await db.select().from(stands).where(and(eq(stands.editionId, edition.id), eq(stands.number, 'N1-110')));
    expect(acmeStand.companyId).toBe(existing.id);
    expect(await db.select().from(halls).where(eq(halls.editionId, edition.id))).toHaveLength(2);
    const invites = await db.select().from(invitations).where(eq(invitations.editionId, edition.id));
    expect(invites.every((i) => i.lastSentAt === null)).toBe(true);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, 'amira@acme.example'))).toHaveLength(0);

    const second = await runImport(actorFor(team), edition.id, rows, { defaultTypeId: null, sendInvites: true });
    expect(second).toMatchObject({ created: 0, updated: 3, newCompanies: 0 });
    expect(await db.select().from(companies).where(eq(companies.name, 'Evergreen Timber'))).toHaveLength(1);
    // Contacts already invited are not invited twice.
    expect(second.invitations).toBe(0);
  });

  it('refuses stands that belong to another company and needs the key columns', async () => {
    const { edition, shell } = await makeEdition();
    const team = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    await makeExhibitor(edition.id, shell.id, 'A1');
    const plan = await planImport(actorFor(team), edition.id, [['Company', 'Stand', 'Type'], ['Somebody Else', 'a1', 'shell']], { defaultTypeId: null });
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].messages.join(' ')).toMatch(/another company/);
    const missing = await planImport(actorFor(team), edition.id, [['Name', 'Email'], ['x', 'y']], { defaultTypeId: null });
    expect(missing.missingColumns).toEqual(['company', 'stand']);
    const outsider = await makeUser();
    await expect(planImport(actorFor(outsider), edition.id, [['Company', 'Stand']], { defaultTypeId: null })).rejects.toThrow();
  });

  it('reads Excel files, including email hyperlinks', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Exhibitors');
    ws.addRow(['Company', 'Stand', 'Type', 'Email', 'Size']);
    ws.addRow(['Fortis Steel', 'N3-620', 'Space only', { text: 'finn@fortis.example', hyperlink: 'mailto:finn@fortis.example' }, 120]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const rows = await readSpreadsheet('list.xlsx', buf);
    expect(rows[1]).toEqual(['Fortis Steel', 'N3-620', 'Space only', 'finn@fortis.example', '120']);
  });

  it('rejects zip bombs and fake spreadsheets', async () => {
    // A tiny archive whose directory claims a 2 GB entry.
    const name = Buffer.from('xl/huge.xml');
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(1000, 20);
    cd.writeUInt32LE(2_000_000_000, 24);
    cd.writeUInt16LE(name.length, 28);
    name.copy(cd, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(4, 16);
    const bomb = new Uint8Array(Buffer.concat([Buffer.from('PK\u0003\u0004'), cd, eocd]));
    expect(() => assertSafeZip(bomb)).toThrow(/too large|suspiciously/);
    await expect(readSpreadsheet('list.xlsx', bomb)).rejects.toThrow();
    await expect(readSpreadsheet('list.xlsx', new TextEncoder().encode('Company,Stand'))).rejects.toThrow(/not a valid Excel/);
  });
});

describe('CSV parsing', () => {
  it('handles quotes, line breaks, semicolons and byte-order marks', () => {
    expect(parseDelimited('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    expect(parseDelimited('a;b\n1;"2\n3"')).toEqual([
      ['a', 'b'],
      ['1', '2\n3'],
    ]);
    expect(parseDelimited('a\tb\n1\t2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
