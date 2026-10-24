import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';
import {
  announcementsForType,
  createAnnouncement,
  deleteAnnouncement,
  emailDraftFromAnnouncement,
  listAnnouncements,
  setAnnouncementPublished,
  updateAnnouncement,
} from '@/server/services/announcements';
import { actorFor, makeEdition, makeStaff } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('announcements', () => {
  it('shows each announcement to the right stand types, at the right time', async () => {
    const { edition, shell, space } = await makeEdition();
    const admin = actorFor(await makeStaff(edition.id, 'show_admin'));
    const rigging = await createAnnouncement(admin, edition.id, {
      title: 'Rigging',
      bodyHtml: '<p onclick="x()">Plans due <script>alert(1)</script>soon</p>',
      visibleToTypes: [space.id],
      when: 'now',
    });
    expect(rigging.bodyHtml).toBe('<p>Plans due soon</p>');
    await createAnnouncement(admin, edition.id, { title: 'Welcome', bodyHtml: '<p>Hello</p>', when: 'now', pinned: true });
    const draft = await createAnnouncement(admin, edition.id, { title: 'Draft', bodyHtml: '' });
    await createAnnouncement(admin, edition.id, { title: 'Later', bodyHtml: '', when: 'scheduled', publishAt: new Date(Date.now() + 3600_000) });
    await expect(createAnnouncement(admin, edition.id, { title: 'No time', bodyHtml: '', when: 'scheduled' })).rejects.toThrow(/when it should appear/);
    await expect(createAnnouncement(admin, edition.id, { title: ' ', bodyHtml: '' })).rejects.toThrow();

    // Pinned first, then newest; drafts and scheduled ones are not shown yet.
    expect(titles(await announcementsForType(edition.id, space.id))).toEqual(['Welcome', 'Rigging']);
    expect(titles(await announcementsForType(edition.id, shell.id))).toEqual(['Welcome']);
    const list = await listAnnouncements(admin, edition.id);
    expect(Object.fromEntries(list.map((a) => [a.title, a.state]))).toEqual({ Welcome: 'published', Rigging: 'published', Draft: 'draft', Later: 'scheduled' });

    // Editing a live announcement keeps the date it went live.
    const liveSince = list.find((a) => a.id === rigging.id)!.publishedAt!;
    await updateAnnouncement(admin, rigging.id, { title: 'Rigging plans', bodyHtml: '<p>Due Friday</p>', visibleToTypes: [space.id], when: 'now' });
    const after = (await listAnnouncements(admin, edition.id)).find((a) => a.id === rigging.id)!;
    expect(after.title).toBe('Rigging plans');
    expect(after.publishedAt!.getTime()).toBe(liveSince.getTime());

    // Taking it off the portal, and publishing the draft straight away.
    await setAnnouncementPublished(admin, rigging.id, false);
    await setAnnouncementPublished(admin, draft.id, true);
    expect(titles(await announcementsForType(edition.id, space.id))).toEqual(['Welcome', 'Draft']);

    // Stand types must belong to this show.
    const other = await makeEdition('Other Expo 2027');
    await expect(createAnnouncement(admin, edition.id, { title: 'Wrong', bodyHtml: '', visibleToTypes: [other.shell.id] })).rejects.toThrow(/stand types from this show/);
  });

  it('only people who edit content can change announcements, and only for their own show', async () => {
    const { edition } = await makeEdition();
    const adminUser = await makeStaff(edition.id, 'show_admin');
    const admin = actorFor(adminUser);
    const sales = actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors']));
    const other = await makeEdition('Other Expo 2027');
    const otherAdmin = actorFor(await makeStaff(other.edition.id, 'show_admin'));

    await expect(createAnnouncement(sales, edition.id, { title: 'Hi', bodyHtml: '' })).rejects.toThrow();
    await expect(createAnnouncement(actorFor(adminUser, { readOnly: true }), edition.id, { title: 'Hi', bodyHtml: '' })).rejects.toThrow();
    const a = await createAnnouncement(admin, edition.id, { title: 'Hi', bodyHtml: '', when: 'now' });
    expect(titles(await listAnnouncements(sales, edition.id))).toEqual(['Hi']);
    await expect(updateAnnouncement(sales, a.id, { title: 'Changed', bodyHtml: '' })).rejects.toThrow();
    await expect(updateAnnouncement(otherAdmin, a.id, { title: 'Changed', bodyHtml: '' })).rejects.toThrow();
    await expect(setAnnouncementPublished(otherAdmin, a.id, false)).rejects.toThrow();
    await expect(deleteAnnouncement(otherAdmin, a.id)).rejects.toThrow();
    await expect(listAnnouncements(otherAdmin, edition.id)).rejects.toThrow();

    await deleteAnnouncement(admin, a.id);
    expect(await listAnnouncements(admin, edition.id)).toEqual([]);
    const db = await getDb();
    const logged = await db.select().from(auditLog).where(and(eq(auditLog.entityId, a.id), eq(auditLog.action, 'announcement.deleted')));
    expect(logged).toHaveLength(1);
  });

  it('turns an announcement into an email draft for the same stand types', async () => {
    const { edition, space } = await makeEdition();
    const admin = actorFor(await makeStaff(edition.id, 'show_admin'));
    const a = await createAnnouncement(admin, edition.id, {
      title: 'Rigging plans',
      bodyHtml: '<p>See <a href="/files/00000000-0000-4000-8000-000000000000">the hall plan</a>.</p>',
      visibleToTypes: [space.id],
      when: 'now',
    });
    const c = await emailDraftFromAnnouncement(admin, a.id);
    expect(c.status).toBe('draft');
    expect(c.subject).toBe('Rigging plans');
    expect(c.filter).toMatchObject({ exhibitorTypeIds: [space.id], audience: 'main_contacts' });
    const html = c.blocks.find((b) => b.type === 'html');
    expect(html && 'html' in html ? html.html : '').toContain('href="http://localhost:3000/files/00000000-0000-4000-8000-000000000000"');
    expect(c.blocks.some((b) => b.type === 'button' && b.url === '{{portal_link}}')).toBe(true);

    // Writing announcements does not include sending emails.
    const writer = actorFor(await makeStaff(edition.id, 'show_team', ['edit_content']));
    await expect(emailDraftFromAnnouncement(writer, a.id)).rejects.toThrow();
  });
});
