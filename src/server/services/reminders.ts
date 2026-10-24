import 'server-only';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  companies,
  companyMembers,
  editions,
  orders,
  reminderLog,
  spaceOnlyPacks,
  stands,
  submissions,
  taskRequirements,
  tasks,
  users,
} from '../db/schema';
import { editionStaffWith } from '../authz';
import { appUrl } from '../auth/login';
import { sendEmail } from '../email/send';
import { renderEmail, type DueItem } from '../email/render';
import { brandingFor, renderTemplate, senderFor } from '../email/templates';
import { env } from '../env';
import { getPlatformSettings } from './settings';
import { resolveDeadline } from './editions';
import { money } from '@/lib/format';

const DAY = 86_400_000;
// Nothing to chase: finished, not needed, waiting for the team, or closed by the team.
const DONE = new Set(['completed', 'approved', 'not_needed', 'submitted', 'rejected']);

type EditionRow = typeof editions.$inferSelect;

/** Which reminder step applies now: the closest "days before" step that has passed, or overdue. */
export function reminderStep(deadline: Date, offsets: number[], now: Date): string | null {
  if (now.getTime() > deadline.getTime()) return 'overdue';
  const passed = offsets.filter((k) => deadline.getTime() - k * DAY <= now.getTime());
  return passed.length ? `d${Math.min(...passed)}` : null;
}

/**
 * The friendly reminder ladder. Once a day, each stand with tasks coming up (14, 7 and 1 days
 * before by default, or the task's own steps) or overdue gets one email listing what is left.
 * Each step is recorded before sending, so a stand never gets the same reminder twice.
 */
export async function runReminders(now = new Date()) {
  const db = await getDb();
  const live = await db.select().from(editions).where(inArray(editions.status, ['live', 'onsite']));
  const settings = await getPlatformSettings();
  let emails = 0;
  let standsReminded = 0;
  for (const edition of live) {
    const r = await remindersForEdition(edition, settings.reminderOffsets, now);
    emails += r.emails;
    standsReminded += r.stands;
  }
  return { editions: live.length, stands: standsReminded, emails };
}

async function remindersForEdition(edition: EditionRow, defaultOffsets: number[], now: Date) {
  const db = await getDb();
  const taskRows = (await db.select().from(tasks).where(and(eq(tasks.editionId, edition.id), eq(tasks.published, true)))).filter((t) => resolveDeadline(t, edition));
  if (!taskRows.length) return { emails: 0, stands: 0 };
  const reqs = await db
    .select()
    .from(taskRequirements)
    .where(
      and(
        inArray(
          taskRequirements.taskId,
          taskRows.map((t) => t.id),
        ),
        inArray(taskRequirements.requirement, ['required', 'if_applicable']),
      ),
    );
  const standRows = await db
    .select({ stand: stands, company: companies })
    .from(stands)
    .innerJoin(companies, eq(companies.id, stands.companyId))
    .where(and(eq(stands.editionId, edition.id), eq(stands.status, 'active')));
  if (!standRows.length) return { emails: 0, stands: 0 };
  const subs = await db
    .select()
    .from(submissions)
    .where(
      inArray(
        submissions.taskId,
        taskRows.map((t) => t.id),
      ),
    );
  const subFor = new Map(subs.map((s) => [`${s.taskId}:${s.standId}`, s]));
  const base = `/portal/${edition.slug}`;
  let emails = 0;
  let reminded = 0;

  for (const { stand, company } of standRows) {
    const outstanding: { task: (typeof taskRows)[number]; deadline: Date }[] = [];
    for (const t of taskRows) {
      if (!reqs.some((r) => r.taskId === t.id && r.exhibitorTypeId === stand.exhibitorTypeId)) continue;
      const sub = subFor.get(`${t.id}:${stand.id}`);
      if (sub && DONE.has(sub.status)) continue;
      const deadline = sub?.deadlineOverrideAt ?? resolveDeadline(t, edition);
      if (deadline) outstanding.push({ task: t, deadline });
    }
    if (!outstanding.length) continue;

    // Record each newly reached step first; only steps recorded now trigger an email.
    let triggered = 0;
    const people = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.role, 'main_contact'), eq(users.status, 'active')));
    if (!people.length) continue;
    for (const o of outstanding) {
      const step = reminderStep(o.deadline, o.task.reminderOffsets ?? defaultOffsets, now);
      if (!step) continue;
      const inserted = await db
        .insert(reminderLog)
        .values({ editionId: edition.id, standId: stand.id, subject: `task:${o.task.id}`, step, channel: 'email' })
        .onConflictDoNothing()
        .returning({ id: reminderLog.id });
      if (inserted.length) triggered += 1;
    }
    if (!triggered) continue;

    // The email lists everything still to do that is overdue or due within the next month.
    const due: DueItem[] = outstanding
      .filter((o) => o.deadline.getTime() - now.getTime() < 30 * DAY)
      .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
      .slice(0, 15)
      .map((o) => ({
        title: o.task.title,
        due: o.deadline.toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: edition.timezone }),
        url: appUrl(`${base}/tasks/${o.task.id}`),
        overdue: o.deadline.getTime() < now.getTime(),
      }));
    const sender = await senderFor(edition, 'reminder');
    for (const p of people) {
      const { subject, html, text } = await renderTemplate(
        edition,
        'reminder_digest',
        { first_name: (p.name || '').split(' ')[0] || 'there', name: p.name, company: company.name, stand: stand.number, portal_link: appUrl(`${base}/checklist`), count: `${due.length} ${due.length === 1 ? 'thing' : 'things'}` },
        { due },
      );
      const r = await sendEmail({ to: p.email, toUserId: p.id, editionId: edition.id, companyId: company.id, standId: stand.id, templateKey: 'reminder_digest', category: 'reminder', subject, html, text, from: sender.from, replyTo: sender.replyTo });
      if (r.status === 'sent') emails += 1;
    }
    reminded += 1;
  }
  return { emails, stands: reminded };
}

/**
 * A short morning summary for each show's team: what is waiting for them and what came in
 * yesterday. Sent once a day, and only when there is something to say.
 */
export async function runStaffDigest(now = new Date()) {
  const db = await getDb();
  const live = await db.select().from(editions).where(inArray(editions.status, ['live', 'onsite']));
  const since = new Date(now.getTime() - DAY);
  const day = now.toISOString().slice(0, 10);
  let sent = 0;
  for (const edition of live) {
    const [toReview] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(submissions)
      .innerJoin(tasks, eq(tasks.id, submissions.taskId))
      .where(and(eq(tasks.editionId, edition.id), eq(submissions.status, 'submitted'), eq(tasks.requiresApproval, true)));
    const [packs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spaceOnlyPacks)
      .innerJoin(stands, eq(stands.id, spaceOnlyPacks.standId))
      .where(and(eq(stands.editionId, edition.id), inArray(spaceOnlyPacks.status, ['submitted', 'under_review'])));
    const [newOrders] = await db
      .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${orders.totalPence}), 0)::bigint` })
      .from(orders)
      .where(and(eq(orders.editionId, edition.id), inArray(orders.status, ['paid', 'invoiced', 'partially_refunded']), gte(orders.createdAt, since)));
    const [overdueInvoices] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.editionId, edition.id), eq(orders.status, 'invoiced'), sql`${orders.dueAt} < now()`));
    const lines = [
      toReview.n ? `${toReview.n} form ${toReview.n === 1 ? 'answer is' : 'answers are'} waiting for your review.` : null,
      packs.n ? `${packs.n} space-only ${packs.n === 1 ? 'pack is' : 'packs are'} waiting for a decision.` : null,
      newOrders.n ? `${newOrders.n} new ${newOrders.n === 1 ? 'order' : 'orders'} yesterday, worth ${money(Number(newOrders.total))}.` : null,
      overdueInvoices.n ? `${overdueInvoices.n} invoice ${overdueInvoices.n === 1 ? 'order is' : 'orders are'} past the payment date.` : null,
    ].filter((x): x is string => Boolean(x));
    if (!lines.length) continue;
    const [logged] = await db
      .insert(reminderLog)
      .values({ editionId: edition.id, standId: edition.id, subject: 'staff_digest', step: day, channel: 'email' })
      .onConflictDoNothing()
      .returning({ id: reminderLog.id });
    if (!logged) continue;
    const people = await editionStaffWith(edition.id, 'manage_exhibitors');
    const { subject, html, text } = await renderEmail({
      subject: `${edition.name}: your morning summary`,
      blocks: [
        { type: 'heading', text: 'Good morning' },
        ...lines.map((l) => ({ type: 'paragraph' as const, text: l })),
        { type: 'button', label: 'Open the show dashboard', url: appUrl(`/manage/${edition.id}`) },
      ],
      vars: {},
      branding: brandingFor(edition),
      baseUrl: env().APP_URL,
    });
    for (const p of people) {
      const r = await sendEmail({ to: p.email, toUserId: p.id, editionId: edition.id, templateKey: 'staff_digest', category: 'transactional', subject, html, text });
      if (r.status === 'sent') sent += 1;
    }
  }
  return { sent };
}
