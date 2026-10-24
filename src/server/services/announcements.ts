import 'server-only';
import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { announcements, exhibitorTypes } from '../db/schema';
import { requireEditionPermission } from '../authz';
import { invalid, notFound } from '../errors';
import { audit } from '../audit';
import { sanitizeRichText } from '../security/sanitize';
import { appUrl } from '../auth/login';
import { createCampaign } from './campaigns';
import type { Actor } from '../auth/actor';

/**
 * Announcements are short notices on the exhibitor portal's home page ("Hall 3 opens at 7am on
 * Monday"). Each can be shown to every stand type or only some, pinned to the top, published straight
 * away or scheduled, and turned into an email to the same exhibitors.
 */
export const ANNOUNCEMENT_WHEN = ['draft', 'now', 'scheduled'] as const;

export const announcementSchema = z.object({
  title: z.string().trim().min(1, 'Give the announcement a title.').max(200),
  bodyHtml: z.string().max(40_000, 'This announcement is too long. Put the details on a manual page and link to it.'),
  visibleToTypes: z.array(z.string().uuid()).max(50).default([]),
  pinned: z.boolean().default(false),
  when: z.enum(ANNOUNCEMENT_WHEN).default('draft'),
  publishAt: z.date().nullable().optional(),
});
export type AnnouncementInput = z.input<typeof announcementSchema>;

export type AnnouncementState = 'draft' | 'scheduled' | 'published';

export function announcementState(a: { publishedAt: Date | null }, now = new Date()): AnnouncementState {
  if (!a.publishedAt) return 'draft';
  return a.publishedAt.getTime() > now.getTime() ? 'scheduled' : 'published';
}

async function checkTypes(editionId: string, typeIds: string[]) {
  if (!typeIds.length) return;
  const db = await getDb();
  const rows = await db.select({ id: exhibitorTypes.id }).from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId));
  const ok = new Set(rows.map((r) => r.id));
  if (typeIds.some((t) => !ok.has(t))) throw invalid('Choose stand types from this show.');
}

/** When the announcement should appear, from the editor's choice. Re-saving a live one keeps its date. */
function publishedAtFor(data: z.infer<typeof announcementSchema>, existing: Date | null): Date | null {
  if (data.when === 'draft') return null;
  if (data.when === 'scheduled') {
    if (!data.publishAt) throw invalid('Choose when it should appear.', { publishAt: 'Choose a date and time.' });
    return data.publishAt;
  }
  return existing && existing.getTime() <= Date.now() ? existing : new Date();
}

async function loadAnnouncement(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!row) throw notFound();
  return row;
}

/** Every announcement for the show team, newest first. */
export async function listAnnouncements(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const rows = await db.select().from(announcements).where(eq(announcements.editionId, editionId)).orderBy(desc(announcements.pinned), desc(announcements.createdAt));
  const now = new Date();
  return rows.map((a) => ({ ...a, state: announcementState(a, now) }));
}

export async function getAnnouncement(actor: Actor, announcementId: string) {
  const a = await loadAnnouncement(announcementId);
  await requireEditionPermission(actor, a.editionId, 'view');
  return { ...a, state: announcementState(a) };
}

export async function createAnnouncement(actor: Actor, editionId: string, input: AnnouncementInput) {
  await requireEditionPermission(actor, editionId, 'edit_content', { write: true });
  const data = announcementSchema.parse(input);
  await checkTypes(editionId, data.visibleToTypes);
  const db = await getDb();
  const [row] = await db
    .insert(announcements)
    .values({
      editionId,
      title: data.title,
      bodyHtml: sanitizeRichText(data.bodyHtml),
      visibleToTypes: data.visibleToTypes,
      pinned: data.pinned,
      publishedAt: publishedAtFor(data, null),
      createdBy: actor.realUserId,
    })
    .returning();
  await audit(actor, 'announcement.created', { entityType: 'announcement', entityId: row.id, editionId, details: { title: row.title, state: announcementState(row) } });
  return row;
}

export async function updateAnnouncement(actor: Actor, announcementId: string, input: AnnouncementInput) {
  const a = await loadAnnouncement(announcementId);
  await requireEditionPermission(actor, a.editionId, 'edit_content', { write: true });
  const data = announcementSchema.parse(input);
  await checkTypes(a.editionId, data.visibleToTypes);
  const publishedAt = publishedAtFor(data, a.publishedAt);
  const db = await getDb();
  await db
    .update(announcements)
    .set({ title: data.title, bodyHtml: sanitizeRichText(data.bodyHtml), visibleToTypes: data.visibleToTypes, pinned: data.pinned, publishedAt })
    .where(eq(announcements.id, announcementId));
  await audit(actor, 'announcement.updated', {
    entityType: 'announcement',
    entityId: announcementId,
    editionId: a.editionId,
    details: { title: data.title, state: announcementState({ publishedAt }) },
  });
}

/** Takes an announcement off the portal (it stays as a draft) or puts it back on straight away. */
export async function setAnnouncementPublished(actor: Actor, announcementId: string, published: boolean) {
  const a = await loadAnnouncement(announcementId);
  await requireEditionPermission(actor, a.editionId, 'edit_content', { write: true });
  const db = await getDb();
  const publishedAt = published ? (a.publishedAt && a.publishedAt.getTime() <= Date.now() ? a.publishedAt : new Date()) : null;
  await db.update(announcements).set({ publishedAt }).where(eq(announcements.id, announcementId));
  await audit(actor, published ? 'announcement.published' : 'announcement.unpublished', { entityType: 'announcement', entityId: announcementId, editionId: a.editionId, details: { title: a.title } });
}

export async function deleteAnnouncement(actor: Actor, announcementId: string) {
  const a = await loadAnnouncement(announcementId);
  await requireEditionPermission(actor, a.editionId, 'edit_content', { write: true });
  const db = await getDb();
  await db.delete(announcements).where(eq(announcements.id, announcementId));
  await audit(actor, 'announcement.deleted', { entityType: 'announcement', entityId: announcementId, editionId: a.editionId, details: { title: a.title } });
}

/**
 * Starts an email to the same exhibitors with the announcement's wording, as a draft the team checks
 * and sends from Emails (which needs the "send emails" permission).
 */
export async function emailDraftFromAnnouncement(actor: Actor, announcementId: string) {
  const a = await loadAnnouncement(announcementId);
  await requireEditionPermission(actor, a.editionId, 'view');
  // Links to downloads on the portal are relative; emails need the full address.
  const html = a.bodyHtml.replace(/(href|src)="\/(?!\/)/g, (_, attr: string) => `${attr}="${appUrl('/')}`);
  return createCampaign(actor, a.editionId, {
    name: `Announcement: ${a.title}`.slice(0, 150),
    subject: a.title,
    blocks: [
      { type: 'paragraph', text: 'Hello {{first_name}},' },
      ...(html.trim() ? [{ type: 'html' as const, html }] : []),
      { type: 'button', label: 'Open your exhibitor portal', url: '{{portal_link}}' },
    ],
    filter: { exhibitorTypeIds: a.visibleToTypes, audience: 'main_contacts' },
  });
}

// ---------------------------------------------------------------------------
// What exhibitors see
// ---------------------------------------------------------------------------

/** Published announcements an exhibitor of this stand type should see, pinned first, then newest. */
export async function announcementsForType(editionId: string, typeId: string, limit = 5) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.editionId, editionId), isNotNull(announcements.publishedAt), lte(announcements.publishedAt, new Date())))
    .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
    .limit(200);
  return rows.filter((a) => a.visibleToTypes.length === 0 || a.visibleToTypes.includes(typeId)).slice(0, limit);
}
