import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  companies,
  companyMembers,
  editions,
  files,
  manualPages,
  stands,
  submissions,
  taskRequirements,
  tasks,
  users,
  type SubmissionStatus,
  type TaskRequirement,
} from '../db/schema';
import { requireEditionPermission, requireStandAccess } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { appUrl } from '../auth/login';
import { validateAnswers, answerToText } from '@/lib/forms';
import { resolveDeadline } from './editions';
import { assertEditionOpen } from './portal';
import type { Actor } from '../auth/actor';

export type TaskState =
  | 'to_do'
  | 'overdue'
  | 'draft'
  | 'submitted'
  | 'completed'
  | 'approved'
  | 'changes_needed'
  | 'rejected'
  | 'not_needed';

type TaskRow = typeof tasks.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;
type EditionRow = typeof editions.$inferSelect;

const DONE: SubmissionStatus[] = ['completed', 'approved', 'not_needed'];

/** Where a stand is with a task, its deadline and whether the exhibitor can still change it. */
export function taskState(task: TaskRow, sub: SubmissionRow | null, edition: EditionRow, now = new Date()) {
  const deadline = sub?.deadlineOverrideAt ?? resolveDeadline(task, edition);
  const reopened = Boolean(sub?.reopenedUntil && sub.reopenedUntil > now);
  const pastDeadline = Boolean(deadline && now > deadline);
  const status = sub?.status ?? null;
  let state: TaskState;
  if (!status || status === 'draft') state = pastDeadline ? 'overdue' : status === 'draft' ? 'draft' : 'to_do';
  else state = status as TaskState;

  let lockedReason: string | null = null;
  if (status === 'approved' && !reopened) lockedReason = 'This has been approved. Ask the show team if you need to change it.';
  else if (status === 'rejected' && !reopened) lockedReason = 'The show team has closed this. Contact them if you need to change it.';
  else if (status !== 'changes_needed' && pastDeadline && task.locksAtDeadline && !reopened) {
    lockedReason = 'The deadline has passed. Contact the show team if you still need to send this.';
  }
  return { state, deadline, pastDeadline, editable: !lockedReason, lockedReason, done: Boolean(status && DONE.includes(status)) };
}

// ---------------------------------------------------------------------------
// Exhibitor side
// ---------------------------------------------------------------------------

/** The tasks a stand has to do (by its type), with their state, in the team's order. */
export async function checklistForStand(actor: Actor, standId: string) {
  const { stand } = await requireStandAccess(actor, standId);
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, stand.editionId)).limit(1);
  const rows = await db
    .select({ task: tasks, requirement: taskRequirements.requirement })
    .from(tasks)
    .innerJoin(taskRequirements, and(eq(taskRequirements.taskId, tasks.id), eq(taskRequirements.exhibitorTypeId, stand.exhibitorTypeId)))
    .where(and(eq(tasks.editionId, stand.editionId), eq(tasks.published, true)))
    .orderBy(asc(tasks.sort), asc(tasks.title));
  const subs = rows.length
    ? await db.select().from(submissions).where(and(eq(submissions.standId, standId), inArray(submissions.taskId, rows.map((r) => r.task.id))))
    : [];
  const items = rows.map((r) => {
    const sub = subs.find((s) => s.taskId === r.task.id) ?? null;
    return { task: r.task, requirement: r.requirement as TaskRequirement, submission: sub, ...taskState(r.task, sub, edition) };
  });
  const required = items.filter((i) => i.requirement === 'required');
  return {
    edition,
    items,
    progress: {
      required: required.length,
      requiredDone: required.filter((i) => i.done).length,
      overdue: items.filter((i) => i.state === 'overdue' && i.requirement === 'required').length,
      changesNeeded: items.filter((i) => i.state === 'changes_needed').length,
    },
  };
}

/** One task for one stand, with the saved answers and the names of uploaded files. */
export async function taskForStand(actor: Actor, standId: string, taskId: string) {
  const { stand } = await requireStandAccess(actor, standId);
  const db = await getDb();
  const [row] = await db
    .select({ task: tasks, requirement: taskRequirements.requirement })
    .from(tasks)
    .innerJoin(taskRequirements, and(eq(taskRequirements.taskId, tasks.id), eq(taskRequirements.exhibitorTypeId, stand.exhibitorTypeId)))
    .where(and(eq(tasks.id, taskId), eq(tasks.editionId, stand.editionId), eq(tasks.published, true)))
    .limit(1);
  if (!row) throw notFound();
  const [edition] = await db.select().from(editions).where(eq(editions.id, stand.editionId)).limit(1);
  const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, taskId), eq(submissions.standId, standId))).limit(1);
  const page = row.task.linkedPageId ? (await db.select().from(manualPages).where(eq(manualPages.id, row.task.linkedPageId)).limit(1))[0] : null;
  const fileIds = collectFileIds(row.task.formSchema, sub?.data ?? {});
  const fileRows = fileIds.length ? await db.select({ id: files.id, name: files.originalName, size: files.sizeBytes }).from(files).where(inArray(files.id, fileIds)) : [];
  return {
    task: row.task,
    requirement: row.requirement as TaskRequirement,
    submission: sub ?? null,
    page: page && page.published ? page : null,
    files: Object.fromEntries(fileRows.map((f) => [f.id, { name: f.name, size: f.size }])),
    ...taskState(row.task, sub ?? null, edition),
  };
}

function collectFileIds(fields: TaskRow['formSchema'], data: Record<string, unknown>) {
  return fields.filter((f) => f.type === 'file').flatMap((f) => (Array.isArray(data[f.id]) ? (data[f.id] as string[]) : []));
}

/** Saves answers as a draft, or submits them. Submitting checks required questions and every uploaded file. */
export async function saveAnswers(actor: Actor, standId: string, taskId: string, data: Record<string, unknown>, opts: { submit: boolean }) {
  const { stand } = await requireStandAccess(actor, standId, { write: true });
  await assertEditionOpen(actor, stand.editionId);
  const t = await taskForStand(actor, standId, taskId);
  if (!t.editable) throw forbidden(t.lockedReason ?? 'This can no longer be changed.');
  if (!['form', 'upload', 'declaration'].includes(t.task.kind)) throw invalid('This task is completed in another part of BluePrint.');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw invalid('Something was wrong with your answers. Please try again.');

  const result = validateAnswers(t.task.formSchema, data, { submit: opts.submit });
  if (!result.ok) throw invalid(opts.submit ? 'Please answer the highlighted questions.' : 'Some answers need fixing.', result.errors);

  // Every attached file must be an upload for this stand that passed its checks.
  const db = await getDb();
  if (result.fileIds.length) {
    const rows = await db.select().from(files).where(inArray(files.id, result.fileIds));
    const ok = rows.filter((f) => f.verifiedAt && !f.deletedAt && f.purpose === 'submission' && f.standId === standId);
    if (ok.length !== new Set(result.fileIds).size) throw invalid('One of the files could not be found. Please upload it again.');
  }
  // Declarations are signed at the moment of submitting.
  if (opts.submit) {
    for (const f of t.task.formSchema) {
      const d = result.clean[f.id] as { agreed?: boolean; name?: string } | undefined;
      if (f.type === 'declaration' && d?.agreed) result.clean[f.id] = { agreed: true, name: d.name ?? '', signedAt: new Date().toISOString() };
    }
  }

  const status: SubmissionStatus = opts.submit ? (t.task.requiresApproval ? 'submitted' : 'completed') : t.submission && t.submission.status !== 'draft' ? t.submission.status : 'draft';
  if (!opts.submit && t.submission && t.submission.status !== 'draft' && t.submission.status !== 'changes_needed') {
    // Editing something already sent: keep it sent; the change only counts when submitted again.
    throw conflict('This has already been sent. Submit your changes to update it.');
  }
  const now = new Date();
  const values = {
    data: result.clean,
    status,
    ...(opts.submit ? { submittedBy: actor.realUserId, submittedAt: now, reviewedBy: null, reviewedAt: null } : {}),
  };
  let row: SubmissionRow;
  if (t.submission) {
    [row] = await db
      .update(submissions)
      .set({ ...values, version: opts.submit ? t.submission.version + 1 : t.submission.version })
      .where(eq(submissions.id, t.submission.id))
      .returning();
  } else {
    [row] = await db
      .insert(submissions)
      .values({ taskId, standId, ...values, version: opts.submit ? 1 : 0 })
      .returning();
  }
  await audit(actor, opts.submit ? 'submission.submitted' : 'submission.saved', {
    entityType: 'submission',
    entityId: row.id,
    editionId: stand.editionId,
    companyId: stand.companyId,
    details: { task: t.task.title, version: row.version, late: Boolean(t.deadline && now > t.deadline) },
  });
  return row;
}

/** Marks a task done without a form: "not needed" for optional tasks, or "read" for information tasks. */
export async function markTask(actor: Actor, standId: string, taskId: string, mark: 'not_needed' | 'read' | 'undo') {
  const { stand } = await requireStandAccess(actor, standId, { write: true });
  await assertEditionOpen(actor, stand.editionId);
  const t = await taskForStand(actor, standId, taskId);
  if (!t.editable) throw forbidden(t.lockedReason ?? 'This can no longer be changed.');
  let status: SubmissionStatus;
  if (mark === 'not_needed') {
    if (t.requirement === 'required') throw invalid('This task is required for your stand.');
    status = 'not_needed';
  } else if (mark === 'read') {
    if (t.task.kind !== 'info') throw invalid('This task needs answers.');
    status = 'completed';
  } else {
    const undoable = t.submission && (t.submission.status === 'not_needed' || (t.task.kind === 'info' && t.submission.status === 'completed'));
    if (!undoable) throw invalid('There is nothing to undo.');
    status = 'draft';
  }
  const db = await getDb();
  if (t.submission) {
    await db.update(submissions).set({ status, submittedBy: actor.realUserId, submittedAt: new Date() }).where(eq(submissions.id, t.submission.id));
  } else {
    await db.insert(submissions).values({ taskId, standId, status, submittedBy: actor.realUserId, submittedAt: new Date() });
  }
  await audit(actor, `submission.${mark}`, { entityType: 'task', entityId: taskId, editionId: stand.editionId, companyId: stand.companyId });
}

// ---------------------------------------------------------------------------
// Show team side
// ---------------------------------------------------------------------------

/** Every stand a task applies to, with what each has sent. */
export async function responsesForTask(actor: Actor, taskId: string) {
  const db = await getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound();
  await requireEditionPermission(actor, task.editionId, 'view');
  const [edition] = await db.select().from(editions).where(eq(editions.id, task.editionId)).limit(1);
  const reqs = await db.select().from(taskRequirements).where(eq(taskRequirements.taskId, taskId));
  const typeIds = reqs.map((r) => r.exhibitorTypeId);
  const standRows = typeIds.length
    ? await db
        .select({ stand: stands, company: companies })
        .from(stands)
        .leftJoin(companies, eq(companies.id, stands.companyId))
        .where(and(eq(stands.editionId, task.editionId), eq(stands.status, 'active'), inArray(stands.exhibitorTypeId, typeIds)))
        .orderBy(asc(stands.number))
    : [];
  const subs = await db.select().from(submissions).where(eq(submissions.taskId, taskId));
  const rows = standRows.map((r) => {
    const sub = subs.find((s) => s.standId === r.stand.id) ?? null;
    const state = taskState(task, sub, edition);
    return {
      stand: r.stand,
      company: r.company,
      requirement: reqs.find((x) => x.exhibitorTypeId === r.stand.exhibitorTypeId)!.requirement,
      submission: sub,
      state: state.state,
      deadline: state.deadline,
      late: Boolean(sub?.submittedAt && state.deadline && sub.submittedAt > state.deadline),
    };
  });
  return { task, edition, rows };
}

export async function submissionForStaff(actor: Actor, taskId: string, standId: string) {
  const db = await getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound();
  await requireEditionPermission(actor, task.editionId, 'view');
  const [stand] = await db.select().from(stands).where(and(eq(stands.id, standId), eq(stands.editionId, task.editionId))).limit(1);
  if (!stand) throw notFound();
  const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, taskId), eq(submissions.standId, standId))).limit(1);
  const fileIds = collectFileIds(task.formSchema, sub?.data ?? {});
  const fileRows = fileIds.length ? await db.select({ id: files.id, name: files.originalName, size: files.sizeBytes }).from(files).where(inArray(files.id, fileIds)) : [];
  const [submitter] = sub?.submittedBy ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, sub.submittedBy)).limit(1) : [];
  return { task, stand, submission: sub ?? null, submitter: submitter ?? null, files: Object.fromEntries(fileRows.map((f) => [f.id, { name: f.name, size: f.size }])) };
}

export const REVIEW_OUTCOMES = ['approved', 'changes_needed', 'rejected', 'not_needed', 'completed'] as const;

async function notifyCompany(editionId: string, standId: string, subject: string, paragraphs: string[], path: string) {
  const db = await getDb();
  const [stand] = await db.select().from(stands).where(eq(stands.id, standId)).limit(1);
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!stand?.companyId || !edition) return;
  const people = await db
    .select({ email: users.email, id: users.id, role: companyMembers.role })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(and(eq(companyMembers.companyId, stand.companyId), eq(users.status, 'active')));
  const { html, text } = renderSimpleEmail({
    heading: subject,
    paragraphs,
    button: { label: 'Open BluePrint', url: appUrl(path) },
    footer: edition.branding.footerText || `${edition.name} · stand ${stand.number}`,
    brandColor: edition.branding.primaryColor,
  });
  for (const p of people) {
    await sendEmail({ to: p.email, toUserId: p.id, editionId, companyId: stand.companyId, standId, templateKey: 'submission_reviewed', category: 'transactional', subject, html, text });
  }
}

/** The show team's decision on a submission. Changes-needed and rejected decisions email the exhibitor with the note. */
export async function reviewSubmission(actor: Actor, taskId: string, standId: string, outcome: (typeof REVIEW_OUTCOMES)[number], note: string | null) {
  const db = await getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound();
  await requireEditionPermission(actor, task.editionId, 'manage_exhibitors', { write: true });
  const [stand] = await db.select().from(stands).where(and(eq(stands.id, standId), eq(stands.editionId, task.editionId))).limit(1);
  if (!stand) throw notFound();
  if (!(REVIEW_OUTCOMES as readonly string[]).includes(outcome)) throw invalid('Choose a decision.');
  const clean = note?.trim().slice(0, 4000) || null;
  if ((outcome === 'changes_needed' || outcome === 'rejected') && !clean) throw invalid('Tell the exhibitor what needs to change.', { note: 'Add a note for the exhibitor.' });
  const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, taskId), eq(submissions.standId, standId))).limit(1);
  const now = new Date();
  const values = { status: outcome as SubmissionStatus, reviewedBy: actor.realUserId, reviewedAt: now, reviewNote: clean, reopenedUntil: null };
  if (sub) await db.update(submissions).set(values).where(eq(submissions.id, sub.id));
  else await db.insert(submissions).values({ taskId, standId, ...values });
  await audit(actor, `submission.${outcome}`, { entityType: 'task', entityId: taskId, editionId: task.editionId, companyId: stand.companyId, details: { stand: stand.number, note: clean } });

  const [edition] = await db.select().from(editions).where(eq(editions.id, task.editionId)).limit(1);
  const path = `/portal/${edition.slug}/tasks/${task.id}`;
  if (outcome === 'changes_needed') {
    await notifyCompany(task.editionId, standId, `Changes needed: ${task.title}`, [`The ${edition.name} team has looked at “${task.title}” for stand ${stand.number} and needs some changes.`, `Their note: ${clean}`], path);
  } else if (outcome === 'rejected') {
    await notifyCompany(task.editionId, standId, `Not accepted: ${task.title}`, [`The ${edition.name} team could not accept “${task.title}” for stand ${stand.number}.`, `Their note: ${clean}`], path);
  } else if (outcome === 'approved' && task.requiresApproval) {
    await notifyCompany(task.editionId, standId, `Approved: ${task.title}`, [`Good news: “${task.title}” for stand ${stand.number} has been approved.`, ...(clean ? [`Note from the team: ${clean}`] : [])], path);
  }
}

/** Lets one stand change its answers again, until a date, even after the deadline or approval. */
export async function reopenForStand(actor: Actor, taskId: string, standId: string, until: Date) {
  const db = await getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound();
  await requireEditionPermission(actor, task.editionId, 'manage_exhibitors', { write: true });
  if (!(until instanceof Date) || Number.isNaN(until.getTime()) || until < new Date()) throw invalid('Choose a date in the future.');
  const [stand] = await db.select().from(stands).where(and(eq(stands.id, standId), eq(stands.editionId, task.editionId))).limit(1);
  if (!stand) throw notFound();
  const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, taskId), eq(submissions.standId, standId))).limit(1);
  if (sub) await db.update(submissions).set({ reopenedUntil: until }).where(eq(submissions.id, sub.id));
  else await db.insert(submissions).values({ taskId, standId, status: 'draft', reopenedUntil: until });
  await audit(actor, 'submission.reopened', { entityType: 'task', entityId: taskId, editionId: task.editionId, companyId: stand.companyId, details: { stand: stand.number, until: until.toISOString() } });
}

/** A later deadline for one stand only (null puts it back to the task's deadline). */
export async function extendDeadlineForStand(actor: Actor, taskId: string, standId: string, at: Date | null) {
  const db = await getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound();
  await requireEditionPermission(actor, task.editionId, 'manage_exhibitors', { write: true });
  if (at && (Number.isNaN(at.getTime()) || at < new Date())) throw invalid('Choose a date in the future.');
  const [stand] = await db.select().from(stands).where(and(eq(stands.id, standId), eq(stands.editionId, task.editionId))).limit(1);
  if (!stand) throw notFound();
  const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, taskId), eq(submissions.standId, standId))).limit(1);
  if (sub) await db.update(submissions).set({ deadlineOverrideAt: at }).where(eq(submissions.id, sub.id));
  else await db.insert(submissions).values({ taskId, standId, status: 'draft', deadlineOverrideAt: at });
  await audit(actor, 'submission.deadline_extended', { entityType: 'task', entityId: taskId, editionId: task.editionId, companyId: stand.companyId, details: { stand: stand.number, until: at?.toISOString() ?? null } });
}

/** Rows for a spreadsheet of every answer to a task. */
export async function exportResponses(actor: Actor, taskId: string) {
  const { task, rows } = await responsesForTask(actor, taskId);
  const access = await requireEditionPermission(actor, task.editionId, 'view');
  if (!access.permissions.has('view_reports') && !access.permissions.has('manage_exhibitors')) throw forbidden();
  const db = await getDb();
  const fileIds = rows.flatMap((r) => collectFileIds(task.formSchema, r.submission?.data ?? {}));
  const names = fileIds.length ? Object.fromEntries((await db.select({ id: files.id, name: files.originalName }).from(files).where(inArray(files.id, fileIds))).map((f) => [f.id, f.name])) : {};
  const questions = task.formSchema.filter((f) => f.type !== 'heading');
  const header = ['Stand', 'Company', 'Status', 'Submitted', 'Late', ...questions.map((q) => q.label)];
  const body = rows.map((r) => [
    r.stand.number,
    r.company?.name ?? '',
    r.state,
    r.submission?.submittedAt ? r.submission.submittedAt.toISOString() : '',
    r.late ? 'Yes' : '',
    ...questions.map((q) => answerToText(q, r.submission?.data?.[q.id], names)),
  ]);
  await audit(actor, 'submission.exported', { entityType: 'task', entityId: taskId, editionId: task.editionId, details: { rows: body.length } });
  return { task, header, body };
}
