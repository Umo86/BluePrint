'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  requestSignInCode,
  signInWithPassword,
  verifySecondFactor,
  verifySignInCode,
} from '@/server/auth/login';
import { createSession, revokeSession } from '@/server/auth/sessions';
import {
  getCurrentAuth,
  renewSession,
  requestContext,
  requireActor,
  safeNextPath,
  setSessionCookie,
  signOutCurrentSession,
} from '@/server/auth/current';
import { acceptInvitation, findInvitation, sendInvitationCode } from '@/server/auth/invitations';
import { invalid } from '@/server/errors';
import { audit } from '@/server/audit';

const emailSchema = z.string().trim().min(3).max(254);

export async function requestCodeAction(email: string): Promise<ActionResult> {
  return runAction(async () => {
    await requestSignInCode(emailSchema.parse(email), await requestContext());
  });
}

async function startSessionAndGo(userId: string, next: string | null) {
  const ctx = await requestContext();
  // A new sign-in replaces whatever session this browser had.
  const previous = await getCurrentAuth();
  if (previous) await revokeSession(previous.session.id);
  const { token, expiresAt, session } = await createSession(userId, ctx);
  await setSessionCookie(token, expiresAt);
  const target = safeNextPath(next);
  if (!session.twoFactorVerified) redirect(`/two-factor?next=${encodeURIComponent(target)}`);
  redirect(target);
}

export async function verifyCodeAction(email: string, code: string, next: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const user = await verifySignInCode(emailSchema.parse(email), String(code), await requestContext());
    await startSessionAndGo(user.id, next);
  });
}

export async function passwordSignInAction(email: string, password: string, next: string | null): Promise<ActionResult> {
  return runAction(async () => {
    if (!password || password.length > 200) throw invalid('Enter your password.');
    const user = await signInWithPassword(emailSchema.parse(email), password, await requestContext());
    await startSessionAndGo(user.id, next);
  });
}

export async function twoFactorAction(code: string, next: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const auth = await getCurrentAuth();
    if (!auth) redirect('/sign-in');
    const ok = await verifySecondFactor(auth.user.id, String(code), await requestContext());
    if (!ok) throw invalid('That code did not work. Try the newest code from your app, or a recovery code.');
    await renewSession(auth, { twoFactorVerified: true });
    redirect(safeNextPath(next));
  });
}

export async function beginEnrollmentAction(): Promise<ActionResult<{ secret: string; qrDataUrl: string }>> {
  return runAction(async () => {
    const actor = await requireActor({ allowIncompleteTwoFactor: true });
    const { secret, qrDataUrl } = await beginTotpEnrollment(actor);
    return { secret, qrDataUrl };
  });
}

export async function confirmEnrollmentAction(code: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => {
    const auth = await getCurrentAuth();
    if (!auth) redirect('/sign-in');
    const recoveryCodes = await confirmTotpEnrollment(auth.actor, String(code), auth.session);
    // Setting up two-factor with a fresh code counts as passing it, on a fresh session.
    await renewSession(auth, { twoFactorVerified: true });
    return { recoveryCodes };
  });
}

export async function signOutAction() {
  const auth = await getCurrentAuth();
  if (auth) await audit(auth.actor, 'auth.sign_out', { entityType: 'user', entityId: auth.user.id });
  await signOutCurrentSession();
  redirect('/sign-in?signedOut=1');
}

export async function sendInviteCodeAction(token: string): Promise<ActionResult> {
  return runAction(async () => {
    await sendInvitationCode(String(token), await requestContext());
  }, 'We have emailed you a code.');
}

/** The address of the person fully signed in on this browser (not while viewing as someone else). */
async function signedInEmail() {
  const auth = await getCurrentAuth();
  if (!auth || auth.needsTwoFactorSetup || auth.needsSecondFactor || auth.viewAsUser) return null;
  return auth.user.email;
}

export async function acceptInviteAction(token: string, name: string, code: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const found = await findInvitation(String(token));
    if (!found) throw invalid('This invitation has expired or has already been used.');
    const user = await acceptInvitation(String(token), { name: String(name ?? ''), code: code ?? undefined }, await requestContext(), {
      signedInEmail: await signedInEmail(),
    });
    // Any earlier session in this browser belongs to someone else; start fresh.
    await signOutCurrentSession();
    await startSessionAndGo(user.id, '/start');
  });
}
