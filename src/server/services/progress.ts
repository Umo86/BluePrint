import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { requireEditionPermission } from '../authz';
import type { Actor } from '../auth/actor';
import { companies, editions, exhibitorTypes, halls, stands, submissions, taskRequirements, tasks, type TaskRequirement } from '../db/schema';
import { resolveDeadline } from './editions';
import { taskState, type TaskState } from './submissions';

/**
 * Where every stand is with every task, worked out in one pass for a whole show. Used by the
 * organiser overview, the exhibitors list, the task pages and the reports.
 *
 * This does no permission checks: callers must check the person may see the show first.
 */

export type StandProgress = {
  standId: string;
  number: string;
  companyId: string | null;
  companyName: string | null;
  typeId: string;
  typeName: string;
  isSpaceOnly: boolean;
  hallId: string | null;
  hallName: string | null;
  /** Required tasks for this stand's type, and how many are done (completed, approved or not needed). */
  required: number;
  requiredDone: number;
  /** Required tasks past their deadline and not started or not sent. */
  overdue: number;
  /** Sent and waiting for the team to check. */
  awaitingReview: number;
  /** The team asked for changes. */
  changesNeeded: number;
  /** The soonest deadline of a required or "if it applies" task that is not done yet. */
  nextDeadline: Date | null;
  /** State of each task that applies to this stand, by task id. */
  states: Record<string, { state: TaskState; requirement: TaskRequirement; deadline: Date | null; done: boolean }>;
};

export type TaskProgress = {
  id: string;
  title: string;
  kind: string;
  requiresApproval: boolean;
  /** The show-wide deadline (individual stands may have extensions). */
  deadline: Date | null;
  applies: number;
  required: number;
  done: number;
  awaitingReview: number;
  changesNeeded: number;
  overdue: number;
  notStarted: number;
};

const NOT_STARTED: TaskState[] = ['to_do', 'draft', 'overdue'];

export async function computeEditionProgress(editionId: string, now = new Date(), opts: { standIds?: string[] } = {}) {
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw new Error('Edition not found');
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.editionId, editionId), eq(tasks.published, true)))
    .orderBy(asc(tasks.sort), asc(tasks.title));
  const taskIds = taskRows.map((t) => t.id);
  const reqs = taskIds.length ? await db.select().from(taskRequirements).where(inArray(taskRequirements.taskId, taskIds)) : [];
  const standRows = await db
    .select({
      id: stands.id,
      number: stands.number,
      companyId: stands.companyId,
      companyName: companies.name,
      typeId: exhibitorTypes.id,
      typeName: exhibitorTypes.name,
      isSpaceOnly: exhibitorTypes.isSpaceOnly,
      hallId: halls.id,
      hallName: halls.name,
    })
    .from(stands)
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active'), ...(opts.standIds ? [inArray(stands.id, opts.standIds.length ? opts.standIds : ['00000000-0000-0000-0000-000000000000'])] : [])))
    .orderBy(asc(stands.number));
  const subs = taskIds.length
    ? await db
        .select()
        .from(submissions)
        .where(and(inArray(submissions.taskId, taskIds), ...(opts.standIds ? [inArray(submissions.standId, standRows.length ? standRows.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'])] : [])))
    : [];

  const reqByTaskType = new Map<string, TaskRequirement>();
  for (const r of reqs) reqByTaskType.set(`${r.taskId}:${r.exhibitorTypeId}`, r.requirement as TaskRequirement);
  const subByTaskStand = new Map<string, (typeof subs)[number]>();
  for (const s of subs) subByTaskStand.set(`${s.taskId}:${s.standId}`, s);

  const taskProgress = new Map<string, TaskProgress>(
    taskRows.map((t) => [
      t.id,
      {
        id: t.id,
        title: t.title,
        kind: t.kind,
        requiresApproval: t.requiresApproval,
        deadline: resolveDeadline(t, edition),
        applies: 0,
        required: 0,
        done: 0,
        awaitingReview: 0,
        changesNeeded: 0,
        overdue: 0,
        notStarted: 0,
      },
    ]),
  );

  const standProgress: StandProgress[] = standRows.map((s) => {
    const p: StandProgress = {
      standId: s.id,
      number: s.number,
      companyId: s.companyId,
      companyName: s.companyName,
      typeId: s.typeId,
      typeName: s.typeName,
      isSpaceOnly: s.isSpaceOnly,
      hallId: s.hallId,
      hallName: s.hallName,
      required: 0,
      requiredDone: 0,
      overdue: 0,
      awaitingReview: 0,
      changesNeeded: 0,
      nextDeadline: null,
      states: {},
    };
    for (const t of taskRows) {
      const requirement = reqByTaskType.get(`${t.id}:${s.typeId}`);
      if (!requirement) continue;
      const st = taskState(t, subByTaskStand.get(`${t.id}:${s.id}`) ?? null, edition, now);
      p.states[t.id] = { state: st.state, requirement, deadline: st.deadline, done: st.done };
      const tp = taskProgress.get(t.id)!;
      tp.applies++;
      if (requirement === 'required') {
        p.required++;
        tp.required++;
        if (st.done) p.requiredDone++;
        if (st.state === 'overdue') p.overdue++;
      }
      if (st.done) tp.done++;
      if (st.state === 'submitted') {
        p.awaitingReview++;
        tp.awaitingReview++;
      }
      if (st.state === 'changes_needed') {
        p.changesNeeded++;
        tp.changesNeeded++;
      }
      if (st.state === 'overdue' && requirement !== 'optional') tp.overdue++;
      if (NOT_STARTED.includes(st.state)) tp.notStarted++;
      if (!st.done && requirement !== 'optional' && st.deadline && st.deadline > now && (!p.nextDeadline || st.deadline < p.nextDeadline)) {
        p.nextDeadline = st.deadline;
      }
    }
    return p;
  });

  const tasksOut = [...taskProgress.values()];
  const totals = {
    stands: standProgress.length,
    requiredItems: standProgress.reduce((n, s) => n + s.required, 0),
    requiredDone: standProgress.reduce((n, s) => n + s.requiredDone, 0),
    overdueItems: standProgress.reduce((n, s) => n + s.overdue, 0),
    standsOverdue: standProgress.filter((s) => s.overdue > 0).length,
    standsComplete: standProgress.filter((s) => s.required > 0 && s.requiredDone === s.required).length,
    awaitingReview: standProgress.reduce((n, s) => n + s.awaitingReview, 0),
    changesNeeded: standProgress.reduce((n, s) => n + s.changesNeeded, 0),
  };
  return { edition, tasks: tasksOut, stands: standProgress, totals };
}

export type EditionProgress = Awaited<ReturnType<typeof computeEditionProgress>>;

/** Percentage, rounded down so 99.6% never shows as "100%" while something is still missing. */
export function pct(done: number, total: number) {
  if (!total) return 100;
  return Math.floor((done / total) * 100);
}

/** Groups stand progress by company (a company can have several stands). */
export function progressByCompany(progress: EditionProgress) {
  const map = new Map<string, { required: number; requiredDone: number; overdue: number; awaitingReview: number; changesNeeded: number; nextDeadline: Date | null; standIds: string[] }>();
  for (const s of progress.stands) {
    if (!s.companyId) continue;
    const c = map.get(s.companyId) ?? { required: 0, requiredDone: 0, overdue: 0, awaitingReview: 0, changesNeeded: 0, nextDeadline: null, standIds: [] };
    c.required += s.required;
    c.requiredDone += s.requiredDone;
    c.overdue += s.overdue;
    c.awaitingReview += s.awaitingReview;
    c.changesNeeded += s.changesNeeded;
    if (s.nextDeadline && (!c.nextDeadline || s.nextDeadline < c.nextDeadline)) c.nextDeadline = s.nextDeadline;
    c.standIds.push(s.standId);
    map.set(s.companyId, c);
  }
  return map;
}

/** The checklist of each of a company's stands at a show, for its record on the show dashboard. */
export async function checklistForCompany(actor: Actor, editionId: string, companyId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const own = await db
    .select({ id: stands.id })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), eq(stands.companyId, companyId)));
  const progress = await computeEditionProgress(editionId, new Date(), { standIds: own.map((r) => r.id) });
  return { tasks: progress.tasks, stands: progress.stands };
}
