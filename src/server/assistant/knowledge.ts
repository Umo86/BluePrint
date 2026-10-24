import 'server-only';
import sanitizeHtml from 'sanitize-html';
import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { getDb } from '../db/client';
import { announcements, assistantFaqs } from '../db/schema';
import { pagesForType } from '../services/manual';

/**
 * What the assistant knows about a show: its manual pages (only those this stand type may read),
 * the answers the team has added, and announcements. Pages are split into chunks and searched with
 * a simple keyword ranking (BM25), so only the relevant parts are sent to the model.
 */

export type Chunk = { kind: 'page' | 'faq' | 'announcement'; title: string; link: string | null; text: string };

const STOP = new Set(
  'a an and are as at be by can do does for from has have how i if in is it its me my of on or our should so that the their them there these this to us was we what when where which who why will with you your yours am any about into than then there'.split(
    ' ',
  ),
);

/** Lower-case words without common endings, so "deliveries" matches "delivery". */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || w);
}

/** Readable text from a page's HTML, keeping paragraphs, list items and link targets. */
export function htmlToParagraphs(html: string): string {
  const marked = (html ?? '')
    .replace(/<a\b[^>]*href="((?:\/|https:\/\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => `${inner} (${href})`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|li|h[1-6]|div|tr|blockquote|ul|ol|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits text into pieces of about `size` characters at paragraph boundaries. */
export function splitText(text: string, size = 1200): string[] {
  const paras = text.split(/\n{2,}|\n(?=- )/);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 1 > size) {
      out.push(cur.trim());
      cur = '';
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size).trim());
      continue;
    }
    cur += `${p}\n`;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export async function knowledgeFor(edition: { id: string; slug: string }, typeId: string): Promise<Chunk[]> {
  const db = await getDb();
  const pages = await pagesForType(edition.id, typeId);
  const chunks: Chunk[] = [];
  for (const p of pages) {
    const text = htmlToParagraphs(p.bodyHtml);
    const link = `/portal/${edition.slug}/manual/${p.slug}`;
    if (!text) {
      chunks.push({ kind: 'page', title: p.title, link, text: p.title });
      continue;
    }
    for (const piece of splitText(text)) chunks.push({ kind: 'page', title: p.title, link, text: piece });
  }
  const faqs = await db.select().from(assistantFaqs).where(eq(assistantFaqs.editionId, edition.id));
  for (const f of faqs) chunks.push({ kind: 'faq', title: f.question, link: null, text: `Q: ${f.question}\nA: ${f.answer}` });
  const news = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.editionId, edition.id), isNotNull(announcements.publishedAt), lte(announcements.publishedAt, new Date())))
    .orderBy(desc(announcements.publishedAt))
    .limit(30);
  for (const a of news) {
    if (a.visibleToTypes.length && !a.visibleToTypes.includes(typeId)) continue;
    chunks.push({ kind: 'announcement', title: a.title, link: `/portal/${edition.slug}/announcements`, text: `${a.title}\n${htmlToParagraphs(a.bodyHtml)}` });
  }
  return chunks;
}

/** Ranks chunks against a question (BM25, titles count double). Returns the best `k` with any match. */
export function searchChunks(chunks: Chunk[], query: string, k = 5) {
  const q = [...new Set(terms(query))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => {
    const words = [...terms(c.title), ...terms(c.title), ...terms(c.text)];
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { c, tf, len: words.length };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.filter((d) => d.tf.has(t)).length);
  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / avg));
    }
    // Answers the team wrote for exactly this kind of question are worth more.
    if (d.c.kind === 'faq') score *= 1.3;
    return { chunk: d.c, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k);
}
