import 'server-only';
import type { EmailBlock } from '../db/schema';
import { htmlToText, sanitizeEmailHtml } from '../security/sanitize';
import { escapeHtml } from './simple';

/**
 * Turns an email's blocks into email-client-safe HTML (through MJML, which produces the table
 * layouts Outlook and Gmail need) and a plain-text version. Everything a person typed is escaped;
 * the only raw HTML allowed is the sanitised "HTML" block.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;
export type EmailBranding = { showName: string; logoUrl: string | null; color: string | null; footer: string | null };
export type DueItem = { title: string; due: string; url: string; overdue: boolean };

export const TEMPLATE_VARIABLES: Record<string, string> = {
  first_name: 'First name of the person receiving it',
  name: 'Full name',
  company: 'Company name',
  stand: 'Stand number',
  hall: 'Hall',
  show: 'Show name',
  portal_link: 'Link to their exhibitor portal',
  venue: 'Venue',
  build_up: 'Build-up start date',
  show_opens: 'Show opening date',
  basket_link: 'Link to their basket',
  basket_lines: 'What is in their basket, one item a line',
  basket_total: 'Basket total with VAT',
  deadline_note: 'The next price rise or ordering deadline, if any',
};

const VAR = /\{\{\s*([a-z_]{1,40})\s*\}\}/g;

/** Replaces {{variables}} in typed text. Unknown variables become empty. */
export function fillVars(text: string, vars: TemplateVars) {
  return text.replace(VAR, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? '' : String(v);
  });
}

/** Only web and mail links may be used for buttons. */
export function safeLink(url: string) {
  const u = url.trim();
  if (/^https:\/\//i.test(u) || /^http:\/\/localhost(:\d+)?\//i.test(u) || /^mailto:[^\s]+$/i.test(u)) return u;
  return null;
}

const hex = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : '#2e52af');
const attr = (s: string) => escapeHtml(s);

function blockMjml(b: EmailBlock, vars: TemplateVars, color: string, due: DueItem[] | null): string {
  switch (b.type) {
    case 'heading':
      return `<mj-text font-size="20px" line-height="28px" font-weight="700" color="#111827" padding="8px 0">${escapeHtml(fillVars(b.text, vars))}</mj-text>`;
    case 'paragraph':
      return `<mj-text padding="6px 0">${escapeHtml(fillVars(b.text, vars)).replace(/\r?\n/g, '<br />')}</mj-text>`;
    case 'button': {
      const href = safeLink(fillVars(b.url, vars));
      if (!href) return '';
      return `<mj-button href="${attr(href)}" background-color="${color}" color="#ffffff" font-weight="600" border-radius="6px" align="left" padding="12px 0">${escapeHtml(fillVars(b.label, vars))}</mj-button>`;
    }
    case 'divider':
      return '<mj-divider border-color="#e5e7eb" border-width="1px" padding="12px 0" />';
    case 'image':
      return /^[0-9a-f-]{36}$/i.test(b.fileId)
        ? `<mj-image src="${attr(`${String(vars.__base ?? '')}/files/${b.fileId}`)}" alt="${attr(b.alt ?? '')}" padding="8px 0" />`
        : '';
    case 'tasks_due': {
      if (!due) return '';
      if (!due.length) return '<mj-text padding="6px 0">You are all up to date. Thank you.</mj-text>';
      const rows = due
        .map(
          (d) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb"><a href="${attr(d.url)}" style="color:${color};font-weight:600;text-decoration:none">${escapeHtml(d.title)}</a><br /><span style="font-size:13px;color:${d.overdue ? '#b91c1c' : '#6b7280'}">${d.overdue ? 'Overdue: was due ' : 'Due '}${escapeHtml(d.due)}</span></td></tr>`,
        )
        .join('');
      return `<mj-text padding="6px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></mj-text>`;
    }
    case 'html':
      return `<mj-text padding="6px 0">${sanitizeEmailHtml(fillVarsEscaped(b.html, vars))}</mj-text>`;
    default:
      return '';
  }
}

/** For HTML blocks: variables are inserted escaped, so a company called "<b>" stays text. */
function fillVarsEscaped(html: string, vars: TemplateVars) {
  return html.replace(VAR, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? '' : escapeHtml(String(v));
  });
}

function blockText(b: EmailBlock, vars: TemplateVars, due: DueItem[] | null): string {
  switch (b.type) {
    case 'heading':
      return fillVars(b.text, vars).toUpperCase();
    case 'paragraph':
      return fillVars(b.text, vars);
    case 'button': {
      const href = safeLink(fillVars(b.url, vars));
      return href ? `${fillVars(b.label, vars)}: ${href}` : '';
    }
    case 'divider':
      return '----';
    case 'image':
      return b.alt ? `[${b.alt}]` : '';
    case 'tasks_due':
      if (!due) return '';
      return due.length ? due.map((d) => `- ${d.title} (${d.overdue ? 'overdue, was due' : 'due'} ${d.due}): ${d.url}`).join('\n') : 'You are all up to date. Thank you.';
    case 'html':
      return htmlToText(fillVars(b.html, vars));
    default:
      return '';
  }
}

export type RenderInput = {
  subject: string;
  preheader?: string;
  blocks: EmailBlock[];
  vars: TemplateVars;
  branding: EmailBranding;
  /** For the "things due" block. */
  due?: DueItem[] | null;
  /** Campaign emails: link to stop receiving them. */
  unsubscribeUrl?: string | null;
  /** Absolute site address, for images. */
  baseUrl: string;
};

export async function renderEmail(input: RenderInput): Promise<{ subject: string; html: string; text: string }> {
  const vars = { ...input.vars, __base: input.baseUrl.replace(/\/$/, '') };
  const color = hex(input.branding.color);
  const subject = fillVars(input.subject, vars).replace(/[\r\n]+/g, ' ').slice(0, 250);
  const preheader = fillVars(input.preheader ?? '', vars).replace(/[\r\n]+/g, ' ').slice(0, 200);
  const body = input.blocks.map((b) => blockMjml(b, vars, color, input.due ?? null)).join('\n');
  const logo = input.branding.logoUrl ? safeLink(input.branding.logoUrl) : null;
  const footerBits = [input.branding.footer ? escapeHtml(input.branding.footer) : escapeHtml(input.branding.showName)];
  if (input.unsubscribeUrl) footerBits.push(`<a href="${attr(input.unsubscribeUrl)}" style="color:#6b7280">Unsubscribe from show updates</a>`);
  const mjml = `<mjml>
  <mj-head>
    <mj-title>${escapeHtml(subject)}</mj-title>
    ${preheader ? `<mj-preview>${escapeHtml(preheader)}</mj-preview>` : ''}
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="15px" line-height="22px" color="#1f2937" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f3f4f6" width="600px">
    <mj-section background-color="${color}" padding="0"><mj-column><mj-spacer height="6px" /></mj-column></mj-section>
    <mj-section background-color="#ffffff" padding="24px 32px 0">
      <mj-column>
        ${logo ? `<mj-image src="${attr(logo)}" alt="${attr(input.branding.showName)}" width="180px" align="left" padding="0" />` : `<mj-text font-size="18px" font-weight="700" color="#111827" padding="0">${escapeHtml(input.branding.showName)}</mj-text>`}
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="8px 32px 28px">
      <mj-column>
${body}
      </mj-column>
    </mj-section>
    <mj-section padding="16px 32px">
      <mj-column>
        <mj-text font-size="12px" line-height="18px" color="#6b7280" padding="0">${footerBits.join(' · ')}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
  const { default: mjml2html } = await import('mjml');
  const out = await mjml2html(mjml, { validationLevel: 'soft', keepComments: false });
  const text = [
    ...input.blocks.map((b) => blockText(b, vars, input.due ?? null)).filter(Boolean),
    '',
    input.branding.footer || input.branding.showName,
    ...(input.unsubscribeUrl ? [`Unsubscribe from show updates: ${input.unsubscribeUrl}`] : []),
  ].join('\n\n');
  return { subject, html: out.html, text };
}
