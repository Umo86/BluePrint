import 'server-only';
import { and, eq, gt, inArray, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { assistantUnanswered, orderLines, orders, type editions, type stands } from '../db/schema';
import { checklistForStand, taskForStand } from '../services/submissions';
import { shopForStand } from '../services/shop';
import { validateAnswers, type FormField } from '@/lib/forms';
import { TASK_STATE_LABELS, REQUIREMENT_LABELS } from '@/lib/task-labels';
import { dateLong, dateTime, money } from '@/lib/format';
import { searchChunks, type Chunk } from './knowledge';
import type { ToolDef } from './model';
import type { Actor } from '../auth/actor';

/**
 * The assistant's tools. Every tool works only on the signed-in exhibitor's own stand: the stand is
 * fixed by the server, never chosen by the model. Tools that would change something only prepare a
 * suggestion; the exhibitor confirms it with a button before anything is saved or sent.
 */

export type FormProposal = { kind: 'form'; taskId: string; taskTitle: string; answers: Record<string, unknown>; display: { label: string; value: string }[]; applied?: boolean };
export type TicketProposal = { subject: string; message: string; sent?: string };

export type ToolContext = {
  actor: Actor;
  stand: typeof stands.$inferSelect;
  edition: typeof editions.$inferSelect;
  knowledge: () => Promise<Chunk[]>;
  conversationId: string;
  proposals: FormProposal[];
  ticket: TicketProposal | null;
  /** Questions the assistant could not answer, saved for the show team. */
  unanswered: string[];
  /** A show team member trying the assistant out: nothing is recorded for the show team. */
  test?: boolean;
  /** When the show team will answer a question passed on now. */
  handoffNote?: string;
};

/** Field types the assistant may fill in. Uploads, signatures and tables are left to the exhibitor. */
const FILLABLE: FormField['type'][] = ['text', 'textarea', 'number', 'email', 'phone', 'select', 'multiselect', 'date', 'checkbox'];

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'search_manual',
    description:
      'Search this show’s exhibitor manual, the answers the show team has added, and announcements. Use it for any question about rules, times, access, deliveries, venue, stand building or anything else about the show. Returns the most relevant passages with links.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in a few words.' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'read_manual_page',
    description: 'Read a whole page of the exhibitor manual, by the link returned from search_manual. Use when a passage is not enough.',
    input_schema: { type: 'object', properties: { link: { type: 'string', description: 'The page link, for example /portal/show/manual/deliveries.' } }, required: ['link'], additionalProperties: false },
  },
  {
    name: 'my_checklist',
    description: 'The exhibitor’s own tasks for this show: each task’s status, deadline, whether it is required, and a link. Use for questions about what is due or what is left to do.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'task_details',
    description: 'One task in detail: instructions, the questions on its form (with ids, types and options), the answers saved so far, and whether it can still be changed.',
    input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'], additionalProperties: false },
  },
  {
    name: 'shop_overview',
    description: 'What this stand can order from the show shop (power, furniture, cleaning and so on): categories, order-by dates, prices and whether the stand has already ordered from each.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_form_answers',
    description:
      'Suggest answers for a form, from what the exhibitor told you. Nothing is saved until the exhibitor presses a button to put the answers in the form, and they always check and send the form themselves. Only use answers the exhibitor actually gave. Use field ids from task_details.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        answers: { type: 'object', description: 'Field id to answer. Text as a string, numbers as numbers, ticks as true or false, several choices as a list.' },
      },
      required: ['task_id', 'answers'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_contact_team',
    description:
      'Prepare a question for the show team when you cannot help, the exhibitor asks for a person, or something needs a decision (for example a deadline extension). The exhibitor sees it and presses a button to send it.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'A short subject.' },
        message: { type: 'string', description: 'The question, with the details the team will need.' },
      },
      required: ['subject', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'log_unanswered',
    description: 'Record a question the manual does not answer, so the show team can add the answer. Use it whenever search_manual finds nothing useful.',
    input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false },
  },
];

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function portalLink(ctx: ToolContext, path: string) {
  return `/portal/${ctx.edition.slug}${path}`;
}

/** Runs a tool. Returns a JSON string for the model; throws an Error with a helpful message when the input is wrong. */
export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'search_manual': {
      const query = str(input.query, 300);
      if (!query) throw new Error('Give a query.');
      const hits = searchChunks(await ctx.knowledge(), query, 5);
      return JSON.stringify({
        results: hits.map((h) => ({ title: h.chunk.title, source: h.chunk.kind === 'faq' ? 'Answer from the show team' : h.chunk.kind === 'announcement' ? 'Announcement' : 'Exhibitor manual', link: h.chunk.link, text: h.chunk.text.slice(0, 1500) })),
        note: hits.length ? undefined : 'Nothing in the manual matches. Say so, call log_unanswered, and offer to contact the show team.',
      });
    }
    case 'read_manual_page': {
      const link = str(input.link, 300);
      const chunks = (await ctx.knowledge()).filter((c) => c.kind === 'page' && c.link === link);
      if (!chunks.length) throw new Error('No manual page has that link. Use a link returned by search_manual.');
      return JSON.stringify({ title: chunks[0].title, link, text: chunks.map((c) => c.text).join('\n\n').slice(0, 12_000) });
    }
    case 'my_checklist': {
      const c = await checklistForStand(ctx.actor, ctx.stand.id);
      return JSON.stringify({
        progress: `${c.progress.requiredDone} of ${c.progress.required} required tasks done`,
        items: c.items.map((i) => ({
          task_id: i.task.id,
          title: i.task.title,
          requirement: REQUIREMENT_LABELS[i.requirement] ?? i.requirement,
          state: TASK_STATE_LABELS[i.state]?.label ?? i.state,
          due: i.deadline ? dateTime(i.deadline) : null,
          can_still_change: i.editable,
          link: portalLink(ctx, `/tasks/${i.task.id}`),
        })),
      });
    }
    case 'task_details': {
      const taskId = str(input.task_id, 40);
      if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error('Use a task_id from my_checklist.');
      const t = await taskForStand(ctx.actor, ctx.stand.id, taskId).catch(() => null);
      if (!t) throw new Error('That task is not on this exhibitor’s checklist.');
      const { htmlToParagraphs } = await import('./knowledge');
      return JSON.stringify({
        task_id: t.task.id,
        title: t.task.title,
        kind: t.task.kind,
        instructions: htmlToParagraphs(t.task.descriptionHtml).slice(0, 4000),
        state: TASK_STATE_LABELS[t.state]?.label ?? t.state,
        due: t.deadline ? dateTime(t.deadline) : null,
        can_still_change: t.editable,
        locked_reason: t.lockedReason,
        already_sent: Boolean(t.submission && !['draft', 'changes_needed'].includes(t.submission.status)),
        questions: t.task.formSchema
          .filter((f) => f.type !== 'heading')
          .map((f) => ({
            id: f.id,
            question: f.label,
            type: f.type,
            required: Boolean(f.required),
            options: f.options,
            help: f.help,
            assistant_can_fill: FILLABLE.includes(f.type),
            answer_so_far: t.submission?.data?.[f.id] ?? null,
          })),
        link: portalLink(ctx, `/tasks/${t.task.id}`),
      });
    }
    case 'shop_overview': {
      const shop = await shopForStand(ctx.actor, ctx.stand.id);
      const db = await getDb();
      const ordered = await db
        .selectDistinct({ categoryId: orderLines.categoryId })
        .from(orderLines)
        .innerJoin(orders, eq(orders.id, orderLines.orderId))
        .where(and(eq(orders.standId, ctx.stand.id), inArray(orders.status, ['paid', 'invoiced', 'partially_refunded']), ne(orderLines.fulfilmentStatus, 'cancelled')));
      const has = new Set(ordered.map((o) => o.categoryId));
      return JSON.stringify({
        categories: shop.categories.map((c) => ({
          name: c.name,
          description: c.description,
          orderBy: c.orderBy ? dateLong(c.orderBy) : null,
          ordered: has.has(c.id),
          link: portalLink(ctx, '/shop'),
          products: c.products.slice(0, 8).map((p) => ({ name: p.name, price: `${money(p.unitPence)} + VAT${p.unit ? ` ${p.unit}` : ''}` })),
        })),
        basket: `${shop.basketCount} items in the basket`,
      });
    }
    case 'propose_form_answers': {
      const taskId = str(input.task_id, 40);
      const answers = input.answers;
      if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error('Use a task_id from my_checklist.');
      if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) throw new Error('answers must be an object of field id to answer.');
      const t = await taskForStand(ctx.actor, ctx.stand.id, taskId).catch(() => null);
      if (!t) throw new Error('That task is not on this exhibitor’s checklist.');
      if (t.task.kind !== 'form') throw new Error('Only forms can be filled in this way.');
      if (!t.editable) throw new Error(`The form cannot be changed: ${t.lockedReason ?? 'it is locked'}.`);
      if (t.submission && !['draft', 'changes_needed'].includes(t.submission.status)) throw new Error('The form has already been sent. The exhibitor can change it on the form page.');
      const fields = new Map(t.task.formSchema.map((f) => [f.id, f]));
      const proposed: Record<string, unknown> = {};
      for (const [id, value] of Object.entries(answers as Record<string, unknown>)) {
        const f = fields.get(id);
        if (!f) throw new Error(`There is no question with id “${id}”. Use ids from task_details.`);
        if (!FILLABLE.includes(f.type)) throw new Error(`“${f.label}” has to be completed by the exhibitor on the form.`);
        proposed[id] = value;
      }
      if (!Object.keys(proposed).length) throw new Error('Give at least one answer.');
      const check = validateAnswers(t.task.formSchema, { ...(t.submission?.data ?? {}), ...proposed }, { submit: false });
      const problems = Object.entries(check.errors).filter(([id]) => id in proposed);
      if (problems.length) throw new Error(problems.map(([id, e]) => `${fields.get(id)!.label}: ${e}`).join('; '));
      const display = Object.keys(proposed).map((id) => {
        const v = check.clean[id];
        return { label: fields.get(id)!.label, value: Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '') };
      });
      const clean = Object.fromEntries(Object.keys(proposed).filter((id) => id in check.clean).map((id) => [id, check.clean[id]]));
      ctx.proposals.push({ kind: 'form', taskId, taskTitle: t.task.title, answers: clean, display });
      return JSON.stringify({ ok: true, shown_to_exhibitor: true, note: 'The exhibitor now sees these answers with a button to put them in the form. Tell them to check the form and send it.' });
    }
    case 'propose_contact_team': {
      const subject = str(input.subject, 150);
      const message = str(input.message, 3000);
      if (subject.length < 3 || !message) throw new Error('Give a subject and a message.');
      ctx.ticket = { subject, message };
      return JSON.stringify({
        ok: true,
        shown_to_exhibitor: true,
        note: `The exhibitor sees the message with a button to send it to the show team, and can add a phone number first. Tell them when to expect an answer: ${ctx.handoffNote ?? 'the show team will reply as soon as they can.'}`,
      });
    }
    case 'log_unanswered': {
      const question = str(input.question, 500);
      if (!question) throw new Error('Give the question.');
      ctx.unanswered.push(question);
      // A team member's test chat is not a real exhibitor's question.
      if (ctx.test) return JSON.stringify({ ok: true });
      const db = await getDb();
      const recent = await db
        .select({ id: assistantUnanswered.id })
        .from(assistantUnanswered)
        .where(and(eq(assistantUnanswered.editionId, ctx.edition.id), eq(assistantUnanswered.question, question), gt(assistantUnanswered.createdAt, new Date(Date.now() - 86_400_000))))
        .limit(1);
      if (!recent.length) await db.insert(assistantUnanswered).values({ editionId: ctx.edition.id, question, conversationId: ctx.conversationId });
      return JSON.stringify({ ok: true });
    }
    default:
      throw new Error(`There is no tool called ${name}.`);
  }
}
