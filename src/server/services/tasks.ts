import 'server-only';
import { and, asc, count, eq, inArray, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import {
  editions,
  exhibitorTypes,
  libraryItems,
  manualPages,
  serviceCategories,
  stands,
  submissions,
  taskRequirements,
  tasks,
  TASK_KINDS,
  type FormField,
  type TaskRequirement,
} from '../db/schema';
import { requireEditionPermission } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { sanitizeRichText } from '../security/sanitize';
import { formSchemaSchema } from '@/lib/forms';
import { parseLocalDateTime } from '@/lib/dates';
import { resolveDeadline } from './editions';
import { syncOrderTaskForAllStands } from './orders';
import { assertMayAddToLibrary } from './library';
import type { Actor } from '../auth/actor';

export const REQUIREMENT_CHOICES = ['required', 'if_applicable', 'optional', 'hidden'] as const;

export const taskSchema = z.object({
  title: z.string().trim().min(2, 'Give the task a title.').max(200),
  descriptionHtml: z.string().max(100_000).default(''),
  kind: z.enum(TASK_KINDS),
  formSchema: formSchemaSchema.default([]),
  deadline: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('none') }),
    z.object({ mode: z.literal('offset'), offsetDays: z.number().int().min(-60, 'At most 60 days after build-up.').max(365, 'At most a year before build-up.') }),
    z.object({ mode: z.literal('fixed'), at: z.string().min(1, 'Choose a date.') }),
  ]),
  requiresApproval: z.boolean().default(false),
  locksAtDeadline: z.boolean().default(true),
  linkedPageId: z.string().uuid().nullable().optional(),
  linkedCategoryId: z.string().uuid().nullable().optional(),
  reminderOffsets: z.array(z.number().int().min(1).max(365)).max(6).nullable().optional(),
  published: z.boolean().default(false),
  requirements: z.record(z.string().uuid(), z.enum(REQUIREMENT_CHOICES)).default({}),
});

export type TaskInput = z.input<typeof taskSchema>;

function checkKind(kind: (typeof TASK_KINDS)[number], fields: FormField[], published: boolean) {
  if (!published) return;
  const inputs = fields.filter((f) => f.type !== 'heading');
  if (kind === 'form' && !inputs.length) throw invalid('Add at least one question before publishing this form.');
  if (kind === 'upload' && !fields.some((f) => f.type === 'file')) throw invalid('An upload task needs a file upload question.');
  if (kind === 'declaration' && !fields.some((f) => f.type === 'declaration')) throw invalid('A declaration task needs a declaration.');
}

async function checkLinks(editionId: string, data: z.infer<typeof taskSchema>) {
  const db = await getDb();
  if (data.linkedPageId) {
    const [p] = await db.select({ id: manualPages.id }).from(manualPages).where(and(eq(manualPages.id, data.linkedPageId), eq(manualPages.editionId, editionId))).limit(1);
    if (!p) throw invalid('Choose a manual page from this show.');
  }
  if (data.linkedCategoryId) {
    const [c] = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(and(eq(serviceCategories.id, data.linkedCategoryId), eq(serviceCategories.editionId, editionId)))
      .limit(1);
    if (!c) throw invalid('Choose a service category from this show.');
  }
  if (data.kind === 'order' && !data.linkedCategoryId && data.published) throw invalid('Choose the service category this order task is for.');
  const typeRows = await db.select({ id: exhibitorTypes.id }).from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId));
  const ok = new Set(typeRows.map((t) => t.id));
  if (Object.keys(data.requirements).some((t) => !ok.has(t))) throw invalid('Choose stand types from this show.');
}

function deadlineColumns(d: z.infer<typeof taskSchema>['deadline']) {
  if (d.mode === 'offset') return { deadlineOffsetDays: d.offsetDays, deadlineAt: null };
  if (d.mode === 'fixed') {
    const at = parseLocalDateTime(d.at);
    if (!at) throw invalid('Enter a valid deadline.', { deadline: 'Enter a valid deadline.' });
    return { deadlineOffsetDays: null, deadlineAt: at };
  }
  return { deadlineOffsetDays: null, deadlineAt: null };
}

async function writeRequirements(db: DbLike, taskId: string, reqs: Record<string, string>) {
  await db.delete(taskRequirements).where(eq(taskRequirements.taskId, taskId));
  const rows = Object.entries(reqs)
    .filter(([, r]) => r !== 'hidden')
    .map(([exhibitorTypeId, requirement]) => ({ taskId, exhibitorTypeId, requirement: requirement as TaskRequirement }));
  if (rows.length) await db.insert(taskRequirements).values(rows);
}

/** Every task in an edition with who it applies to and how far exhibitors have got. */
export async function listTasks(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw notFound();
  const rows = await db.select().from(tasks).where(eq(tasks.editionId, editionId)).orderBy(asc(tasks.sort), asc(tasks.title));
  const reqs = rows.length ? await db.select().from(taskRequirements).where(inArray(taskRequirements.taskId, rows.map((t) => t.id))) : [];
  const standCounts = await db
    .select({ typeId: stands.exhibitorTypeId, n: count() })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .groupBy(stands.exhibitorTypeId);
  const standsByType = new Map(standCounts.map((s) => [s.typeId, Number(s.n)]));
  const subCounts = rows.length
    ? await db
        .select({ taskId: submissions.taskId, status: submissions.status, n: count() })
        .from(submissions)
        .innerJoin(stands, eq(stands.id, submissions.standId))
        .where(and(inArray(submissions.taskId, rows.map((t) => t.id)), eq(stands.status, 'active')))
        .groupBy(submissions.taskId, submissions.status)
    : [];
  return rows.map((t) => {
    const r = reqs.filter((x) => x.taskId === t.id);
    const applicable = r.reduce((n, x) => n + (standsByType.get(x.exhibitorTypeId) ?? 0), 0);
    const counts = Object.fromEntries(subCounts.filter((c) => c.taskId === t.id).map((c) => [c.status, Number(c.n)])) as Record<string, number>;
    const done = (counts.completed ?? 0) + (counts.approved ?? 0) + (counts.not_needed ?? 0);
    return {
      task: t,
      requirements: Object.fromEntries(r.map((x) => [x.exhibitorTypeId, x.requirement])) as Record<string, TaskRequirement>,
      deadline: resolveDeadline(t, edition),
      applicable,
      done,
      awaitingReview: counts.submitted ?? 0,
      changesNeeded: counts.changes_needed ?? 0,
    };
  });
}

async function loadTask(taskId: string) {
  const db = await getDb();
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw notFound();
  return row;
}

export async function getTask(actor: Actor, taskId: string) {
  const task = await loadTask(taskId);
  await requireEditionPermission(actor, task.editionId, 'view');
  const db = await getDb();
  const reqs = await db.select().from(taskRequirements).where(eq(taskRequirements.taskId, taskId));
  return { task, requirements: Object.fromEntries(reqs.map((r) => [r.exhibitorTypeId, r.requirement])) as Record<string, TaskRequirement> };
}

export async function createTask(actor: Actor, editionId: string, input: TaskInput) {
  await requireEditionPermission(actor, editionId, 'edit_content', { write: true });
  const data = taskSchema.parse(input);
  checkKind(data.kind, data.formSchema, data.published);
  await checkLinks(editionId, data);
  const db = await getDb();
  const [{ top }] = await db.select({ top: max(tasks.sort) }).from(tasks).where(eq(tasks.editionId, editionId));
  const row = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tasks)
      .values({
        editionId,
        title: data.title,
        descriptionHtml: sanitizeRichText(data.descriptionHtml),
        kind: data.kind,
        formSchema: data.formSchema,
        ...deadlineColumns(data.deadline),
        requiresApproval: data.requiresApproval,
        locksAtDeadline: data.locksAtDeadline,
        linkedPageId: data.linkedPageId ?? null,
        linkedCategoryId: data.linkedCategoryId ?? null,
        reminderOffsets: data.reminderOffsets?.length ? data.reminderOffsets : null,
        published: data.published,
        sort: (top ?? 0) + 1,
      })
      .returning();
    await writeRequirements(tx, t.id, data.requirements);
    return t;
  });
  if (row.kind === 'order') await syncOrderTaskForAllStands(row.id);
  await audit(actor, 'task.created', { entityType: 'task', entityId: row.id, editionId, details: { title: row.title, kind: row.kind } });
  return row;
}

export async function updateTask(actor: Actor, taskId: string, input: TaskInput) {
  const task = await loadTask(taskId);
  await requireEditionPermission(actor, task.editionId, 'edit_content', { write: true });
  const data = taskSchema.parse(input);
  checkKind(data.kind, data.formSchema, data.published);
  await checkLinks(task.editionId, data);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        title: data.title,
        descriptionHtml: sanitizeRichText(data.descriptionHtml),
        kind: data.kind,
        formSchema: data.formSchema,
        ...deadlineColumns(data.deadline),
        requiresApproval: data.requiresApproval,
        locksAtDeadline: data.locksAtDeadline,
        linkedPageId: data.linkedPageId ?? null,
        linkedCategoryId: data.linkedCategoryId ?? null,
        reminderOffsets: data.reminderOffsets?.length ? data.reminderOffsets : null,
        published: data.published,
      })
      .where(eq(tasks.id, taskId));
    await writeRequirements(tx, taskId, data.requirements);
  });
  if (data.kind === 'order' && (task.kind !== 'order' || task.linkedCategoryId !== (data.linkedCategoryId ?? null))) await syncOrderTaskForAllStands(taskId);
  await audit(actor, 'task.updated', { entityType: 'task', entityId: taskId, editionId: task.editionId, details: { title: data.title, published: data.published } });
}

/** Tasks that exhibitors have already answered are unpublished rather than deleted, so answers are never lost by accident. */
export async function deleteTask(actor: Actor, taskId: string) {
  const task = await loadTask(taskId);
  await requireEditionPermission(actor, task.editionId, 'edit_content', { write: true });
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(submissions)
    .where(and(eq(submissions.taskId, taskId), ne(submissions.status, 'draft')));
  if (Number(n) > 0) throw conflict('Exhibitors have already answered this task. Unpublish it instead, so their answers are kept.');
  await db.delete(tasks).where(eq(tasks.id, taskId));
  await audit(actor, 'task.deleted', { entityType: 'task', entityId: taskId, editionId: task.editionId, details: { title: task.title } });
}

export async function moveTask(actor: Actor, taskId: string, direction: 'up' | 'down') {
  const task = await loadTask(taskId);
  await requireEditionPermission(actor, task.editionId, 'edit_content', { write: true });
  const db = await getDb();
  const all = await db.select().from(tasks).where(eq(tasks.editionId, task.editionId)).orderBy(asc(tasks.sort), asc(tasks.title));
  const i = all.findIndex((t) => t.id === taskId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [index, t] of all.entries()) await tx.update(tasks).set({ sort: index + 1 }).where(eq(tasks.id, t.id));
  });
}

type LibraryTask = {
  title: string;
  descriptionHtml: string;
  kind: (typeof TASK_KINDS)[number];
  formSchema: FormField[];
  deadlineOffsetDays: number | null;
  requiresApproval: boolean;
  locksAtDeadline: boolean;
  /** Requirement by built-in type key (shell_scheme, space_only). */
  requirementsByKey: Record<string, TaskRequirement>;
};

/** Copies a task template from the library (unpublished, so the team can check it first). */
export async function copyTaskFromLibrary(actor: Actor, editionId: string, itemId: string) {
  await requireEditionPermission(actor, editionId, 'edit_content', { write: true });
  const db = await getDb();
  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
  if (!item || item.kind !== 'task') throw notFound();
  const d = item.data as Partial<LibraryTask>;
  const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId));
  const requirements: Record<string, (typeof REQUIREMENT_CHOICES)[number]> = {};
  for (const t of types) requirements[t.id] = d.requirementsByKey?.[t.key] ?? 'hidden';
  const parsed = formSchemaSchema.safeParse(d.formSchema ?? []);
  return createTask(actor, editionId, {
    title: d.title || item.name,
    descriptionHtml: d.descriptionHtml ?? '',
    kind: d.kind && (TASK_KINDS as readonly string[]).includes(d.kind) ? d.kind : 'form',
    formSchema: parsed.success ? parsed.data : [],
    deadline: typeof d.deadlineOffsetDays === 'number' ? { mode: 'offset', offsetDays: d.deadlineOffsetDays } : { mode: 'none' },
    requiresApproval: Boolean(d.requiresApproval),
    locksAtDeadline: d.locksAtDeadline !== false,
    published: false,
    requirements,
  });
}

/** Saves a task as a library template (super admins only). */
export async function saveTaskToLibrary(actor: Actor, taskId: string) {
  await assertMayAddToLibrary(actor);
  const { task, requirements } = await getTask(actor, taskId);
  await requireEditionPermission(actor, task.editionId, 'edit_content', { write: true });
  const db = await getDb();
  const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, task.editionId));
  const requirementsByKey = Object.fromEntries(types.filter((t) => requirements[t.id]).map((t) => [t.key, requirements[t.id]]));
  const data: LibraryTask = {
    title: task.title,
    descriptionHtml: task.descriptionHtml,
    kind: task.kind,
    formSchema: task.formSchema,
    deadlineOffsetDays: task.deadlineOffsetDays,
    requiresApproval: task.requiresApproval,
    locksAtDeadline: task.locksAtDeadline,
    requirementsByKey,
  };
  const [row] = await db.insert(libraryItems).values({ kind: 'task', name: task.title, data, createdBy: actor.realUserId }).returning();
  await audit(actor, 'library.created', { entityType: 'library_item', entityId: row.id, details: { kind: 'task', from: taskId } });
  return row;
}
