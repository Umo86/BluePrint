import 'server-only';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { companies, companyMembers, editions, exhibitorTypes, halls, invitations, shows, stands, users } from '../db/schema';
import { requireStandAccess } from '../authz';
import { forbidden, notFound } from '../errors';
import type { Actor } from '../auth/actor';

export type PortalStand = {
  id: string;
  number: string;
  companyId: string;
  companyName: string;
  typeId: string;
  typeKey: string;
  typeName: string;
  isSpaceOnly: boolean;
  hallName: string | null;
  sizeSqm: string | null;
};

const OPEN_STATUSES = ['live', 'onsite'];
const VISIBLE_STATUSES = ['live', 'onsite', 'closed'];

/**
 * Everything the exhibitor portal needs to know about who is looking: the edition, the stands
 * they can act for there, which one is selected, and whether changes are allowed.
 */
export async function resolvePortal(actor: Actor, slug: string, chosenStandId?: string | null) {
  const db = await getDb();
  const [row] = await db
    .select({ edition: editions, show: shows })
    .from(editions)
    .innerJoin(shows, eq(shows.id, editions.showId))
    .where(eq(editions.slug, slug))
    .limit(1);
  if (!row) throw notFound();
  const { edition, show } = row;
  // Draft shows are only visible to staff previewing as an exhibitor.
  if (!VISIBLE_STATUSES.includes(edition.status) && !actor.readOnly) throw notFound();

  const memberships = await db.select().from(companyMembers).where(eq(companyMembers.userId, actor.userId));
  if (!memberships.length) throw notFound();
  const standRows = await db
    .select({ stand: stands, type: exhibitorTypes, company: companies, hall: halls })
    .from(stands)
    .innerJoin(exhibitorTypes, eq(exhibitorTypes.id, stands.exhibitorTypeId))
    .innerJoin(companies, eq(companies.id, stands.companyId))
    .leftJoin(halls, eq(halls.id, stands.hallId))
    .where(
      and(
        eq(stands.editionId, edition.id),
        eq(stands.status, 'active'),
        inArray(
          stands.companyId,
          memberships.map((m) => m.companyId),
        ),
      ),
    )
    .orderBy(asc(companies.name), asc(stands.number));
  if (!standRows.length) throw notFound();

  const portalStands: PortalStand[] = standRows.map((r) => ({
    id: r.stand.id,
    number: r.stand.number,
    companyId: r.company.id,
    companyName: r.company.name,
    typeId: r.type.id,
    typeKey: r.type.key,
    typeName: r.type.name,
    isSpaceOnly: r.type.isSpaceOnly,
    hallName: r.hall?.name ?? null,
    sizeSqm: r.stand.sizeSqm,
  }));
  const stand = portalStands.find((s) => s.id === chosenStandId) ?? portalStands[0];
  const membership = memberships.find((m) => m.companyId === stand.companyId)!;
  const editable = OPEN_STATUSES.includes(edition.status) && !actor.readOnly;
  return {
    edition,
    show,
    stands: portalStands,
    stand,
    membership,
    isMainContact: membership.role === 'main_contact',
    canPay: membership.role === 'main_contact' || membership.canPay,
    editable,
    closedReason: actor.readOnly ? 'You are viewing as someone else, so nothing can be changed.' : edition.status === 'closed' ? 'This show has closed, so changes are switched off.' : null,
  };
}

export type PortalContext = Awaited<ReturnType<typeof resolvePortal>>;

/** Refuses changes when the show is not open (draft, closed or archived) or while viewing as someone else. */
export async function assertEditionOpen(actor: Actor, editionId: string) {
  if (actor.readOnly) throw forbidden('You are viewing as someone else, so changes are switched off.');
  const db = await getDb();
  const [e] = await db.select({ status: editions.status }).from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!e) throw notFound();
  if (!OPEN_STATUSES.includes(e.status)) throw forbidden('This show is not open for changes.');
}

/** The exhibitor's company, its people and invitations still waiting, for the portal's company page. */
export async function companyForPortal(actor: Actor, standId: string) {
  const { stand, membership } = await requireStandAccess(actor, standId);
  const db = await getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, stand.companyId!)).limit(1);
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, lastLoginAt: users.lastLoginAt, role: companyMembers.role, canPay: companyMembers.canPay })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, company.id))
    .orderBy(asc(users.name));
  const companyStands = await db
    .select({ id: stands.id })
    .from(stands)
    .where(and(eq(stands.companyId, company.id), eq(stands.editionId, stand.editionId)));
  const pending =
    membership.role === 'main_contact'
      ? await db
          .select()
          .from(invitations)
          .where(
            and(
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
              gt(invitations.expiresAt, new Date()),
              eq(invitations.kind, 'colleague'),
              inArray(
                invitations.standId,
                companyStands.map((s) => s.id),
              ),
            ),
          )
      : [];
  return { company, people, pending, isMainContact: membership.role === 'main_contact' };
}
