import 'server-only';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import {
  auditLog,
  emailOutbox,
  companies,
  companyMembers,
  editions,
  exhibitorNotes,
  exhibitorTypes,
  halls,
  invitations,
  orders,
  spaceOnlyPacks,
  standContractors,
  stands,
  submissions,
  users,
} from '../db/schema';
import { getEditionAccess, requireEditionPermission } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { createInvitation } from '../auth/invitations';
import { assertRateLimit } from '../security/rate-limit';
import { companySchema } from './companies';
import type { Actor } from '../auth/actor';

export const standSchema = z.object({
  number: z.string().trim().min(1, 'Enter the stand number.').max(30, 'Keep the stand number under 30 characters.'),
  exhibitorTypeId: z.string().uuid('Choose the stand type.'),
  hallId: z.string().uuid().nullable().optional(),
  sizeSqm: z.number().min(0).max(100_000).nullable().optional(),
  openSides: z.number().int().min(0).max(4).default(1),
  notes: z.string().trim().max(2000).nullable().optional(),
});

async function checkTypeAndHall(db: DbLike, editionId: string, typeId: string, hallId: string | null | undefined) {
  const [type] = await db.select().from(exhibitorTypes).where(and(eq(exhibitorTypes.id, typeId), eq(exhibitorTypes.editionId, editionId))).limit(1);
  if (!type) throw invalid('Choose a stand type from this show.', { exhibitorTypeId: 'Choose a stand type.' });
  if (hallId) {
    const [hall] = await db.select().from(halls).where(and(eq(halls.id, hallId), eq(halls.editionId, editionId))).limit(1);
    if (!hall) throw invalid('Choose a hall from this show.', { hallId: 'Choose a hall.' });
  }
  return type;
}

async function standNumberTaken(db: DbLike, editionId: string, number: string, exceptId?: string) {
  const rows = await db
    .select({ id: stands.id })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), sql`lower(${stands.number}) = lower(${number})`));
  return rows.some((r) => r.id !== exceptId);
}

async function loadStand(standId: string) {
  const db = await getDb();
  const [row] = await db.select().from(stands).where(eq(stands.id, standId)).limit(1);
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type InviteState = 'joined' | 'invited' | 'not_sent' | 'no_contact';

export const EXHIBITOR_FILTERS = ['all', 'joined', 'invited', 'not_sent', 'no_contact'] as const;

/** Every exhibiting company in an edition with its stands, main contact and invitation state. */
export async function listExhibitors(
  actor: Actor,
  editionId: string,
  opts: { q?: string; typeId?: string; hallId?: string; state?: (typeof EXHIBITOR_FILTERS)[number] } = {},
) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const standRows = await db
    .select({ stand: stands, type: exhibitorTypes, hall: halls, company: companies })
    .from(stands)
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .orderBy(asc(stands.number));

  const companyIds = [...new Set(standRows.map((r) => r.company?.id).filter((x): x is string => Boolean(x)))];
  const members = companyIds.length
    ? await db
        .select({ companyId: companyMembers.companyId, role: companyMembers.role, user: { id: users.id, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt, status: users.status } })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId))
        .where(inArray(companyMembers.companyId, companyIds))
    : [];
  const pending = companyIds.length
    ? await db
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.editionId, editionId),
            eq(invitations.kind, 'exhibitor'),
            inArray(invitations.companyId, companyIds),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(invitations.createdAt))
    : [];

  type Row = {
    company: typeof companies.$inferSelect;
    stands: { id: string; number: string; typeId: string; typeName: string; isSpaceOnly: boolean; hallId: string | null; hallName: string | null; sizeSqm: string | null }[];
    mainContact: { id: string; name: string; email: string; lastLoginAt: Date | null } | null;
    memberCount: number;
    lastLoginAt: Date | null;
    invite: { id: string; email: string; sent: boolean; sentAt: Date | null } | null;
    state: InviteState;
  };
  const byCompany = new Map<string, Row>();
  for (const r of standRows) {
    if (!r.company) continue;
    let row = byCompany.get(r.company.id);
    if (!row) {
      const m = members.filter((x) => x.companyId === r.company!.id && x.user.status !== 'disabled');
      const main = m.find((x) => x.role === 'main_contact') ?? m[0];
      const inv = pending.find((p) => p.companyId === r.company!.id);
      const lastLoginAt = m.reduce<Date | null>((acc, x) => (x.user.lastLoginAt && (!acc || x.user.lastLoginAt > acc) ? x.user.lastLoginAt : acc), null);
      const state: InviteState = m.length ? 'joined' : inv ? (inv.lastSentAt ? 'invited' : 'not_sent') : 'no_contact';
      row = {
        company: r.company,
        stands: [],
        mainContact: main ? main.user : null,
        memberCount: m.length,
        lastLoginAt,
        invite: inv ? { id: inv.id, email: inv.email, sent: Boolean(inv.lastSentAt), sentAt: inv.lastSentAt } : null,
        state,
      };
      byCompany.set(r.company.id, row);
    }
    row.stands.push({
      id: r.stand.id,
      number: r.stand.number,
      typeId: r.type.id,
      typeName: r.type.name,
      isSpaceOnly: r.type.isSpaceOnly,
      hallId: r.hall?.id ?? null,
      hallName: r.hall?.name ?? null,
      sizeSqm: r.stand.sizeSqm,
    });
  }

  let rows = [...byCompany.values()].sort((a, b) => a.company.name.localeCompare(b.company.name, 'en-GB'));
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.company.name.toLowerCase().includes(q) ||
        r.stands.some((s) => s.number.toLowerCase().includes(q)) ||
        (r.mainContact?.email.toLowerCase().includes(q) ?? false) ||
        (r.mainContact?.name.toLowerCase().includes(q) ?? false) ||
        (r.invite?.email.toLowerCase().includes(q) ?? false),
    );
  }
  if (opts.typeId) rows = rows.filter((r) => r.stands.some((s) => s.typeId === opts.typeId));
  if (opts.hallId) rows = rows.filter((r) => r.stands.some((s) => s.hallId === opts.hallId));
  if (opts.state && opts.state !== 'all') rows = rows.filter((r) => r.state === opts.state);

  const all = [...byCompany.values()];
  const summary = {
    companies: all.length,
    joined: all.filter((r) => r.state === 'joined').length,
    invited: all.filter((r) => r.state === 'invited').length,
    notSent: all.filter((r) => r.state === 'not_sent').length,
    noContact: all.filter((r) => r.state === 'no_contact').length,
    unassignedStands: standRows.filter((r) => !r.company).length,
  };
  return { rows, summary };
}

/** Every stand in an edition, including stands with no company yet. */
export async function listStands(actor: Actor, editionId: string, opts: { q?: string; typeId?: string; hallId?: string; status?: 'active' | 'cancelled' | 'all' } = {}) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const conds = [eq(stands.editionId, editionId)];
  if (opts.status !== 'all') conds.push(eq(stands.status, opts.status ?? 'active'));
  if (opts.typeId) conds.push(eq(stands.exhibitorTypeId, opts.typeId));
  if (opts.hallId) conds.push(eq(stands.hallId, opts.hallId));
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(stands.number, like), ilike(companies.name, like))!);
  }
  return db
    .select({ stand: stands, type: exhibitorTypes, hall: halls, company: companies })
    .from(stands)
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .where(and(...conds))
    .orderBy(asc(stands.number));
}

// ---------------------------------------------------------------------------
// One exhibitor
// ---------------------------------------------------------------------------

export async function getExhibitor(actor: Actor, editionId: string, companyId: string) {
  const access = await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw notFound();
  const standRows = await db
    .select({ stand: stands, type: exhibitorTypes, hall: halls, contractor: standContractors })
    .from(stands)
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(standContractors, eq(standContractors.standId, stands.id))
    .where(and(eq(stands.editionId, editionId), eq(stands.companyId, companyId)))
    .orderBy(asc(stands.number));
  // Staff only see companies that exhibit at their show.
  if (!standRows.length) throw notFound();
  const members = await db
    .select({ user: users, role: companyMembers.role, canPay: companyMembers.canPay, since: companyMembers.createdAt })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(users.name));
  const standIds = standRows.map((r) => r.stand.id);
  const invites = await db
    .select()
    .from(invitations)
    .where(
      and(
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        or(
          and(eq(invitations.editionId, editionId), eq(invitations.companyId, companyId), eq(invitations.kind, 'exhibitor')),
          and(inArray(invitations.standId, standIds), inArray(invitations.kind, ['colleague', 'contractor'])),
        ),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  const notes = await db
    .select({ note: exhibitorNotes, author: { id: users.id, name: users.name, email: users.email } })
    .from(exhibitorNotes)
    .leftJoin(users, eq(users.id, exhibitorNotes.authorId))
    .where(and(eq(exhibitorNotes.editionId, editionId), eq(exhibitorNotes.companyId, companyId)))
    .orderBy(desc(exhibitorNotes.createdAt));
  const activity = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), or(eq(auditLog.editionId, editionId), isNull(auditLog.editionId))))
    .orderBy(desc(auditLog.at))
    .limit(50);
  // Every email BluePrint sent this company for the show, with how far it got (delivered, bounced...).
  const emails = await db
    .select({ id: emailOutbox.id, toEmail: emailOutbox.toEmail, subject: emailOutbox.subject, status: emailOutbox.status, createdAt: emailOutbox.createdAt })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.editionId, editionId), eq(emailOutbox.companyId, companyId)))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(30);
  return {
    company,
    stands: standRows,
    members,
    invites,
    notes,
    activity,
    emails,
    canOpenEmails: access.permissions.has('send_emails'),
    canManage: access.permissions.has('manage_exhibitors'),
    canNote: access.permissions.has('manage_exhibitors') || access.permissions.has('helpdesk'),
  };
}

/** Company names for the "add exhibitor" picker, so last year's record is reused. Contact details are not included. */
export async function searchCompanies(actor: Actor, editionId: string, q: string) {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors');
  const term = q.trim();
  if (term.length < 2) return [];
  const db = await getDb();
  return db
    .select({ id: companies.id, name: companies.name, website: companies.website, city: companies.city })
    .from(companies)
    .where(and(eq(companies.kind, 'exhibitor'), isNull(companies.archivedAt), ilike(companies.name, `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)))
    .orderBy(asc(companies.name))
    .limit(15);
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export const addExhibitorSchema = z.object({
  existingCompanyId: z.string().uuid().nullable().optional(),
  company: companySchema.partial({ name: true }).optional(),
  stand: standSchema,
  contact: z
    .object({
      email: z.string().trim().max(254),
      sendNow: z.boolean().default(true),
    })
    .nullable()
    .optional(),
});

/** Adds an exhibitor to the show: the company (new or existing), its stand and optionally an invitation. */
export async function addExhibitor(actor: Actor, editionId: string, raw: z.input<typeof addExhibitorSchema>) {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors', { write: true });
  const input = addExhibitorSchema.parse(raw);
  if (!input.existingCompanyId && !input.company?.name) throw invalid('Enter the company name or choose an existing company.', { name: 'Enter the company name.' });
  const db = await getDb();
  await checkTypeAndHall(db, editionId, input.stand.exhibitorTypeId, input.stand.hallId);
  if (await standNumberTaken(db, editionId, input.stand.number)) {
    throw invalid(`Stand ${input.stand.number} already exists at this show.`, { number: 'Already used at this show.' });
  }
  const result = await db.transaction(async (tx) => {
    let companyId = input.existingCompanyId ?? null;
    if (companyId) {
      const [c] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
      if (!c || c.kind !== 'exhibitor') throw invalid('Choose an existing company.');
    } else {
      const data = companySchema.parse({ ...input.company });
      const [c] = await tx.insert(companies).values({ ...data, kind: 'exhibitor' }).returning();
      companyId = c.id;
    }
    const [stand] = await tx
      .insert(stands)
      .values({
        editionId,
        number: input.stand.number,
        exhibitorTypeId: input.stand.exhibitorTypeId,
        hallId: input.stand.hallId ?? null,
        sizeSqm: input.stand.sizeSqm === null || input.stand.sizeSqm === undefined ? null : String(input.stand.sizeSqm),
        openSides: input.stand.openSides,
        notes: input.stand.notes ?? null,
        companyId,
      })
      .returning();
    return { companyId, stand };
  });
  await audit(actor, 'exhibitor.added', {
    entityType: 'stand',
    entityId: result.stand.id,
    editionId,
    companyId: result.companyId,
    details: { stand: result.stand.number, newCompany: !input.existingCompanyId },
  });
  if (input.contact?.email) {
    await createInvitation(actor, { kind: 'exhibitor', email: input.contact.email, editionId, companyId: result.companyId, role: 'main_contact' }, { send: input.contact.sendNow });
  }
  return result;
}

export async function createStand(actor: Actor, editionId: string, raw: z.input<typeof standSchema> & { companyId?: string | null }) {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors', { write: true });
  const input = standSchema.parse(raw);
  const db = await getDb();
  await checkTypeAndHall(db, editionId, input.exhibitorTypeId, input.hallId);
  if (await standNumberTaken(db, editionId, input.number)) throw invalid(`Stand ${input.number} already exists at this show.`, { number: 'Already used at this show.' });
  if (raw.companyId) {
    const [c] = await db.select().from(companies).where(eq(companies.id, raw.companyId)).limit(1);
    if (!c) throw invalid('Choose an existing company.');
  }
  const [stand] = await db
    .insert(stands)
    .values({
      editionId,
      number: input.number,
      exhibitorTypeId: input.exhibitorTypeId,
      hallId: input.hallId ?? null,
      sizeSqm: input.sizeSqm === null || input.sizeSqm === undefined ? null : String(input.sizeSqm),
      openSides: input.openSides,
      notes: input.notes ?? null,
      companyId: raw.companyId ?? null,
    })
    .returning();
  await audit(actor, 'stand.created', { entityType: 'stand', entityId: stand.id, editionId, companyId: stand.companyId, details: { number: stand.number } });
  return stand;
}

export async function updateStand(actor: Actor, standId: string, raw: z.input<typeof standSchema> & { companyId?: string | null }) {
  const current = await loadStand(standId);
  await requireEditionPermission(actor, current.editionId, 'manage_exhibitors', { write: true });
  const input = standSchema.parse(raw);
  const db = await getDb();
  const type = await checkTypeAndHall(db, current.editionId, input.exhibitorTypeId, input.hallId);
  if (await standNumberTaken(db, current.editionId, input.number, standId)) {
    throw invalid(`Stand ${input.number} already exists at this show.`, { number: 'Already used at this show.' });
  }
  const companyId = raw.companyId === undefined ? current.companyId : raw.companyId;
  if (companyId && companyId !== current.companyId) {
    const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!c) throw invalid('Choose an existing company.');
    const [{ n }] = await db.select({ n: count() }).from(orders).where(eq(orders.standId, standId));
    if (Number(n) > 0) throw conflict('This stand already has orders, so it cannot be moved to another company. Cancel it and add a new stand instead.');
  }
  await db
    .update(stands)
    .set({
      number: input.number,
      exhibitorTypeId: input.exhibitorTypeId,
      hallId: input.hallId ?? null,
      sizeSqm: input.sizeSqm === null || input.sizeSqm === undefined ? null : String(input.sizeSqm),
      openSides: input.openSides,
      notes: input.notes ?? null,
      companyId,
    })
    .where(eq(stands.id, standId));
  await audit(actor, 'stand.updated', {
    entityType: 'stand',
    entityId: standId,
    editionId: current.editionId,
    companyId,
    details: {
      number: input.number,
      typeChanged: current.exhibitorTypeId !== input.exhibitorTypeId ? type.name : undefined,
      companyChanged: companyId !== current.companyId ? true : undefined,
    },
  });
}

export async function setStandStatus(actor: Actor, standId: string, status: 'active' | 'cancelled') {
  const current = await loadStand(standId);
  await requireEditionPermission(actor, current.editionId, 'manage_exhibitors', { write: true });
  const db = await getDb();
  await db.update(stands).set({ status }).where(eq(stands.id, standId));
  await audit(actor, status === 'cancelled' ? 'stand.cancelled' : 'stand.restored', {
    entityType: 'stand',
    entityId: standId,
    editionId: current.editionId,
    companyId: current.companyId,
    details: { number: current.number },
  });
}

/** Deleting is only for mistakes: once a stand has orders, forms or a space-only pack it is cancelled instead. */
export async function deleteStand(actor: Actor, standId: string) {
  const current = await loadStand(standId);
  await requireEditionPermission(actor, current.editionId, 'manage_exhibitors', { write: true });
  const db = await getDb();
  const [{ o }] = await db.select({ o: count() }).from(orders).where(eq(orders.standId, standId));
  const [{ s }] = await db.select({ s: count() }).from(submissions).where(eq(submissions.standId, standId));
  const [{ p }] = await db.select({ p: count() }).from(spaceOnlyPacks).where(eq(spaceOnlyPacks.standId, standId));
  if (Number(o) + Number(s) + Number(p) > 0) throw conflict('This stand has orders or completed tasks, so it cannot be deleted. Cancel it instead.');
  await db.delete(stands).where(eq(stands.id, standId));
  await audit(actor, 'stand.deleted', { entityType: 'stand', entityId: standId, editionId: current.editionId, companyId: current.companyId, details: { number: current.number } });
}

// ---------------------------------------------------------------------------
// Invitations and notes
// ---------------------------------------------------------------------------

async function requireExhibitingCompany(editionId: string, companyId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: stands.id })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), eq(stands.companyId, companyId), eq(stands.status, 'active')))
    .limit(1);
  if (!row) throw notFound('That company has no stand at this show.');
}

export async function inviteExhibitorContact(actor: Actor, editionId: string, companyId: string, input: { email: string; role: 'main_contact' | 'colleague'; sendNow?: boolean }) {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors', { write: true });
  await requireExhibitingCompany(editionId, companyId);
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (input.sendNow !== false && edition?.status === 'draft') {
    throw conflict('This show is still a draft, so exhibitors cannot sign in yet. Save the invitation without sending, or set the show live first.');
  }
  return createInvitation(actor, { kind: 'exhibitor', email: input.email, editionId, companyId, role: input.role === 'colleague' ? 'colleague' : 'main_contact' }, { send: input.sendNow !== false });
}

/** Sends every invitation that was saved but not yet sent (for example after an import). */
export async function sendUnsentInvitations(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors', { write: true });
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw notFound();
  if (edition.status === 'draft') throw conflict('Set the show live before sending invitations, so exhibitors can sign in.');
  const unsent = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.editionId, editionId),
        eq(invitations.kind, 'exhibitor'),
        isNull(invitations.lastSentAt),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  if (!unsent.length) return { sent: 0 };
  await assertRateLimit(`bulk-invite:${editionId}`, 5000, 24 * 3600, unsent.length);
  let sent = 0;
  for (const inv of unsent) {
    await createInvitation(
      actor,
      { kind: 'exhibitor', email: inv.email, editionId, companyId: inv.companyId, role: inv.role },
      { send: true, bulk: true },
    );
    sent++;
  }
  await audit(actor, 'invitation.bulk_sent', { editionId, details: { sent } });
  return { sent };
}

export async function addExhibitorNote(actor: Actor, editionId: string, companyId: string, body: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!access.permissions.has('manage_exhibitors') && !access.permissions.has('helpdesk')) throw forbidden();
  if (actor.readOnly) throw forbidden();
  await requireExhibitingCompany(editionId, companyId);
  const clean = body.trim().slice(0, 4000);
  if (!clean) throw invalid('Write a note first.', { body: 'Write a note first.' });
  const db = await getDb();
  const [note] = await db.insert(exhibitorNotes).values({ editionId, companyId, authorId: actor.realUserId, body: clean }).returning();
  await audit(actor, 'exhibitor.note_added', { entityType: 'exhibitor_note', entityId: note.id, editionId, companyId });
  return note;
}

export async function deleteExhibitorNote(actor: Actor, noteId: string) {
  const db = await getDb();
  const [note] = await db.select().from(exhibitorNotes).where(eq(exhibitorNotes.id, noteId)).limit(1);
  if (!note) throw notFound();
  const access = await getEditionAccess(actor, note.editionId);
  if (!access) throw notFound();
  const isAdmin = access.role === 'super_admin' || access.role === 'show_admin';
  if (note.authorId !== actor.realUserId && !isAdmin) throw forbidden('Only the author or a show admin can delete a note.');
  if (actor.readOnly) throw forbidden();
  await db.delete(exhibitorNotes).where(eq(exhibitorNotes.id, noteId));
  await audit(actor, 'exhibitor.note_deleted', { entityType: 'exhibitor_note', entityId: noteId, editionId: note.editionId, companyId: note.companyId });
}
