import 'server-only';

/** Escapes text for safe use inside HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type SimpleEmail = {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer?: string;
  brandColor?: string;
};

/**
 * Plain, email-client-safe layout used for security emails (sign-in codes) that must never
 * depend on editable templates.
 */
export function renderSimpleEmail(input: SimpleEmail): { html: string; text: string } {
  const color = /^#[0-9a-fA-F]{6}$/.test(input.brandColor ?? '') ? input.brandColor : '#2e52af';
  const paras = input.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#1f2937">${escapeHtml(p)}</p>`)
    .join('');
  const button = input.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(input.button.url)}" style="background:${color};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;display:inline-block">${escapeHtml(input.button.label)}</a></p>`
    : '';
  const footer = input.footer
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#6b7280">${escapeHtml(input.footer)}</p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.heading)}</title></head><body style="margin:0;padding:0;background:#f3f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;padding:32px;font-family:Arial,Helvetica,sans-serif"><tr><td><h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#111827">${escapeHtml(input.heading)}</h1>${paras}${button}${footer}</td></tr></table></td></tr></table></body></html>`;
  const text = [input.heading, '', ...input.paragraphs, ...(input.button ? ['', `${input.button.label}: ${input.button.url}`] : []), ...(input.footer ? ['', input.footer] : [])].join('\n');
  return { html, text };
}
