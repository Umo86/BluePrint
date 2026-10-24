'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { previewContent, previewTemplate, resetTemplate, saveTemplate, sendTemplateTest } from '@/server/services/email-admin';
import {
  audienceSize,
  cancelScheduledCampaign,
  createCampaign,
  deleteCampaign,
  sendCampaign,
  sendCampaignTest,
  updateCampaign,
  type CampaignAudience,
  type campaignSchema,
} from '@/server/services/campaigns';
import { parseLocalDateTime } from '@/lib/dates';
import { invalid } from '@/server/errors';
import type { z } from 'zod';

const id = (v: unknown) => String(v ?? '');
const refresh = () => revalidatePath('/manage', 'layout');

export async function saveTemplateAction(editionId: string, key: string, content: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await saveTemplate(await requireActor(), id(editionId), id(key), content);
    refresh();
  }, 'Email saved. It is used from now on.');
}

export async function resetTemplateAction(editionId: string, key: string): Promise<ActionResult> {
  return runAction(async () => {
    await resetTemplate(await requireActor(), id(editionId), id(key));
    refresh();
  }, 'Back to the standard wording.');
}

export async function previewTemplateAction(editionId: string, key: string, content: unknown): Promise<ActionResult<{ subject: string; html: string; text: string }>> {
  return runAction(async () => previewTemplate(await requireActor(), id(editionId), id(key), content));
}

export async function sendTemplateTestAction(editionId: string, key: string, content: unknown): Promise<ActionResult> {
  return runAction(async () => {
    await sendTemplateTest(await requireActor(), id(editionId), id(key), content);
  }, 'Test sent to your inbox.');
}

export async function previewCampaignAction(editionId: string, content: { subject: string; blocks: unknown[] }): Promise<ActionResult<{ subject: string; html: string; text: string }>> {
  return runAction(async () => previewContent(await requireActor(), id(editionId), content as never));
}

export async function audienceSizeAction(editionId: string, filter: CampaignAudience): Promise<ActionResult<{ recipients: number; unsubscribed: number; stands: number }>> {
  return runAction(async () => audienceSize(await requireActor(), id(editionId), filter));
}

export async function createCampaignAction(editionId: string, input: z.input<typeof campaignSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const c = await createCampaign(await requireActor(), id(editionId), input);
    refresh();
    return { id: c.id };
  }, 'Saved as a draft.');
}

export async function updateCampaignAction(campaignId: string, input: z.input<typeof campaignSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateCampaign(await requireActor(), id(campaignId), input);
    refresh();
  }, 'Saved.');
}

export async function deleteCampaignAction(campaignId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteCampaign(await requireActor(), id(campaignId));
    refresh();
  }, 'Deleted.');
}

export async function sendCampaignTestAction(campaignId: string): Promise<ActionResult> {
  return runAction(async () => {
    await sendCampaignTest(await requireActor(), id(campaignId));
  }, 'Test sent to your inbox.');
}

export async function sendCampaignAction(campaignId: string, at: string | null): Promise<ActionResult<{ scheduled: boolean; recipients: number }>> {
  return runAction(async () => {
    let when: Date | null = null;
    if (at) {
      when = parseLocalDateTime(at);
      if (!when) throw invalid('Enter a valid date and time.');
    }
    const r = await sendCampaign(await requireActor(), id(campaignId), { at: when });
    refresh();
    return r;
  });
}

export async function cancelCampaignAction(campaignId: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelScheduledCampaign(await requireActor(), id(campaignId));
    refresh();
  }, 'Not sending. It is back in your drafts.');
}
