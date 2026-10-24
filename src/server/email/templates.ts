import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { emailTemplates, editions, files, type EmailBlock } from '../db/schema';
import { env } from '../env';
import { getPlatformSettings } from '../services/settings';
import { renderEmail, type DueItem, type EmailBranding, type TemplateVars } from './render';

/**
 * Emails the show team can reword for their show. Security emails (sign-in codes) are never
 * editable. Each has a default, used until the team saves their own version.
 */
export const EDITABLE_TEMPLATES = {
  invite_exhibitor: {
    name: 'Invitation to the exhibitor portal',
    description: 'Sent when an exhibitor contact is invited.',
    category: 'transactional',
    variables: ['invite_link', 'company', 'show', 'stand', 'venue', 'build_up', 'show_opens'],
    required: ['invite_link'],
    default: {
      subject: 'Your exhibitor portal for {{show}}',
      preheader: 'Everything you need for stand {{stand}}, in one place.',
      blocks: [
        { type: 'heading', text: 'Welcome to {{show}}' },
        { type: 'paragraph', text: 'You have been invited to the online exhibitor manual for {{company}}, stand {{stand}}. Everything you need to do before the show is listed there, with deadlines, and you can order your stand services.' },
        { type: 'button', label: 'Open your exhibitor portal', url: '{{invite_link}}' },
        { type: 'paragraph', text: 'This link is just for you and expires in 14 days. If you were not expecting it, you can ignore this email.' },
      ] as EmailBlock[],
    },
  },
  reminder_digest: {
    name: 'Deadline reminders',
    description: 'Sent when tasks are coming up or overdue. The list of tasks fills itself in for each stand.',
    category: 'reminder',
    variables: ['first_name', 'company', 'show', 'stand', 'portal_link', 'count'],
    required: [],
    default: {
      subject: '{{show}}: {{count}} to do for stand {{stand}}',
      preheader: 'A friendly reminder of what is coming up.',
      blocks: [
        { type: 'heading', text: 'Hello {{first_name}}' },
        { type: 'paragraph', text: 'A friendly reminder of what still needs doing for stand {{stand}} at {{show}}:' },
        { type: 'tasks_due' },
        { type: 'button', label: 'Open your checklist', url: '{{portal_link}}' },
        { type: 'paragraph', text: 'If something does not apply to you, you can mark it as not needed in the portal and we will stop reminding you.' },
      ] as EmailBlock[],
    },
  },
  order_confirmation: {
    name: 'Order confirmation',
    description: 'Sent when an exhibitor pays for an order or places it on invoice.',
    category: 'transactional',
    variables: ['first_name', 'company', 'show', 'stand', 'order_number', 'order_total', 'order_link', 'order_lines', 'payment_note'],
    required: ['order_link'],
    default: {
      subject: 'Order {{order_number}} confirmed: {{show}}',
      preheader: 'Your services for stand {{stand}}.',
      blocks: [
        { type: 'heading', text: 'Thank you for your order' },
        { type: 'paragraph', text: '{{payment_note}}' },
        { type: 'paragraph', text: '{{order_lines}}' },
        { type: 'button', label: 'View your order and invoice', url: '{{order_link}}' },
      ] as EmailBlock[],
    },
  },
} as const;

export type EditableTemplateKey = keyof typeof EDITABLE_TEMPLATES;
export const EDITABLE_KEYS = Object.keys(EDITABLE_TEMPLATES) as EditableTemplateKey[];

const text = z.string().max(5000);
export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().max(300) }),
  z.object({ type: z.literal('paragraph'), text }),
  z.object({ type: z.literal('button'), label: z.string().trim().min(1, 'Give the button a label.').max(80), url: z.string().trim().min(1, 'Add the button link.').max(1000) }),
  z.object({ type: z.literal('tasks_due') }),
  z.object({ type: z.literal('image'), fileId: z.string().uuid(), alt: z.string().max(200).default('') }),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('html'), html: z.string().max(50_000) }),
]);

export const templateContentSchema = z.object({
  subject: z.string().trim().min(1, 'Enter a subject.').max(250),
  preheader: z.string().trim().max(200).default(''),
  blocks: z.array(blockSchema).min(1, 'Add at least one block.').max(40),
});
export type TemplateContent = z.infer<typeof templateContentSchema>;

/** Checks a template still has the variables it cannot work without (for example the invitation link). */
export function missingRequired(key: EditableTemplateKey, content: TemplateContent) {
  const all = [content.subject, content.preheader, ...content.blocks.map((b) => JSON.stringify(b))].join(' ');
  return EDITABLE_TEMPLATES[key].required.filter((v) => !new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`).test(all));
}

/** Images in emails must be public files (logos, branding), because email clients fetch them without signing in. */
export async function checkTemplateImages(content: TemplateContent) {
  const ids = content.blocks.filter((b): b is Extract<EmailBlock, { type: 'image' }> => b.type === 'image').map((b) => b.fileId);
  if (!ids.length) return [];
  const db = await getDb();
  const bad: string[] = [];
  for (const id of ids) {
    const [f] = await db.select({ isPublic: files.isPublic, verifiedAt: files.verifiedAt, deletedAt: files.deletedAt }).from(files).where(eq(files.id, id)).limit(1);
    if (!f || !f.isPublic || !f.verifiedAt || f.deletedAt) bad.push(id);
  }
  return bad;
}

/** The show's saved version of a template, or the default. */
export async function templateFor(editionId: string | null, key: EditableTemplateKey): Promise<TemplateContent & { custom: boolean; updatedAt: Date | null }> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(emailTemplates)
    .where(and(editionId ? eq(emailTemplates.editionId, editionId) : isNull(emailTemplates.editionId), eq(emailTemplates.key, key)))
    .limit(1);
  if (row) return { subject: row.subject, preheader: row.preheader, blocks: row.blocks, custom: true, updatedAt: row.updatedAt };
  const d = EDITABLE_TEMPLATES[key].default;
  return { subject: d.subject, preheader: d.preheader, blocks: [...d.blocks], custom: false, updatedAt: null };
}

type EditionRow = typeof editions.$inferSelect;

export function brandingFor(edition: EditionRow): EmailBranding {
  const base = env().APP_URL.replace(/\/$/, '');
  return {
    showName: edition.name,
    logoUrl: edition.branding.logoFileId ? `${base}/files/${edition.branding.logoFileId}` : null,
    color: edition.branding.primaryColor ?? null,
    footer: edition.branding.footerText || null,
  };
}

/** Who an edition's email comes from: the show's own sender if set, else the platform default. */
export async function senderFor(edition: EditionRow | null, category: 'transactional' | 'reminder' | 'campaign' | 'security') {
  const settings = await getPlatformSettings();
  const s = edition?.emailSettings ?? {};
  const name = (s.senderName || settings.emailDefaults.senderName || 'BluePrint').replace(/["<>\r\n]/g, '');
  const address = (category === 'campaign' ? s.campaignSenderAddress || s.senderAddress : s.senderAddress) || settings.emailDefaults.senderAddress;
  const from = address && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address) ? `${name} <${address}>` : env().EMAIL_DEFAULT_FROM;
  const replyTo = s.replyTo || settings.emailDefaults.replyTo || null;
  return { from, replyTo };
}

/** Standard variables for a show. */
export function editionVars(edition: EditionRow): TemplateVars {
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: edition.timezone }) : 'to be confirmed');
  return { show: edition.name, venue: [edition.venue, edition.city].filter(Boolean).join(', '), build_up: fmt(edition.buildUpStartsAt), show_opens: fmt(edition.openStartsAt) };
}

/** Renders one of an edition's templates for one recipient. */
export async function renderTemplate(edition: EditionRow, key: EditableTemplateKey, vars: TemplateVars, opts: { due?: DueItem[] | null; unsubscribeUrl?: string | null } = {}) {
  const t = await templateFor(edition.id, key);
  return renderEmail({
    subject: t.subject,
    preheader: t.preheader,
    blocks: t.blocks,
    vars: { ...editionVars(edition), ...vars },
    branding: brandingFor(edition),
    due: opts.due ?? null,
    unsubscribeUrl: opts.unsubscribeUrl ?? null,
    baseUrl: env().APP_URL,
  });
}
