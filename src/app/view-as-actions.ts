'use server';

import { redirect } from 'next/navigation';
import { runAction, type ActionResult } from '@/server/actions';
import { getCurrentAuth, requireActor, setViewAs } from '@/server/auth/current';
import { authorizeViewAs } from '@/server/services/view-as';
import { audit } from '@/server/audit';

export async function startViewAsAction(targetUserId: string, editionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const auth = await getCurrentAuth();
    const { slug } = await authorizeViewAs(actor, String(targetUserId), String(editionId));
    await setViewAs(auth!.session.id, String(targetUserId), String(editionId));
    redirect(`/portal/${slug}`);
  });
}

export async function stopViewAsAction() {
  const auth = await getCurrentAuth();
  if (auth?.viewAsUser) {
    await setViewAs(auth.session.id, null, null);
    await audit({ ...auth.actor, readOnly: false, userId: auth.user.id }, 'view_as.stop', {
      entityType: 'user',
      entityId: auth.viewAsUser.id,
      editionId: auth.session.viewAsEditionId,
    });
    if (auth.session.viewAsEditionId) redirect(`/manage/${auth.session.viewAsEditionId}/exhibitors`);
  }
  redirect('/start');
}
