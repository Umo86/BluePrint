'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { askAssistantAsTest, resetTestConversation, saveAssistantSettings, testAssistantView } from '@/server/assistant';
import type { AssistantSettingsInput } from '@/lib/assistant-config';
import type { ChatMessage, ChatView } from '@/app/portal/help-actions';

const id = (v: unknown) => String(v ?? '');
const refresh = (editionId: string) => revalidatePath(`/manage/${id(editionId)}`, 'layout');

export async function saveAssistantSettingsAction(editionId: string, input: AssistantSettingsInput): Promise<ActionResult> {
  return runAction(async () => {
    await saveAssistantSettings(await requireActor(), id(editionId), input);
    refresh(editionId);
  }, 'Assistant settings saved.');
}

/** The test chat as the chosen exhibitor would see it. */
export async function testChatViewAction(editionId: string, standId: string, userId: string): Promise<ActionResult<ChatView>> {
  return runAction(async () => {
    const v = await testAssistantView(await requireActor(), id(editionId), id(standId), id(userId));
    if (!v.available) return { available: false as const, reason: v.reason };
    return { ...v, messages: v.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) };
  });
}

export async function testChatAskAction(editionId: string, standId: string, userId: string, text: string): Promise<ActionResult<{ messages: ChatMessage[] }>> {
  return runAction(async () => {
    const r = await askAssistantAsTest(await requireActor(), id(editionId), { standId: id(standId), userId: id(userId), text: String(text ?? '') });
    refresh(editionId);
    return { messages: r.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) };
  });
}

export async function testChatResetAction(editionId: string, standId: string): Promise<ActionResult> {
  return runAction(async () => {
    await resetTestConversation(await requireActor(), id(editionId), id(standId));
  });
}
