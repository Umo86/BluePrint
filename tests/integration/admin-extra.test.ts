import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, emailOutbox, invitations, standContractors, users } from '@/server/db/schema';
import { eraseEmailAddress, findPersonRecords } from '@/server/services/gdpr';
import { getUserDetail } from '@/server/services/users';
import { createSupplier, getSupplierDetail } from '@/server/services/suppliers';
import { createInvitation } from '@/server/auth/invitations';
import { listLibrary, createLibraryItem, updateLibraryItem } from '@/server/services/library';
import { updatePlatformSettings, getPlatformSettings } from '@/server/services/settings';
import { toCsv } from '@/lib/csv';
import { systemStatus } from '@/server/services/system';
import { DEMO_ADDRESS_REASON, DEMO_SHOW_REASON } from '@/server/email/send';
import { EMAIL_OFF_REASON } from '@/server/email/provider';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

let root: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
  root = await makeUser({ email: 'root2@example.com', isSuperAdmin: true });
});
afterAll(closeDb);

describe('privacy requests', () => {
  it('finds records for an address and erases one with no account', async () => {
    const { edition, space } = await makeEdition();
    const { stand } = await makeExhibitor(edition.id, space.id);
    const db = await getDb();
    const email = 'builder@contractor.example';
    await db.insert(standContractors).values({ standId: stand.id, contactName: 'Bob Builder', contactEmail: email, contractorCompanyName: 'Build Co' });
    await db.insert(emailOutbox).values({
      toEmail: email,
      templateKey: 'contractor_nominated',
      category: 'transactional',
      fromAddress: 'noreply@example.com',
      subject: 'You have been nominated',
      html: '<p>Hi Bob</p>',
      text: 'Hi Bob',
      status: 'sent',
    });
    const found = await findPersonRecords(actorFor(root), ' Builder@Contractor.example ');
    expect(found.user).toBeNull();
    expect(found.counts.contractorContacts).toBe(1);
    expect(found.counts.emails).toBe(1);

    await eraseEmailAddress(actorFor(root), email);
    const after = await findPersonRecords(actorFor(root), email);
    expect(Object.values(after.counts).every((n) => n === 0)).toBe(true);
    const [c] = await db.select().from(standContractors).where(eq(standContractors.standId, stand.id));
    expect(c.contactName).toBe('Deleted contact');
    expect(c.contactEmail).toMatch(/anonymised\.invalid$/);
    const logged = await db.select().from(auditLog).where(eq(auditLog.action, 'gdpr.address_erased'));
    expect(JSON.stringify(logged)).not.toContain(email);
  });

  it('refuses to erase an address that belongs to an account, and refuses non super admins', async () => {
    const someone = await makeUser({ email: 'has-account@example.com' });
    await expect(eraseEmailAddress(actorFor(root), someone.email)).rejects.toThrow(/belongs to an account/);
    const staff = await makeUser();
    await expect(findPersonRecords(actorFor(staff), someone.email)).rejects.toThrow();
    await expect(findPersonRecords(actorFor(root, { readOnly: true }), someone.email)).rejects.toThrow();
  });
});

describe('user detail', () => {
  it('lists the stands an exhibitor can be viewed at', async () => {
    const { edition, shell } = await makeEdition('View As Expo 2027');
    const { user, stand } = await makeExhibitor(edition.id, shell.id, 'B42');
    const detail = await getUserDetail(actorFor(root), user.id);
    expect(detail.exhibitorStands).toHaveLength(1);
    expect(detail.exhibitorStands[0]).toMatchObject({ editionId: edition.id, standNumber: stand.number });
  });
});

describe('suppliers', () => {
  it('shows pending invitations on the supplier record', async () => {
    const s = await createSupplier(actorFor(root), { name: 'Sparks Electrical', email: 'orders@sparks.example' });
    await createInvitation(actorFor(root), { kind: 'supplier', email: 'jo@sparks.example', supplierId: s.id });
    const detail = await getSupplierDetail(actorFor(root), s.id);
    expect(detail.pendingInvites.map((i) => i.email)).toEqual(['jo@sparks.example']);
    const db = await getDb();
    const [inv] = await db.select().from(invitations).where(eq(invitations.email, 'jo@sparks.example'));
    expect(inv.tokenHash).not.toContain('jo@');
  });

  it('hides supplier records from show team members who are not show admins', async () => {
    const { edition } = await makeEdition();
    const teamMember = await makeStaff(edition.id, 'show_team', ['manage_orders']);
    const s = await createSupplier(actorFor(root), { name: 'Furniture Ltd', email: 'hello@furniture.example' });
    await expect(getSupplierDetail(actorFor(teamMember), s.id)).rejects.toThrow();
  });
});

describe('library', () => {
  it('cleans page HTML and only lets super admins change templates', async () => {
    const item = await createLibraryItem(actorFor(root), {
      kind: 'page',
      name: 'Health and safety',
      data: { title: 'Health and safety', bodyHtml: '<p onclick="steal()">Hi<script>alert(1)</script></p><a href="javascript:alert(1)">x</a>' },
    });
    expect(String(item.data.bodyHtml)).toBe('<p>Hi</p><a>x</a>');
    const { edition } = await makeEdition();
    const staff = await makeStaff(edition.id, 'show_team', ['edit_content']);
    expect((await listLibrary(actorFor(staff))).length).toBeGreaterThan(0);
    await expect(updateLibraryItem(actorFor(staff), item.id, { kind: 'page', name: 'Hacked', data: { title: 'x', bodyHtml: '' } })).rejects.toThrow();
    const outsider = await makeUser();
    await expect(listLibrary(actorFor(outsider))).rejects.toThrow();
  });
});

describe('settings', () => {
  it('rejects out-of-range values and keeps the rest', async () => {
    await expect(updatePlatformSettings(actorFor(root), { stripeFeePercentBps: 999999 })).rejects.toThrow();
    await updatePlatformSettings(actorFor(root), { maintenanceMessage: 'Planned maintenance on Sunday 8am to 9am.' });
    expect((await getPlatformSettings()).maintenanceMessage).toContain('Planned maintenance');
    const db = await getDb();
    const [u] = await db.select().from(users).where(eq(users.id, root.id));
    expect(u.isSuperAdmin).toBe(true);
  });
});

describe('CSV downloads', () => {
  it('neutralises spreadsheet formulas and quotes properly', () => {
    const csv = toCsv([
      ['=HYPERLINK("http://evil")', '+1', '-2', '@cmd', 'normal, with comma', 'line\nbreak', null, 42],
    ]);
    expect(csv).toBe(`"'=HYPERLINK(""http://evil"")",'+1,'-2,'@cmd,"normal, with comma","line\nbreak",,42\r\n`);
  });
});

describe('system page', () => {
  it('says why emails were not sent', async () => {
    const db = await getDb();
    const held = (error: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        toEmail: `held-${i}@example.com`,
        templateKey: 'campaign',
        category: 'campaign' as const,
        fromAddress: 'noreply@example.com',
        subject: 'Update',
        html: '<p>Hi</p>',
        text: 'Hi',
        status: 'suppressed' as const,
        error,
      }));
    await db.insert(emailOutbox).values([...held(DEMO_SHOW_REASON, 3), ...held(DEMO_ADDRESS_REASON, 1), ...held(EMAIL_OFF_REASON, 2), ...held('Unsubscribed from campaigns', 1)]);
    const s = await systemStatus(actorFor(root));
    expect(s.notSent).toEqual({ demo: 4, emailOff: 2, blocked: 1 });
    expect(s.emailByStatus.suppressed).toBe(7);
  });
});
