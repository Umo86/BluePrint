import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { companies, companyMembers, editions, files, savedReplies, stands, ticketMessages, tickets, users } from '../db/schema';
import { editionStaffWith, getEditionAccess, requireEditionPermission, requireStandAccess } from '../authz';
import { forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { assertRateLimit } from '../security/rate-limit';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { appUrl } from '../auth/login';
import { requireOwnVerifiedFile } from './files';
import { nextNumber } from './orders';
import type { Actor } from '../auth/actor';

/**
 * The help desk: exhibitors ask the show team a question from the portal (or the assistant hands
 * one over), the team replies, assigns and closes them. Messages are plain text. Internal notes
 * are never shown to exhibitors. A company's colleagues can see each other's questions for a show.
 */

export const TICKET_STATUSES = ['open', 'pending', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = { open: 'Waiting for the team', pending: 'Waiting for the exhibitor', closed: 'Closed' };

const body = z.string().trim().min(1, 'Write your message.').max(5000, 'Please keep messages under 5,000 characters.');
const attachments = z.array(z.string().uuid()).max(5, 'Attach up to five files.').default([]);

export const openTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Give your question a short subject.').max(150),
  body,
  phone: z.string().trim().max(40).optional().nullable(),
  attachments,
});
export const replySchema = z.object({ body, attachments });
export const staffReplySchema = z.object({
  body,
  attachments,
  internal: z.boolean().default(false),
  /** What happens to the ticket after a reply to the exhibitor (default: waiting for them). */
  status: z.enum(TICKET_STATUSES).optional(),
});
export const savedReplySchema = z.object({
  title: z.string().trim().min(1, 'Give the reply a name.').max(100),
  body: z.string().trim().min(1, 'Write the reply.').max(5000),
});

type TicketRow = typeof tickets.$inferSelect;

async function loadTicket(ticketId: string) {
  const db = await getDb();
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!t) throw notFound();
  return t;
}

async function checkAttachments(actor: Actor, ids: string[], standId: string | null) {
  for (const id of ids) {
    const f = await requireOwnVerifiedFile(actor, id, 'ticket');
    if (standId && f.standId !== standId) throw invalid('That upload could not be found. Please upload it again.');
  }
}

async function editionOf(editionId: string) {
  const db = await getDb();
  const [e] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!e) throw notFound();
  return e;
}

/** Exhibitors can ask questions while a show is being prepared, during it and afterwards (not once archived). */
function assertCanAsk(actor: Actor, edition: typeof editions.$inferSelect) {
  if (actor.readOnly) throw forbidden('You are viewing as someone else, so changes are switched off.');
  if (edition.status === 'draft' || edition.status === 'archived') throw forbidden('This show is not taking questions.');
}

async function fileNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const db = await getDb();
  const rows = await db.select({ id: files.id, name: files.originalName }).from(files).where(inArray(files.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function notifyStaff(t: TicketRow, heading: string, paragraphs: string[]) {
  const edition = await editionOf(t.editionId);
  let people: { id: string; email: string }[];
  if (t.assignedTo) {
    const db = await getDb();
    people = await db.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.id, t.assignedTo), eq(users.status, 'active')));
  } else {
    people = (await editionStaffWith(t.editionId, 'helpdesk')).map((p) => ({ id: p.id, email: p.email }));
  }
  const { html, text } = renderSimpleEmail({
    heading,
    paragraphs,
    button: { label: 'Open the question', url: appUrl(`/manage/${t.editionId}/help-desk/${t.id}`) },
    footer: `${edition.name} help desk`,
    brandColor: edition.branding.primaryColor,
  });
  for (const p of people) {
    await sendEmail({ to: p.email, toUserId: p.id, editionId: t.editionId, templateKey: 'helpdesk_staff', category: 'transactional', subject: heading, html, text });
  }
}

async function notifyExhibitor(t: TicketRow, reply: string, staffName: string) {
  const edition = await editionOf(t.editionId);
  const db = await getDb();
  const [stand] = t.standId ? await db.select().from(stands).where(eq(stands.id, t.standId)).limit(1) : [];
  let to: { id: string | null; email: string } | null = null;
  if (t.openedBy) {
    const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.id, t.openedBy), eq(users.status, 'active'))).limit(1);
    if (u) to = u;
  }
  if (!to && t.contactEmail) to = { id: null, email: t.contactEmail };
  if (!to) return;
  const subject = `Re: ${t.subject} [${t.number ?? 'help desk'}]`;
  const { html, text } = renderSimpleEmail({
    heading: `${staffName || 'The show team'} replied to your question`,
    paragraphs: [`“${t.subject}”`, ...reply.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)],
    button: stand ? { label: 'See the conversation', url: appUrl(`/portal/${edition.slug}/help/${t.id}`) } : undefined,
    footer: edition.branding.footerText || `${edition.name}${stand ? ` · stand ${stand.number}` : ''}`,
    brandColor: edition.branding.primaryColor,
  });
  await sendEmail({ to: to.email, toUserId: to.id, editionId: t.editionId, companyId: t.companyId, standId: t.standId, templateKey: 'helpdesk_reply', category: 'transactional', subject, html, text });
}

// ---------------------------------------------------------------------------
// Exhibitor side
// ---------------------------------------------------------------------------

/** The company's questions for this show, newest activity first. */
export async function ticketsForStand(actor: Actor, standId: string) {
  const { stand } = await requireStandAccess(actor, standId);
  const db = await getDb();
  return db
    .select({ id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status, updatedAt: tickets.updatedAt, lastMessageBy: tickets.lastMessageBy, createdAt: tickets.createdAt })
    .from(tickets)
    .where(and(eq(tickets.editionId, stand.editionId), eq(tickets.companyId, stand.companyId!)))
    .orderBy(desc(tickets.updatedAt));
}

/** Questions where the show team has replied and is waiting for the exhibitor, for the portal menu. */
export async function ticketsAwaitingExhibitor(actor: Actor, standId: string) {
  const { stand } = await requireStandAccess(actor, standId);
  const db = await getDb();
  const [r] = await db
    .select({ n: count() })
    .from(tickets)
    .where(and(eq(tickets.editionId, stand.editionId), eq(tickets.companyId, stand.companyId!), eq(tickets.status, 'pending'), eq(tickets.lastMessageBy, 'staff')));
  return Number(r?.n ?? 0);
}

export async function ticketForExhibitor(actor: Actor, standId: string, ticketId: string) {
  const { stand } = await requireStandAccess(actor, standId);
  const t = await loadTicket(ticketId);
  if (t.editionId !== stand.editionId || t.companyId !== stand.companyId) throw notFound();
  const db = await getDb();
  const messages = await db
    .select({ id: ticketMessages.id, body: ticketMessages.body, attachments: ticketMessages.attachments, createdAt: ticketMessages.createdAt, authorId: ticketMessages.authorId, authorName: users.name })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorId))
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.internal, false)))
    .orderBy(asc(ticketMessages.createdAt));
  // Anyone who is not in the exhibitor's company wrote on behalf of the show team.
  const members = await db.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, stand.companyId!));
  const memberIds = new Set(members.map((m) => m.userId));
  const names = await fileNames(messages.flatMap((m) => m.attachments));
  return {
    ticket: t,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      fromTeam: !m.authorId || !memberIds.has(m.authorId),
      authorName: m.authorName ?? '',
      files: m.attachments.map((id) => ({ id, name: names.get(id) ?? 'file' })),
    })),
  };
}

export async function openTicket(actor: Actor, standId: string, raw: z.input<typeof openTicketSchema>, opts: { source?: 'portal' | 'assistant' } = {}) {
  const { stand } = await requireStandAccess(actor, standId, { write: true });
  const edition = await editionOf(stand.editionId);
  assertCanAsk(actor, edition);
  const data = openTicketSchema.parse(raw);
  await assertRateLimit(`ticket-open:${actor.realUserId}`, 10, 3600);
  await checkAttachments(actor, data.attachments, stand.id);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  const t = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, 'ticket');
    const now = new Date();
    const [row] = await tx
      .insert(tickets)
      .values({
        editionId: stand.editionId,
        standId: stand.id,
        companyId: stand.companyId,
        openedBy: actor.userId,
        contactName: user?.name ?? null,
        contactEmail: user?.email ?? actor.email,
        contactPhone: data.phone || user?.phone || null,
        number,
        subject: data.subject,
        status: 'open',
        source: opts.source ?? 'portal',
        lastMessageAt: now,
        lastMessageBy: 'exhibitor',
      })
      .returning();
    await tx.insert(ticketMessages).values({ ticketId: row.id, authorId: actor.userId, body: data.body, attachments: data.attachments });
    return row;
  });
  await audit(actor, 'ticket.opened', { entityType: 'ticket', entityId: t.id, editionId: t.editionId, companyId: t.companyId, details: { number: t.number, source: t.source } });
  const [company] = t.companyId ? await db.select({ name: companies.name }).from(companies).where(eq(companies.id, t.companyId)).limit(1) : [];
  await notifyStaff(t, `New question from ${company?.name ?? 'an exhibitor'}: ${t.subject}`, [
    `${user?.name || actor.email} (stand ${stand.number}) asked:`,
    data.body.length > 800 ? `${data.body.slice(0, 800)}…` : data.body,
  ]);
  return t;
}

export async function replyAsExhibitor(actor: Actor, standId: string, ticketId: string, raw: z.input<typeof replySchema>) {
  const { stand } = await requireStandAccess(actor, standId, { write: true });
  const t = await loadTicket(ticketId);
  if (t.editionId !== stand.editionId || t.companyId !== stand.companyId) throw notFound();
  assertCanAsk(actor, await editionOf(t.editionId));
  const data = replySchema.parse(raw);
  await assertRateLimit(`ticket-reply:${actor.realUserId}`, 60, 3600);
  await checkAttachments(actor, data.attachments, stand.id);
  const db = await getDb();
  await db.insert(ticketMessages).values({ ticketId, authorId: actor.userId, body: data.body, attachments: data.attachments });
  await db.update(tickets).set({ status: 'open', lastMessageAt: new Date(), lastMessageBy: 'exhibitor' }).where(eq(tickets.id, ticketId));
  await audit(actor, 'ticket.replied', { entityType: 'ticket', entityId: ticketId, editionId: t.editionId, companyId: t.companyId, details: { by: 'exhibitor' } });
  await notifyStaff(t, `New reply on ${t.number ?? 'a question'}: ${t.subject}`, [data.body.length > 800 ? `${data.body.slice(0, 800)}…` : data.body]);
}

export async function closeTicketAsExhibitor(actor: Actor, standId: string, ticketId: string) {
  const { stand } = await requireStandAccess(actor, standId, { write: true });
  const t = await loadTicket(ticketId);
  if (t.editionId !== stand.editionId || t.companyId !== stand.companyId) throw notFound();
  if (actor.readOnly) throw forbidden();
  const db = await getDb();
  await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId));
  await audit(actor, 'ticket.closed', { entityType: 'ticket', entityId: ticketId, editionId: t.editionId, companyId: t.companyId, details: { by: 'exhibitor' } });
}

// ---------------------------------------------------------------------------
// Show team side
// ---------------------------------------------------------------------------

export const QUEUE_FILTERS = ['open', 'pending', 'closed', 'all'] as const;

export async function helpdeskQueue(actor: Actor, editionId: string, opts: { status?: (typeof QUEUE_FILTERS)[number]; mine?: boolean; q?: string } = {}) {
  await requireEditionPermission(actor, editionId, 'helpdesk');
  const db = await getDb();
  const conds = [eq(tickets.editionId, editionId)];
  const status = opts.status ?? 'open';
  if (status !== 'all') conds.push(eq(tickets.status, status));
  if (opts.mine) conds.push(eq(tickets.assignedTo, actor.userId));
  const q = (opts.q ?? '').trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(tickets.subject, like), ilike(tickets.number, like), ilike(companies.name, like), ilike(stands.number, like), ilike(tickets.contactEmail, like))!);
  }
  const assignee = sql<string | null>`(select name from users where users.id = ${tickets.assignedTo})`;
  const rows = await db
    .select({ ticket: tickets, companyName: companies.name, standNumber: stands.number, assigneeName: assignee })
    .from(tickets)
    .leftJoin(companies, eq(companies.id, tickets.companyId))
    .leftJoin(stands, eq(stands.id, tickets.standId))
    .where(and(...conds))
    .orderBy(status === 'closed' ? desc(tickets.updatedAt) : asc(tickets.lastMessageAt))
    .limit(200);
  const counts = await db.select({ status: tickets.status, n: count() }).from(tickets).where(eq(tickets.editionId, editionId)).groupBy(tickets.status);
  const by = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])) as Partial<Record<TicketStatus, number>>;
  return { rows, counts: { open: by.open ?? 0, pending: by.pending ?? 0, closed: by.closed ?? 0 } };
}

/** Open questions for a show, for the menu badge and overview (no permission check: callers check). */
export async function openTicketCount(editionId: string) {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(tickets).where(and(eq(tickets.editionId, editionId), eq(tickets.status, 'open')));
  return Number(r?.n ?? 0);
}

export async function ticketForStaff(actor: Actor, ticketId: string) {
  const t = await loadTicket(ticketId);
  await requireEditionPermission(actor, t.editionId, 'helpdesk');
  const db = await getDb();
  const messages = await db
    .select({ message: ticketMessages, authorName: users.name, authorEmail: users.email })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorId))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt));
  const [company] = t.companyId ? await db.select().from(companies).where(eq(companies.id, t.companyId)).limit(1) : [];
  const [stand] = t.standId ? await db.select().from(stands).where(eq(stands.id, t.standId)).limit(1) : [];
  const members = t.companyId ? await db.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, t.companyId)) : [];
  const memberIds = new Set(members.map((m) => m.userId));
  const team = await editionStaffWith(t.editionId, 'helpdesk');
  const names = await fileNames(messages.flatMap((m) => m.message.attachments));
  const replies = await db
    .select()
    .from(savedReplies)
    .where(eq(savedReplies.editionId, t.editionId))
    .orderBy(asc(savedReplies.title));
  return {
    ticket: t,
    company: company ?? null,
    stand: stand ?? null,
    messages: messages.map((m) => ({
      ...m.message,
      authorName: m.authorName ?? m.authorEmail ?? 'BluePrint',
      fromExhibitor: Boolean(m.message.authorId && memberIds.has(m.message.authorId)),
      files: m.message.attachments.map((id) => ({ id, name: names.get(id) ?? 'file' })),
    })),
    team: team.map((p) => ({ id: p.id, name: p.name || p.email })),
    savedReplies: replies,
  };
}

export async function replyAsStaff(actor: Actor, ticketId: string, raw: z.input<typeof staffReplySchema>) {
  const t = await loadTicket(ticketId);
  await requireEditionPermission(actor, t.editionId, 'helpdesk', { write: true });
  const data = staffReplySchema.parse(raw);
  await assertRateLimit(`ticket-staff-reply:${actor.realUserId}`, 300, 3600);
  await checkAttachments(actor, data.attachments, t.standId);
  const db = await getDb();
  await db.insert(ticketMessages).values({ ticketId, authorId: actor.userId, body: data.body, internal: data.internal, attachments: data.internal ? data.attachments : data.attachments });
  if (data.internal) {
    if (data.status) await db.update(tickets).set({ status: data.status }).where(eq(tickets.id, ticketId));
    else await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  } else {
    // Whoever on the help desk answers first looks after the question, unless someone already does.
    const onDesk = !t.assignedTo && (await editionStaffWith(t.editionId, 'helpdesk')).some((p) => p.id === actor.userId);
    await db
      .update(tickets)
      .set({ status: data.status ?? 'pending', lastMessageAt: new Date(), lastMessageBy: 'staff', ...(onDesk ? { assignedTo: actor.userId } : {}) })
      .where(eq(tickets.id, ticketId));
  }
  await audit(actor, data.internal ? 'ticket.note_added' : 'ticket.replied', { entityType: 'ticket', entityId: ticketId, editionId: t.editionId, companyId: t.companyId, details: { by: 'staff', status: data.status ?? null } });
  if (!data.internal) await notifyExhibitor(t, data.body, actor.name);
}

export async function assignTicket(actor: Actor, ticketId: string, userId: string | null) {
  const t = await loadTicket(ticketId);
  await requireEditionPermission(actor, t.editionId, 'helpdesk', { write: true });
  if (userId) {
    const team = await editionStaffWith(t.editionId, 'helpdesk');
    if (!team.some((p) => p.id === userId)) throw invalid('Choose someone on this show’s help desk.');
  }
  const db = await getDb();
  await db.update(tickets).set({ assignedTo: userId }).where(eq(tickets.id, ticketId));
  await audit(actor, 'ticket.assigned', { entityType: 'ticket', entityId: ticketId, editionId: t.editionId, details: { to: userId } });
  if (userId && userId !== actor.userId) {
    await notifyStaff({ ...t, assignedTo: userId }, `Assigned to you: ${t.subject}`, [`${actor.name || actor.email} asked you to look after question ${t.number ?? ''}.`]);
  }
}

export async function setTicketStatus(actor: Actor, ticketId: string, status: TicketStatus) {
  const t = await loadTicket(ticketId);
  await requireEditionPermission(actor, t.editionId, 'helpdesk', { write: true });
  if (!TICKET_STATUSES.includes(status)) throw invalid('Choose a status.');
  const db = await getDb();
  await db.update(tickets).set({ status }).where(eq(tickets.id, ticketId));
  await audit(actor, 'ticket.status_changed', { entityType: 'ticket', entityId: ticketId, editionId: t.editionId, details: { status } });
}

/** A company's questions, for its record on the show dashboard. */
export async function ticketsForCompany(actor: Actor, editionId: string, companyId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('helpdesk') && !access.permissions.has('manage_exhibitors')) throw forbidden();
  const db = await getDb();
  return db
    .select()
    .from(tickets)
    .where(and(eq(tickets.editionId, editionId), eq(tickets.companyId, companyId)))
    .orderBy(desc(tickets.updatedAt));
}

// Saved replies --------------------------------------------------------------

export async function listSavedReplies(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'helpdesk');
  const db = await getDb();
  return db.select().from(savedReplies).where(eq(savedReplies.editionId, editionId)).orderBy(asc(savedReplies.title));
}

export async function saveSavedReply(actor: Actor, editionId: string, replyId: string | null, raw: z.input<typeof savedReplySchema>) {
  await requireEditionPermission(actor, editionId, 'helpdesk', { write: true });
  const data = savedReplySchema.parse(raw);
  const db = await getDb();
  if (replyId) {
    const [r] = await db.update(savedReplies).set(data).where(and(eq(savedReplies.id, replyId), eq(savedReplies.editionId, editionId))).returning();
    if (!r) throw notFound();
    await audit(actor, 'saved_reply.updated', { entityType: 'saved_reply', entityId: r.id, editionId });
    return r;
  }
  const [r] = await db.insert(savedReplies).values({ editionId, ...data }).returning();
  await audit(actor, 'saved_reply.created', { entityType: 'saved_reply', entityId: r.id, editionId });
  return r;
}

export async function deleteSavedReply(actor: Actor, editionId: string, replyId: string) {
  await requireEditionPermission(actor, editionId, 'helpdesk', { write: true });
  const db = await getDb();
  const [r] = await db.delete(savedReplies).where(and(eq(savedReplies.id, replyId), eq(savedReplies.editionId, editionId))).returning();
  if (!r) throw notFound();
  await audit(actor, 'saved_reply.deleted', { entityType: 'saved_reply', entityId: replyId, editionId });
}
