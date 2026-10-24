import 'server-only';
import { and, asc, count, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { exhibitorTypes, halls, stands } from '../db/schema';
import { requireEditionPermission, requireShowAdmin } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { slugify } from '@/lib/slug';
import type { Actor } from '../auth/actor';

// ---------------------------------------------------------------------------
// Exhibitor types: shell scheme and space only come with every edition; shows can add more
// (for example "Pavilion" or "Start-up pod"). Each type decides which tasks and pages people see.
// ---------------------------------------------------------------------------

const BUILT_IN = new Set(['shell_scheme', 'space_only']);

export const exhibitorTypeSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name.').max(60),
  description: z.string().trim().max(300).optional().nullable(),
  isSpaceOnly: z.boolean().default(false),
});

export async function listExhibitorTypes(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId)).orderBy(asc(exhibitorTypes.sort), asc(exhibitorTypes.name));
  const counts = await db
    .select({ typeId: stands.exhibitorTypeId, n: count() })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .groupBy(stands.exhibitorTypeId);
  const byType = new Map(counts.map((c) => [c.typeId, Number(c.n)]));
  return types.map((t) => ({ ...t, standCount: byType.get(t.id) ?? 0, builtIn: BUILT_IN.has(t.key) }));
}

export async function createExhibitorType(actor: Actor, editionId: string, input: z.input<typeof exhibitorTypeSchema>) {
  await requireShowAdmin(actor, editionId, { write: true });
  const data = exhibitorTypeSchema.parse(input);
  const db = await getDb();
  const base = slugify(data.name).replace(/-/g, '_') || 'type';
  const existing = new Set((await db.select({ key: exhibitorTypes.key }).from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId))).map((r) => r.key));
  let key = base;
  for (let i = 2; existing.has(key); i++) key = `${base}_${i}`;
  const [{ top }] = await db.select({ top: max(exhibitorTypes.sort) }).from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId));
  const [row] = await db
    .insert(exhibitorTypes)
    .values({ editionId, key, name: data.name, description: data.description ?? null, isSpaceOnly: data.isSpaceOnly, sort: (top ?? 0) + 1 })
    .returning();
  await audit(actor, 'exhibitor_type.created', { entityType: 'exhibitor_type', entityId: row.id, editionId, details: { name: row.name, isSpaceOnly: row.isSpaceOnly } });
  return row;
}

async function loadType(typeId: string) {
  const db = await getDb();
  const [row] = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.id, typeId)).limit(1);
  if (!row) throw notFound();
  return row;
}

export async function updateExhibitorType(actor: Actor, typeId: string, input: z.input<typeof exhibitorTypeSchema>) {
  const type = await loadType(typeId);
  await requireShowAdmin(actor, type.editionId, { write: true });
  const data = exhibitorTypeSchema.parse(input);
  // The two built-in types keep their meaning; only their wording can change.
  const isSpaceOnly = type.key === 'space_only' ? true : type.key === 'shell_scheme' ? false : data.isSpaceOnly;
  const db = await getDb();
  await db.update(exhibitorTypes).set({ name: data.name, description: data.description ?? null, isSpaceOnly }).where(eq(exhibitorTypes.id, typeId));
  await audit(actor, 'exhibitor_type.updated', { entityType: 'exhibitor_type', entityId: typeId, editionId: type.editionId, details: { name: data.name, isSpaceOnly } });
}

export async function deleteExhibitorType(actor: Actor, typeId: string) {
  const type = await loadType(typeId);
  await requireShowAdmin(actor, type.editionId, { write: true });
  if (BUILT_IN.has(type.key)) throw conflict('Shell scheme and space only are part of every show and cannot be deleted. You can rename them.');
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(stands).where(eq(stands.exhibitorTypeId, typeId));
  if (Number(n) > 0) throw conflict('Stands still use this type. Move them to another type first.');
  await db.delete(exhibitorTypes).where(eq(exhibitorTypes.id, typeId));
  await audit(actor, 'exhibitor_type.deleted', { entityType: 'exhibitor_type', entityId: typeId, editionId: type.editionId, details: { name: type.name } });
}

/** Swaps a type with its neighbour, to change the order types are listed in. */
export async function moveExhibitorType(actor: Actor, typeId: string, direction: 'up' | 'down') {
  const type = await loadType(typeId);
  await requireShowAdmin(actor, type.editionId, { write: true });
  const db = await getDb();
  const all = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, type.editionId)).orderBy(asc(exhibitorTypes.sort), asc(exhibitorTypes.name));
  const i = all.findIndex((t) => t.id === typeId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [index, t] of all.entries()) await tx.update(exhibitorTypes).set({ sort: index + 1 }).where(eq(exhibitorTypes.id, t.id));
  });
}

// ---------------------------------------------------------------------------
// Halls
// ---------------------------------------------------------------------------

const hallName = z.string().trim().min(1, 'Enter a hall name.').max(60);

export async function listHalls(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const rows = await db.select().from(halls).where(eq(halls.editionId, editionId)).orderBy(asc(halls.sort), asc(halls.name));
  const counts = await db
    .select({ hallId: stands.hallId, n: count() })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .groupBy(stands.hallId);
  const byHall = new Map(counts.map((c) => [c.hallId, Number(c.n)]));
  return rows.map((h) => ({ ...h, standCount: byHall.get(h.id) ?? 0 }));
}

export async function createHall(actor: Actor, editionId: string, name: string) {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors', { write: true });
  const clean = hallName.parse(name);
  const db = await getDb();
  const [clash] = await db.select().from(halls).where(and(eq(halls.editionId, editionId), eq(halls.name, clean))).limit(1);
  if (clash) throw invalid('There is already a hall with that name.', { name: 'Already used.' });
  const [{ top }] = await db.select({ top: max(halls.sort) }).from(halls).where(eq(halls.editionId, editionId));
  const [row] = await db.insert(halls).values({ editionId, name: clean, sort: (top ?? 0) + 1 }).returning();
  await audit(actor, 'hall.created', { entityType: 'hall', entityId: row.id, editionId, details: { name: clean } });
  return row;
}

async function loadHall(hallId: string) {
  const db = await getDb();
  const [row] = await db.select().from(halls).where(eq(halls.id, hallId)).limit(1);
  if (!row) throw notFound();
  return row;
}

export async function renameHall(actor: Actor, hallId: string, name: string) {
  const hall = await loadHall(hallId);
  await requireEditionPermission(actor, hall.editionId, 'manage_exhibitors', { write: true });
  const clean = hallName.parse(name);
  const db = await getDb();
  const [clash] = await db.select().from(halls).where(and(eq(halls.editionId, hall.editionId), eq(halls.name, clean))).limit(1);
  if (clash && clash.id !== hallId) throw invalid('There is already a hall with that name.', { name: 'Already used.' });
  await db.update(halls).set({ name: clean }).where(eq(halls.id, hallId));
  await audit(actor, 'hall.renamed', { entityType: 'hall', entityId: hallId, editionId: hall.editionId, details: { from: hall.name, to: clean } });
}

export async function deleteHall(actor: Actor, hallId: string) {
  const hall = await loadHall(hallId);
  await requireEditionPermission(actor, hall.editionId, 'manage_exhibitors', { write: true });
  const db = await getDb();
  // Stands in the hall stay; they just no longer have a hall.
  await db.delete(halls).where(eq(halls.id, hallId));
  await audit(actor, 'hall.deleted', { entityType: 'hall', entityId: hallId, editionId: hall.editionId, details: { name: hall.name } });
}

export async function moveHall(actor: Actor, hallId: string, direction: 'up' | 'down') {
  const hall = await loadHall(hallId);
  await requireEditionPermission(actor, hall.editionId, 'manage_exhibitors', { write: true });
  const db = await getDb();
  const all = await db.select().from(halls).where(eq(halls.editionId, hall.editionId)).orderBy(asc(halls.sort), asc(halls.name));
  const i = all.findIndex((h) => h.id === hallId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [index, h] of all.entries()) await tx.update(halls).set({ sort: index + 1 }).where(eq(halls.id, h.id));
  });
}
