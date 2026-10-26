import 'server-only';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import {
  EDITION_STATUSES,
  editionStaff,
  editions,
  emailTemplates,
  files,
  exhibitorTypes,
  halls,
  manualPages,
  orders,
  products,
  serviceCategories,
  shows,
  stands,
  taskRequirements,
  tasks,
  type EditionContact,
  type SpaceOnlyRules,
} from '../db/schema';
import { assertSuperAdmin, assertWritable, getEditionAccess, requireEditionPermission, requireShowAdmin } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { slugify, SLUG_PATTERN } from '@/lib/slug';
import { parseLocalDateTime } from '@/lib/dates';
import type { Actor } from '../auth/actor';

export const DEFAULT_SPACE_ONLY_RULES: SpaceOnlyRules = {
  maxHeightM: 4,
  maxPlatformMm: 599,
  stepsMakeComplex: true,
  minInsuranceGbp: 5_000_000,
  requiredDocs: ['drawings', 'risk_assessment', 'method_statement', 'construction_phase_plan', 'contractor_insurance', 'hs_declaration'],
  complexDocs: ['structural_calculations'],
};

const optionalDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = v instanceof Date ? v : parseLocalDateTime(v);
    if (!d || Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid date.' });
      return z.NEVER;
    }
    return d;
  });

const colour = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2e52af.')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const showSchema = z.object({
  name: z.string().trim().min(2, 'Enter a show name.').max(120),
  slug: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const editionBasicsSchema = z.object({
  name: z.string().trim().min(2, 'Enter an edition name.').max(120),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and dashes.')
    .optional(),
  venue: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  buildUpStartsAt: optionalDate,
  openStartsAt: optionalDate,
  openEndsAt: optionalDate,
  breakdownEndsAt: optionalDate,
  vatRateBps: z.number().int().min(0).max(10_000).optional(),
  status: z.enum(EDITION_STATUSES).optional(),
  /** The exhibitor assistant for this show. */
  assistantEnabled: z.boolean().optional(),
});

export const brandingSchema = z.object({
  primaryColor: colour,
  accentColor: colour,
  logoFileId: z.string().uuid().nullable().optional(),
  headerImageFileId: z.string().uuid().nullable().optional(),
  footerText: z.string().max(500).optional(),
});

export const emailSettingsSchema = z.object({
  senderName: z.string().trim().max(80).optional(),
  senderAddress: z.string().trim().email('Enter a valid email address.').max(200).optional().or(z.literal('')),
  replyTo: z.string().trim().email('Enter a valid email address.').max(200).optional().or(z.literal('')),
  campaignSenderAddress: z.string().trim().email('Enter a valid email address.').max(200).optional().or(z.literal('')),
});

const contactSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,24}$/),
    team: z.string().trim().min(1, 'Say who this contact is, for example Operations.').max(60),
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().email('Enter a valid email address.').max(200).optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^[0-9+()\-.\s]*$/, 'Use only numbers, spaces and + ( ) - in a phone number.')
      .optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((c) => Boolean(c.email || c.phone || c.note), { message: 'Add an email, a phone number or a note.', path: ['email'] });

/** The people exhibitors can contact about the show, in the order they are shown. */
export const contactsSchema = z.object({ contacts: z.array(contactSchema).max(8, 'Up to 8 contacts.') });

export const spaceOnlyRulesSchema = z.object({
  maxHeightM: z.number().min(1).max(30),
  maxPlatformMm: z.number().int().min(0).max(5000),
  stepsMakeComplex: z.boolean(),
  minInsuranceGbp: z.number().int().min(0).max(100_000_000),
  requiredDocs: z.array(z.string().max(60)).max(20),
  complexDocs: z.array(z.string().max(60)).max(20),
});

export const commercialSchema = z.object({
  feeMode: z.enum(['exhibitor_pays', 'deduct_from_supplier']).nullable(),
  defaultCommissionType: z.enum(['percent', 'fixed']).nullable(),
  defaultCommissionValue: z.number().int().min(0).max(1_000_000).nullable(),
});

async function uniqueSlug(base: string, table: 'shows' | 'editions') {
  const db = await getDb();
  const root = slugify(base) || 'show';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const rows =
      table === 'shows'
        ? await db.select({ id: shows.id }).from(shows).where(eq(shows.slug, candidate)).limit(1)
        : await db.select({ id: editions.id }).from(editions).where(eq(editions.slug, candidate)).limit(1);
    if (!rows.length) return candidate;
  }
  throw conflict('Could not find a free web address. Try a different name.');
}

// ---------------------------------------------------------------------------
// Shows
// ---------------------------------------------------------------------------

export async function listShowsWithEditions(actor: Actor) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const showRows = await db.select().from(shows).orderBy(asc(shows.name));
  const editionRows = await db.select().from(editions).orderBy(desc(editions.openStartsAt));
  const standCounts = await db
    .select({ editionId: stands.editionId, n: count() })
    .from(stands)
    .where(eq(stands.status, 'active'))
    .groupBy(stands.editionId);
  const countBy = new Map(standCounts.map((r) => [r.editionId, Number(r.n)]));
  return showRows.map((s) => ({
    ...s,
    editions: editionRows.filter((e) => e.showId === s.id).map((e) => ({ ...e, standCount: countBy.get(e.id) ?? 0 })),
  }));
}

export async function createShow(actor: Actor, input: z.input<typeof showSchema>) {
  assertSuperAdmin(actor);
  const data = showSchema.parse(input);
  const db = await getDb();
  const slug = await uniqueSlug(data.slug || data.name, 'shows');
  const [show] = await db.insert(shows).values({ name: data.name, slug, description: data.description ?? null }).returning();
  await audit(actor, 'show.created', { entityType: 'show', entityId: show.id, details: { name: show.name } });
  return show;
}

export async function updateShow(actor: Actor, showId: string, input: z.input<typeof showSchema>) {
  assertSuperAdmin(actor);
  const data = showSchema.parse(input);
  const db = await getDb();
  const [show] = await db.update(shows).set({ name: data.name, description: data.description ?? null }).where(eq(shows.id, showId)).returning();
  if (!show) throw notFound();
  await audit(actor, 'show.updated', { entityType: 'show', entityId: showId });
  return show;
}

export async function setShowArchived(actor: Actor, showId: string, archived: boolean) {
  assertSuperAdmin(actor);
  const db = await getDb();
  await db.update(shows).set({ archivedAt: archived ? new Date() : null }).where(eq(shows.id, showId));
  await audit(actor, archived ? 'show.archived' : 'show.restored', { entityType: 'show', entityId: showId });
}

export async function deleteShow(actor: Actor, showId: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(editions).where(eq(editions.showId, showId));
  if (Number(n) > 0) throw conflict('Delete or move this show’s editions first.');
  await db.delete(shows).where(eq(shows.id, showId));
  await audit(actor, 'show.deleted', { entityType: 'show', entityId: showId });
}

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

export async function getEdition(editionId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ edition: editions, show: shows })
    .from(editions)
    .innerJoin(shows, eq(shows.id, editions.showId))
    .where(eq(editions.id, editionId))
    .limit(1);
  return row ?? null;
}

/** The edition and what the actor may do in it, for the show dashboard. Anyone else gets "not found". */
export async function getEditionForStaff(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  const found = await getEdition(editionId);
  if (!found) throw notFound();
  return { ...found, access };
}

export async function getEditionBySlug(slug: string) {
  const db = await getDb();
  const [row] = await db
    .select({ edition: editions, show: shows })
    .from(editions)
    .innerJoin(shows, eq(shows.id, editions.showId))
    .where(eq(editions.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function createEdition(actor: Actor, showId: string, input: z.input<typeof editionBasicsSchema>) {
  assertSuperAdmin(actor);
  const data = editionBasicsSchema.parse(input);
  const db = await getDb();
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!show) throw notFound();
  const slug = data.slug ? await uniqueSlug(data.slug, 'editions') : await uniqueSlug(data.name, 'editions');
  const edition = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(editions)
      .values({
        showId,
        name: data.name,
        slug,
        venue: data.venue ?? null,
        city: data.city ?? null,
        buildUpStartsAt: data.buildUpStartsAt,
        openStartsAt: data.openStartsAt,
        openEndsAt: data.openEndsAt,
        breakdownEndsAt: data.breakdownEndsAt,
        vatRateBps: data.vatRateBps ?? 2000,
        status: data.status ?? 'draft',
        spaceOnlyRules: DEFAULT_SPACE_ONLY_RULES,
      })
      .returning();
    await tx.insert(exhibitorTypes).values([
      { editionId: e.id, key: 'shell_scheme', name: 'Shell scheme', description: 'Walls, fascia, carpet and lighting supplied by the organiser.', sort: 1 },
      { editionId: e.id, key: 'space_only', name: 'Space only', description: 'Floor space only; the exhibitor’s contractor builds the stand.', isSpaceOnly: true, sort: 2 },
    ]);
    return e;
  });
  await audit(actor, 'edition.created', { entityType: 'edition', entityId: edition.id, editionId: edition.id, details: { name: edition.name } });
  return edition;
}

/** Super admins can change everything; show admins can change everything except commercial terms. */
export async function updateEditionBasics(actor: Actor, editionId: string, input: z.input<typeof editionBasicsSchema>) {
  await requireShowAdmin(actor, editionId, { write: true });
  const data = editionBasicsSchema.parse(input);
  const db = await getDb();
  if (data.slug) {
    const [clash] = await db.select({ id: editions.id }).from(editions).where(eq(editions.slug, data.slug)).limit(1);
    if (clash && clash.id !== editionId) throw invalid('That web address is already used.', { slug: 'Already used by another edition.' });
  }
  if (data.status === 'archived' && !actor.isSuperAdmin) throw forbidden('Only a super admin can archive an edition.');
  const [e] = await db
    .update(editions)
    .set({
      name: data.name,
      ...(data.slug ? { slug: data.slug } : {}),
      venue: data.venue ?? null,
      city: data.city ?? null,
      buildUpStartsAt: data.buildUpStartsAt,
      openStartsAt: data.openStartsAt,
      openEndsAt: data.openEndsAt,
      breakdownEndsAt: data.breakdownEndsAt,
      ...(data.vatRateBps !== undefined ? { vatRateBps: data.vatRateBps } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.assistantEnabled !== undefined ? { assistantEnabled: data.assistantEnabled } : {}),
    })
    .where(eq(editions.id, editionId))
    .returning();
  if (!e) throw notFound();
  await audit(actor, 'edition.updated', { entityType: 'edition', entityId: editionId, editionId, details: { status: e.status } });
  return e;
}

export async function updateEditionBranding(actor: Actor, editionId: string, input: z.input<typeof brandingSchema>) {
  await requireEditionPermission(actor, editionId, 'edit_content', { write: true });
  const data = brandingSchema.parse(input);
  const db = await getDb();
  // Images must be branding uploads for this edition that passed their checks.
  for (const fileId of [data.logoFileId, data.headerImageFileId]) {
    if (!fileId) continue;
    const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!f || f.purpose !== 'branding' || f.editionId !== editionId || !f.verifiedAt || f.deletedAt) {
      throw invalid('That image could not be found. Please upload it again.');
    }
  }
  const [current] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!current) throw notFound();
  await db.update(editions).set({ branding: { ...current.branding, ...data } }).where(eq(editions.id, editionId));
  await audit(actor, 'edition.branding_updated', { entityType: 'edition', entityId: editionId, editionId });
}

export async function updateEditionEmailSettings(actor: Actor, editionId: string, input: z.input<typeof emailSettingsSchema>) {
  await requireShowAdmin(actor, editionId, { write: true });
  const data = emailSettingsSchema.parse(input);
  const db = await getDb();
  const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v || undefined]));
  await db.update(editions).set({ emailSettings: clean }).where(eq(editions.id, editionId));
  await audit(actor, 'edition.email_settings_updated', { entityType: 'edition', entityId: editionId, editionId });
}

export async function updateEditionContacts(actor: Actor, editionId: string, input: z.input<typeof contactsSchema>) {
  await requireEditionPermission(actor, editionId, 'edit_content', { write: true });
  const { contacts } = contactsSchema.parse(input);
  const ids = contacts.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw invalid('Each contact needs its own id.');
  const clean: EditionContact[] = contacts.map((c) => ({
    id: c.id,
    team: c.team,
    ...(c.name ? { name: c.name } : {}),
    ...(c.email ? { email: c.email.toLowerCase() } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.note ? { note: c.note } : {}),
  }));
  const db = await getDb();
  await db.update(editions).set({ contacts: clean }).where(eq(editions.id, editionId));
  await audit(actor, 'edition.contacts_updated', { entityType: 'edition', entityId: editionId, editionId, details: { contacts: clean.length } });
}

export async function updateSpaceOnlyRules(actor: Actor, editionId: string, input: z.input<typeof spaceOnlyRulesSchema>) {
  await requireShowAdmin(actor, editionId, { write: true });
  const data = spaceOnlyRulesSchema.parse(input);
  const db = await getDb();
  await db.update(editions).set({ spaceOnlyRules: data }).where(eq(editions.id, editionId));
  await audit(actor, 'edition.space_only_rules_updated', { entityType: 'edition', entityId: editionId, editionId });
}

export async function updateEditionCommercial(actor: Actor, editionId: string, input: z.input<typeof commercialSchema>) {
  assertSuperAdmin(actor);
  const data = commercialSchema.parse(input);
  if ((data.defaultCommissionType === null) !== (data.defaultCommissionValue === null)) {
    throw invalid('Set both the commission type and value, or neither.');
  }
  const db = await getDb();
  await db.update(editions).set(data).where(eq(editions.id, editionId));
  await audit(actor, 'edition.commercial_updated', { entityType: 'edition', entityId: editionId, editionId, details: data });
}

/** Deleting is only allowed before any order exists; afterwards an edition is archived instead. */
export async function deleteEdition(actor: Actor, editionId: string, confirmName: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const [e] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!e) throw notFound();
  if (confirmName.trim() !== e.name) throw invalid('Type the edition name exactly to confirm.');
  const [{ n }] = await db.select({ n: count() }).from(orders).where(eq(orders.editionId, editionId));
  if (Number(n) > 0) throw conflict('This edition has orders, so it cannot be deleted. Archive it instead.');
  await db.delete(editions).where(eq(editions.id, editionId));
  await audit(actor, 'edition.deleted', { entityType: 'edition', entityId: editionId, details: { name: e.name } });
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

export const cloneSchema = z.object({
  name: z.string().trim().min(2).max(120),
  buildUpStartsAt: optionalDate,
  openStartsAt: optionalDate,
  openEndsAt: optionalDate,
  breakdownEndsAt: optionalDate,
  copyStaff: z.boolean().default(true),
});

/**
 * Creates next year's edition from an existing one: manual pages, tasks, forms, services, prices,
 * suppliers, email templates, exhibitor types, halls and the team. Never exhibitors, stands,
 * submissions or orders. Deadlines set relative to build-up move automatically; fixed deadlines
 * move by the same number of days as build-up.
 */
export async function cloneEdition(actor: Actor, sourceId: string, input: z.input<typeof cloneSchema>) {
  assertSuperAdmin(actor);
  assertWritable(actor);
  const data = cloneSchema.parse(input);
  const db = await getDb();
  const [src] = await db.select().from(editions).where(eq(editions.id, sourceId)).limit(1);
  if (!src) throw notFound();
  const slug = await uniqueSlug(data.name, 'editions');
  const shiftMs =
    src.buildUpStartsAt && data.buildUpStartsAt ? data.buildUpStartsAt.getTime() - src.buildUpStartsAt.getTime() : 0;
  const shift = (d: Date | null) => (d ? new Date(d.getTime() + shiftMs) : null);

  const created = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(editions)
      .values({
        showId: src.showId,
        name: data.name,
        slug,
        venue: src.venue,
        city: src.city,
        timezone: src.timezone,
        currency: src.currency,
        vatRateBps: src.vatRateBps,
        buildUpStartsAt: data.buildUpStartsAt,
        openStartsAt: data.openStartsAt,
        openEndsAt: data.openEndsAt,
        breakdownEndsAt: data.breakdownEndsAt,
        status: 'draft',
        branding: src.branding,
        emailSettings: src.emailSettings,
        spaceOnlyRules: src.spaceOnlyRules,
        contacts: src.contacts,
        feeMode: src.feeMode,
        defaultCommissionType: src.defaultCommissionType,
        defaultCommissionValue: src.defaultCommissionValue,
        clonedFromId: src.id,
      })
      .returning();

    const typeMap = new Map<string, string>();
    for (const t of await tx.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, src.id))) {
      const [n] = await tx
        .insert(exhibitorTypes)
        .values({ editionId: e.id, key: t.key, name: t.name, description: t.description, isSpaceOnly: t.isSpaceOnly, sort: t.sort })
        .returning();
      typeMap.set(t.id, n.id);
    }
    const mapTypes = (ids: string[]) => ids.map((id) => typeMap.get(id)).filter((x): x is string => Boolean(x));

    for (const h of await tx.select().from(halls).where(eq(halls.editionId, src.id))) {
      await tx.insert(halls).values({ editionId: e.id, name: h.name, sort: h.sort });
    }

    const pageMap = new Map<string, string>();
    const pages = await tx.select().from(manualPages).where(eq(manualPages.editionId, src.id)).orderBy(asc(manualPages.sort));
    for (const p of pages) {
      const [n] = await tx
        .insert(manualPages)
        .values({
          editionId: e.id,
          title: p.title,
          slug: p.slug,
          bodyHtml: p.bodyHtml,
          visibleToTypes: mapTypes(p.visibleToTypes),
          published: p.published,
          pinned: p.pinned,
          sort: p.sort,
        })
        .returning();
      pageMap.set(p.id, n.id);
    }
    for (const p of pages) {
      if (p.parentId && pageMap.has(p.parentId)) {
        await tx.update(manualPages).set({ parentId: pageMap.get(p.parentId)! }).where(eq(manualPages.id, pageMap.get(p.id)!));
      }
    }

    const catMap = new Map<string, string>();
    for (const c of await tx.select().from(serviceCategories).where(eq(serviceCategories.editionId, src.id))) {
      const [n] = await tx
        .insert(serviceCategories)
        .values({
          editionId: e.id,
          name: c.name,
          description: c.description,
          supplierId: c.supplierId,
          commissionType: c.commissionType,
          commissionValue: c.commissionValue,
          orderByOffsetDays: c.orderByOffsetDays,
          visibleToTypes: mapTypes(c.visibleToTypes),
          sort: c.sort,
        })
        .returning();
      catMap.set(c.id, n.id);
    }
    for (const p of await tx.select().from(products).where(eq(products.editionId, src.id))) {
      if (p.status === 'archived') continue;
      await tx.insert(products).values({
        editionId: e.id,
        categoryId: catMap.get(p.categoryId)!,
        supplierId: p.supplierId,
        name: p.name,
        code: p.code,
        description: p.description,
        imageFileId: p.imageFileId,
        unit: p.unit,
        pricePence: p.pricePence,
        earlyPricePence: p.earlyPricePence,
        earlyUntilOffsetDays: p.earlyUntilOffsetDays,
        latePricePence: p.latePricePence,
        lateFromOffsetDays: p.lateFromOffsetDays,
        vatRateBps: p.vatRateBps,
        options: p.options,
        requiredDetails: p.requiredDetails,
        stockLimit: p.stockLimit,
        visibleToTypes: mapTypes(p.visibleToTypes),
        status: p.status,
        commissionType: p.commissionType,
        commissionValue: p.commissionValue,
        sort: p.sort,
      });
    }

    for (const t of await tx.select().from(tasks).where(eq(tasks.editionId, src.id))) {
      const [n] = await tx
        .insert(tasks)
        .values({
          editionId: e.id,
          title: t.title,
          descriptionHtml: t.descriptionHtml,
          kind: t.kind,
          formSchema: t.formSchema,
          deadlineOffsetDays: t.deadlineOffsetDays,
          deadlineAt: shift(t.deadlineAt),
          requiresApproval: t.requiresApproval,
          linkedPageId: t.linkedPageId ? pageMap.get(t.linkedPageId) ?? null : null,
          linkedCategoryId: t.linkedCategoryId ? catMap.get(t.linkedCategoryId) ?? null : null,
          reminderOffsets: t.reminderOffsets,
          published: t.published,
          sort: t.sort,
        })
        .returning();
      const reqs = await tx.select().from(taskRequirements).where(eq(taskRequirements.taskId, t.id));
      for (const r of reqs) {
        const typeId = typeMap.get(r.exhibitorTypeId);
        if (typeId) await tx.insert(taskRequirements).values({ taskId: n.id, exhibitorTypeId: typeId, requirement: r.requirement });
      }
    }

    for (const t of await tx.select().from(emailTemplates).where(eq(emailTemplates.editionId, src.id))) {
      await tx.insert(emailTemplates).values({
        editionId: e.id,
        key: t.key,
        name: t.name,
        subject: t.subject,
        preheader: t.preheader,
        blocks: t.blocks,
        category: t.category,
      });
    }

    if (data.copyStaff) {
      for (const s of await tx.select().from(editionStaff).where(eq(editionStaff.editionId, src.id))) {
        await tx.insert(editionStaff).values({ editionId: e.id, userId: s.userId, role: s.role, permissions: s.permissions, addedBy: actor.realUserId });
      }
    }
    return e;
  });

  await audit(actor, 'edition.cloned', { entityType: 'edition', entityId: created.id, editionId: created.id, details: { from: src.id, name: created.name } });
  return created;
}

/** Deadline for a task in an edition: fixed date, else days before build-up. */
export function resolveDeadline(
  task: { deadlineAt: Date | null; deadlineOffsetDays: number | null },
  edition: { buildUpStartsAt: Date | null },
): Date | null {
  if (task.deadlineAt) return task.deadlineAt;
  if (task.deadlineOffsetDays !== null && task.deadlineOffsetDays !== undefined && edition.buildUpStartsAt) {
    return new Date(edition.buildUpStartsAt.getTime() - task.deadlineOffsetDays * 24 * 3600 * 1000);
  }
  return null;
}

export async function editionSummaryCounts(editionIds: string[]) {
  if (!editionIds.length) return new Map<string, { stands: number }>();
  const db = await getDb();
  const rows = await db
    .select({ editionId: stands.editionId, n: sql<number>`count(*)::int` })
    .from(stands)
    .where(and(inArray(stands.editionId, editionIds), eq(stands.status, 'active')))
    .groupBy(stands.editionId);
  return new Map(rows.map((r) => [r.editionId, { stands: r.n }]));
}
