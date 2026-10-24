import 'server-only';
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { editionStaff, emailOutbox, exhibitorTypes, halls, orders, stands } from '../db/schema';
import { assertSuperAdmin, requireEditionPermission } from '../authz';
import { getEdition, listShowsWithEditions } from './editions';
import { listExhibitors } from './stands';
import { computeEditionProgress, pct } from './progress';
import { spaceOnlyQueue } from './space-only';
import { openTicketCount } from './helpdesk';
import type { Actor } from '../auth/actor';

const DAY = 86_400_000;
const LIVE_ORDERS = ['paid', 'invoiced', 'partially_refunded'] as const;

async function shopTotals(editionIds: string[]) {
  if (!editionIds.length) return new Map<string, { orders: number; salesPence: number; awaitingPence: number }>();
  const db = await getDb();
  const rows = await db
    .select({
      editionId: orders.editionId,
      n: sql<number>`count(*)::int`,
      sales: sql<number>`coalesce(sum(${orders.totalPence} - ${orders.refundedPence}), 0)::bigint`,
      awaiting: sql<number>`coalesce(sum(${orders.totalPence} - ${orders.refundedPence}) filter (where ${orders.status} = 'invoiced'), 0)::bigint`,
    })
    .from(orders)
    .where(and(inArray(orders.editionId, editionIds), inArray(orders.status, [...LIVE_ORDERS])))
    .groupBy(orders.editionId);
  return new Map(rows.map((r) => [r.editionId, { orders: Number(r.n), salesPence: Number(r.sales), awaitingPence: Number(r.awaiting) }]));
}

/** Numbers, progress and things needing attention for the top of a show dashboard. */
export async function editionOverview(actor: Actor, editionId: string) {
  const access = await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const found = await getEdition(editionId);
  const progress = await computeEditionProgress(editionId);
  const { summary } = await listExhibitors(actor, editionId, {}, progress);
  const byType = await db
    .select({ name: exhibitorTypes.name, isSpaceOnly: exhibitorTypes.isSpaceOnly, n: count(stands.id) })
    .from(exhibitorTypes)
    .leftJoin(stands, and(eq(stands.exhibitorTypeId, exhibitorTypes.id), eq(stands.status, 'active')))
    .where(eq(exhibitorTypes.editionId, editionId))
    .groupBy(exhibitorTypes.id, exhibitorTypes.name, exhibitorTypes.isSpaceOnly, exhibitorTypes.sort)
    .orderBy(exhibitorTypes.sort);
  const [{ hallCount }] = await db.select({ hallCount: count() }).from(halls).where(eq(halls.editionId, editionId));
  const [{ teamCount }] = await db.select({ teamCount: count() }).from(editionStaff).where(eq(editionStaff.editionId, editionId));
  const edition = found!.edition;
  const standTotal = byType.reduce((n, t) => n + Number(t.n), 0);
  const setup = [
    { key: 'dates', label: 'Dates set', done: Boolean(edition.buildUpStartsAt && edition.openStartsAt), href: 'settings' },
    { key: 'branding', label: 'Logo and colours added', done: Boolean(edition.branding.logoFileId && edition.branding.primaryColor), href: 'settings?tab=branding' },
    { key: 'email', label: 'Email sender set', done: Boolean(edition.emailSettings.senderAddress), href: 'settings?tab=email' },
    { key: 'halls', label: 'Halls added', done: Number(hallCount) > 0, href: 'settings?tab=halls' },
    { key: 'stands', label: 'Exhibitors and stands added', done: standTotal > 0, href: 'exhibitors' },
    { key: 'team', label: 'Team invited', done: Number(teamCount) > 1, href: 'team' },
    { key: 'live', label: 'Show set live', done: edition.status !== 'draft', href: 'settings' },
  ];

  const now = Date.now();
  const p = access.permissions;
  // Deadlines in the next 30 days (and the last week, while they are still being chased).
  const deadlines = progress.tasks
    .filter((t) => t.deadline && t.applies > 0 && t.deadline.getTime() > now - 7 * DAY && t.deadline.getTime() < now + 30 * DAY)
    .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime())
    .slice(0, 8)
    .map((t) => ({ ...t, past: t.deadline!.getTime() < now }));
  // Stands most in need of a nudge: most overdue, then least done.
  const nudge = progress.stands
    .filter((s) => s.overdue > 0 && s.companyId)
    .sort((a, b) => b.overdue - a.overdue || a.requiredDone / Math.max(1, a.required) - b.requiredDone / Math.max(1, b.required))
    .slice(0, 8);

  let shop: { orders: number; salesPence: number; awaitingPence: number } | null = null;
  if (p.has('manage_orders') || p.has('view_reports')) shop = (await shopTotals([editionId])).get(editionId) ?? { orders: 0, salesPence: 0, awaitingPence: 0 };

  let spaceOnly: { total: number; toReview: number; approved: number; chase: number } | null = null;
  if (p.has('review_space_only') || p.has('manage_exhibitors')) spaceOnly = (await spaceOnlyQueue(actor, editionId)).counts;

  let emails: { sent7d: number; problems7d: number } | null = null;
  if (p.has('send_emails')) {
    const [row] = await db
      .select({
        sent: sql<number>`count(*) filter (where ${emailOutbox.status} in ('sent','delivered','opened','clicked'))::int`,
        problems: sql<number>`count(*) filter (where ${emailOutbox.status} in ('bounced','complained','failed'))::int`,
      })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.editionId, editionId), gte(emailOutbox.createdAt, new Date(now - 7 * DAY))));
    emails = { sent7d: Number(row?.sent ?? 0), problems7d: Number(row?.problems ?? 0) };
  }

  const questions = p.has('helpdesk') ? await openTicketCount(editionId) : null;

  return {
    edition,
    show: found!.show,
    summary,
    questions,
    byType: byType.map((t) => ({ name: t.name, isSpaceOnly: t.isSpaceOnly, stands: Number(t.n) })),
    standTotal,
    hallCount: Number(hallCount),
    teamCount: Number(teamCount),
    setup,
    checklist: { ...progress.totals, pct: pct(progress.totals.requiredDone, progress.totals.requiredItems) },
    deadlines,
    nudge,
    shop,
    spaceOnly,
    emails,
  };
}

/** Every show that is not archived, with sign-ups, checklist progress and sales, for super admins. */
export async function editionsAtAGlance(actor: Actor) {
  assertSuperAdmin(actor);
  const shows = await listShowsWithEditions(actor);
  const list = shows.flatMap((s) => s.editions.map((e) => ({ ...e, showName: s.name }))).filter((e) => e.status !== 'archived');
  const sales = await shopTotals(list.map((e) => e.id));
  const out = [];
  for (const e of list) {
    const progress = await computeEditionProgress(e.id);
    const { summary } = await listExhibitors(actor, e.id, {}, progress);
    out.push({
      ...e,
      companies: summary.companies,
      signedUpPct: summary.companies ? Math.floor((summary.joined / summary.companies) * 100) : null,
      checklistPct: progress.totals.requiredItems ? pct(progress.totals.requiredDone, progress.totals.requiredItems) : null,
      standsOverdue: progress.totals.standsOverdue,
      awaitingReview: progress.totals.awaitingReview,
      salesPence: sales.get(e.id)?.salesPence ?? 0,
    });
  }
  return out;
}
