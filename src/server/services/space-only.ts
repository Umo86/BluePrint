import 'server-only';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import {
  companies,
  companyMembers,
  editionStaff,
  editions,
  exhibitorTypes,
  files,
  halls,
  invitations,
  shows,
  spaceOnlyPacks,
  spaceOnlyReviews,
  spaceOnlyVersions,
  standContractors,
  stands,
  submissions,
  taskRequirements,
  tasks,
  users,
  type SpaceOnlyRules,
  type SubmissionStatus,
} from '../db/schema';
import { getEditionAccess, getMemberships, inViewedEdition, isViewingAs, membershipCovers } from '../authz';
import { conflict, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { createInvitation } from '../auth/invitations';
import { isValidEmail, normaliseEmail, appUrl } from '../auth/login';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { renderCertificate } from '../pdf/certificate';
import { storeGeneratedFile } from './files';
import { DEFAULT_SPACE_ONLY_RULES } from './editions';
import { checkPack, SPACE_ONLY_DOCS, type Declared } from '@/lib/space-only';
import type { Actor } from '../auth/actor';

const DOC_KEYS = new Set(SPACE_ONLY_DOCS.map((d) => d.key));
const EDITABLE: string[] = ['not_started', 'changes_needed', 'rejected'];
const OPEN_EDITION = ['live', 'onsite'];

type Role = 'exhibitor' | 'main_contact' | 'contractor';

/** Loads a space-only stand and works out how the actor is connected to it. Anyone else gets "not found". */
async function access(actor: Actor, standId: string, opts: { write?: boolean } = {}) {
  const db = await getDb();
  const [row] = await db
    .select({ stand: stands, type: exhibitorTypes, edition: editions, show: shows, company: companies, hall: halls })
    .from(stands)
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .innerJoin(editions, eq(editions.id, stands.editionId))
    .innerJoin(shows, eq(shows.id, editions.showId))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .where(eq(stands.id, standId))
    .limit(1);
  if (!row || row.stand.status !== 'active' || !row.type.isSpaceOnly || !row.company) throw notFound();
  if (!inViewedEdition(actor, row.stand.editionId)) throw notFound();
  let role: Role | null = null;
  const memberships = await getMemberships(actor);
  const membership = memberships.find((m) => m.companyId === row.company!.id && membershipCovers(m, row.stand.editionId));
  if (membership) role = membership.role === 'main_contact' ? 'main_contact' : 'exhibitor';
  if (!role && !isViewingAs(actor)) {
    const [c] = await db
      .select()
      .from(standContractors)
      .where(and(eq(standContractors.standId, standId), eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active')))
      .limit(1);
    if (c) role = 'contractor';
  }
  if (!role) throw notFound();
  if (!['live', 'onsite', 'closed'].includes(row.edition.status) && !actor.readOnly) throw notFound();
  if (opts.write) {
    if (actor.readOnly) throw forbidden('You are viewing as someone else, so changes are switched off.');
    if (!OPEN_EDITION.includes(row.edition.status)) throw forbidden('This show is not open for changes.');
  }
  return { ...row, company: row.company!, role, rules: (row.edition.spaceOnlyRules ?? DEFAULT_SPACE_ONLY_RULES) as SpaceOnlyRules };
}

async function packFor(standId: string) {
  const db = await getDb();
  const [pack] = await db.select().from(spaceOnlyPacks).where(eq(spaceOnlyPacks.standId, standId)).limit(1);
  return pack ?? null;
}

async function ensurePack(standId: string) {
  const db = await getDb();
  await db.insert(spaceOnlyPacks).values({ standId }).onConflictDoNothing();
  return (await packFor(standId))!;
}

function declaredOf(pack: typeof spaceOnlyPacks.$inferSelect | null): Declared {
  return {
    heightM: pack?.declaredHeightM !== null && pack?.declaredHeightM !== undefined ? Number(pack.declaredHeightM) : null,
    platformMm: pack?.declaredPlatformMm ?? null,
    hasSteps: pack?.hasSteps ?? false,
    insuranceCoverGbp: pack?.insuranceCoverGbp ?? null,
    insuranceExpiresOn: pack?.insuranceExpiresOn ?? null,
  };
}

async function fileInfo(ids: string[]) {
  if (!ids.length) return {};
  const db = await getDb();
  const rows = await db.select({ id: files.id, name: files.originalName, size: files.sizeBytes, type: files.mimeType }).from(files).where(inArray(files.id, ids));
  return Object.fromEntries(rows.map((f) => [f.id, { name: f.name, size: f.size, type: f.type }]));
}

/** Keeps the checklist tasks for nomination and the pack in step with what has actually happened. */
async function syncTasks(standId: string) {
  const db = await getDb();
  const [stand] = await db.select().from(stands).where(eq(stands.id, standId)).limit(1);
  if (!stand) return;
  const related = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(taskRequirements, and(eq(taskRequirements.taskId, tasks.id), eq(taskRequirements.exhibitorTypeId, stand.exhibitorTypeId)))
    .where(and(eq(tasks.editionId, stand.editionId), inArray(tasks.kind, ['contractor_nomination', 'space_only_pack'])));
  if (!related.length) return;
  const [contractor] = await db.select().from(standContractors).where(eq(standContractors.standId, standId)).limit(1);
  const pack = await packFor(standId);
  for (const { task } of related) {
    let status: SubmissionStatus | null = null;
    if (task.kind === 'contractor_nomination') status = contractor && contractor.status !== 'removed' ? 'completed' : null;
    else if (pack && pack.status !== 'not_started') {
      status = (
        { submitted: 'submitted', under_review: 'submitted', changes_needed: 'changes_needed', approved: 'approved', approved_with_conditions: 'approved', rejected: 'rejected' } as const
      )[pack.status as 'submitted'];
    }
    const [existing] = await db.select().from(submissions).where(and(eq(submissions.taskId, task.id), eq(submissions.standId, standId))).limit(1);
    if (!status) {
      if (existing && existing.status !== 'draft') await db.update(submissions).set({ status: 'draft' }).where(eq(submissions.id, existing.id));
      continue;
    }
    if (existing) await db.update(submissions).set({ status, submittedAt: existing.submittedAt ?? new Date() }).where(eq(submissions.id, existing.id));
    else await db.insert(submissions).values({ taskId: task.id, standId, status, submittedAt: new Date() });
  }
}

// ---------------------------------------------------------------------------
// Exhibitor and contractor side
// ---------------------------------------------------------------------------

/** Everything the space-only page shows: contractor, pack, what is missing, the team's comments and the certificate. */
export async function packView(actor: Actor, standId: string) {
  const a = await access(actor, standId);
  const db = await getDb();
  const pack = await packFor(standId);
  const [contractor] = await db.select().from(standContractors).where(eq(standContractors.standId, standId)).limit(1);
  const draft = (pack?.draftDocuments ?? {}) as Record<string, string[]>;
  const [current] = pack?.currentVersion
    ? await db
        .select()
        .from(spaceOnlyVersions)
        .where(and(eq(spaceOnlyVersions.packId, pack.id), eq(spaceOnlyVersions.version, pack.currentVersion)))
        .limit(1)
    : [];
  const reviews = pack
    ? await db.select().from(spaceOnlyReviews).where(eq(spaceOnlyReviews.packId, pack.id)).orderBy(desc(spaceOnlyReviews.createdAt))
    : [];
  const declared = declaredOf(pack);
  const check = checkPack(a.rules, declared, draft, { breakdownEndsAt: a.edition.breakdownEndsAt });
  const status = pack?.status ?? 'not_started';
  const editableNow = EDITABLE.includes(status) && OPEN_EDITION.includes(a.edition.status) && !actor.readOnly;
  const allIds = [...Object.values(draft).flat(), ...Object.values((current?.documents ?? {}) as Record<string, string[]>).flat()].filter((x): x is string => typeof x === 'string');
  return {
    stand: a.stand,
    edition: a.edition,
    show: a.show,
    company: a.company,
    hall: a.hall,
    role: a.role,
    rules: a.rules,
    contractor: contractor && contractor.status !== 'removed' ? contractor : null,
    pack,
    status,
    declared,
    draft,
    check,
    current: current ?? null,
    reviews: reviews.map((r) => ({ id: r.id, version: r.version, by: r.reviewerRole === 'hs' ? 'Health and safety' : 'Show team', outcome: r.outcome, docType: r.docType, comment: r.comment, at: r.createdAt })),
    files: await fileInfo(allIds),
    editable: editableNow,
    canNominate: (a.role === 'main_contact' || a.role === 'exhibitor') && OPEN_EDITION.includes(a.edition.status) && !actor.readOnly,
  };
}

export const nominationSchema = z.object({
  selfBuild: z.boolean().default(false),
  companyName: z.string().trim().max(200).optional(),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
});

/** Names the company building a space-only stand and invites their contact to BluePrint. */
export async function nominateContractor(actor: Actor, standId: string, raw: z.input<typeof nominationSchema>) {
  const a = await access(actor, standId, { write: true });
  if (a.role === 'contractor') throw forbidden('Only the exhibitor can change the contractor.');
  const input = nominationSchema.parse(raw);
  const db = await getDb();
  const [existing] = await db.select().from(standContractors).where(eq(standContractors.standId, standId)).limit(1);
  const pack = await packFor(standId);
  if (pack && ['approved', 'approved_with_conditions', 'submitted', 'under_review'].includes(pack.status)) {
    throw conflict('Your stand pack is with the show team, so the contractor cannot be changed now. Contact the show team.');
  }

  let values: typeof standContractors.$inferInsert;
  if (input.selfBuild) {
    const [me] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
    values = { standId, contractorCompanyName: a.company.name, contactName: me.name || me.email, contactEmail: me.email, contactPhone: me.phone, userId: me.id, status: 'active', nominatedBy: actor.realUserId };
  } else {
    const email = normaliseEmail(input.email ?? '');
    const errors: Record<string, string> = {};
    if (!input.companyName) errors.companyName = 'Enter the contractor’s company name.';
    if (!input.contactName) errors.contactName = 'Enter a contact name.';
    if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
    if (Object.keys(errors).length) throw invalid('Please check the contractor’s details.', errors);
    values = { standId, contractorCompanyName: input.companyName!, contactName: input.contactName!, contactEmail: email, contactPhone: input.phone || null, userId: null, status: 'invited', nominatedBy: actor.realUserId };
  }
  const changed = !existing || existing.contactEmail !== values.contactEmail || existing.status === 'removed';
  if (existing) {
    await db
      .update(standContractors)
      .set(changed ? values : { contractorCompanyName: values.contractorCompanyName, contactName: values.contactName, contactPhone: values.contactPhone })
      .where(eq(standContractors.id, existing.id));
  } else {
    await db.insert(standContractors).values(values);
  }
  if (changed) {
    // The previous contractor's pending invitation stops working.
    await db
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.standId, standId), eq(invitations.kind, 'contractor'), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    if (!input.selfBuild) {
      // An existing BluePrint user is linked when they accept, like anyone else.
      await createInvitation(actor, { kind: 'contractor', email: values.contactEmail, standId, editionId: a.edition.id, companyId: a.company.id });
    }
  }
  await syncTasks(standId);
  await audit(actor, 'space_only.contractor_nominated', {
    entityType: 'stand',
    entityId: standId,
    editionId: a.edition.id,
    companyId: a.company.id,
    details: { contractor: values.contractorCompanyName, selfBuild: input.selfBuild, changed },
  });
}

export async function removeContractor(actor: Actor, standId: string) {
  const a = await access(actor, standId, { write: true });
  if (a.role === 'contractor') throw forbidden();
  const pack = await packFor(standId);
  if (pack && ['approved', 'approved_with_conditions', 'submitted', 'under_review'].includes(pack.status)) {
    throw conflict('Your stand pack is with the show team, so the contractor cannot be changed now.');
  }
  const db = await getDb();
  await db.update(standContractors).set({ status: 'removed', userId: null }).where(eq(standContractors.standId, standId));
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.standId, standId), eq(invitations.kind, 'contractor'), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  await syncTasks(standId);
  await audit(actor, 'space_only.contractor_removed', { entityType: 'stand', entityId: standId, editionId: a.edition.id, companyId: a.company.id });
}

export const packDraftSchema = z.object({
  heightM: z.number().min(0).max(50).nullable(),
  platformMm: z.number().int().min(0).max(10_000).nullable(),
  hasSteps: z.boolean(),
  insuranceCoverGbp: z.number().int().min(0).max(1_000_000_000).nullable(),
  insuranceExpiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  documents: z.record(z.string(), z.array(z.string().uuid()).max(20)),
});

/** Saves the pack being prepared. Every document must be a checked upload for this stand. */
export async function savePackDraft(actor: Actor, standId: string, raw: z.input<typeof packDraftSchema>) {
  const a = await access(actor, standId, { write: true });
  const input = packDraftSchema.parse(raw);
  const pack = await ensurePack(standId);
  if (!EDITABLE.includes(pack.status)) throw conflict('Your pack is with the show team. You can change it if they ask for changes.');
  const documents: Record<string, string[]> = {};
  const ids = new Set<string>();
  for (const [key, list] of Object.entries(input.documents)) {
    if (!DOC_KEYS.has(key)) throw invalid('Unknown document type.');
    if (list.length) documents[key] = [...new Set(list)];
    list.forEach((x) => ids.add(x));
  }
  if (ids.size) {
    const db = await getDb();
    const rows = await db.select().from(files).where(inArray(files.id, [...ids]));
    const ok = rows.filter((f) => f.verifiedAt && !f.deletedAt && f.purpose === 'space_only' && f.standId === standId);
    if (ok.length !== ids.size) throw invalid('One of the documents could not be found. Please upload it again.');
  }
  const db = await getDb();
  const check = checkPack(a.rules, { heightM: input.heightM, platformMm: input.platformMm, hasSteps: input.hasSteps, insuranceCoverGbp: input.insuranceCoverGbp, insuranceExpiresOn: input.insuranceExpiresOn }, documents, {
    breakdownEndsAt: a.edition.breakdownEndsAt,
  });
  await db
    .update(spaceOnlyPacks)
    .set({
      declaredHeightM: input.heightM === null ? null : String(input.heightM),
      declaredPlatformMm: input.platformMm,
      hasSteps: input.hasSteps,
      insuranceCoverGbp: input.insuranceCoverGbp,
      insuranceExpiresOn: input.insuranceExpiresOn,
      isComplex: check.isComplex,
      draftDocuments: documents,
    })
    .where(eq(spaceOnlyPacks.id, pack.id));
  return check;
}

async function reviewers(editionId: string) {
  const db = await getDb();
  const rows = await db
    .select({ email: users.email, id: users.id, role: editionStaff.role, permissions: editionStaff.permissions })
    .from(editionStaff)
    .innerJoin(users, eq(users.id, editionStaff.userId))
    .where(and(eq(editionStaff.editionId, editionId), eq(users.status, 'active')));
  return rows.filter((r) => r.role !== 'show_team' || r.permissions.includes('review_space_only'));
}

/** Sends the prepared pack for review as a new version. Missing items stop it being sent. */
export async function submitPack(actor: Actor, standId: string) {
  const a = await access(actor, standId, { write: true });
  const pack = await ensurePack(standId);
  if (!EDITABLE.includes(pack.status)) throw conflict('This pack has already been sent.');
  const db = await getDb();
  const [contractor] = await db.select().from(standContractors).where(eq(standContractors.standId, standId)).limit(1);
  if (!contractor || contractor.status === 'removed') throw invalid('Nominate your stand contractor before sending the pack.');
  const declared = declaredOf(pack);
  const documents = pack.draftDocuments as Record<string, string[]>;
  const check = checkPack(a.rules, declared, documents, { breakdownEndsAt: a.edition.breakdownEndsAt });
  if (!check.complete) throw invalid(`Your pack is not complete yet. Still needed: ${check.missing.join('; ')}.`);
  const version = pack.currentVersion + 1;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(spaceOnlyVersions).values({
      packId: pack.id,
      version,
      documents,
      declarations: { ...declared, isComplex: check.isComplex, contractor: contractor.contractorCompanyName },
      completeness: { missing: check.missing, warnings: check.warnings },
      submittedBy: actor.realUserId,
      submittedAt: now,
    });
    await tx
      .update(spaceOnlyPacks)
      .set({ currentVersion: version, status: 'submitted', submittedAt: now, isComplex: check.isComplex, decidedAt: null, decidedBy: null, conditions: null, certificateFileId: null })
      .where(eq(spaceOnlyPacks.id, pack.id));
  });
  await syncTasks(standId);
  await audit(actor, 'space_only.submitted', { entityType: 'stand', entityId: standId, editionId: a.edition.id, companyId: a.company.id, details: { version, complex: check.isComplex } });

  const { html, text } = renderSimpleEmail({
    heading: `Space-only pack to review: stand ${a.stand.number}`,
    paragraphs: [`${a.company.name} has sent version ${version} of the space-only pack for stand ${a.stand.number}${check.isComplex ? ' (complex stand)' : ''}.`],
    button: { label: 'Review the pack', url: appUrl(`/manage/${a.edition.id}/space-only/${standId}`) },
    brandColor: a.edition.branding.primaryColor,
  });
  for (const r of await reviewers(a.edition.id)) {
    await sendEmail({ to: r.email, toUserId: r.id, editionId: a.edition.id, standId, templateKey: 'space_only_submitted', category: 'transactional', subject: `Space-only pack to review: stand ${a.stand.number}`, html, text });
  }
  return { version };
}

/** Space-only stands the actor builds as a contractor, across every show. */
export async function contractorStands(actor: Actor) {
  if (isViewingAs(actor)) return [];
  const db = await getDb();
  const rows = await db
    .select({ contractor: standContractors, stand: stands, edition: editions, company: companies, pack: spaceOnlyPacks })
    .from(standContractors)
    .innerJoin(stands, eq(stands.id, standContractors.standId))
    .innerJoin(editions, eq(editions.id, stands.editionId))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .leftJoin(spaceOnlyPacks, eq(spaceOnlyPacks.standId, stands.id))
    .where(and(eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active'), eq(stands.status, 'active'), inArray(editions.status, ['live', 'onsite', 'closed'])))
    .orderBy(asc(editions.buildUpStartsAt), asc(stands.number));
  return rows;
}

// ---------------------------------------------------------------------------
// Show team side
// ---------------------------------------------------------------------------

async function requireReviewer(actor: Actor, editionId: string, opts: { write?: boolean } = {}) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  const canReview = access.permissions.has('review_space_only');
  if (!canReview && !access.permissions.has('manage_exhibitors')) throw forbidden();
  if (opts.write && !canReview) throw forbidden('You can see space-only packs but not decide on them.');
  if (opts.write && actor.readOnly) throw forbidden();
  return { access, role: access.role === 'hs_reviewer' ? ('hs' as const) : ('ops' as const) };
}

/** Every space-only stand in an edition with its contractor and pack state. */
export async function spaceOnlyQueue(actor: Actor, editionId: string) {
  await requireReviewer(actor, editionId);
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw notFound();
  const rows = await db
    .select({ stand: stands, company: companies, hall: halls, contractor: standContractors, pack: spaceOnlyPacks })
    .from(stands)
    .innerJoin(exhibitorTypes, and(eq(exhibitorTypes.id, stands.exhibitorTypeId), eq(exhibitorTypes.isSpaceOnly, true)))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(standContractors, eq(standContractors.standId, stands.id))
    .leftJoin(spaceOnlyPacks, eq(spaceOnlyPacks.standId, stands.id))
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .orderBy(asc(stands.number));
  const now = Date.now();
  const daysToBuild = edition.buildUpStartsAt ? Math.ceil((edition.buildUpStartsAt.getTime() - now) / 86_400_000) : null;
  const items = rows.map((r) => {
    const status = r.pack?.status ?? 'not_started';
    const contractor = r.contractor && r.contractor.status !== 'removed' ? r.contractor : null;
    const issues: string[] = [];
    if (!contractor) issues.push('No contractor nominated');
    else if (contractor.status === 'invited') issues.push('Contractor has not joined');
    if (status === 'not_started') issues.push('Pack not sent');
    if (status === 'changes_needed') issues.push('Waiting for changes');
    if (status === 'rejected') issues.push('Not approved');
    if (r.pack?.insuranceExpiresOn && edition.breakdownEndsAt && new Date(`${r.pack.insuranceExpiresOn}T23:59:59Z`) < edition.breakdownEndsAt) issues.push('Insurance expires too early');
    return { ...r, contractor, status, issues };
  });
  return {
    edition,
    daysToBuild,
    items,
    counts: {
      total: items.length,
      toReview: items.filter((i) => i.status === 'submitted' || i.status === 'under_review').length,
      approved: items.filter((i) => i.status === 'approved' || i.status === 'approved_with_conditions').length,
      chase: items.filter((i) => i.issues.length && !['approved', 'approved_with_conditions'].includes(i.status)).length,
    },
  };
}

/** One pack with every version, document and comment, for the reviewers. */
export async function packForReview(actor: Actor, standId: string) {
  const db = await getDb();
  const [stand] = await db.select().from(stands).where(eq(stands.id, standId)).limit(1);
  if (!stand) throw notFound();
  const { access: acc } = await requireReviewer(actor, stand.editionId);
  const [row] = await db
    .select({ type: exhibitorTypes, edition: editions, company: companies, hall: halls })
    .from(stands)
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .innerJoin(editions, eq(editions.id, stands.editionId))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .where(eq(stands.id, standId))
    .limit(1);
  if (!row?.type.isSpaceOnly) throw notFound();
  const pack = await packFor(standId);
  const [contractor] = await db.select().from(standContractors).where(eq(standContractors.standId, standId)).limit(1);
  const versions = pack ? await db.select().from(spaceOnlyVersions).where(eq(spaceOnlyVersions.packId, pack.id)).orderBy(desc(spaceOnlyVersions.version)) : [];
  const reviewRows = pack
    ? await db
        .select({ review: spaceOnlyReviews, reviewer: { name: users.name, email: users.email } })
        .from(spaceOnlyReviews)
        .leftJoin(users, eq(users.id, spaceOnlyReviews.reviewerId))
        .where(eq(spaceOnlyReviews.packId, pack.id))
        .orderBy(desc(spaceOnlyReviews.createdAt))
    : [];
  const ids = versions.flatMap((v) => Object.values(v.documents as Record<string, string[]>).flat());
  return {
    stand,
    edition: row.edition,
    company: row.company,
    hall: row.hall,
    contractor: contractor && contractor.status !== 'removed' ? contractor : null,
    pack,
    versions,
    reviews: reviewRows,
    files: await fileInfo(ids),
    rules: (row.edition.spaceOnlyRules ?? DEFAULT_SPACE_ONLY_RULES) as SpaceOnlyRules,
    canDecide: acc.permissions.has('review_space_only') && !actor.readOnly,
  };
}

export const REVIEW_DECISIONS = ['comment', 'under_review', 'approved', 'approved_with_conditions', 'changes_needed', 'rejected'] as const;

async function notifyPackPeople(standId: string, subject: string, paragraphs: string[], editionSlug: string) {
  const db = await getDb();
  const [stand] = await db.select().from(stands).where(eq(stands.id, standId)).limit(1);
  const [edition] = await db.select().from(editions).where(eq(editions.id, stand.editionId)).limit(1);
  const people = stand.companyId
    ? await db
        .select({ email: users.email, id: users.id })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId))
        .where(and(eq(companyMembers.companyId, stand.companyId), eq(users.status, 'active')))
    : [];
  const [contractor] = await db.select().from(standContractors).where(and(eq(standContractors.standId, standId), eq(standContractors.status, 'active'))).limit(1);
  const send = async (to: string, userId: string | null, path: string) => {
    const { html, text } = renderSimpleEmail({ heading: subject, paragraphs, button: { label: 'Open BluePrint', url: appUrl(path) }, brandColor: edition.branding.primaryColor, footer: edition.branding.footerText || edition.name });
    await sendEmail({ to, toUserId: userId, editionId: edition.id, companyId: stand.companyId, standId, templateKey: 'space_only_decision', category: 'transactional', subject, html, text });
  };
  for (const p of people) await send(p.email, p.id, `/portal/${editionSlug}/space-only`);
  if (contractor && !people.some((p) => p.email === contractor.contactEmail)) await send(contractor.contactEmail, contractor.userId, `/contractor/${standId}`);
}

/** Records a reviewer's comment or decision on the current version, and issues the certificate on approval. */
export async function reviewPack(
  actor: Actor,
  standId: string,
  input: { decision: (typeof REVIEW_DECISIONS)[number]; comment?: string | null; docType?: string | null; conditions?: string | null },
) {
  const db = await getDb();
  const [stand] = await db.select().from(stands).where(eq(stands.id, standId)).limit(1);
  if (!stand) throw notFound();
  const { role } = await requireReviewer(actor, stand.editionId, { write: true });
  const pack = await packFor(standId);
  if (!pack || !pack.currentVersion) throw conflict('Nothing has been sent for this stand yet.');
  if (!(REVIEW_DECISIONS as readonly string[]).includes(input.decision)) throw invalid('Choose a decision.');
  const comment = input.comment?.trim().slice(0, 4000) || null;
  const conditions = input.conditions?.trim().slice(0, 4000) || null;
  if (input.docType && !DOC_KEYS.has(input.docType)) throw invalid('Unknown document type.');
  if (input.decision === 'comment' && !comment) throw invalid('Write a comment first.', { comment: 'Write a comment first.' });
  if ((input.decision === 'changes_needed' || input.decision === 'rejected') && !comment) {
    throw invalid('Explain what needs to change.', { comment: 'Explain what needs to change.' });
  }
  if (input.decision === 'approved_with_conditions' && !conditions) throw invalid('Write the conditions.', { conditions: 'Write the conditions.' });

  const [edition] = await db.select().from(editions).where(eq(editions.id, stand.editionId)).limit(1);
  const [show] = await db.select().from(shows).where(eq(shows.id, edition.showId)).limit(1);
  const [company] = stand.companyId ? await db.select().from(companies).where(eq(companies.id, stand.companyId)).limit(1) : [];
  const now = new Date();

  await db.insert(spaceOnlyReviews).values({
    packId: pack.id,
    version: pack.currentVersion,
    reviewerId: actor.realUserId,
    reviewerRole: role,
    outcome: input.decision === 'under_review' ? 'comment' : input.decision,
    docType: input.docType ?? null,
    comment: input.decision === 'under_review' ? comment ?? 'Review started.' : input.decision === 'approved_with_conditions' ? [conditions, comment].filter(Boolean).join('\n\n') : comment,
  });

  if (input.decision === 'under_review') {
    await db.update(spaceOnlyPacks).set({ status: 'under_review' }).where(eq(spaceOnlyPacks.id, pack.id));
  } else if (input.decision !== 'comment') {
    let certificateFileId: string | null = null;
    if (input.decision === 'approved' || input.decision === 'approved_with_conditions') {
      const [contractor] = await db.select().from(standContractors).where(eq(standContractors.standId, standId)).limit(1);
      const [hall] = stand.hallId ? await db.select().from(halls).where(eq(halls.id, stand.hallId)).limit(1) : [];
      const [approver] = await db.select().from(users).where(eq(users.id, actor.realUserId)).limit(1);
      const reference = `PTB-${edition.slug.toUpperCase().slice(0, 12)}-${stand.number.replace(/[^A-Za-z0-9]/g, '')}-${pack.currentVersion}`;
      const pdf = await renderCertificate({
        reference,
        showName: show.name,
        editionName: edition.name,
        venue: edition.venue,
        standNumber: stand.number,
        hall: hall?.name ?? null,
        exhibitor: company?.name ?? '',
        contractor: contractor && contractor.status !== 'removed' ? contractor.contractorCompanyName : null,
        version: pack.currentVersion,
        approvedAt: now,
        approvedBy: approver?.name || approver?.email || 'The show team',
        conditions: input.decision === 'approved_with_conditions' ? conditions : null,
        buildUp: edition.buildUpStartsAt,
        breakdownEnds: edition.breakdownEndsAt,
        brandColor: edition.branding.primaryColor,
      });
      const file = await storeGeneratedFile({
        purpose: 'certificate',
        filename: `Permission to build - stand ${stand.number}.pdf`,
        contentType: 'application/pdf',
        body: pdf,
        editionId: edition.id,
        companyId: stand.companyId,
        standId,
      });
      certificateFileId = file.id;
    }
    await db
      .update(spaceOnlyPacks)
      .set({
        status: input.decision,
        decidedAt: now,
        decidedBy: actor.realUserId,
        conditions: input.decision === 'approved_with_conditions' ? conditions : null,
        // The exhibitor's working copy still holds what they sent, so changes start from there.
        certificateFileId,
      })
      .where(eq(spaceOnlyPacks.id, pack.id));
    await syncTasks(standId);
    const subjects: Record<string, string> = {
      approved: `Approved: your space-only stand ${stand.number}`,
      approved_with_conditions: `Approved with conditions: your space-only stand ${stand.number}`,
      changes_needed: `Changes needed: your space-only stand ${stand.number}`,
      rejected: `Not approved: your space-only stand ${stand.number}`,
    };
    const paragraphs =
      input.decision === 'approved' || input.decision === 'approved_with_conditions'
        ? [
            `The ${edition.name} team has approved the stand pack for stand ${stand.number}. Your permission-to-build certificate is ready in BluePrint. Keep it on the stand during build-up.`,
            ...(conditions ? [`Conditions: ${conditions}`] : []),
            ...(comment ? [`Note from the team: ${comment}`] : []),
          ]
        : [`The ${edition.name} team has reviewed the stand pack for stand ${stand.number}.`, `What needs to change: ${comment}`];
    await notifyPackPeople(standId, subjects[input.decision], paragraphs, edition.slug);
  }
  await audit(actor, `space_only.${input.decision}`, {
    entityType: 'stand',
    entityId: standId,
    editionId: stand.editionId,
    companyId: stand.companyId,
    details: { version: pack.currentVersion, role, docType: input.docType ?? null },
  });
}
