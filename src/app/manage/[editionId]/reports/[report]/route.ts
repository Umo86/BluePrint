import { getActorForApi } from '@/server/auth/current';
import { buildReport, isReportKey, type ReportOptions } from '@/server/reports';
import { XLSX_TYPE } from '@/server/reports/xlsx';
import { EXHIBITOR_FILTERS, PROGRESS_FILTERS } from '@/server/services/stands';
import { AppError } from '@/server/errors';
import { RateLimitedError } from '@/server/security/rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrUndefined = (v: string | null) => (v && UUID.test(v) ? v : undefined);
const oneOf = <T extends readonly string[]>(list: T, v: string | null): T[number] | undefined => (v && (list as readonly string[]).includes(v) ? (v as T[number]) : undefined);

function optionsFrom(url: URL): ReportOptions {
  const sp = url.searchParams;
  return {
    exhibitors: {
      q: sp.get('q')?.slice(0, 200) || undefined,
      typeId: uuidOrUndefined(sp.get('type')),
      hallId: uuidOrUndefined(sp.get('hall')),
      state: oneOf(EXHIBITOR_FILTERS, sp.get('state')),
      progress: oneOf(PROGRESS_FILTERS, sp.get('progress')),
      taskNotDoneId: uuidOrUndefined(sp.get('task')),
      notOrderedCategoryId: uuidOrUndefined(sp.get('notOrdered')),
    },
    taskId: uuidOrUndefined(sp.get('task')),
  };
}

async function respond(editionId: string, report: string, opts: ReportOptions) {
  const actor = await getActorForApi();
  if (!actor || !UUID.test(editionId) || !isReportKey(report)) return new Response('Not found', { status: 404 });
  try {
    const r = await buildReport(actor, editionId, report, opts);
    return new Response(new Uint8Array(r.buffer), {
      headers: {
        'Content-Type': XLSX_TYPE,
        'Content-Disposition': `attachment; filename="${r.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof RateLimitedError) return new Response(err.message, { status: 429, headers: { 'Retry-After': String(err.retryAfterSeconds) } });
    if (err instanceof AppError) return new Response('Not found', { status: 404 });
    throw err;
  }
}

export async function GET(req: Request, ctx: RouteContext<'/manage/[editionId]/reports/[report]'>) {
  const { editionId, report } = await ctx.params;
  return respond(editionId, report, optionsFrom(new URL(req.url)));
}

/** The exhibitors report for rows picked on the exhibitors list (too many to fit in a link). */
export async function POST(req: Request, ctx: RouteContext<'/manage/[editionId]/reports/[report]'>) {
  const { editionId, report } = await ctx.params;
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return new Response('Forbidden', { status: 403 });
  if (report !== 'exhibitors') return new Response('Not found', { status: 404 });
  const text = await req.text();
  if (text.length > 300_000) return new Response('Too large', { status: 413 });
  let companyIds: string[] = [];
  try {
    const body = JSON.parse(text) as { companyIds?: unknown };
    if (!Array.isArray(body.companyIds) || body.companyIds.length === 0 || body.companyIds.length > 5000) throw new Error('bad');
    companyIds = body.companyIds.filter((x): x is string => typeof x === 'string' && UUID.test(x));
    if (!companyIds.length) throw new Error('bad');
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  return respond(editionId, report, { exhibitors: { companyIds }, filterLabels: [`${companyIds.length} chosen companies`] });
}
