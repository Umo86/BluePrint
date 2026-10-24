import 'server-only';
import { getDb, type DbLike } from './db/client';
import { auditLog } from './db/schema';
import { isSystemActor, type Actor } from './auth/actor';

export type AuditOptions = {
  entityType?: string;
  entityId?: string | null;
  editionId?: string | null;
  companyId?: string | null;
  details?: Record<string, unknown>;
  db?: DbLike;
};

/** Values never written to the audit log, even if a caller passes them by mistake. */
const SENSITIVE_KEYS = /password|token|secret|code|hash|card|iban|sort_?code|account_?number/i;

function scrub(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrub(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Appends one entry to the audit log. Never throws: auditing must not break the action itself. */
export async function audit(actor: Actor | null, action: string, opts: AuditOptions = {}) {
  try {
    const db = opts.db ?? (await getDb());
    const details = scrub(opts.details ?? {});
    if (actor && actor.realUserId !== actor.userId) details.viewingAs = actor.userId;
    await db.insert(auditLog).values({
      actorUserId: actor && !isSystemActor(actor) ? actor.realUserId : null,
      actorEmail: actor ? actor.realEmail : null,
      action,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
      editionId: opts.editionId ?? null,
      companyId: opts.companyId ?? null,
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent?.slice(0, 300) ?? null,
      details,
    });
  } catch (err) {
    console.error('audit log write failed', action, err);
  }
}
