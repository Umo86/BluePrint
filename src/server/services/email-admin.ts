import 'server-only';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { emailEvents, emailOutbox, emailTemplates, editions, EMAIL_STATUSES, type EmailStatus } from '../db/schema';
import { requireEditionPermission } from '../authz';
import { invalid, notFound } from '../errors';
import { audit } from '../audit';
import { appUrl } from '../auth/login';
import { env } from '../env';
import { hideSecrets, sendEmail } from '../email/send';
import { renderEmail, TEMPLATE_VARIABLES } from '../email/render';
import {
  EDITABLE_KEYS,
  EDITABLE_TEMPLATES,
  brandingFor,
  checkTemplateImages,
  editionVars,
  missingRequired,
  senderFor,
  templateContentSchema,
  templateFor,
  type EditableTemplateKey,
  type TemplateContent,
} from '../email/templates';
import { assertRateLimit } from '../security/rate-limit';
import type { Actor } from '../auth/actor';

function editableKey(key: string): EditableTemplateKey {
  if (!(EDITABLE_KEYS as string[]).includes(key)) throw notFound();
  return key as EditableTemplateKey;
}

async function editionOrThrow(editionId: string) {
  const db = await getDb();
  const [e] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!e) throw notFound();
  return e;
}

export async function listTemplates(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const out = [];
  for (const key of EDITABLE_KEYS) {
    const t = await templateFor(editionId, key);
    out.push({ key, name: EDITABLE_TEMPLATES[key].name, description: EDITABLE_TEMPLATES[key].description, custom: t.custom, updatedAt: t.updatedAt, subject: t.subject });
  }
  return out;
}

export async function templateForEdit(actor: Actor, editionId: string, rawKey: string) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const key = editableKey(rawKey);
  const t = await templateFor(editionId, key);
  const def = EDITABLE_TEMPLATES[key];
  const variables = def.variables.map((k) => ({ key: k, label: TEMPLATE_VARIABLES[k] ?? k.replace(/_/g, ' ') }));
  return { key, name: def.name, description: def.description, content: { subject: t.subject, preheader: t.preheader, blocks: t.blocks }, custom: t.custom, variables, allowTasksDue: key === 'reminder_digest', required: def.required };
}

async function validated(key: EditableTemplateKey, raw: unknown) {
  const content = templateContentSchema.parse(raw);
  const missing = missingRequired(key, content);
  if (missing.length) throw invalid(`This email must include ${missing.map((m) => `{{${m}}}`).join(', ')} (for example in a button link).`);
  if ((await checkTemplateImages(content)).length) throw invalid('Images in emails must be uploaded here, so they can be shown in email apps.');
  if (key !== 'reminder_digest' && content.blocks.some((b) => b.type === 'tasks_due')) throw invalid('The list of things due only works in reminder emails.');
  return content;
}

export async function saveTemplate(actor: Actor, editionId: string, rawKey: string, raw: unknown) {
  await requireEditionPermission(actor, editionId, 'send_emails', { write: true });
  const key = editableKey(rawKey);
  const content = await validated(key, raw);
  const db = await getDb();
  const [existing] = await db.select({ id: emailTemplates.id }).from(emailTemplates).where(and(eq(emailTemplates.editionId, editionId), eq(emailTemplates.key, key))).limit(1);
  const values = { subject: content.subject, preheader: content.preheader, blocks: content.blocks, updatedBy: actor.realUserId };
  if (existing) await db.update(emailTemplates).set(values).where(eq(emailTemplates.id, existing.id));
  else await db.insert(emailTemplates).values({ editionId, key, name: EDITABLE_TEMPLATES[key].name, category: EDITABLE_TEMPLATES[key].category, ...values });
  await audit(actor, 'email.template_saved', { entityType: 'email_template', entityId: key, editionId });
}

export async function resetTemplate(actor: Actor, editionId: string, rawKey: string) {
  await requireEditionPermission(actor, editionId, 'send_emails', { write: true });
  const key = editableKey(rawKey);
  const db = await getDb();
  await db.delete(emailTemplates).where(and(eq(emailTemplates.editionId, editionId), eq(emailTemplates.key, key)));
  await audit(actor, 'email.template_reset', { entityType: 'email_template', entityId: key, editionId });
}

/** Sample details used in previews and test sends. */
function sampleVars(edition: typeof editions.$inferSelect, actor: Actor) {
  return {
    ...editionVars(edition),
    first_name: (actor.name || 'Alex').split(' ')[0],
    name: actor.name || 'Alex Example',
    company: 'Example Exhibitor Ltd',
    stand: 'A100',
    hall: 'N1',
    portal_link: appUrl(`/portal/${edition.slug}`),
    invite_link: appUrl('/invite/example'),
    count: '3 things',
    order_number: 'ORD-000123',
    order_total: '£240.00',
    order_link: appUrl(`/portal/${edition.slug}/orders`),
    order_lines: '4 × Folding chair: £86.40\n1 × 500 W power socket: £102.00',
    payment_note: 'We have received your payment of £188.40 for stand A100.',
  };
}

const SAMPLE_DUE = [
  { title: 'Stand team details', due: '12 April, 17:00', url: '#', overdue: false },
  { title: 'Health and safety declaration', due: '1 April, 17:00', url: '#', overdue: true },
];

/** Renders what someone is editing (not yet saved), for the preview and the HTML view. */
export async function previewTemplate(actor: Actor, editionId: string, rawKey: string, raw: unknown) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const key = editableKey(rawKey);
  const content = templateContentSchema.parse(raw);
  const edition = await editionOrThrow(editionId);
  return renderEmail({ ...content, vars: sampleVars(edition, actor), branding: brandingFor(edition), due: key === 'reminder_digest' ? SAMPLE_DUE : null, baseUrl: env().APP_URL });
}

/** Renders a campaign being edited, for its preview. */
export async function previewContent(actor: Actor, editionId: string, raw: Pick<TemplateContent, 'subject' | 'blocks'>) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const content = templateContentSchema.parse({ ...raw, preheader: '' });
  const edition = await editionOrThrow(editionId);
  return renderEmail({ ...content, vars: sampleVars(edition, actor), branding: brandingFor(edition), unsubscribeUrl: appUrl('/unsubscribe/example'), baseUrl: env().APP_URL });
}

export async function sendTemplateTest(actor: Actor, editionId: string, rawKey: string, raw: unknown) {
  await requireEditionPermission(actor, editionId, 'send_emails', { write: true });
  await assertRateLimit(`template-test:${actor.realUserId}`, 30, 3600);
  const key = editableKey(rawKey);
  const content = await validated(key, raw);
  const edition = await editionOrThrow(editionId);
  const r = await renderEmail({ ...content, vars: sampleVars(edition, actor), branding: brandingFor(edition), due: key === 'reminder_digest' ? SAMPLE_DUE : null, baseUrl: env().APP_URL });
  const sender = await senderFor(edition, 'transactional');
  await sendEmail({ to: actor.email, toUserId: actor.userId, editionId, templateKey: `${key}_test`, category: 'transactional', subject: `[Test] ${r.subject}`, html: r.html, text: r.text, from: sender.from, replyTo: sender.replyTo, sentBy: actor.realUserId });
}

export const LOG_FILTERS = ['all', 'problems', 'campaign', 'reminder', 'transactional'] as const;

/** Every email sent for a show, with its delivery status. */
export async function emailLog(actor: Actor, editionId: string, opts: { filter?: (typeof LOG_FILTERS)[number]; q?: string; page?: number } = {}) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const db = await getDb();
  const conds = [eq(emailOutbox.editionId, editionId)];
  const f = opts.filter ?? 'all';
  if (f === 'problems') conds.push(inArray(emailOutbox.status, ['bounced', 'complained', 'failed', 'suppressed'] as EmailStatus[]));
  else if (f !== 'all') conds.push(eq(emailOutbox.category, f));
  const q = (opts.q ?? '').trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(emailOutbox.toEmail, like), ilike(emailOutbox.subject, like))!);
  }
  const pageSize = 50;
  const page = Math.max(1, Math.min(1000, opts.page ?? 1));
  const rows = await db
    .select({ id: emailOutbox.id, toEmail: emailOutbox.toEmail, subject: emailOutbox.subject, status: emailOutbox.status, category: emailOutbox.category, createdAt: emailOutbox.createdAt, error: emailOutbox.error })
    .from(emailOutbox)
    .where(and(...conds))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(emailOutbox).where(and(...conds));
  return { rows, total: Number(n), page, pageSize, statuses: EMAIL_STATUSES };
}

/** One email as it was sent, with its delivery history (team only). */
export async function emailDetail(actor: Actor, editionId: string, outboxId: string) {
  await requireEditionPermission(actor, editionId, 'send_emails');
  const db = await getDb();
  const [row] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.id, outboxId), eq(emailOutbox.editionId, editionId))).limit(1);
  if (!row) throw notFound();
  const events = await db.select().from(emailEvents).where(eq(emailEvents.outboxId, row.id)).orderBy(desc(emailEvents.at));
  // Invitation and unsubscribe links (and any codes) belong to the recipient, not the show team.
  const mail = { ...row, subject: hideSecrets(row.subject, row.category), html: hideSecrets(row.html, row.category), text: hideSecrets(row.text, row.category), headers: null };
  return { mail, events };
}
