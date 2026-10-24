import { getActorForApi } from '@/server/auth/current';
import { exportAuditLog } from '@/server/services/audit-log';
import { audit } from '@/server/audit';
import { toCsv } from '@/lib/csv';

export async function GET(req: Request) {
  const actor = await getActorForApi();
  if (!actor || !actor.isSuperAdmin || actor.readOnly) return new Response('Not found', { status: 404 });
  const sp = new URL(req.url).searchParams;
  const get = (k: string, max = 200) => sp.get(k)?.slice(0, max) || undefined;
  const editionId = get('edition');
  const filters = {
    action: get('action'),
    actorEmail: get('who'),
    editionId: editionId && /^[0-9a-f-]{36}$/i.test(editionId) ? editionId : undefined,
    entityId: get('entity'),
    from: get('from', 10),
    to: get('to', 10),
  };
  const rows = await exportAuditLog(actor, filters);
  await audit(actor, 'audit_log.exported', { details: { rows: rows.length, filters } });
  const csv = toCsv([
    ['When (UTC)', 'Who', 'Action', 'Record type', 'Record ID', 'Edition ID', 'Company ID', 'IP address', 'Details'],
    ...rows.map((r) => [r.at, r.actorEmail, r.action, r.entityType, r.entityId, r.editionId, r.companyId, r.ip, r.details ? JSON.stringify(r.details) : '']),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="blueprint-audit-log-${stamp}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
