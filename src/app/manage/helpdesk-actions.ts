'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { assignTicket, deleteSavedReply, replyAsStaff, saveSavedReply, setTicketStatus, type savedReplySchema, type staffReplySchema, type TicketStatus } from '@/server/services/helpdesk';
import { deleteFaq, resolveUnanswered, saveFaq, type faqSchema } from '@/server/assistant';

const id = (v: unknown) => String(v ?? '');
const refresh = (editionId: string) => revalidatePath(`/manage/${id(editionId)}`, 'layout');

export async function staffReplyAction(editionId: string, ticketId: string, input: z.input<typeof staffReplySchema>): Promise<ActionResult> {
  return runAction(
    async () => {
      await replyAsStaff(await requireActor(), id(ticketId), input);
      refresh(editionId);
    },
    input?.internal ? 'Note added.' : 'Reply sent.',
  );
}

export async function assignTicketAction(editionId: string, ticketId: string, userId: string | null): Promise<ActionResult> {
  return runAction(async () => {
    await assignTicket(await requireActor(), id(ticketId), userId ? id(userId) : null);
    refresh(editionId);
  }, 'Assigned.');
}

export async function setTicketStatusAction(editionId: string, ticketId: string, status: TicketStatus): Promise<ActionResult> {
  return runAction(async () => {
    await setTicketStatus(await requireActor(), id(ticketId), status);
    refresh(editionId);
  }, 'Status changed.');
}

export async function saveSavedReplyAction(editionId: string, replyId: string | null, input: z.input<typeof savedReplySchema>): Promise<ActionResult> {
  return runAction(async () => {
    await saveSavedReply(await requireActor(), id(editionId), replyId ? id(replyId) : null, input);
    refresh(editionId);
  }, 'Saved reply saved.');
}

export async function deleteSavedReplyAction(editionId: string, replyId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteSavedReply(await requireActor(), id(editionId), id(replyId));
    refresh(editionId);
  }, 'Deleted.');
}

export async function saveFaqAction(editionId: string, faqId: string | null, input: z.input<typeof faqSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await saveFaq(await requireActor(), id(editionId), faqId ? id(faqId) : null, input);
    refresh(editionId);
  }, 'Answer saved. The assistant uses it from now on.');
}

export async function deleteFaqAction(editionId: string, faqId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteFaq(await requireActor(), id(editionId), id(faqId));
    refresh(editionId);
  }, 'Deleted.');
}

export async function resolveUnansweredAction(editionId: string, questionId: string, answer: string | null): Promise<ActionResult> {
  return runAction(
    async () => {
      await resolveUnanswered(await requireActor(), id(editionId), id(questionId), typeof answer === 'string' ? answer : null);
      refresh(editionId);
    },
    answer ? 'Answer saved. The assistant uses it from now on.' : 'Marked as dealt with.',
  );
}
