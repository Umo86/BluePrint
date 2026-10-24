'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { closeTicketAsExhibitor, openTicket, replyAsExhibitor, type openTicketSchema, type replySchema } from '@/server/services/helpdesk';
import { applyFormProposal, askAssistant, assistantView, recordNudges, sendTicketProposal, startNewConversation, type AssistantMeta } from '@/server/assistant';

const id = (v: unknown) => String(v ?? '');
const slugOf = (v: unknown) => {
  const s = String(v ?? '');
  return /^[a-z0-9-]{1,80}$/.test(s) ? s : '';
};
const refresh = (slug: string) => revalidatePath(`/portal/${slugOf(slug)}`, 'layout');

// Help desk -------------------------------------------------------------------

export async function openTicketAction(slug: string, standId: string, input: z.input<typeof openTicketSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const t = await openTicket(await requireActor(), id(standId), input);
    refresh(slug);
    return { id: t.id };
  }, 'Sent to the show team. You will get an email when they reply.');
}

export async function replyTicketAction(slug: string, standId: string, ticketId: string, input: z.input<typeof replySchema>): Promise<ActionResult> {
  return runAction(async () => {
    await replyAsExhibitor(await requireActor(), id(standId), id(ticketId), input);
    refresh(slug);
  }, 'Sent.');
}

export async function closeTicketAction(slug: string, standId: string, ticketId: string): Promise<ActionResult> {
  return runAction(async () => {
    await closeTicketAsExhibitor(await requireActor(), id(standId), id(ticketId));
    refresh(slug);
  }, 'Marked as solved.');
}

// Assistant -------------------------------------------------------------------

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; meta: AssistantMeta; createdAt: string };
export type ChatView =
  | { available: false; reason: string | null }
  | { available: true; offline: boolean; readOnly: boolean; greeting: { text: string; suggestions: string[] }; conversationId: string | null; messages: ChatMessage[] };

export async function assistantViewAction(standId: string): Promise<ActionResult<ChatView>> {
  return runAction(async () => {
    const v = await assistantView(await requireActor(), id(standId));
    if (!v.available) return { available: false as const, reason: v.reason };
    return { ...v, messages: v.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) };
  });
}

export async function askAssistantAction(standId: string, text: string): Promise<ActionResult<{ messages: ChatMessage[] }>> {
  return runAction(async () => {
    const r = await askAssistant(await requireActor(), id(standId), { text: String(text ?? '') });
    return { messages: r.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) };
  });
}

export async function applyProposalAction(slug: string, standId: string, messageId: string, index: number): Promise<ActionResult<{ taskId: string }>> {
  return runAction(async () => {
    const r = await applyFormProposal(await requireActor(), id(standId), id(messageId), Number(index));
    refresh(slug);
    return r;
  }, 'The answers are in the form. Check them, then send the form.');
}

export async function sendTicketProposalAction(slug: string, standId: string, messageId: string): Promise<ActionResult<{ ticketId: string; number: string | null }>> {
  return runAction(async () => {
    const r = await sendTicketProposal(await requireActor(), id(standId), id(messageId));
    refresh(slug);
    return r;
  }, 'Sent to the show team. You will get an email when they reply.');
}

export async function newConversationAction(standId: string): Promise<ActionResult> {
  return runAction(async () => {
    await startNewConversation(await requireActor(), id(standId));
  });
}

export async function nudgesSeenAction(standId: string, items: { taskId: string; step: string }[]): Promise<ActionResult> {
  return runAction(async () => {
    await recordNudges(await requireActor(), id(standId), items);
  });
}
