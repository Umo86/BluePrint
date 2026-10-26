import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  companies,
  companyMembers,
  exhibitorTypes,
  files,
  halls,
  orders,
  spaceOnlyPacks,
  standContractors,
  stands,
  submissions,
  tasks,
  unsubscribes,
  users,
} from '../db/schema';
import { getEditionAccess, memberCovers, type EditionAccess } from '../authz';
import { forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { assertRateLimit } from '../security/rate-limit';
import { computeEditionProgress, type EditionProgress } from '../services/progress';
import { listExhibitors, type ExhibitorListOptions } from '../services/stands';
import { commissionReport, FULFILMENT_LABELS, lineGross, linePayoutAfterRefunds, ORDER_STATUS_LABELS } from '../services/orders';
import { deliverableLines, describeLineDetails, orderLinesForEdition, totalsByProduct } from '../services/service-lists';
import { answerToText, type FormField } from '@/lib/forms';
import { TASK_STATE_LABELS } from '@/lib/task-labels';
import { PACK_STATUS_LABELS } from '@/lib/space-only';
import { slugify } from '@/lib/slug';
import { standSize } from '@/lib/format';
import { buildWorkbook, type SheetSpec } from './xlsx';
import type { Actor } from '../auth/actor';

/**
 * The downloadable reports for a show. Each one checks the person's permissions, is limited per
 * person per hour, and is recorded in the audit log (who downloaded what, and how many rows).
 */

export const REPORT_KEYS = ['exhibitors', 'contacts', 'checklist', 'responses', 'orders', 'services', 'space_only', 'commission'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

const has = (a: EditionAccess, p: Parameters<EditionAccess['permissions']['has']>[0]) => a.permissions.has(p);

export const REPORTS: Record<ReportKey, { title: string; description: string; group: 'Exhibitors' | 'Shop' | 'Space-only'; allowed: (a: EditionAccess) => boolean }> = {
  exhibitors: {
    title: 'Exhibitors',
    description: 'Every exhibiting company with its stands, main contact, sign-up status, checklist progress and what it has ordered.',
    group: 'Exhibitors',
    allowed: (a) => has(a, 'manage_exhibitors') || has(a, 'view_reports'),
  },
  contacts: {
    title: 'Exhibitor contacts',
    description: 'Everyone who can use the exhibitor portal: name, email, company, stands, role and when they last signed in.',
    group: 'Exhibitors',
    allowed: (a) => has(a, 'manage_exhibitors') || has(a, 'view_reports'),
  },
  checklist: {
    title: 'Checklist by stand',
    description: 'One row per stand and one column per task, showing where every stand is.',
    group: 'Exhibitors',
    allowed: (a) => has(a, 'manage_exhibitors') || has(a, 'view_reports'),
  },
  responses: {
    title: 'All form answers',
    description: 'Every answer to every form, one sheet per form (for example stand team details or fascia names).',
    group: 'Exhibitors',
    allowed: (a) => has(a, 'manage_exhibitors') || has(a, 'view_reports'),
  },
  orders: {
    title: 'Orders',
    description: 'Every order and every item ordered, with VAT, refunds, commission and supplier payouts.',
    group: 'Shop',
    allowed: (a) => has(a, 'manage_orders') || has(a, 'view_reports'),
  },
  services: {
    title: 'Services by stand',
    description: 'The delivery list for build-up: what each stand ordered, by hall and stand, and totals for each product.',
    group: 'Shop',
    allowed: (a) => has(a, 'manage_orders') || has(a, 'view_reports'),
  },
  commission: {
    title: 'Commission and payouts',
    description: 'Sales, commission and payouts for each supplier.',
    group: 'Shop',
    allowed: (a) => has(a, 'manage_orders') || has(a, 'view_reports'),
  },
  space_only: {
    title: 'Space-only approvals',
    description: 'Each space-only stand’s contractor, the state of its stand pack, insurance and certificate.',
    group: 'Space-only',
    allowed: (a) => has(a, 'review_space_only') || has(a, 'manage_exhibitors') || has(a, 'view_reports'),
  },
};

export function isReportKey(v: string): v is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(v);
}

/** The reports this person may download for a show. */
export async function availableReports(actor: Actor, editionId: string) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  return REPORT_KEYS.filter((k) => REPORTS[k].allowed(access)).map((k) => ({ key: k, ...REPORTS[k] }));
}

const STAND_STATUS_LABELS = { joined: 'Signed up', invited: 'Invited', not_sent: 'Invitation not sent', no_contact: 'No contact yet' } as const;

export type ReportOptions = {
  exhibitors?: ExhibitorListOptions & { companyIds?: string[] };
  /** For form answers: only this task. */
  taskId?: string;
  filterLabels?: string[];
};

/** Builds a report as an Excel file. */
export async function buildReport(actor: Actor, editionId: string, key: ReportKey, opts: ReportOptions = {}) {
  const access = await getEditionAccess(actor, editionId);
  if (!access) throw notFound();
  if (!REPORTS[key].allowed(access)) throw forbidden();
  await assertRateLimit(`report:${actor.realUserId}`, 60, 3600);
  const progress = await computeEditionProgress(editionId);
  const { edition } = progress;
  let sheets: SheetSpec[];
  switch (key) {
    case 'exhibitors':
      sheets = await exhibitorsSheets(actor, editionId, progress, opts.exhibitors ?? {});
      break;
    case 'contacts':
      sheets = await contactsSheets(editionId);
      break;
    case 'checklist':
      sheets = checklistSheets(progress);
      break;
    case 'responses':
      sheets = await responsesSheets(editionId, progress, opts.taskId);
      break;
    case 'orders':
      sheets = await ordersSheets(editionId);
      break;
    case 'services':
      sheets = await servicesSheets(editionId);
      break;
    case 'commission':
      sheets = await commissionSheets(actor, editionId);
      break;
    case 'space_only':
      sheets = await spaceOnlySheets(editionId);
      break;
  }
  const rows = sheets.reduce((n, s) => n + s.rows.length, 0);
  const filters = opts.filterLabels ?? (key === 'exhibitors' ? exhibitorFilterLabels(progress, opts.exhibitors ?? {}) : key === 'responses' && opts.taskId ? [`Only “${progress.tasks.find((t) => t.id === opts.taskId)?.title ?? 'one task'}”`] : []);
  const buffer = await buildWorkbook(sheets, {
    title: REPORTS[key].title,
    show: edition.name,
    generatedFor: actor.realEmail,
    filters,
  });
  await audit(actor, 'report.downloaded', { entityType: 'edition', entityId: editionId, editionId, details: { report: key, rows, filters } });
  const date = new Date().toISOString().slice(0, 10);
  return { buffer, rows, filename: `${slugify(edition.name) || 'show'}-${key.replace('_', '-')}-${date}.xlsx` };
}

// ---------------------------------------------------------------------------
// Exhibitors
// ---------------------------------------------------------------------------

const PROGRESS_LABELS: Record<string, string> = {
  behind: 'Behind (overdue tasks)',
  review: 'Waiting for review',
  changes: 'Changes needed',
  not_started: 'Not started',
  complete: 'All required tasks done',
};

function exhibitorFilterLabels(progress: EditionProgress, o: ExhibitorListOptions) {
  const labels: string[] = [];
  if (o.q) labels.push(`Search: ${o.q}`);
  if (o.typeId) labels.push(`Stand type: ${progress.stands.find((s) => s.typeId === o.typeId)?.typeName ?? 'chosen type'}`);
  if (o.hallId) labels.push(`Hall: ${progress.stands.find((s) => s.hallId === o.hallId)?.hallName ?? 'chosen hall'}`);
  if (o.state === 'never_signed_in') labels.push('Never signed in');
  else if (o.state && o.state !== 'all') labels.push(`BluePrint: ${STAND_STATUS_LABELS[o.state]}`);
  if (o.progress && o.progress !== 'any') labels.push(`Checklist: ${PROGRESS_LABELS[o.progress]}`);
  if (o.taskNotDoneId) labels.push(`Not done: ${progress.tasks.find((t) => t.id === o.taskNotDoneId)?.title ?? 'chosen task'}`);
  if (o.notOrderedCategoryId) labels.push('Has not ordered from a chosen shop category');
  return labels;
}

async function exhibitorsSheets(actor: Actor, editionId: string, progress: EditionProgress, opts: ExhibitorListOptions & { companyIds?: string[] }): Promise<SheetSpec[]> {
  const { rows } = await listExhibitors(actor, editionId, opts, progress);
  const chosen = opts.companyIds?.length ? rows.filter((r) => opts.companyIds!.includes(r.company.id)) : rows;
  return [
    {
      name: 'Exhibitors',
      columns: [
        { header: 'Company', key: 'company', width: 32 },
        { header: 'Stands', key: 'stands' },
        { header: 'Stand types', key: 'types', width: 22 },
        { header: 'Halls', key: 'halls' },
        { header: 'Size (sqm)', key: 'size', type: 'number' },
        { header: 'Stand sizes', key: 'sizes', width: 30 },
        { header: 'Main contact', key: 'contact', width: 24 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'BluePrint', key: 'state', width: 20 },
        { header: 'Last signed in', key: 'lastLogin', type: 'datetime' },
        { header: 'Required tasks done', key: 'done', type: 'number' },
        { header: 'Required tasks', key: 'required', type: 'number' },
        { header: 'Overdue', key: 'overdue', type: 'number' },
        { header: 'Waiting for review', key: 'review', type: 'number' },
        { header: 'Changes needed', key: 'changes', type: 'number' },
        { header: 'Next deadline', key: 'next', type: 'datetime' },
        { header: 'Orders', key: 'orders', type: 'number' },
        { header: 'Spent (inc VAT)', key: 'spent', type: 'money' },
        { header: 'Unpaid invoices', key: 'unpaid', type: 'money' },
        { header: 'Space-only pack', key: 'pack', width: 22 },
        { header: 'Website', key: 'website', width: 26 },
      ],
      rows: chosen.map((r) => ({
        company: r.company.name,
        stands: r.stands.map((s) => s.number).join(', '),
        types: [...new Set(r.stands.map((s) => s.typeName))].join(', '),
        halls: [...new Set(r.stands.map((s) => s.hallName).filter(Boolean))].join(', '),
        size: r.stands.reduce((n, s) => n + (s.sizeSqm ? Number(s.sizeSqm) : 0), 0) || null,
        sizes: r.stands
          .filter((s) => standSize(s))
          .map((s) => (r.stands.length > 1 ? `${s.number}: ${standSize(s)}` : standSize(s)))
          .join('; '),
        contact: r.mainContact?.name ?? '',
        email: r.mainContact?.email ?? r.invite?.email ?? '',
        state: STAND_STATUS_LABELS[r.state],
        lastLogin: r.lastLoginAt,
        done: r.progress.requiredDone,
        required: r.progress.required,
        overdue: r.progress.overdue,
        review: r.progress.awaitingReview,
        changes: r.progress.changesNeeded,
        next: r.progress.nextDeadline,
        orders: r.spend.orders,
        spent: r.spend.paidPence + r.spend.unpaidPence,
        unpaid: r.spend.unpaidPence,
        pack: r.stands
          .filter((st) => st.packStatus)
          .map((st) => `${r.stands.length > 1 ? `${st.number}: ` : ''}${PACK_STATUS_LABELS[st.packStatus!]?.label ?? st.packStatus}`)
          .join('; '),
        website: r.company.website ?? '',
      })),
    },
  ];
}

async function contactsSheets(editionId: string): Promise<SheetSpec[]> {
  const db = await getDb();
  const standRows = await db
    .select({ companyId: stands.companyId, number: stands.number })
    .from(stands)
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .orderBy(asc(stands.number));
  const companyIds = [...new Set(standRows.map((s) => s.companyId).filter((x): x is string => Boolean(x)))];
  if (!companyIds.length) return [{ name: 'Contacts', columns: [{ header: 'Name', key: 'name' }], rows: [] }];
  const people = await db
    .select({ companyId: companyMembers.companyId, role: companyMembers.role, company: companies.name, name: users.name, email: users.email, status: users.status, lastLoginAt: users.lastLoginAt, phone: users.phone })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(and(inArray(companyMembers.companyId, companyIds), memberCovers(editionId)))
    .orderBy(asc(companies.name), asc(users.name));
  const unsub = people.length
    ? new Set(
        (await db.select({ email: unsubscribes.email, editionId: unsubscribes.editionId }).from(unsubscribes).where(inArray(unsubscribes.email, people.map((p) => p.email))))
          .filter((u) => u.editionId === null || u.editionId === editionId)
          .map((u) => u.email),
      )
    : new Set<string>();
  const standsOf = (companyId: string) => standRows.filter((s) => s.companyId === companyId).map((s) => s.number).join(', ');
  return [
    {
      name: 'Contacts',
      columns: [
        { header: 'Company', key: 'company', width: 30 },
        { header: 'Stands', key: 'stands' },
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Role', key: 'role' },
        { header: 'Account', key: 'status' },
        { header: 'Last signed in', key: 'lastLogin', type: 'datetime' },
        { header: 'Unsubscribed from updates', key: 'unsub' },
      ],
      rows: people
        .filter((p) => p.status !== 'disabled')
        .map((p) => ({
          company: p.company,
          stands: standsOf(p.companyId),
          name: p.name,
          email: p.email,
          phone: p.phone ?? '',
          role: p.role === 'main_contact' ? 'Main contact' : 'Colleague',
          status: p.status === 'active' ? 'Active' : 'Invited',
          lastLogin: p.lastLoginAt,
          unsub: unsub.has(p.email) ? 'Yes' : '',
        })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Checklist and form answers
// ---------------------------------------------------------------------------

function checklistSheets(progress: EditionProgress): SheetSpec[] {
  const taskCols = progress.tasks.map((t, i) => ({ header: t.title, key: `t${i}`, width: Math.min(30, Math.max(14, t.title.length / 1.5)) }));
  return [
    {
      name: 'Checklist by stand',
      columns: [
        { header: 'Stand', key: 'stand' },
        { header: 'Company', key: 'company', width: 30 },
        { header: 'Stand type', key: 'type' },
        { header: 'Hall', key: 'hall' },
        { header: 'Required done', key: 'done', type: 'number' },
        { header: 'Required tasks', key: 'required', type: 'number' },
        { header: 'Overdue', key: 'overdue', type: 'number' },
        ...taskCols,
      ],
      rows: progress.stands.map((s) => ({
        stand: s.number,
        company: s.companyName ?? '',
        type: s.typeName,
        hall: s.hallName ?? '',
        done: s.requiredDone,
        required: s.required,
        overdue: s.overdue,
        ...Object.fromEntries(progress.tasks.map((t, i) => [`t${i}`, s.states[t.id] ? (TASK_STATE_LABELS[s.states[t.id].state]?.label ?? s.states[t.id].state) : 'Does not apply'])),
      })),
    },
    {
      name: 'Tasks',
      columns: [
        { header: 'Task', key: 'title', width: 36 },
        { header: 'Deadline', key: 'deadline', type: 'datetime' },
        { header: 'Applies to stands', key: 'applies', type: 'number' },
        { header: 'Done', key: 'done', type: 'number' },
        { header: 'Waiting for review', key: 'review', type: 'number' },
        { header: 'Changes needed', key: 'changes', type: 'number' },
        { header: 'Not started', key: 'notStarted', type: 'number' },
        { header: 'Overdue', key: 'overdue', type: 'number' },
        { header: 'Done (%)', key: 'pct', type: 'percent' },
      ],
      rows: progress.tasks.map((t) => ({
        title: t.title,
        deadline: t.deadline,
        applies: t.applies,
        done: t.done,
        review: t.awaitingReview,
        changes: t.changesNeeded,
        notStarted: t.notStarted,
        overdue: t.overdue,
        pct: t.applies ? t.done / t.applies : null,
      })),
    },
  ];
}

function collectFileIds(fields: FormField[], data: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const v = data?.[f.id];
    if (f.type === 'file' && Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
    if (f.type === 'repeater' && Array.isArray(v)) for (const row of v) out.push(...collectFileIds(f.fields ?? [], (row ?? {}) as Record<string, unknown>));
  }
  return out;
}

async function responsesSheets(editionId: string, progress: EditionProgress, onlyTaskId?: string): Promise<SheetSpec[]> {
  const db = await getDb();
  const formTasks = (await db.select().from(tasks).where(and(eq(tasks.editionId, editionId), eq(tasks.published, true))).orderBy(asc(tasks.sort), asc(tasks.title))).filter(
    (t) => t.formSchema.some((f) => f.type !== 'heading') && (!onlyTaskId || t.id === onlyTaskId),
  );
  if (!formTasks.length) return [{ name: 'No forms', columns: [{ header: 'There are no published forms in this show yet.', key: 'x', width: 60 }], rows: [] }];
  const subs = await db.select().from(submissions).where(inArray(submissions.taskId, formTasks.map((t) => t.id)));
  const fileIds = formTasks.flatMap((t) => subs.filter((s) => s.taskId === t.id).flatMap((s) => collectFileIds(t.formSchema, s.data ?? {})));
  const names = fileIds.length ? Object.fromEntries((await db.select({ id: files.id, name: files.originalName }).from(files).where(inArray(files.id, fileIds))).map((f) => [f.id, f.name])) : {};
  return formTasks.map((t) => {
    const questions = t.formSchema.filter((f) => f.type !== 'heading');
    const applying = progress.stands.filter((s) => s.states[t.id]);
    return {
      name: t.title,
      columns: [
        { header: 'Stand', key: 'stand' },
        { header: 'Company', key: 'company', width: 28 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Sent', key: 'sent', type: 'datetime' as const },
        ...questions.map((q, i) => ({ header: q.label, key: `q${i}`, width: q.type === 'textarea' || q.type === 'repeater' ? 40 : 22 })),
      ],
      rows: applying.map((s) => {
        const sub = subs.find((x) => x.taskId === t.id && x.standId === s.standId);
        const st = s.states[t.id];
        return {
          stand: s.number,
          company: s.companyName ?? '',
          status: TASK_STATE_LABELS[st.state]?.label ?? st.state,
          sent: sub?.submittedAt ?? null,
          ...Object.fromEntries(questions.map((q, i) => [`q${i}`, answerToText(q, sub?.data?.[q.id], names)])),
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

async function ordersSheets(editionId: string): Promise<SheetSpec[]> {
  const db = await getDb();
  const orderRows = await db
    .select({ order: orders, companyName: companies.name, standNumber: stands.number })
    .from(orders)
    .innerJoin(stands, eq(stands.id, orders.standId))
    .leftJoin(companies, eq(companies.id, orders.companyId))
    .where(eq(orders.editionId, editionId))
    .orderBy(asc(orders.createdAt));
  const lines = await orderLinesForEdition(editionId);
  return [
    {
      name: 'Orders',
      columns: [
        { header: 'Order', key: 'number' },
        { header: 'Placed', key: 'placed', type: 'datetime' },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Payment', key: 'payment' },
        { header: 'Company', key: 'company', width: 28 },
        { header: 'Stand', key: 'stand' },
        { header: 'PO number', key: 'po' },
        { header: 'Net', key: 'net', type: 'money' },
        { header: 'VAT', key: 'vat', type: 'money' },
        { header: 'Card fee', key: 'fee', type: 'money' },
        { header: 'Total', key: 'total', type: 'money' },
        { header: 'Refunded', key: 'refunded', type: 'money' },
        { header: 'Commission', key: 'commission', type: 'money' },
        { header: 'Paid', key: 'paid', type: 'datetime' },
        { header: 'Invoice due', key: 'due', type: 'date' },
      ],
      rows: orderRows.map((r) => ({
        number: r.order.number,
        placed: r.order.createdAt,
        status: ORDER_STATUS_LABELS[r.order.status],
        payment: r.order.paymentMethod === 'card' ? 'Card' : 'Invoice',
        company: r.companyName ?? '',
        stand: r.standNumber,
        po: r.order.poNumber ?? '',
        net: r.order.netPence,
        vat: r.order.vatPence,
        fee: r.order.cardFeePence,
        total: r.order.totalPence,
        refunded: r.order.refundedPence,
        commission: r.order.commissionPence,
        paid: r.order.paidAt,
        due: r.order.dueAt,
      })),
    },
    {
      name: 'Items',
      columns: [
        { header: 'Order', key: 'number' },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Company', key: 'company', width: 28 },
        { header: 'Stand', key: 'stand' },
        { header: 'Item', key: 'item', width: 32 },
        { header: 'Code', key: 'code', width: 14 },
        { header: 'Options and details', key: 'options', width: 40 },
        { header: 'Quantity', key: 'qty', type: 'number' },
        { header: 'Unit price (net)', key: 'unit', type: 'money' },
        { header: 'VAT rate', key: 'vatRate', type: 'percent' },
        { header: 'Net', key: 'net', type: 'money' },
        { header: 'VAT', key: 'vat', type: 'money' },
        { header: 'Gross', key: 'gross', type: 'money' },
        { header: 'Refunded', key: 'refunded', type: 'money' },
        { header: 'Supplier', key: 'supplier', width: 24 },
        { header: 'Commission', key: 'commission', type: 'money' },
        { header: 'Card fee share', key: 'fee', type: 'money' },
        { header: 'Supplier payout', key: 'payout', type: 'money' },
        { header: 'Fulfilment', key: 'fulfilment' },
      ],
      rows: lines.map((r) => ({
        number: r.order.number,
        status: ORDER_STATUS_LABELS[r.order.status],
        company: r.companyName ?? '',
        stand: r.standNumber,
        item: r.line.description,
        code: r.line.productCode ?? '',
        options: describeLineDetails(r.line),
        qty: r.line.quantity,
        unit: r.line.unitPricePence,
        vatRate: r.line.vatRateBps / 10_000,
        net: r.line.netPence,
        vat: r.line.vatPence,
        gross: lineGross(r.line),
        refunded: r.line.refundedPence,
        supplier: r.supplierName ?? 'Media10',
        commission: r.line.commissionPence,
        fee: r.line.cardFeeSharePence,
        payout: r.line.supplierId ? linePayoutAfterRefunds(r.line) : 0,
        fulfilment: FULFILMENT_LABELS[r.line.fulfilmentStatus],
      })),
    },
  ];
}

async function servicesSheets(editionId: string): Promise<SheetSpec[]> {
  const lines = await deliverableLines(editionId);
  return [
    {
      name: 'By stand',
      columns: [
        { header: 'Hall', key: 'hall' },
        { header: 'Stand', key: 'stand' },
        { header: 'Company', key: 'company', width: 28 },
        { header: 'Item', key: 'item', width: 32 },
        { header: 'Code', key: 'code', width: 14 },
        { header: 'Options and details', key: 'options', width: 40 },
        { header: 'Quantity', key: 'qty', type: 'number' },
        { header: 'Supplier', key: 'supplier', width: 24 },
        { header: 'Order', key: 'order' },
        { header: 'Status', key: 'fulfilment' },
      ],
      rows: lines.map((r) => ({
        hall: r.hallName ?? '',
        stand: r.standNumber,
        company: r.companyName ?? '',
        item: r.line.description,
        code: r.line.productCode ?? '',
        options: describeLineDetails(r.line),
        qty: r.line.quantity,
        supplier: r.supplierName ?? 'Media10',
        order: r.order.number,
        fulfilment: FULFILMENT_LABELS[r.line.fulfilmentStatus],
      })),
    },
    {
      name: 'By product',
      columns: [
        { header: 'Item', key: 'item', width: 34 },
        { header: 'Supplier', key: 'supplier', width: 24 },
        { header: 'Total quantity', key: 'qty', type: 'number' },
        { header: 'Delivered', key: 'delivered', type: 'number' },
        { header: 'Stands', key: 'stands', width: 60 },
      ],
      rows: totalsByProduct(lines).map((p) => ({ item: p.item, supplier: p.supplier, qty: p.quantity, delivered: p.delivered, stands: p.stands.join(', ') })),
    },
  ];
}

async function commissionSheets(actor: Actor, editionId: string): Promise<SheetSpec[]> {
  const r = await commissionReport(actor, editionId);
  return [
    {
      name: 'Commission',
      columns: [
        { header: 'Supplier', key: 'name', width: 30 },
        { header: 'Orders', key: 'orders', type: 'number' },
        { header: 'Sales (inc VAT)', key: 'gross', type: 'money' },
        { header: 'Refunded', key: 'refunded', type: 'money' },
        { header: 'Net', key: 'net', type: 'money' },
        { header: 'VAT', key: 'vat', type: 'money' },
        { header: 'Commission', key: 'commission', type: 'money' },
        { header: 'Card fees', key: 'fees', type: 'money' },
        { header: 'Payouts (paid orders)', key: 'payout', type: 'money' },
        { header: 'Payouts (unpaid invoices)', key: 'awaiting', type: 'money' },
        { header: 'Sent by Stripe', key: 'sent', type: 'money' },
        { header: 'Waiting to send', key: 'waiting', type: 'money' },
        { header: 'Paid by bank transfer', key: 'manualSettled', type: 'money' },
        { header: 'Owed by bank transfer', key: 'manualOwed', type: 'money' },
      ],
      rows: r.suppliers.map((s) => ({
        name: s.name,
        orders: s.orders,
        gross: s.grossPence,
        refunded: s.refundedPence,
        net: s.netPence,
        vat: s.vatPence,
        commission: s.commissionPence,
        fees: s.cardFeePence,
        payout: s.payoutPence,
        awaiting: s.awaitingPaymentPence,
        sent: s.transfers?.sent ?? null,
        waiting: s.transfers?.waiting ?? null,
        manualSettled: s.transfers?.manualSettled ?? null,
        manualOwed: s.transfers?.manualOwed ?? null,
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// Space-only
// ---------------------------------------------------------------------------

async function spaceOnlySheets(editionId: string): Promise<SheetSpec[]> {
  const db = await getDb();
  const rows = await db
    .select({ stand: stands, company: companies, hall: halls, contractor: standContractors, pack: spaceOnlyPacks, reviewer: users.name })
    .from(stands)
    .innerJoin(exhibitorTypes, and(eq(exhibitorTypes.id, stands.exhibitorTypeId), eq(exhibitorTypes.isSpaceOnly, true)))
    .leftJoin(companies, eq(companies.id, stands.companyId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .leftJoin(standContractors, eq(standContractors.standId, stands.id))
    .leftJoin(spaceOnlyPacks, eq(spaceOnlyPacks.standId, stands.id))
    .leftJoin(users, eq(users.id, spaceOnlyPacks.decidedBy))
    .where(and(eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .orderBy(asc(stands.number));
  return [
    {
      name: 'Space-only approvals',
      columns: [
        { header: 'Stand', key: 'stand' },
        { header: 'Company', key: 'company', width: 28 },
        { header: 'Hall', key: 'hall' },
        { header: 'Width (m)', key: 'width', type: 'number' },
        { header: 'Depth (m)', key: 'depth', type: 'number' },
        { header: 'Size (sqm)', key: 'size', type: 'number' },
        { header: 'Open sides', key: 'sides', type: 'number' },
        { header: 'Contractor', key: 'contractor', width: 26 },
        { header: 'Contractor contact', key: 'contact', width: 22 },
        { header: 'Contractor email', key: 'email', width: 28 },
        { header: 'Contractor phone', key: 'phone', width: 16 },
        { header: 'Contractor joined', key: 'joined' },
        { header: 'Pack status', key: 'status', width: 22 },
        { header: 'Version', key: 'version', type: 'number' },
        { header: 'Height (m)', key: 'height', type: 'number' },
        { header: 'Complex build', key: 'complex' },
        { header: 'Insurance cover (£)', key: 'cover', type: 'number' },
        { header: 'Insurance expires', key: 'expires', type: 'date' },
        { header: 'Sent', key: 'sent', type: 'datetime' },
        { header: 'Decided', key: 'decided', type: 'datetime' },
        { header: 'Decided by', key: 'reviewer' },
        { header: 'Conditions', key: 'conditions', width: 40 },
        { header: 'Certificate issued', key: 'certificate' },
      ],
      rows: rows.map((r) => {
        const contractor = r.contractor && r.contractor.status !== 'removed' ? r.contractor : null;
        return {
          stand: r.stand.number,
          company: r.company?.name ?? '',
          hall: r.hall?.name ?? '',
          width: r.stand.widthM ? Number(r.stand.widthM) : null,
          depth: r.stand.depthM ? Number(r.stand.depthM) : null,
          size: r.stand.sizeSqm ? Number(r.stand.sizeSqm) : null,
          sides: r.stand.openSides,
          contractor: contractor?.contractorCompanyName ?? 'Not nominated',
          contact: contractor?.contactName ?? '',
          email: contractor?.contactEmail ?? '',
          phone: contractor?.contactPhone ?? '',
          joined: contractor ? (contractor.status === 'active' ? 'Yes' : 'Not yet') : '',
          status: PACK_STATUS_LABELS[r.pack?.status ?? 'not_started']?.label ?? r.pack?.status ?? '',
          version: r.pack?.currentVersion || null,
          height: r.pack?.declaredHeightM ? Number(r.pack.declaredHeightM) : null,
          complex: r.pack ? (r.pack.isComplex ? 'Yes' : 'No') : '',
          cover: r.pack?.insuranceCoverGbp ?? null,
          expires: r.pack?.insuranceExpiresOn ? new Date(`${r.pack.insuranceExpiresOn}T12:00:00Z`) : null,
          sent: r.pack?.submittedAt ?? null,
          decided: r.pack?.decidedAt ?? null,
          reviewer: r.pack?.decidedAt ? (r.reviewer ?? '') : '',
          conditions: r.pack?.conditions ?? '',
          certificate: r.pack?.certificateFileId ? 'Yes' : '',
        };
      }),
    },
  ];
}
