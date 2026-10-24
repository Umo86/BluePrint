'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { nominateContractor, removeContractor, reviewPack, savePackDraft, submitPack, type nominationSchema, type packDraftSchema, type REVIEW_DECISIONS } from '@/server/services/space-only';

const id = (v: unknown) => String(v ?? '');
const refreshAll = () => {
  revalidatePath('/portal', 'layout');
  revalidatePath('/contractor', 'layout');
  revalidatePath('/manage', 'layout');
};

export async function nominateContractorAction(standId: string, input: z.input<typeof nominationSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await nominateContractor(await requireActor(), id(standId), input);
    refreshAll();
  }, input.selfBuild ? 'Saved: you are building the stand yourselves.' : 'Contractor saved and invited to BluePrint.');
}

export async function removeContractorAction(standId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeContractor(await requireActor(), id(standId));
    refreshAll();
  }, 'Contractor removed.');
}

export async function savePackDraftAction(standId: string, input: z.input<typeof packDraftSchema>): Promise<ActionResult<{ complete: boolean; missing: string[] }>> {
  return runAction(async () => {
    const check = await savePackDraft(await requireActor(), id(standId), input);
    refreshAll();
    return { complete: check.complete, missing: check.missing };
  }, 'Saved.');
}

export async function submitPackAction(standId: string): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    const r = await submitPack(await requireActor(), id(standId));
    refreshAll();
    return r;
  }, 'Sent for review. The show team will let you know.');
}

export async function reviewPackAction(
  standId: string,
  input: { decision: (typeof REVIEW_DECISIONS)[number]; comment?: string | null; docType?: string | null; conditions?: string | null },
): Promise<ActionResult> {
  return runAction(async () => {
    await reviewPack(await requireActor(), id(standId), input);
    refreshAll();
  }, input.decision === 'comment' ? 'Comment added.' : input.decision === 'under_review' ? 'Marked as being reviewed.' : 'Decision saved.');
}
