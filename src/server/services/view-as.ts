import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { companyMembers, editions, stands, users } from '../db/schema';
import { forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { requireShowAdmin } from '../authz';
import type { Actor } from '../auth/actor';

/**
 * Checks that the signed-in admin may view the portal as `targetUserId` in `editionId`:
 * super admins for any exhibitor, show admins for exhibitors in their own edition.
 * Returns the edition slug to open.
 */
export async function authorizeViewAs(actor: Actor, targetUserId: string, editionId: string) {
  if (actor.readOnly) throw forbidden('Stop the current view first.');
  if (targetUserId === actor.realUserId) throw forbidden('You are already signed in as yourself.');
  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw notFound();
  if (!actor.isSuperAdmin) await requireShowAdmin(actor, editionId);

  const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target || target.isSuperAdmin) throw notFound();
  const [link] = await db
    .select({ standId: stands.id })
    .from(companyMembers)
    .innerJoin(stands, and(eq(stands.companyId, companyMembers.companyId), eq(stands.editionId, editionId)))
    .where(eq(companyMembers.userId, targetUserId))
    .limit(1);
  if (!link) throw notFound('That person is not an exhibitor at this show.');
  await audit(actor, 'view_as.start', { entityType: 'user', entityId: targetUserId, editionId, details: { target: target.email } });
  return { slug: edition.slug };
}
