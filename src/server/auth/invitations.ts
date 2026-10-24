import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  companies,
  companyMembers,
  EDITION_PERMISSIONS,
  EDITION_ROLES,
  editionStaff,
  editions,
  invitations,
  standContractors,
  stands,
  supplierUsers,
  suppliers,
  users,
  type EditionPermission,
  type EditionRole,
  type InvitationKind,
} from '../db/schema';
import { randomToken, sha256Hex } from '../security/crypto';
import { assertRateLimit } from '../security/rate-limit';
import { forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import {
  assertSuperAdmin,
  assertWritable,
  getEditionAccess,
  requireEditionPermission,
  requireShowAdmin,
  requireStandAccess,
} from '../authz';
import { consumeEmailCode, isValidEmail, issueEmailCode, normaliseEmail, appUrl, type RequestContext } from './login';
import type { Actor } from './actor';

export const INVITE_TTL_MS = 14 * 24 * 3600 * 1000;

/** Invitations that grant staff or payout access need the person to prove they own the mailbox. */
export const KINDS_NEEDING_EMAIL_CODE: InvitationKind[] = ['super_admin', 'edition_staff', 'supplier'];

export type CreateInvitationInput = {
  kind: InvitationKind;
  email: string;
  editionId?: string | null;
  companyId?: string | null;
  standId?: string | null;
  supplierId?: string | null;
  role?: string | null;
  permissions?: string[];
};

async function authorize(actor: Actor, input: CreateInvitationInput) {
  assertWritable(actor);
  switch (input.kind) {
    case 'super_admin':
      assertSuperAdmin(actor);
      return;
    case 'edition_staff':
      if (!input.editionId) throw invalid('Choose a show edition.');
      await requireShowAdmin(actor, input.editionId);
      if (!EDITION_ROLES.includes(input.role as EditionRole)) throw invalid('Choose a role.');
      return;
    case 'exhibitor':
      if (!input.editionId || !input.companyId) throw invalid('Choose the exhibiting company.');
      await requireEditionPermission(actor, input.editionId, 'manage_exhibitors');
      return;
    case 'colleague':
    case 'contractor': {
      if (!input.standId) throw invalid('Choose the stand.');
      const db = await getDb();
      const [stand] = await db.select().from(stands).where(eq(stands.id, input.standId)).limit(1);
      if (!stand) throw notFound();
      const staff = await getEditionAccess(actor, stand.editionId);
      if (staff?.permissions.has('manage_exhibitors')) return;
      const { membership } = await requireStandAccess(actor, input.standId, { write: true });
      if (input.kind === 'colleague' && membership.role !== 'main_contact') {
        throw forbidden('Only your company’s main contact can invite colleagues.');
      }
      return;
    }
    case 'supplier':
      if (!input.supplierId) throw invalid('Choose the supplier.');
      if (actor.isSuperAdmin && !actor.readOnly) return;
      if (!input.editionId) throw forbidden();
      await requireShowAdmin(actor, input.editionId);
      return;
  }
}

async function describeInvitation(inv: typeof invitations.$inferSelect) {
  const db = await getDb();
  const [edition] = inv.editionId ? await db.select().from(editions).where(eq(editions.id, inv.editionId)).limit(1) : [];
  const [company] = inv.companyId ? await db.select().from(companies).where(eq(companies.id, inv.companyId)).limit(1) : [];
  const [stand] = inv.standId ? await db.select().from(stands).where(eq(stands.id, inv.standId)).limit(1) : [];
  const [supplier] = inv.supplierId ? await db.select().from(suppliers).where(eq(suppliers.id, inv.supplierId)).limit(1) : [];
  const [standEdition] = stand && !edition ? await db.select().from(editions).where(eq(editions.id, stand.editionId)).limit(1) : [];
  const e = edition ?? standEdition;
  let headline = 'You have been invited to BluePrint';
  switch (inv.kind) {
    case 'super_admin':
      headline = 'You have been made a BluePrint super admin';
      break;
    case 'edition_staff':
      headline = `Join the ${e?.name ?? 'show'} team on BluePrint`;
      break;
    case 'exhibitor':
      headline = `${company?.name ?? 'Your company'} is exhibiting at ${e?.name ?? 'a Media10 show'}`;
      break;
    case 'colleague':
      headline = `Join your colleagues on stand ${stand?.number ?? ''} at ${e?.name ?? 'a Media10 show'}`;
      break;
    case 'contractor':
      headline = `You have been nominated to build stand ${stand?.number ?? ''} at ${e?.name ?? 'a Media10 show'}`;
      break;
    case 'supplier':
      headline = `${supplier?.name ?? 'Your company'} is a supplier on BluePrint`;
      break;
  }
  return { headline, edition: e ?? null, company: company ?? null, stand: stand ?? null, supplier: supplier ?? null };
}

export async function createInvitation(actor: Actor, input: CreateInvitationInput, opts: { send?: boolean } = {}) {
  const email = normaliseEmail(input.email);
  if (!isValidEmail(email)) throw invalid('Enter a valid email address.', { email: 'Enter a valid email address.' });
  await authorize(actor, input);
  await assertRateLimit(`invite:${actor.realUserId}`, 300, 3600);

  const permissions = (input.permissions ?? []).filter((p) =>
    input.kind === 'edition_staff' ? EDITION_PERMISSIONS.includes(p as EditionPermission) : p === 'pay',
  );

  const db = await getDb();
  // Replace any earlier pending invitation for the same person and place.
  const scope = [
    eq(invitations.email, email),
    eq(invitations.kind, input.kind),
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
  ];
  if (input.editionId) scope.push(eq(invitations.editionId, input.editionId));
  if (input.companyId) scope.push(eq(invitations.companyId, input.companyId));
  if (input.standId) scope.push(eq(invitations.standId, input.standId));
  if (input.supplierId) scope.push(eq(invitations.supplierId, input.supplierId));
  await db.update(invitations).set({ revokedAt: new Date() }).where(and(...scope));

  const token = randomToken(32);
  const [inv] = await db
    .insert(invitations)
    .values({
      tokenHash: sha256Hex(token),
      email,
      kind: input.kind,
      editionId: input.editionId ?? null,
      companyId: input.companyId ?? null,
      standId: input.standId ?? null,
      supplierId: input.supplierId ?? null,
      role: input.role ?? null,
      permissions,
      invitedBy: actor.realUserId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      lastSentAt: opts.send === false ? null : new Date(),
    })
    .returning();

  const url = appUrl(`/invite/${token}`);
  if (opts.send !== false) await sendInvitationEmail(inv, url, actor);
  await audit(actor, 'invitation.created', {
    entityType: 'invitation',
    entityId: inv.id,
    editionId: input.editionId ?? null,
    companyId: input.companyId ?? null,
    details: { kind: input.kind, email, role: input.role ?? null },
  });
  return { invitation: inv, token, url };
}

async function sendInvitationEmail(inv: typeof invitations.$inferSelect, url: string, actor: Actor) {
  const d = await describeInvitation(inv);
  const brand = d.edition?.branding?.primaryColor;
  const { html, text } = renderSimpleEmail({
    heading: d.headline,
    paragraphs: [
      'BluePrint is where you complete your tasks, order services and find everything you need for the show.',
      'Use the button below to accept. The link is personal to you and works for 14 days.',
    ],
    button: { label: 'Accept invitation', url },
    footer: `This invitation was sent to ${inv.email}. If you were not expecting it, you can ignore this email.`,
    brandColor: brand,
  });
  const keyByKind: Record<InvitationKind, string> = {
    super_admin: 'invite_staff',
    edition_staff: 'invite_staff',
    exhibitor: 'invite_exhibitor',
    colleague: 'invite_colleague',
    contractor: 'invite_contractor',
    supplier: 'invite_supplier',
  };
  await sendEmail({
    to: inv.email,
    editionId: d.edition?.id ?? null,
    companyId: inv.companyId,
    standId: inv.standId,
    templateKey: keyByKind[inv.kind],
    category: 'transactional',
    subject: d.headline,
    html,
    text,
    sentBy: actor.realUserId,
  });
}

/** Re-sends a pending invitation with a fresh link. */
export async function resendInvitation(actor: Actor, invitationId: string) {
  const db = await getDb();
  const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
  if (!inv || inv.acceptedAt || inv.revokedAt) throw notFound();
  return createInvitation(actor, {
    kind: inv.kind,
    email: inv.email,
    editionId: inv.editionId,
    companyId: inv.companyId,
    standId: inv.standId,
    supplierId: inv.supplierId,
    role: inv.role,
    permissions: inv.permissions,
  });
}

export async function revokeInvitation(actor: Actor, invitationId: string) {
  const db = await getDb();
  const [inv] = await db.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
  if (!inv) throw notFound();
  await authorize(actor, { ...inv, email: inv.email, permissions: inv.permissions });
  await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, invitationId));
  await audit(actor, 'invitation.revoked', { entityType: 'invitation', entityId: inv.id, editionId: inv.editionId });
}

/** Finds a usable invitation from the token in the link. */
export async function findInvitation(token: string) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const db = await getDb();
  const [inv] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.tokenHash, sha256Hex(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  if (!inv) return null;
  const [existing] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, inv.email)).limit(1);
  return { invitation: inv, needsEmailCode: KINDS_NEEDING_EMAIL_CODE.includes(inv.kind), existingUser: existing ?? null, ...(await describeInvitation(inv)) };
}

export async function sendInvitationCode(token: string, ctx: RequestContext) {
  const found = await findInvitation(token);
  if (!found) throw notFound('This invitation has expired or has already been used.');
  await assertRateLimit(`invite-code:${found.invitation.id}`, 5, 15 * 60);
  await issueEmailCode(found.invitation.email, { purpose: 'accept_invite', ctx });
}

/**
 * Accepts an invitation: creates or activates the account, grants the access it describes and
 * uses the invitation up. Returns the user to sign in.
 */
export async function acceptInvitation(token: string, input: { name: string; code?: string }, ctx: RequestContext) {
  const found = await findInvitation(token);
  if (!found) throw notFound('This invitation has expired or has already been used.');
  const inv = found.invitation;
  const name = input.name.trim().slice(0, 120);
  if (!name && !found.existingUser?.name) throw invalid('Enter your name.', { name: 'Enter your name.' });

  if (found.needsEmailCode) {
    if (!input.code) throw invalid('Enter the code we emailed you.', { code: 'Enter the code we emailed you.' });
    await consumeEmailCode(inv.email, input.code, ctx);
  }

  const db = await getDb();
  const user = await db.transaction(async (tx) => {
    // Use the invitation up first; if two requests race, only one wins.
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (!claimed.length) throw notFound('This invitation has already been used.');

    let [u] = await tx.select().from(users).where(eq(users.email, inv.email)).limit(1);
    if (!u) {
      [u] = await tx.insert(users).values({ email: inv.email, name, status: 'active' }).returning();
    } else {
      if (u.status === 'disabled') throw forbidden('This account has been disabled. Contact the show team.');
      [u] = await tx
        .update(users)
        .set({ status: 'active', name: u.name || name })
        .where(eq(users.id, u.id))
        .returning();
    }

    switch (inv.kind) {
      case 'super_admin':
        await tx.update(users).set({ isSuperAdmin: true }).where(eq(users.id, u.id));
        break;
      case 'edition_staff':
        await tx
          .insert(editionStaff)
          .values({ editionId: inv.editionId!, userId: u.id, role: inv.role as EditionRole, permissions: inv.permissions as EditionPermission[], addedBy: inv.invitedBy })
          .onConflictDoUpdate({
            target: [editionStaff.editionId, editionStaff.userId],
            set: { role: inv.role as EditionRole, permissions: inv.permissions as EditionPermission[] },
          });
        break;
      case 'exhibitor':
        await tx
          .insert(companyMembers)
          .values({ companyId: inv.companyId!, userId: u.id, role: (inv.role as 'main_contact' | 'colleague') ?? 'main_contact', canPay: true })
          .onConflictDoNothing();
        break;
      case 'colleague': {
        const [stand] = await tx.select().from(stands).where(eq(stands.id, inv.standId!)).limit(1);
        if (!stand?.companyId) throw notFound();
        await tx
          .insert(companyMembers)
          .values({ companyId: stand.companyId, userId: u.id, role: 'colleague', canPay: inv.permissions.includes('pay') })
          .onConflictDoNothing();
        break;
      }
      case 'contractor':
        await tx
          .update(standContractors)
          .set({ userId: u.id, status: 'active' })
          .where(and(eq(standContractors.standId, inv.standId!), eq(standContractors.contactEmail, inv.email)));
        break;
      case 'supplier':
        await tx.insert(supplierUsers).values({ supplierId: inv.supplierId!, userId: u.id }).onConflictDoNothing();
        break;
    }
    await tx.update(invitations).set({ acceptedUserId: u.id }).where(eq(invitations.id, inv.id));
    return u;
  });

  await audit(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      readOnly: false,
      realUserId: user.id,
      realEmail: user.email,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    'invitation.accepted',
    { entityType: 'invitation', entityId: inv.id, editionId: inv.editionId, companyId: inv.companyId, details: { kind: inv.kind } },
  );
  return user;
}
