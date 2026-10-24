import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { companyMembers, editionStaff, invitations, standContractors, stands } from '@/server/db/schema';
import { acceptInvitation, createInvitation, revokeInvitation, sendInvitationCode } from '@/server/auth/invitations';
import { exhibitorEditions, requireStandAccess } from '@/server/authz';
import { addExhibitor, getExhibitor, setStandStatus } from '@/server/services/stands';
import { resolvePortal } from '@/server/services/portal';
import { recipientsFor } from '@/server/services/campaigns';
import { removeMember, setCompanyInvoiceAllowed, setMemberAccess, updateCompany } from '@/server/services/companies';
import { nominateContractor } from '@/server/services/space-only';
import { actorFor, codeFromEmail, lastEmailTo, makeEdition, makeExhibitor, makeStaff } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

const ctx = { ip: '127.0.0.1', userAgent: 'vitest' };

async function accept(token: string, email: string, name: string) {
  await sendInvitationCode(token, ctx);
  return acceptInvitation(token, { name, code: codeFromEmail((await lastEmailTo(email)).subject) }, ctx);
}

/** A company that exhibits at two shows run by different teams. */
async function twoShows() {
  const ukcw = await makeEdition('UKCW 2027');
  const stone = await makeEdition('Stone & Surface 2027');
  const ukcwAdmin = await makeStaff(ukcw.edition.id, 'show_admin');
  const stoneTeam = await makeStaff(stone.edition.id, 'show_team', ['manage_exhibitors', 'send_emails']);
  const acme = await makeExhibitor(ukcw.edition.id, ukcw.shell.id, 'U1');
  return { ukcw, stone, ukcwAdmin, stoneTeam, acme };
}

describe('people act for a company at the shows they were invited for', () => {
  it('stops one show’s team giving anyone access to the company at another show', async () => {
    const { ukcw, stone, stoneTeam, acme } = await twoShows();
    // The Stone & Surface team reuses the company record and invites a contact.
    const { stand: sStand } = await addExhibitor(actorFor(stoneTeam), stone.edition.id, {
      existingCompanyId: acme.company.id,
      stand: { number: 'S1', exhibitorTypeId: stone.shell.id, openSides: 1 },
    });
    const { token } = await createInvitation(actorFor(stoneTeam), { kind: 'exhibitor', email: 'insider@example.com', editionId: stone.edition.id, companyId: acme.company.id });
    const insider = await accept(token, 'insider@example.com', 'Insider');
    const me = actorFor(insider);

    // They act for Acme at Stone & Surface only.
    await expect(requireStandAccess(me, sStand.id)).resolves.toBeTruthy();
    await expect(requireStandAccess(me, acme.stand.id)).rejects.toThrow(/could not find/);
    await expect(resolvePortal(me, ukcw.edition.slug)).rejects.toThrow(/could not find/);
    expect((await exhibitorEditions(me)).map((e) => e.id)).toEqual([stone.edition.id]);

    // UKCW's updates and contact lists do not include them; Stone & Surface's do.
    const ukcwPeople = await recipientsFor(ukcw.edition.id, { audience: 'everyone' });
    expect(ukcwPeople.map((p) => p.email)).not.toContain('insider@example.com');
    expect((await recipientsFor(stone.edition.id, { audience: 'everyone' })).map((p) => p.email)).toContain('insider@example.com');
    const ukcwView = await getExhibitor(actorFor((await makeStaff(ukcw.edition.id, 'show_admin'))), ukcw.edition.id, acme.company.id);
    expect(ukcwView.members.map((m) => m.user.email)).not.toContain('insider@example.com');

    // Invited later for UKCW too, by UKCW's own team, they then act at both.
    const ukcwAdmin = await makeStaff(ukcw.edition.id, 'show_admin');
    const again = await createInvitation(actorFor(ukcwAdmin), { kind: 'exhibitor', email: 'insider@example.com', editionId: ukcw.edition.id, companyId: acme.company.id });
    await accept(again.token, 'insider@example.com', 'Insider');
    await expect(requireStandAccess(me, acme.stand.id)).resolves.toBeTruthy();
    const db = await getDb();
    const [row] = await db.select().from(companyMembers).where(and(eq(companyMembers.companyId, acme.company.id), eq(companyMembers.userId, insider.id)));
    expect(new Set(row.editionIds)).toEqual(new Set([stone.edition.id, ukcw.edition.id]));
  });

  it('does not let a show’s team change or remove the company’s people at other shows', async () => {
    const { stone, stoneTeam, acme } = await twoShows();
    await addExhibitor(actorFor(stoneTeam), stone.edition.id, {
      existingCompanyId: acme.company.id,
      stand: { number: 'S2', exhibitorTypeId: stone.shell.id, openSides: 1 },
    });
    // Acme's main contact acts at every show (UKCW included), so the Stone & Surface team cannot touch them.
    await expect(setMemberAccess(actorFor(stoneTeam), acme.company.id, acme.user.id, { role: 'colleague', canPay: false })).rejects.toThrow(/other shows/);
    await expect(removeMember(actorFor(stoneTeam), acme.company.id, acme.user.id)).rejects.toThrow(/other shows/);

    // Their own contact for Stone & Surface they can manage.
    const { token } = await createInvitation(actorFor(stoneTeam), { kind: 'exhibitor', email: 'stone.contact@example.com', editionId: stone.edition.id, companyId: acme.company.id, role: 'colleague' });
    const local = await accept(token, 'stone.contact@example.com', 'Stone Contact');
    await setMemberAccess(actorFor(stoneTeam), acme.company.id, local.id, { role: 'colleague', canPay: false });
    await removeMember(actorFor(stoneTeam), acme.company.id, local.id);
  });

  it('refuses invitations to yourself, and to companies not at the show', async () => {
    const { stone, stoneTeam, acme } = await twoShows();
    const db = await getDb();
    await db.insert(stands).values({ editionId: stone.edition.id, number: 'S3', exhibitorTypeId: stone.shell.id, companyId: acme.company.id });
    await expect(
      createInvitation(actorFor(stoneTeam), { kind: 'exhibitor', email: stoneTeam.email, editionId: stone.edition.id, companyId: acme.company.id }),
    ).rejects.toThrow(/cannot invite yourself/);
    const elsewhere = await makeExhibitor((await makeEdition('Futurebuild 2027')).edition.id, stone.shell.id, 'F1');
    await expect(
      createInvitation(actorFor(stoneTeam), { kind: 'exhibitor', email: 'x@example.com', editionId: stone.edition.id, companyId: elsewhere.company.id }),
    ).rejects.toThrow(/stand at this show first/);
  });
});

describe('changes that reach across shows', () => {
  it('takes someone off only the shows the team manages, and keeps shared company details for those who cover every show', async () => {
    const { ukcw, stone, stoneTeam, acme } = await twoShows();
    await addExhibitor(actorFor(stoneTeam), stone.edition.id, {
      existingCompanyId: acme.company.id,
      stand: { number: 'S4', exhibitorTypeId: stone.shell.id, openSides: 1 },
    });
    // A contact invited for both shows by each show's own team.
    const ukcwAdmin = await makeStaff(ukcw.edition.id, 'show_admin');
    const both = 'both.shows@example.com';
    const a = await createInvitation(actorFor(ukcwAdmin), { kind: 'exhibitor', email: both, editionId: ukcw.edition.id, companyId: acme.company.id, role: 'colleague' });
    const person = await accept(a.token, both, 'Both Shows');
    const b = await createInvitation(actorFor(stoneTeam), { kind: 'exhibitor', email: both, editionId: stone.edition.id, companyId: acme.company.id, role: 'colleague' });
    await accept(b.token, both, 'Both Shows');

    // The Stone & Surface team removes them: they lose Stone & Surface only.
    await removeMember(actorFor(stoneTeam), acme.company.id, person.id);
    const db = await getDb();
    const [row] = await db.select().from(companyMembers).where(and(eq(companyMembers.companyId, acme.company.id), eq(companyMembers.userId, person.id)));
    expect(row.editionIds).toEqual([ukcw.edition.id]);
    await expect(requireStandAccess(actorFor(person), acme.stand.id)).resolves.toBeTruthy();

    // Shared company details (printed on every show's invoices) need someone who covers every show.
    await expect(updateCompany(actorFor(stoneTeam), acme.company.id, { name: 'Acme (renamed)' })).rejects.toThrow(/other shows/);
    await expect(setCompanyInvoiceAllowed(actorFor(stoneTeam), acme.company.id, true)).rejects.toThrow(/other shows/);
    const both2 = await makeStaff(ukcw.edition.id, 'show_admin');
    await db.insert(editionStaff).values({ editionId: stone.edition.id, userId: both2.id, role: 'show_admin', permissions: [] });
    await expect(updateCompany(actorFor(both2), acme.company.id, { name: 'Acme Ltd' })).resolves.toBeTruthy();
  });

  it('withdraws waiting invitations when a company’s last stand at a show goes, and can always cancel one', async () => {
    const { edition, shell } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const ex = await makeExhibitor(edition.id, shell.id, 'W1');
    const { invitation } = await createInvitation(actorFor(admin), { kind: 'exhibitor', email: 'waiting@example.com', editionId: edition.id, companyId: ex.company.id });
    await setStandStatus(actorFor(admin), ex.stand.id, 'cancelled');
    const db = await getDb();
    const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(inv.revokedAt).not.toBeNull();

    // Even with no stand left, a pending invitation can still be cancelled.
    const other = await makeExhibitor(edition.id, shell.id, 'W2');
    const { invitation: second } = await createInvitation(actorFor(admin), { kind: 'exhibitor', email: 'second@example.com', editionId: edition.id, companyId: other.company.id });
    await db.update(stands).set({ status: 'cancelled' }).where(eq(stands.id, other.stand.id));
    await expect(revokeInvitation(actorFor(admin), second.id)).resolves.toBeUndefined();
  });

  it('does not half-save a contractor when the exhibitor gives their own address', async () => {
    const { edition, space } = await makeEdition();
    const ex = await makeExhibitor(edition.id, space.id, 'C9');
    await expect(nominateContractor(actorFor(ex.user), ex.stand.id, { companyName: 'Us', contactName: 'Me', email: ex.user.email })).rejects.toThrow(/contractor’s details/);
    const db = await getDb();
    expect(await db.select().from(standContractors).where(eq(standContractors.standId, ex.stand.id))).toHaveLength(0);
  });
});
