import 'server-only';
import sanitizeHtml from 'sanitize-html';

/**
 * Cleans rich text from the page editor, announcements and email blocks.
 * Only formatting tags survive; scripts, event handlers, styles and unsafe URLs are removed.
 */
const RICH_TEXT: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote',
    'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'span', 'mark',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https'] },
  allowProtocolRelative: false,
  // Images may also come from BluePrint's own file route.
  exclusiveFilter: (frame) => frame.tag === 'img' && !/^(https:\/\/|\/files\/)/.test(frame.attribs.src ?? ''),
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? '';
      const external = /^https?:\/\//i.test(href);
      return {
        tagName,
        attribs: {
          ...attribs,
          ...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {}),
        },
      };
    },
  },
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html ?? '', RICH_TEXT).trim();
}

/** Strips every tag; for plain-text previews and search. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Email HTML entered in the template editor's HTML view. A wider tag set is allowed
 * (tables and inline styles are how emails are laid out) but scripts and handlers never are.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: [...(RICH_TEXT.allowedTags as string[]), 'div', 'center', 'font', 'small', 'big', 'sup', 'sub'],
    allowedAttributes: {
      '*': ['style', 'align', 'width', 'height', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'valign', 'color'],
      a: ['href', 'title', 'target', 'rel', 'style'],
      img: ['src', 'alt', 'width', 'height', 'style'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^[a-z]+$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^[a-z]+$/i],
        'text-align': [/^(left|right|center|justify)$/],
        'font-size': [/^\d+(px|em|%)$/],
        'font-weight': [/^(normal|bold|\d{3})$/],
        'line-height': [/^[\d.]+(px|em|%)?$/],
        padding: [/^[\d\spx%]+$/],
        margin: [/^[\d\spx%a-z]+$/],
        border: [/^[\w\s#().,%-]+$/],
        'border-radius': [/^\d+px$/],
        width: [/^\d+(px|%)$/],
      },
    },
  });
}
