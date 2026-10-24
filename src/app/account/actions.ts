'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/server/actions';
import { getCurrentAuth, requireActor } from '@/server/auth/current';
import { removePassword, setPassword } from '@/server/auth/login';
import { revokeAllSessions, revokeSession } from '@/server/auth/sessions';
import { updateProfile } from '@/server/services/account';
import { audit } from '@/server/audit';
import { notFound } from '@/server/errors';
import { listActiveSessions } from '@/server/auth/sessions';

export async function updateProfileAction(input: { name: string; phone?: string; jobTitle?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await updateProfile(await requireActor(), input);
    revalidatePath('/account');
  }, 'Profile saved.');
}

export async function setPasswordAction(password: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const auth = await getCurrentAuth();
    await setPassword(actor, String(password), auth?.session.id);
    revalidatePath('/account');
  }, 'Password saved. Other devices have been signed out.');
}

export async function removePasswordAction(): Promise<ActionResult> {
  return runAction(async () => {
    await removePassword(await requireActor());
    revalidatePath('/account');
  }, 'Password removed. You will sign in with emailed codes.');
}

export async function signOutOtherDevicesAction(): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const auth = await getCurrentAuth();
    await revokeAllSessions(actor.realUserId, auth?.session.id);
    await audit(actor, 'auth.signed_out_other_devices', { entityType: 'user', entityId: actor.realUserId });
    revalidatePath('/account');
  }, 'Other devices have been signed out.');
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const mine = await listActiveSessions(actor.realUserId);
    if (!mine.some((s) => s.id === sessionId)) throw notFound();
    await revokeSession(sessionId);
    await audit(actor, 'auth.session_revoked', { entityType: 'user', entityId: actor.realUserId });
    revalidatePath('/account');
  }, 'Device signed out.');
}
