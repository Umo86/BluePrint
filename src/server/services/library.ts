import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { editionStaff, libraryItems, users } from '../db/schema';
import { assertSuperAdmin, isViewingAs } from '../authz';
import { forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { sanitizeRichText } from '../security/sanitize';
import type { Actor } from '../auth/actor';

export const LIBRARY_KINDS = ['page', 'task', 'email_template', 'catalogue'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const libraryPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyHtml: z.string().max(200_000),
});

export const libraryItemSchema = z.object({
  kind: z.enum(LIBRARY_KINDS),
  name: z.string().trim().min(1, 'Give it a name.').max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  data: z.record(z.string(), z.unknown()),
});

function cleanData(kind: LibraryKind, data: Record<string, unknown>) {
  if (kind === 'page') {
    const page = libraryPageSchema.parse(data);
    return { ...page, bodyHtml: sanitizeRichText(page.bodyHtml) };
  }
  if (kind === 'task' && typeof data.descriptionHtml === 'string') {
    return { ...data, descriptionHtml: sanitizeRichText(data.descriptionHtml) };
  }
  return data;
}

/**
 * Whether the person may save tasks and manual pages from their shows into the shared library:
 * super admins, and anyone a super admin has given the library right.
 */
export async function mayAddToLibrary(actor: Actor) {
  if (actor.readOnly || isViewingAs(actor)) return false;
  if (actor.isSuperAdmin) return true;
  const db = await getDb();
  const [u] = await db.select({ allowed: users.canAddToLibrary, status: users.status }).from(users).where(eq(users.id, actor.userId)).limit(1);
  return Boolean(u?.allowed) && u.status === 'active';
}

export async function assertMayAddToLibrary(actor: Actor) {
  if (!(await mayAddToLibrary(actor))) throw forbidden('Adding to the library needs the library right. A super admin can give it to you.');
}

export async function listLibrary(actor: Actor, kind?: LibraryKind) {
  // Show staff read the library to pull templates into their show; only super admins change it.
  const db = await getDb();
  if (!(actor.isSuperAdmin && !actor.readOnly)) {
    if (isViewingAs(actor)) throw forbidden();
    const [staff] = await db.select().from(editionStaff).where(eq(editionStaff.userId, actor.userId)).limit(1);
    if (!staff) throw forbidden();
  }
  const rows = await db.select().from(libraryItems).orderBy(asc(libraryItems.kind), asc(libraryItems.name));
  return kind ? rows.filter((r) => r.kind === kind) : rows;
}

export async function getLibraryItem(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1);
  if (!row) throw notFound();
  return row;
}

export async function createLibraryItem(actor: Actor, input: z.input<typeof libraryItemSchema>) {
  assertSuperAdmin(actor);
  const data = libraryItemSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(libraryItems)
    .values({ kind: data.kind, name: data.name, description: data.description ?? null, data: cleanData(data.kind, data.data), createdBy: actor.realUserId })
    .returning();
  await audit(actor, 'library.created', { entityType: 'library_item', entityId: row.id, details: { kind: row.kind, name: row.name } });
  return row;
}

export async function updateLibraryItem(actor: Actor, id: string, input: z.input<typeof libraryItemSchema>) {
  assertSuperAdmin(actor);
  const data = libraryItemSchema.parse(input);
  const db = await getDb();
  const [row] = await db
    .update(libraryItems)
    .set({ name: data.name, description: data.description ?? null, data: cleanData(data.kind, data.data) })
    .where(eq(libraryItems.id, id))
    .returning();
  if (!row) throw notFound();
  await audit(actor, 'library.updated', { entityType: 'library_item', entityId: id });
  return row;
}

export async function deleteLibraryItem(actor: Actor, id: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.delete(libraryItems).where(eq(libraryItems.id, id));
  await audit(actor, 'library.deleted', { entityType: 'library_item', entityId: id });
}
