import 'server-only';
import { and, asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { exhibitorTypes, libraryItems, manualPages, tasks } from '../db/schema';
import { requireEditionPermission } from '../authz';
import { invalid, notFound } from '../errors';
import { audit } from '../audit';
import { sanitizeRichText } from '../security/sanitize';
import { slugify } from '@/lib/slug';
import { assertMayAddToLibrary } from './library';
import type { Actor } from '../auth/actor';

export const pageSchema = z.object({
  title: z.string().trim().min(1, 'Give the page a title.').max(200),
  bodyHtml: z.string().max(400_000, 'This page is too long.'),
  visibleToTypes: z.array(z.string().uuid()).max(50).default([]),
  published: z.boolean().default(true),
  pinned: z.boolean().default(false),
  parentId: z.string().uuid().nullable().optional(),
});

async function uniquePageSlug(editionId: string, title: string, exceptId?: string) {
  const db = await getDb();
  const rows = await db.select({ id: manualPages.id, slug: manualPages.slug }).from(manualPages).where(eq(manualPages.editionId, editionId));
  const taken = new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.slug));
  const base = slugify(title) || 'page';
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

async function checkTypes(editionId: string, typeIds: string[]) {
  if (!typeIds.length) return;
  const db = await getDb();
  const rows = await db.select({ id: exhibitorTypes.id }).from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId));
  const ok = new Set(rows.map((r) => r.id));
  if (typeIds.some((t) => !ok.has(t))) throw invalid('Choose stand types from this show.');
}

async function checkParent(editionId: string, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return null;
  if (parentId === selfId) throw invalid('A page cannot sit inside itself.');
  const db = await getDb();
  const [p] = await db.select().from(manualPages).where(and(eq(manualPages.id, parentId), eq(manualPages.editionId, editionId))).limit(1);
  if (!p) throw invalid('Choose a section from this manual.');
  if (p.parentId) throw invalid('Pages can only be one level deep.');
  return p.id;
}

export async function listPages(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  return db.select().from(manualPages).where(eq(manualPages.editionId, editionId)).orderBy(asc(manualPages.sort), asc(manualPages.title));
}

async function loadPage(pageId: string) {
  const db = await getDb();
  const [row] = await db.select().from(manualPages).where(eq(manualPages.id, pageId)).limit(1);
  if (!row) throw notFound();
  return row;
}

export async function getPage(actor: Actor, pageId: string) {
  const page = await loadPage(pageId);
  await requireEditionPermission(actor, page.editionId, 'view');
  return page;
}

export async function createPage(actor: Actor, editionId: string, input: z.input<typeof pageSchema>) {
  await requireEditionPermission(actor, editionId, 'edit_content', { write: true });
  const data = pageSchema.parse(input);
  await checkTypes(editionId, data.visibleToTypes);
  const parentId = await checkParent(editionId, data.parentId);
  const db = await getDb();
  const [{ top }] = await db.select({ top: max(manualPages.sort) }).from(manualPages).where(eq(manualPages.editionId, editionId));
  const [row] = await db
    .insert(manualPages)
    .values({
      editionId,
      title: data.title,
      slug: await uniquePageSlug(editionId, data.title),
      bodyHtml: sanitizeRichText(data.bodyHtml),
      visibleToTypes: data.visibleToTypes,
      published: data.published,
      pinned: data.pinned,
      parentId,
      sort: (top ?? 0) + 1,
      updatedBy: actor.realUserId,
    })
    .returning();
  await audit(actor, 'manual.page_created', { entityType: 'manual_page', entityId: row.id, editionId, details: { title: row.title } });
  return row;
}

export async function updatePage(actor: Actor, pageId: string, input: z.input<typeof pageSchema>) {
  const page = await loadPage(pageId);
  await requireEditionPermission(actor, page.editionId, 'edit_content', { write: true });
  const data = pageSchema.parse(input);
  await checkTypes(page.editionId, data.visibleToTypes);
  const parentId = await checkParent(page.editionId, data.parentId, pageId);
  const db = await getDb();
  const slug = data.title !== page.title ? await uniquePageSlug(page.editionId, data.title, pageId) : page.slug;
  await db
    .update(manualPages)
    .set({
      title: data.title,
      slug,
      bodyHtml: sanitizeRichText(data.bodyHtml),
      visibleToTypes: data.visibleToTypes,
      published: data.published,
      pinned: data.pinned,
      parentId,
      updatedBy: actor.realUserId,
    })
    .where(eq(manualPages.id, pageId));
  await audit(actor, 'manual.page_updated', { entityType: 'manual_page', entityId: pageId, editionId: page.editionId, details: { title: data.title } });
}

export async function deletePage(actor: Actor, pageId: string) {
  const page = await loadPage(pageId);
  await requireEditionPermission(actor, page.editionId, 'edit_content', { write: true });
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(manualPages).set({ parentId: null }).where(eq(manualPages.parentId, pageId));
    await tx.update(tasks).set({ linkedPageId: null }).where(eq(tasks.linkedPageId, pageId));
    await tx.delete(manualPages).where(eq(manualPages.id, pageId));
  });
  await audit(actor, 'manual.page_deleted', { entityType: 'manual_page', entityId: pageId, editionId: page.editionId, details: { title: page.title } });
}

export async function movePage(actor: Actor, pageId: string, direction: 'up' | 'down') {
  const page = await loadPage(pageId);
  await requireEditionPermission(actor, page.editionId, 'edit_content', { write: true });
  const db = await getDb();
  const all = await db.select().from(manualPages).where(eq(manualPages.editionId, page.editionId)).orderBy(asc(manualPages.sort), asc(manualPages.title));
  const siblings = all.filter((p) => (p.parentId ?? null) === (page.parentId ?? null));
  const i = siblings.findIndex((p) => p.id === pageId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  await db.transaction(async (tx) => {
    for (const [index, p] of siblings.entries()) await tx.update(manualPages).set({ sort: index + 1 }).where(eq(manualPages.id, p.id));
  });
}

/** Copies a page template from the library into this edition's manual (unpublished, to check first). */
export async function copyPageFromLibrary(actor: Actor, editionId: string, itemId: string) {
  await requireEditionPermission(actor, editionId, 'edit_content', { write: true });
  const db = await getDb();
  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (!item || item.kind !== 'page') throw notFound();
  const data = item.data as { title?: string; bodyHtml?: string };
  return createPage(actor, editionId, { title: data.title || item.name, bodyHtml: data.bodyHtml ?? '', published: false });
}

/** Saves a page as a library template (super admins only). */
export async function savePageToLibrary(actor: Actor, pageId: string) {
  await assertMayAddToLibrary(actor);
  const page = await loadPage(pageId);
  await requireEditionPermission(actor, page.editionId, 'edit_content', { write: true });
  const db = await getDb();
  const [row] = await db
    .insert(libraryItems)
    .values({ kind: 'page', name: page.title, data: { title: page.title, bodyHtml: page.bodyHtml }, createdBy: actor.realUserId })
    .returning();
  await audit(actor, 'library.created', { entityType: 'library_item', entityId: row.id, details: { kind: 'page', from: pageId } });
  return row;
}

// ---------------------------------------------------------------------------
// What exhibitors see
// ---------------------------------------------------------------------------

function visibleTo(typeId: string) {
  return (p: typeof manualPages.$inferSelect) => p.published && (p.visibleToTypes.length === 0 || p.visibleToTypes.includes(typeId));
}

/** Published pages for one stand type, sections first with their pages beneath. */
export async function pagesForType(editionId: string, typeId: string) {
  const db = await getDb();
  const all = await db.select().from(manualPages).where(eq(manualPages.editionId, editionId)).orderBy(asc(manualPages.sort), asc(manualPages.title));
  const visible = all.filter(visibleTo(typeId));
  const ids = new Set(visible.map((p) => p.id));
  // A page inside a hidden section is shown at the top level.
  return visible.map((p) => ({ ...p, parentId: p.parentId && ids.has(p.parentId) ? p.parentId : null }));
}

export async function pageForType(editionId: string, typeId: string, slug: string) {
  const db = await getDb();
  const [page] = await db.select().from(manualPages).where(and(eq(manualPages.editionId, editionId), eq(manualPages.slug, slug))).limit(1);
  if (!page || !visibleTo(typeId)(page)) return null;
  return page;
}
