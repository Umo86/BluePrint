import 'server-only';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import {
  campaigns,
  companies,
  companyMembers,
  editions,
  exhibitorTypes,
  halls,
  serviceCategories,
  stands,
  submissions,
  taskRequirements,
  tasks,
  unsubscribes,
  users,
  type CampaignFilter,
} from '../db/schema';
import { memberCovers, requireEditionPermission } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { appUrl } from '../auth/login';
import { env } from '../env';
import { sendEmail } from '../email/send';
import { escapeHtml } from '../email/simple';
import { renderEmail } from '../email/render';
import { brandingFor, checkTemplateImages, editionVars, senderFor, templateContentSchema } from '../email/templates';
import { assertRateLimit } from '../security/rate-limit';
import { signToken, verifyToken } from '../security/signed-token';
import { sendQueuedEmails } from './housekeeping';
import { standsWithoutOrderFrom } from './stands';
import type { Actor } from '../auth/actor';

/**
 * Show-wide emails to a chosen group of exhibitors ("build-up times have changed", "last chance
 * to order electrics"). Emails are queued and sent in batches; everyone can unsubscribe from
 * these, but never from service emails such as deadlines and orders.
 */

const uuid = z.string().uuid();
export const campaignFilterSchema = z.object({
  exhibitorTypeIds: z.array(uuid).max(50).default([]),
  hallIds: z.array(uuid).max(50).default([]),
  taskNotDoneId: uuid.nullable().optional(),
  categoryNotOrderedId: uuid.nullable().optional(),
  neverSignedIn: z.boolean().default(false),
  standIds: z.array(uuid).max(5000).default([]),
  audience: z.enum(['main_contacts', 'everyone']).default('main_contacts'),
});
export type CampaignAudience = z.infer<typeof campaignFilterSchema>;

export const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Name the email (only your team sees this).').max(150),
  subject: templateContentSchema.shape.subject,
  blocks: templateContentSchema.shape.blocks,
  filter: campaignFilterSchema,
});

type EditionRow = typeof editions.$inferSelect;
type Recipient = { userId: string; email: string; name: string; standId: string; standNumber: string; hallName: string | null; companyId: string; companyName: string };

const DONE = ['completed', 'approved', 'not_needed'];

/** Everyone a campaign would go to, one entry per email address. */
export async function recipientsFor(editionId: string, raw: CampaignFilter | CampaignAudience): Promise<Recipient[]> {
  const f = campaignFilterSchema.parse(raw ?? {});
  const db = await getDb();
  const conds = [eq(stands.editionId, editionId), eq(stands.status, 'active')];
  if (f.exhibitorTypeIds.length) conds.push(inArray(stands.exhibitorTypeId, f.exhibitorTypeIds));
  if (f.hallIds.length) conds.push(inArray(stands.hallId, f.hallIds));
  if (f.standIds.length) conds.push(inArray(stands.id, f.standIds));
  let rows = await db
    .select({ stand: stands, company: companies, hallName: halls.name })
    .from(stands)
    .innerJoin(companies, eq(companies.id, stands.companyId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .where(and(...conds))
    .orderBy(asc(stands.number));
  if (f.taskNotDoneId) {
    const reqs = await db.select().from(taskRequirements).where(eq(taskRequirements.taskId, f.taskNotDoneId));
    const subs = await db.select().from(submissions).where(and(eq(submissions.taskId, f.taskNotDoneId), inArray(submissions.status, DONE as never)));
    const done = new Set(subs.map((s) => s.standId));
    rows = rows.filter((r) => reqs.some((q) => q.exhibitorTypeId === r.stand.exhibitorTypeId) && !done.has(r.stand.id));
  }
  if (f.categoryNotOrderedId) {
    const without = await standsWithoutOrderFrom(editionId, f.categoryNotOrderedId);
    rows = rows.filter((r) => without.has(r.stand.id));
  }
  if (!rows.length) return [];
  const companyIds = [...new Set(rows.map((r) => r.company.id))];
  const memberConds = [inArray(companyMembers.companyId, companyIds), eq(users.status, 'active'), memberCovers(editionId)];
  if (f.audience === 'main_contacts') memberConds.push(eq(companyMembers.role, 'main_contact'));
  if (f.neverSignedIn) memberConds.push(isNull(users.lastLoginAt));
  const people = await db
    .select({ companyId: companyMembers.companyId, userId: users.id, email: users.email, name: users.name })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(and(...memberConds));
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of rows) {
    for (const p of people.filter((x) => x.companyId === r.company.id)) {
      if (seen.has(p.email)) continue;
      seen.add(p.email);
      out.push({ userId: p.userId, email: p.email, name: p.name, standId: r.stand.id, standNumber: r.stand.number, hallName: r.hallName, companyId: r.company.id, companyName: r.company.name });
    }
  }
  return out;
}

async function unsubscribedOf(editionId: string, emails: string[]) {
  if (!emails.length) return new Set<string>();
  const db = await getDb();
  const rows = await db.select({ email: unsubscribes.email, editionId: unsubscribes.editionId }).from(unsubscribes).where(inArray(unsubscribes.email, emails));
  return new Set(rows.filter((r) => r.editionId === null || r.editionId === editionId).map((r) => r.email));
}

/** How many people a filter reaches (and how many of them have unsubscribed), for the editor. */
export async function audienceSize(actor: Actor, editionId: string, filter: CampaignAudience) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const list = await recipientsFor(editionId, filter);
  const unsub = await unsubscribedOf(
    editionId,
    list.map((r) => r.email),
  );
  return { recipients: list.length - unsub.size, unsubscribed: unsub.size, stands: new Set(list.map((r) => r.standId)).size };
}

export async function listCampaigns(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const db = await getDb();
  return db.select().from(campaigns).where(eq(campaigns.editionId, editionId)).orderBy(desc(campaigns.createdAt));
}

async function loadCampaign(actor: Actor, campaignId: string, write: boolean) {
  const db = await getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!c) throw notFound();
  await requireEditionPermission(actor, c.editionId, 'send_emails', { write });
  return c;
}

export async function getCampaign(actor: Actor, campaignId: string) {
  return loadCampaign(actor, campaignId, false);
}

/** What the editor needs to build a filter: stand types, halls, tasks and shop categories. */
export async function audienceOptions(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const db = await getDb();
  const [types, hallRows, taskRows, cats] = await Promise.all([
    db.select({ id: exhibitorTypes.id, name: exhibitorTypes.name }).from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId)).orderBy(asc(exhibitorTypes.sort)),
    db.select({ id: halls.id, name: halls.name }).from(halls).where(eq(halls.editionId, editionId)).orderBy(asc(halls.sort)),
    db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(eq(tasks.editionId, editionId), eq(tasks.published, true))).orderBy(asc(tasks.sort)),
    db.select({ id: serviceCategories.id, name: serviceCategories.name }).from(serviceCategories).where(eq(serviceCategories.editionId, editionId)).orderBy(asc(serviceCategories.sort)),
  ]);
  return { types, halls: hallRows, tasks: taskRows, categories: cats };
}

async function checkContent(data: z.infer<typeof campaignSchema>, editionId: string) {
  const bad = await checkTemplateImages({ subject: data.subject, preheader: '', blocks: data.blocks });
  if (bad.length) throw invalid('Images in emails must be uploaded as show branding images.');
  const db = await getDb();
  const f = data.filter;
  if (f.taskNotDoneId) {
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, f.taskNotDoneId), eq(tasks.editionId, editionId))).limit(1);
    if (!t) throw invalid('Choose a task from this show.');
  }
  if (f.categoryNotOrderedId) {
    const [c] = await db.select({ id: serviceCategories.id }).from(serviceCategories).where(and(eq(serviceCategories.id, f.categoryNotOrderedId), eq(serviceCategories.editionId, editionId))).limit(1);
    if (!c) throw invalid('Choose a shop category from this show.');
  }
}

export async function createCampaign(actor: Actor, editionId: string, raw: z.input<typeof campaignSchema>) {
  await requireEditionPermission(actor, editionId, 'send_emails', { write: true });
  const data = campaignSchema.parse(raw);
  await checkContent(data, editionId);
  const db = await getDb();
  const [c] = await db.insert(campaigns).values({ editionId, name: data.name, subject: data.subject, blocks: data.blocks, filter: data.filter, createdBy: actor.realUserId }).returning();
  await audit(actor, 'campaign.created', { entityType: 'campaign', entityId: c.id, editionId, details: { name: c.name } });
  return c;
}

export async function updateCampaign(actor: Actor, campaignId: string, raw: z.input<typeof campaignSchema>) {
  const c = await loadCampaign(actor, campaignId, true);
  if (c.status !== 'draft' && c.status !== 'scheduled') throw conflict('This email has already been sent.');
  const data = campaignSchema.parse(raw);
  await checkContent(data, c.editionId);
  const db = await getDb();
  await db.update(campaigns).set({ name: data.name, subject: data.subject, blocks: data.blocks, filter: data.filter }).where(eq(campaigns.id, campaignId));
  await audit(actor, 'campaign.updated', { entityType: 'campaign', entityId: campaignId, editionId: c.editionId });
}

export async function deleteCampaign(actor: Actor, campaignId: string) {
  const c = await loadCampaign(actor, campaignId, true);
  if (c.status === 'sending' || c.status === 'sent') throw conflict('Sent emails are kept as a record.');
  const db = await getDb();
  await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  await audit(actor, 'campaign.deleted', { entityType: 'campaign', entityId: campaignId, editionId: c.editionId, details: { name: c.name } });
}

export function unsubscribeUrl(email: string, editionId: string) {
  return appUrl(`/unsubscribe/${signToken('unsubscribe', { e: email, d: editionId })}`);
}

/** Renders a campaign once, with markers where each person's details go, then fills them in per person. */
async function renderForRecipients(edition: EditionRow, c: { subject: string; blocks: typeof campaigns.$inferSelect.blocks }) {
  const mark = (k: string) => `⁣${k}⁣`;
  const personal = ['first_name', 'name', 'company', 'stand', 'hall', 'unsubscribe_url'];
  const rendered = await renderEmail({
    subject: c.subject,
    blocks: c.blocks,
    vars: { ...editionVars(edition), portal_link: appUrl(`/portal/${edition.slug}`), ...Object.fromEntries(personal.map((k) => [k, mark(k)])) },
    branding: brandingFor(edition),
    unsubscribeUrl: mark('unsubscribe_url'),
    baseUrl: env().APP_URL,
  });
  return (r: Recipient) => {
    const values: Record<string, string> = {
      first_name: (r.name || '').split(' ')[0] || 'there',
      name: r.name,
      company: r.companyName,
      stand: r.standNumber,
      hall: r.hallName ?? '',
      unsubscribe_url: unsubscribeUrl(r.email, edition.id),
    };
    const fill = (s: string, esc: boolean) => s.replace(/⁣([a-z_]+)⁣/g, (_, k: string) => (esc ? escapeHtml(values[k] ?? '') : (values[k] ?? '')));
    // Names can contain line breaks; a subject never may.
    return { subject: fill(rendered.subject, false).replace(/[\r\n]+/g, ' ').slice(0, 250), html: fill(rendered.html, true), text: fill(rendered.text, false), unsubscribe: values.unsubscribe_url };
  };
}

/** Sends a test copy to the person editing it. */
export async function sendCampaignTest(actor: Actor, campaignId: string) {
  const c = await loadCampaign(actor, campaignId, true);
  await assertRateLimit(`campaign-test:${actor.realUserId}`, 30, 3600);
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, c.editionId)).limit(1);
  const [sample] = await recipientsFor(c.editionId, c.filter);
  const make = await renderForRecipients(edition, c);
  const m = make({ userId: actor.userId, email: actor.email, name: actor.name, standId: sample?.standId ?? '', standNumber: sample?.standNumber ?? 'A100', hallName: sample?.hallName ?? null, companyId: sample?.companyId ?? '', companyName: sample?.companyName ?? 'Example Ltd' });
  const sender = await senderFor(edition, 'campaign');
  await sendEmail({ to: actor.email, toUserId: actor.userId, editionId: edition.id, templateKey: 'campaign_test', category: 'transactional', subject: `[Test] ${m.subject}`, html: m.html, text: m.text, from: sender.from, replyTo: sender.replyTo, sentBy: actor.realUserId });
}

/** Sends now, or schedules for later. */
export async function sendCampaign(actor: Actor, campaignId: string, opts: { at?: Date | null } = {}) {
  const c = await loadCampaign(actor, campaignId, true);
  if (c.status !== 'draft' && c.status !== 'scheduled') throw conflict('This email has already been sent.');
  const db = await getDb();
  if (opts.at && opts.at.getTime() > Date.now() + 60_000) {
    if (opts.at.getTime() > Date.now() + 365 * 86_400_000) throw invalid('Choose a date within the next year.');
    await db.update(campaigns).set({ status: 'scheduled', scheduledFor: opts.at }).where(eq(campaigns.id, campaignId));
    await audit(actor, 'campaign.scheduled', { entityType: 'campaign', entityId: campaignId, editionId: c.editionId, details: { at: opts.at.toISOString() } });
    return { scheduled: true, recipients: 0 };
  }
  const r = await enqueueCampaign(campaignId, actor);
  // Start sending straight away; the scheduled job sends whatever is left.
  await sendQueuedEmails({ limit: 100 });
  return { scheduled: false, recipients: r.recipients };
}

export async function cancelScheduledCampaign(actor: Actor, campaignId: string) {
  const c = await loadCampaign(actor, campaignId, true);
  if (c.status !== 'scheduled') throw conflict('Only scheduled emails can be cancelled.');
  const db = await getDb();
  await db.update(campaigns).set({ status: 'draft', scheduledFor: null }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'scheduled')));
  await audit(actor, 'campaign.unscheduled', { entityType: 'campaign', entityId: campaignId, editionId: c.editionId });
}

/**
 * Queues a campaign for everyone in its audience. The status change is atomic, so a campaign
 * is never queued twice even if "send" is pressed twice or the scheduler runs at the same time.
 */
async function enqueueCampaign(campaignId: string, actor: Actor | null) {
  const db = await getDb();
  const [c] = await db
    .update(campaigns)
    .set({ status: 'sending' })
    .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, ['draft', 'scheduled'])))
    .returning();
  if (!c) throw conflict('This email is already being sent.');
  try {
    const [edition] = await db.select().from(editions).where(eq(editions.id, c.editionId)).limit(1);
    const list = await recipientsFor(c.editionId, c.filter);
    if (!list.length) throw invalid('Nobody matches this audience.');
    await assertRateLimit(`bulk-email:${c.editionId}`, 5000, 24 * 3600, list.length);
    const make = await renderForRecipients(edition, c);
    const sender = await senderFor(edition, 'campaign');
    for (const r of list) {
      const m = make(r);
      await sendEmail({
        to: r.email,
        toUserId: r.userId,
        editionId: c.editionId,
        companyId: r.companyId,
        standId: r.standId,
        templateKey: 'campaign',
        category: 'campaign',
        subject: m.subject,
        html: m.html,
        text: m.text,
        from: sender.from,
        replyTo: sender.replyTo,
        campaignId: c.id,
        sentBy: actor?.realUserId ?? c.createdBy,
        deferred: true,
        headers: { 'List-Unsubscribe': `<${m.unsubscribe.replace('/unsubscribe/', '/api/unsubscribe/')}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
    }
    await db.update(campaigns).set({ status: 'sent', sentAt: new Date(), recipients: list.length }).where(eq(campaigns.id, c.id));
    await audit(actor, 'campaign.sent', { entityType: 'campaign', entityId: c.id, editionId: c.editionId, details: { name: c.name, recipients: list.length } });
    return { recipients: list.length };
  } catch (err) {
    await db.update(campaigns).set({ status: c.scheduledFor ? 'scheduled' : 'draft' }).where(eq(campaigns.id, c.id));
    throw err;
  }
}

/** For the scheduler: queues campaigns whose time has come. */
export async function processScheduledCampaigns(now = new Date()) {
  const db = await getDb();
  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'scheduled'), lte(campaigns.scheduledFor, now)))
    .limit(20);
  let queued = 0;
  const problems: string[] = [];
  for (const d of due) {
    try {
      queued += (await enqueueCampaign(d.id, null)).recipients;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { campaigns: due.length, queued, problems };
}

/** Records an unsubscribe from a signed link. Returns the address and show name, for the confirmation page. */
export async function unsubscribeWithToken(token: string) {
  const data = verifyToken('unsubscribe', token);
  if (!data?.e || !data.d || !/^[0-9a-f-]{36}$/i.test(data.d)) return null;
  const db = await getDb();
  const [edition] = await db.select({ id: editions.id, name: editions.name }).from(editions).where(eq(editions.id, data.d)).limit(1);
  if (!edition) return null;
  await db.insert(unsubscribes).values({ email: data.e.toLowerCase(), editionId: edition.id }).onConflictDoNothing();
  await audit(null, 'email.unsubscribed', { editionId: edition.id, details: { email: data.e } });
  return { email: data.e, show: edition.name };
}

/** Reads a token without acting on it (the page asks the person to confirm first). */
export async function describeUnsubscribe(token: string) {
  const data = verifyToken('unsubscribe', token);
  if (!data?.e || !data.d || !/^[0-9a-f-]{36}$/i.test(data.d)) return null;
  const db = await getDb();
  const [edition] = await db.select({ name: editions.name }).from(editions).where(eq(editions.id, data.d)).limit(1);
  return edition ? { email: data.e, show: edition.name } : null;
}

// ---------------------------------------------------------------------------
// Drafts started from other pages
// ---------------------------------------------------------------------------

/** Starts an email to particular stands (chosen on the exhibitors list or the overview), for the team to finish. */
export async function draftCampaignForStands(actor: Actor, editionId: string, standIdsRaw: string[]) {
  await requireEditionPermission(actor, editionId, 'send_emails', { write: true });
  const standIds = z.array(uuid).min(1, 'Choose at least one exhibitor.').max(5000).parse([...new Set(standIdsRaw)]);
  const db = await getDb();
  const found = await db
    .select({ id: stands.id })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), inArray(stands.id, standIds)));
  if (found.length !== standIds.length) throw invalid('Some of those stands are not in this show.');
  return createCampaign(actor, editionId, {
    name: `Email to ${found.length} chosen ${found.length === 1 ? 'stand' : 'stands'}`,
    subject: 'A message about {{show}}',
    blocks: [
      { type: 'paragraph', text: 'Hello {{first_name}},' },
      { type: 'paragraph', text: 'Write your message here.' },
      { type: 'button', label: 'Open your exhibitor portal', url: '{{portal_link}}' },
    ],
    filter: { standIds, audience: 'main_contacts' },
  });
}

/** Starts a reminder about one task to every stand that has not done it yet. */
export async function draftTaskReminder(actor: Actor, taskId: string) {
  const db = await getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw notFound();
  await requireEditionPermission(actor, task.editionId, 'send_emails', { write: true });
  return createCampaign(actor, task.editionId, {
    name: `Reminder: ${task.title}`.slice(0, 150),
    subject: `Reminder: ${task.title}`.slice(0, 250),
    blocks: [
      { type: 'paragraph', text: 'Hello {{first_name}},' },
      { type: 'paragraph', text: `We have not yet had “${task.title}” for stand {{stand}}. Please complete it in your exhibitor portal as soon as you can.` },
      { type: 'button', label: 'Open your checklist', url: '{{portal_link}}' },
      { type: 'paragraph', text: 'If you have already done this, thank you, and please ignore this email.' },
    ],
    filter: { taskNotDoneId: task.id, audience: 'main_contacts' },
  });
}
