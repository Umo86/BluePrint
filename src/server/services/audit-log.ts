import 'server-only';
import { and, count, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import { getDb } from '../db/client';
import { auditLog } from '../db/schema';
import { assertSuperAdmin, requireShowAdmin } from '../authz';
import type { Actor } from '../auth/actor';

export type AuditFilters = {
  action?: string;
  actorEmail?: string;
  editionId?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
};

const PAGE_SIZE = 100;

function buildWhere(f: AuditFilters): SQL | undefined {
  const conds: SQL[] = [];
  const esc = (v: string) => v.replace(/[%_\\]/g, (m) => `\\${m}`);
  if (f.action?.trim()) conds.push(ilike(auditLog.action, `${esc(f.action.trim())}%`));
  if (f.actorEmail?.trim()) conds.push(ilike(auditLog.actorEmail, `%${esc(f.actorEmail.trim())}%`));
  if (f.editionId) conds.push(eq(auditLog.editionId, f.editionId));
  if (f.entityId?.trim()) conds.push(eq(auditLog.entityId, f.entityId.trim()));
  if (f.from && !Number.isNaN(Date.parse(f.from))) conds.push(gte(auditLog.at, new Date(f.from)));
  if (f.to && !Number.isNaN(Date.parse(f.to))) conds.push(lte(auditLog.at, new Date(new Date(f.to).getTime() + 24 * 3600 * 1000)));
  return conds.length ? and(...conds) : undefined;
}

export async function queryAuditLog(actor: Actor, filters: AuditFilters) {
  if (filters.editionId && !actor.isSuperAdmin) {
    await requireShowAdmin(actor, filters.editionId);
  } else {
    assertSuperAdmin(actor);
  }
  const db = await getDb();
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters);
  const [{ total }] = await db.select({ total: count() }).from(auditLog).where(where);
  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.at))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { rows, total: Number(total), page, pageSize: PAGE_SIZE };
}

/** Up to 10,000 rows for a CSV download. */
export async function exportAuditLog(actor: Actor, filters: AuditFilters) {
  assertSuperAdmin(actor);
  const db = await getDb();
  return db.select().from(auditLog).where(buildWhere(filters)).orderBy(desc(auditLog.at)).limit(10_000);
}
