import 'server-only';
import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { getDb } from '../db/client';
import { announcements } from '../db/schema';

/** Published announcements an exhibitor of this stand type should see, newest (and pinned) first. */
export async function announcementsForType(editionId: string, typeId: string, limit = 5) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.editionId, editionId), isNotNull(announcements.publishedAt), lte(announcements.publishedAt, new Date())))
    .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
    .limit(50);
  return rows.filter((a) => a.visibleToTypes.length === 0 || a.visibleToTypes.includes(typeId)).slice(0, limit);
}
