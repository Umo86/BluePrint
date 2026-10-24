'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { resolvePortal } from '@/server/services/portal';
import { markTask, saveAnswers } from '@/server/services/submissions';
import { updateCompany, type companySchema } from '@/server/services/companies';
import { createInvitation } from '@/server/auth/invitations';
import { requireStandAccess } from '@/server/authz';
import { env } from '@/server/env';
import { invalid } from '@/server/errors';
import type { z } from 'zod';
import { standCookie } from './[slug]/load';

const id = (v: unknown) => String(v ?? '');

export async function chooseStandAction(slug: string, standId: string): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const ctx = await resolvePortal(actor, String(slug), id(standId));
    if (ctx.stand.id !== standId) throw invalid('Choose one of your stands.');
    const store = await cookies();
    store.set(standCookie(ctx.edition.id), ctx.stand.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    });
    revalidatePath(`/portal/${ctx.edition.slug}`, 'layout');
  });
}

export async function saveAnswersAction(
  slug: string,
  standId: string,
  taskId: string,
  data: Record<string, unknown>,
  submit: boolean,
): Promise<ActionResult> {
  return runAction(
    async () => {
      await saveAnswers(await requireActor(), id(standId), id(taskId), data ?? {}, { submit: submit === true });
      revalidatePath(`/portal/${String(slug)}`, 'layout');
    },
    submit ? 'Sent. Thank you.' : 'Saved. You can come back and finish it later.',
  );
}

export async function markTaskAction(slug: string, standId: string, taskId: string, mark: 'not_needed' | 'read' | 'undo'): Promise<ActionResult> {
  return runAction(async () => {
    await markTask(await requireActor(), id(standId), id(taskId), mark === 'not_needed' || mark === 'read' ? mark : 'undo');
    revalidatePath(`/portal/${String(slug)}`, 'layout');
  }, mark === 'read' ? 'Marked as read.' : mark === 'not_needed' ? 'Marked as not needed.' : 'Done.');
}

export async function updateMyCompanyAction(slug: string, companyId: string, input: z.input<typeof companySchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateCompany(await requireActor(), id(companyId), input);
    revalidatePath(`/portal/${String(slug)}`, 'layout');
  }, 'Company details saved.');
}

export async function inviteColleagueAction(slug: string, standId: string, email: string, canPay: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const { stand } = await requireStandAccess(actor, id(standId), { write: true });
    await createInvitation(actor, { kind: 'colleague', email: String(email ?? ''), standId: stand.id, editionId: stand.editionId, companyId: stand.companyId, permissions: canPay ? ['pay'] : [] });
    revalidatePath(`/portal/${String(slug)}`, 'layout');
  }, 'Invitation sent.');
}
