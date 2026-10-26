import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { companyMembers, editionStaff, sessions, stands } from '../db/schema';
import { env } from '../env';
import { localPath } from '@/lib/safe-redirect';
import { memberCovers } from '../authz';
import { AppError } from '../errors';
import type { Actor } from './actor';
import { createSession, isStaffUser, revokeSession, twoFactorSteps, validateSessionToken, type SessionRow, type SessionUser } from './sessions';
import type { RequestContext } from './login';

const COOKIE_NAME_PROD = '__Host-bp_session';
const COOKIE_NAME_DEV = 'bp_session';

function cookieName() {
  return env().NODE_ENV === 'production' ? COOKIE_NAME_PROD : COOKIE_NAME_DEV;
}

function secureCookies() {
  return env().NODE_ENV === 'production';
}

export async function requestContext(): Promise<RequestContext> {
  const h = await headers();
  const ip =
    h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip')?.trim() ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null;
  return { ip, userAgent: h.get('user-agent') };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(cookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(cookieName(), '', { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: 0 });
}

/**
 * Swaps this browser's session for a brand-new one (a new token), for example once two-factor has
 * been passed, so a token seen before that point is worthless.
 */
export async function renewSession(auth: CurrentAuth, opts: { twoFactorVerified: boolean }) {
  const { token, expiresAt } = await createSession(auth.user.id, { ...(await requestContext()), twoFactorVerified: opts.twoFactorVerified, signedInAt: auth.session.createdAt });
  await revokeSession(auth.session.id);
  await setSessionCookie(token, expiresAt);
}

export type CurrentAuth = {
  session: SessionRow;
  /** The person actually signed in. */
  user: SessionUser;
  /** Who requests act as (the viewed user while viewing as someone else). */
  actor: Actor;
  viewAsUser: SessionUser | null;
  isStaff: boolean;
  needsTwoFactorSetup: boolean;
  needsSecondFactor: boolean;
};

/**
 * Viewing as someone is re-checked on every request: the admin must still run that show (or be a
 * super admin) and the person must still exhibit there. Otherwise the view simply ends.
 */
async function viewAsStillAllowed(real: SessionUser, target: SessionUser, editionId: string | null) {
  if (!editionId || target.isSuperAdmin || target.id === real.id) return false;
  const db = await getDb();
  if (!real.isSuperAdmin) {
    const [staff] = await db
      .select({ role: editionStaff.role })
      .from(editionStaff)
      .where(and(eq(editionStaff.editionId, editionId), eq(editionStaff.userId, real.id)))
      .limit(1);
    if (staff?.role !== 'show_admin') return false;
  }
  const [link] = await db
    .select({ id: stands.id })
    .from(companyMembers)
    .innerJoin(stands, and(eq(stands.companyId, companyMembers.companyId), eq(stands.editionId, editionId), eq(stands.status, 'active')))
    .where(and(eq(companyMembers.userId, target.id), memberCovers(editionId)))
    .limit(1);
  return Boolean(link);
}

/** The signed-in person for this request (memoised per request). */
export const getCurrentAuth = cache(async (): Promise<CurrentAuth | null> => {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  const valid = await validateSessionToken(token);
  if (!valid) return null;
  const { session, user } = valid;
  let { viewAsUser } = valid;
  if (viewAsUser && !(await viewAsStillAllowed(user, viewAsUser, session.viewAsEditionId))) {
    await setViewAs(session.id, null, null);
    viewAsUser = null;
  }
  const ctx = await requestContext();
  const isStaff = await isStaffUser(user.id);
  const { needsTwoFactorSetup, needsSecondFactor } = twoFactorSteps({ isStaff, totpEnabledAt: user.totpEnabledAt, twoFactorVerified: session.twoFactorVerified });

  const actor: Actor = viewAsUser
    ? {
        userId: viewAsUser.id,
        email: viewAsUser.email,
        name: viewAsUser.name,
        // Viewing as someone never carries super admin rights, and nothing can be changed.
        isSuperAdmin: false,
        readOnly: true,
        // Only the show the admin was allowed to view (an empty value matches nothing).
        viewAsEditionId: session.viewAsEditionId ?? '',
        realUserId: user.id,
        realEmail: user.email,
        sessionId: session.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }
    : {
        userId: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
        readOnly: false,
        realUserId: user.id,
        realEmail: user.email,
        sessionId: session.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      };
  return { session, user, actor, viewAsUser, isStaff, needsTwoFactorSetup, needsSecondFactor };
});

/** Whether two-factor was turned on in the last few minutes (while the person saves their recovery codes). */
export function twoFactorJustTurnedOn(user: { totpEnabledAt: Date | null }) {
  return Boolean(user.totpEnabledAt && Date.now() - user.totpEnabledAt.getTime() < 10 * 60 * 1000);
}

/**
 * Only relative paths inside the app, so the sign-in page cannot be used as an open redirect.
 * The homepage is the public front page, so after signing in people go to their workspace instead.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/start'): string {
  const path = localPath(next);
  if (!path || path === '/' || path.startsWith('/?') || path.startsWith('/#')) return fallback;
  return path;
}

async function currentPath() {
  const h = await headers();
  return safeNextPath(h.get('x-pathname'));
}

/**
 * Returns the actor for a page or action, sending the person to sign in (or to finish two-factor)
 * when needed.
 */
export async function requireActor(opts: { allowIncompleteTwoFactor?: boolean } = {}): Promise<Actor> {
  const auth = await getCurrentAuth();
  if (!auth) {
    const next = await currentPath();
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }
  if (!opts.allowIncompleteTwoFactor) {
    if (auth.needsTwoFactorSetup) redirect('/two-factor-setup');
    if (auth.needsSecondFactor) redirect(`/two-factor?next=${encodeURIComponent(await currentPath())}`);
  }
  return auth.actor;
}

/** For super admin pages: anyone else gets "not found", so the area's existence is not revealed. */
export async function requireSuperAdmin(): Promise<Actor> {
  const actor = await requireActor();
  if (!actor.isSuperAdmin || actor.readOnly) notFound();
  return actor;
}

/** For route handlers: returns null instead of redirecting. */
export async function getActorForApi(): Promise<Actor | null> {
  const auth = await getCurrentAuth();
  if (!auth || auth.needsTwoFactorSetup || auth.needsSecondFactor) return null;
  return auth.actor;
}

export async function signOutCurrentSession() {
  const auth = await getCurrentAuth();
  if (auth) await revokeSession(auth.session.id);
  await clearSessionCookie();
}

export async function setViewAs(sessionId: string, targetUserId: string | null, editionId: string | null) {
  const db = await getDb();
  await db.update(sessions).set({ viewAsUserId: targetUserId, viewAsEditionId: editionId }).where(eq(sessions.id, sessionId));
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
