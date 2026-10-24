import 'server-only';
import { and, count, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { editionStaff, exhibitorTypes, halls, stands } from '../db/schema';
import { requireEditionPermission } from '../authz';
import { getEdition } from './editions';
import { listExhibitors } from './stands';
import type { Actor } from '../auth/actor';

/** Numbers and set-up progress for the top of a show dashboard. */
export async function editionOverview(actor: Actor, editionId: string) {
  await requireEditionPermission(actor, editionId, 'view');
  const db = await getDb();
  const found = await getEdition(editionId);
  const { summary } = await listExhibitors(actor, editionId);
  const byType = await db
    .select({ name: exhibitorTypes.name, isSpaceOnly: exhibitorTypes.isSpaceOnly, n: count(stands.id) })
    .from(exhibitorTypes)
    .leftJoin(stands, and(eq(stands.exhibitorTypeId, exhibitorTypes.id), eq(stands.status, 'active')))
    .where(eq(exhibitorTypes.editionId, editionId))
    .groupBy(exhibitorTypes.id, exhibitorTypes.name, exhibitorTypes.isSpaceOnly, exhibitorTypes.sort)
    .orderBy(exhibitorTypes.sort);
  const [{ hallCount }] = await db.select({ hallCount: count() }).from(halls).where(eq(halls.editionId, editionId));
  const [{ teamCount }] = await db.select({ teamCount: count() }).from(editionStaff).where(eq(editionStaff.editionId, editionId));
  const edition = found!.edition;
  const standTotal = byType.reduce((n, t) => n + Number(t.n), 0);
  const setup = [
    { key: 'dates', label: 'Dates set', done: Boolean(edition.buildUpStartsAt && edition.openStartsAt), href: 'settings' },
    { key: 'branding', label: 'Logo and colours added', done: Boolean(edition.branding.logoFileId && edition.branding.primaryColor), href: 'settings?tab=branding' },
    { key: 'email', label: 'Email sender set', done: Boolean(edition.emailSettings.senderAddress), href: 'settings?tab=email' },
    { key: 'halls', label: 'Halls added', done: Number(hallCount) > 0, href: 'settings?tab=halls' },
    { key: 'stands', label: 'Exhibitors and stands added', done: standTotal > 0, href: 'exhibitors' },
    { key: 'team', label: 'Team invited', done: Number(teamCount) > 1, href: 'team' },
    { key: 'live', label: 'Show set live', done: edition.status !== 'draft', href: 'settings' },
  ];
  return {
    edition,
    show: found!.show,
    summary,
    byType: byType.map((t) => ({ name: t.name, isSpaceOnly: t.isSpaceOnly, stands: Number(t.n) })),
    standTotal,
    hallCount: Number(hallCount),
    teamCount: Number(teamCount),
    setup,
  };
}
