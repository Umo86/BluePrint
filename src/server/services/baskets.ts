import 'server-only';
import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import { cartItems, companies, companyMembers, editions, halls, orders, reminderLog, stands, users, type BasketReminderSettings } from '../db/schema';
import { getEditionAccess, memberCovers, requireEditionPermission, requireStandAccess } from '../authz';
import { conflict, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { appUrl } from '../auth/login';
import { sendEmail } from '../email/send';
import { renderTemplate, senderFor } from '../email/templates';
import { basketSnapshot } from './shop';
import { money } from '@/lib/format';
import type { Actor } from '../auth/actor';

/**
 * Cart abandonment: exhibitors who put services in their basket and leave without ordering get a
 * reminder the morning after, and another a few days later. Any change to the basket starts the
 * count again, and ordering empties the basket, so the reminders stop by themselves.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Reminders go out with the morning reminders; this lets "after 1 day" mean "the next morning". */
const MORNING_SLACK = 6 * HOUR;
/** Orders placed up to 14 days after a basket reminder count as ordered after a reminder (see basketsForStaff). */
/** The team can send a reminder by hand, but not more than once in this time. */
const MANUAL_GAP = 12 * HOUR;
const OPEN_STATUSES = ['live', 'onsite'] as const;

export const BASKET_REMINDER_DEFAULTS = { enabled: true, firstAfterDays: 1, secondAfterDays: 4 } as const;

type EditionRow = typeof editions.$inferSelect;

export function basketReminderSettings(edition: Pick<EditionRow, 'basketReminders'>) {
  const s: BasketReminderSettings = edition.basketReminders ?? {};
  return {
    enabled: s.enabled ?? BASKET_REMINDER_DEFAULTS.enabled,
    firstAfterDays: s.firstAfterDays ?? BASKET_REMINDER_DEFAULTS.firstAfterDays,
    secondAfterDays: s.secondAfterDays ?? BASKET_REMINDER_DEFAULTS.secondAfterDays,
  };
}

/** Reminders are recorded against the basket as it was last changed, so a changed basket starts again. */
export const basketCycle = (lastChange: Date) => `basket:${lastChange.toISOString()}`;

/** Stands in an edition with something in their basket, and when the basket last changed. */
async function openBaskets(db: DbLike, editionId: string) {
  const rows = await db
    .select({
      standId: cartItems.standId,
      items: sql<number>`count(*)::int`,
      lastChange: sql<Date>`max(greatest(${cartItems.createdAt}, ${cartItems.updatedAt}))`,
      addedBy: sql<string[]>`array_remove(array_agg(distinct ${cartItems.addedBy}), null)`,
    })
    .from(cartItems)
    .innerJoin(stands, eq(stands.id, cartItems.standId))
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .groupBy(cartItems.standId);
  return rows.map((r) => ({ ...r, lastChange: new Date(r.lastChange), addedBy: r.addedBy ?? [] }));
}

/** Basket reminders already sent for each stand's current basket. */
async function remindersFor(db: DbLike, standIds: string[]) {
  if (!standIds.length) return [];
  return db
    .select({ standId: reminderLog.standId, subject: reminderLog.subject, step: reminderLog.step, at: reminderLog.createdAt })
    .from(reminderLog)
    .where(and(inArray(reminderLog.standId, standIds), like(reminderLog.subject, 'basket:%')))
    .orderBy(desc(reminderLog.createdAt));
}

/** A card payment in progress: leave the stand alone rather than remind them mid-checkout. */
async function payingNow(db: DbLike, standIds: string[], now: Date) {
  if (!standIds.length) return new Set<string>();
  const rows = await db
    .select({ standId: orders.standId })
    .from(orders)
    .where(and(inArray(orders.standId, standIds), eq(orders.status, 'pending_payment'), gte(orders.createdAt, new Date(now.getTime() - DAY))));
  return new Set(rows.map((r) => r.standId));
}

/** Which automatic reminder is due for a basket now, if any. */
export function dueBasketReminder(
  settings: ReturnType<typeof basketReminderSettings>,
  lastChange: Date,
  sent: { at: Date }[],
  now: Date,
): 'r1' | 'r2' | null {
  if (!settings.enabled) return null;
  const quiet = now.getTime() - lastChange.getTime();
  if (sent.length === 0) return quiet >= settings.firstAfterDays * DAY - MORNING_SLACK ? 'r1' : null;
  if (sent.length === 1 && settings.secondAfterDays > settings.firstAfterDays) {
    const sinceLast = now.getTime() - sent[0].at.getTime();
    return quiet >= settings.secondAfterDays * DAY - MORNING_SLACK && sinceLast >= DAY - MORNING_SLACK ? 'r2' : null;
  }
  return null;
}

/** The morning job runs at 07:00 UTC (vercel.json): the first run at or after a time. */
function nextMorningRun(at: Date) {
  const run = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 7));
  if (run.getTime() < at.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

/** When the next automatic reminder becomes due, for the team's list (null when none will). */
function nextReminderAt(settings: ReturnType<typeof basketReminderSettings>, lastChange: Date, sent: { at: Date }[]) {
  if (!settings.enabled) return null;
  if (sent.length === 0) return new Date(lastChange.getTime() + settings.firstAfterDays * DAY - MORNING_SLACK);
  if (sent.length === 1 && settings.secondAfterDays > settings.firstAfterDays) {
    return new Date(Math.max(lastChange.getTime() + settings.secondAfterDays * DAY - MORNING_SLACK, sent[0].at.getTime() + DAY - MORNING_SLACK));
  }
  return null;
}

/** Who a basket reminder goes to: the people who filled the basket, else the company's main contacts. */
async function basketRecipients(db: DbLike, editionId: string, companyId: string, addedBy: string[]) {
  const people = await db
    .select({ id: users.id, email: users.email, name: users.name, role: companyMembers.role })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(and(eq(companyMembers.companyId, companyId), eq(users.status, 'active'), memberCovers(editionId)));
  const fillers = people.filter((p) => addedBy.includes(p.id));
  return (fillers.length ? fillers : people.filter((p) => p.role === 'main_contact')).slice(0, 3);
}

function dateForEmail(d: Date, timezone: string) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone });
}

/** Sends one stand's basket reminder to its people, recording it first so it is never sent twice. */
async function remindStand(
  db: DbLike,
  edition: EditionRow,
  basket: { standId: string; lastChange: Date; addedBy: string[] },
  step: string,
  now: Date,
): Promise<{ recorded: boolean; emails: number; recipients: number }> {
  const snap = await basketSnapshot(db, basket.standId, now);
  if (!snap.buyableCount || !snap.company) return { recorded: false, emails: 0, recipients: 0 };
  const people = await basketRecipients(db, edition.id, snap.company.id, basket.addedBy);
  if (!people.length) return { recorded: false, emails: 0, recipients: 0 };
  const [logged] = await db
    .insert(reminderLog)
    .values({ editionId: edition.id, standId: basket.standId, subject: basketCycle(basket.lastChange), step, channel: 'email', createdAt: now })
    .onConflictDoNothing()
    .returning({ id: reminderLog.id });
  if (!logged) return { recorded: false, emails: 0, recipients: 0 };

  const lines = snap.lines
    .filter((l) => !l.problem)
    .map((l) => `${l.quantity} × ${l.name}${Object.keys(l.options).length ? ` (${Object.values(l.options).join(', ')})` : ''}: ${money(l.totalPence)}`);
  const sender = await senderFor(edition, 'reminder');
  let emails = 0;
  for (const p of people) {
    const { subject, html, text } = await renderTemplate(edition, 'basket_reminder', {
      first_name: (p.name || '').split(' ')[0] || 'there',
      name: p.name,
      company: snap.company.name,
      stand: snap.stand.number,
      basket_link: appUrl(`/portal/${edition.slug}/shop/basket`),
      basket_lines: lines.join('\n'),
      basket_total: money(snap.totalPence),
      count: `${snap.buyableCount} ${snap.buyableCount === 1 ? 'item' : 'items'}`,
      deadline_note: snap.next ? `${snap.next.what} on ${dateForEmail(snap.next.at, edition.timezone)}.` : '',
    });
    const r = await sendEmail({
      to: p.email,
      toUserId: p.id,
      editionId: edition.id,
      companyId: snap.company.id,
      standId: basket.standId,
      templateKey: 'basket_reminder',
      category: 'reminder',
      subject,
      html,
      text,
      from: sender.from,
      replyTo: sender.replyTo,
    });
    if (r.status === 'sent' || r.status === 'queued') emails += 1;
  }
  return { recorded: true, emails, recipients: people.length };
}

/** The morning job: sends whichever basket reminders are due in every open show. */
export async function runBasketReminders(now = new Date()) {
  const db = await getDb();
  const live = await db.select().from(editions).where(inArray(editions.status, [...OPEN_STATUSES]));
  let stands = 0;
  let emails = 0;
  for (const edition of live) {
    const settings = basketReminderSettings(edition);
    if (!settings.enabled) continue;
    const baskets = await openBaskets(db, edition.id);
    if (!baskets.length) continue;
    const sent = await remindersFor(
      db,
      baskets.map((b) => b.standId),
    );
    const busy = await payingNow(
      db,
      baskets.map((b) => b.standId),
      now,
    );
    for (const b of baskets) {
      if (busy.has(b.standId)) continue;
      const cycle = sent.filter((s) => s.standId === b.standId && s.subject === basketCycle(b.lastChange));
      const step = dueBasketReminder(settings, b.lastChange, cycle, now);
      if (!step) continue;
      try {
        const r = await remindStand(db, edition, b, step, now);
        if (r.recorded) stands += 1;
        emails += r.emails;
      } catch (err) {
        console.error('Basket reminder failed for stand', b.standId, err);
      }
    }
  }
  return { stands, emails };
}

/** The show team sends a basket reminder now (at most once every 12 hours per stand). */
export async function sendBasketReminderNow(actor: Actor, editionId: string, standId: string) {
  await requireEditionPermission(actor, editionId, 'manage_orders', { write: true });
  const db = await getDb();
  const now = new Date();
  const basket = (await openBaskets(db, editionId)).find((b) => b.standId === standId);
  if (!basket) throw notFound();
  const [last] = await remindersFor(db, [standId]);
  if (last && now.getTime() - last.at.getTime() < MANUAL_GAP) throw conflict('A basket reminder went to this stand in the last 12 hours. Try again later, or give them a call.');
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  const r = await remindStand(db, edition, basket, `manual:${now.toISOString()}`, now);
  if (!r.recorded) throw conflict('There is nothing in this basket that can be ordered, or nobody at the company to email.');
  await audit(actor, 'shop.basket_reminder_sent', { entityType: 'stand', entityId: standId, editionId, details: { emails: r.emails, recipients: r.recipients } });
  return { emails: r.emails, recipients: r.recipients };
}

export const basketSettingsSchema = z.object({
  enabled: z.boolean(),
  firstAfterDays: z.number().int().min(1, 'Wait at least a day.').max(14, 'At most 14 days.'),
  secondAfterDays: z.number().int().min(0).max(30, 'At most 30 days.'),
});

export async function updateBasketReminderSettings(actor: Actor, editionId: string, input: z.input<typeof basketSettingsSchema>) {
  await requireEditionPermission(actor, editionId, 'manage_orders', { write: true });
  const data = basketSettingsSchema.parse(input);
  if (data.secondAfterDays !== 0 && data.secondAfterDays <= data.firstAfterDays) {
    throw conflict('The second reminder has to come after the first. Use 0 for no second reminder.');
  }
  const db = await getDb();
  await db.update(editions).set({ basketReminders: data }).where(eq(editions.id, editionId));
  await audit(actor, 'shop.basket_reminders_updated', { entityType: 'edition', entityId: editionId, editionId, details: data });
}

/** Open baskets for the show team: what is waiting, who filled it, reminders, and orders that followed one. */
export async function basketsForStaff(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports')) throw forbidden();
  const db = await getDb();
  const now = new Date();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw notFound();
  const settings = basketReminderSettings(edition);
  const baskets = await openBaskets(db, editionId);
  const ids = baskets.map((b) => b.standId);
  const sent = await remindersFor(db, ids);
  const busy = await payingNow(db, ids, now);
  const standRows = ids.length
    ? await db
        .select({ id: stands.id, number: stands.number, companyId: companies.id, companyName: companies.name, hallName: halls.name })
        .from(stands)
        .leftJoin(companies, eq(companies.id, stands.companyId))
        .leftJoin(halls, eq(halls.id, stands.hallId))
        .where(inArray(stands.id, ids))
    : [];
  const adders = [...new Set(baskets.flatMap((b) => b.addedBy))];
  const people = adders.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, adders)) : [];

  const rows = [];
  for (const b of baskets) {
    const snap = await basketSnapshot(db, b.standId, now).catch(() => null);
    if (!snap) continue;
    const s = standRows.find((x) => x.id === b.standId);
    const cycle = sent.filter((x) => x.standId === b.standId && x.subject === basketCycle(b.lastChange));
    rows.push({
      standId: b.standId,
      standNumber: s?.number ?? '',
      hallName: s?.hallName ?? null,
      companyId: s?.companyId ?? null,
      companyName: s?.companyName ?? 'No company',
      items: snap.lines,
      totalPence: snap.totalPence,
      lastChange: b.lastChange,
      addedBy: people.filter((p) => b.addedBy.includes(p.id)).map((p) => ({ name: p.name, email: p.email })),
      reminders: cycle.map((x) => ({ at: x.at, manual: x.step.startsWith('manual:') })).reverse(),
      nextReminderAt: (() => {
        const due = busy.has(b.standId) ? null : nextReminderAt(settings, b.lastChange, cycle);
        return due ? nextMorningRun(new Date(Math.max(due.getTime(), now.getTime()))) : null;
      })(),
      payingNow: busy.has(b.standId),
      next: snap.next,
    });
  }
  rows.sort((a, b) => b.totalPence - a.totalPence);

  // Orders placed within two weeks after a basket reminder to the same stand.
  const since = new Date(now.getTime() - 90 * DAY);
  const [recovered] = await db
    .select({ orders: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${orders.totalPence}), 0)::bigint` })
    .from(orders)
    .where(
      and(
        eq(orders.editionId, editionId),
        inArray(orders.status, ['paid', 'invoiced', 'partially_refunded']),
        gte(orders.createdAt, since),
        sql`exists (select 1 from ${reminderLog} r where r.stand_id = ${orders.standId} and r.subject like 'basket:%' and r.created_at <= ${orders.createdAt} and r.created_at >= ${orders.createdAt} - interval '14 days')`,
      ),
    );
  const [{ n: remindersSent }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reminderLog)
    .where(and(eq(reminderLog.editionId, editionId), like(reminderLog.subject, 'basket:%'), gte(reminderLog.createdAt, new Date(now.getTime() - 30 * DAY))));

  return {
    edition: { id: edition.id, name: edition.name, timezone: edition.timezone, status: edition.status },
    settings,
    rows,
    totals: {
      baskets: rows.length,
      valuePence: rows.reduce((a, r) => a + r.totalPence, 0),
      remindersLast30Days: Number(remindersSent),
      recoveredOrders: Number(recovered?.orders ?? 0),
      recoveredPence: Number(recovered?.total ?? 0),
    },
    canManage: access.permissions.has('manage_orders') && !actor.readOnly,
  };
}

/** How many stands have something waiting in their basket, for the Orders page button. */
export async function openBasketCount(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access || (!access.permissions.has('manage_orders') && !access.permissions.has('view_reports'))) return 0;
  const db = await getDb();
  return (await openBaskets(db, editionId)).length;
}

/** For the exhibitor's home page: what is waiting in their basket. */
export async function basketNudge(actor: Actor, standId: string) {
  await requireStandAccess(actor, standId);
  const db = await getDb();
  const snap = await basketSnapshot(db, standId);
  if (!snap.buyableCount) return null;
  const lines = snap.lines.filter((l) => !l.problem).map((l) => ({ name: l.name, quantity: l.quantity }));
  return { items: snap.buyableCount, lines, totalPence: snap.totalPence, next: snap.next };
}
