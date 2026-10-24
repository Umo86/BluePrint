import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { sessions } from '../db/schema';
import { env } from '../env';
import { AppError } from '../errors';
import type { Actor } from './actor';
import { isStaffUser, revokeSession, validateSessionToken, type SessionRow, type SessionUser } from './sessions';
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

/** The signed-in person for this request (memoised per request). */
export const getCurrentAuth = cache(async (): Promise<CurrentAuth | null> => {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  const valid = await validateSessionToken(token);
  if (!valid) return null;
  const { session, user, viewAsUser } = valid;
  const ctx = await requestContext();
  const isStaff = await isStaffUser(user.id);
  const needsTwoFactorSetup = isStaff && !user.totpEnabledAt;
  const needsSecondFactor = isStaff && Boolean(user.totpEnabledAt) && !session.twoFactorVerified;

  const actor: Actor = viewAsUser
    ? {
        userId: viewAsUser.id,
        email: viewAsUser.email,
        name: viewAsUser.name,
        // Viewing as someone never carries super admin rights, and nothing can be changed.
        isSuperAdmin: false,
        readOnly: true,
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

/** Only relative paths inside the app, so the sign-in page cannot be used as an open redirect. */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.includes('\n') || next.length > 500) {
    return fallback;
  }
  return next;
}

async function currentPath() {
  const h = await headers();
  return safeNextPath(h.get('x-pathname'), '/');
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
