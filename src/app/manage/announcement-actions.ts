'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import {
  createAnnouncement,
  deleteAnnouncement,
  emailDraftFromAnnouncement,
  setAnnouncementPublished,
  updateAnnouncement,
  type ANNOUNCEMENT_WHEN,
} from '@/server/services/announcements';
import { parseLocalDateTime } from '@/lib/dates';
import { invalid } from '@/server/errors';

const id = (v: unknown) => String(v ?? '');
const refresh = (editionId: string) => {
  revalidatePath(`/manage/${editionId}`, 'layout');
  revalidatePath('/portal', 'layout');
};

export type AnnouncementForm = {
  title: string;
  bodyHtml: string;
  visibleToTypes: string[];
  pinned: boolean;
  when: (typeof ANNOUNCEMENT_WHEN)[number];
  /** UK wall-clock time from the date picker, for scheduled announcements. */
  publishAt: string | null;
};

export async function saveAnnouncementAction(editionId: string, announcementId: string | null, form: AnnouncementForm): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requireActor();
    let publishAt: Date | null = null;
    if (form?.when === 'scheduled') {
      publishAt = parseLocalDateTime(typeof form.publishAt === 'string' ? form.publishAt : null);
      if (!publishAt) throw invalid('Choose when it should appear.', { publishAt: 'Choose a date and time.' });
    }
    const input = {
      title: String(form?.title ?? ''),
      bodyHtml: String(form?.bodyHtml ?? ''),
      visibleToTypes: Array.isArray(form?.visibleToTypes) ? form.visibleToTypes.map(String) : [],
      pinned: Boolean(form?.pinned),
      when: form?.when,
      publishAt,
    };
    let out: string;
    if (announcementId) {
      await updateAnnouncement(actor, id(announcementId), input);
      out = id(announcementId);
    } else {
      out = (await createAnnouncement(actor, id(editionId), input)).id;
    }
    refresh(editionId);
    return { id: out };
  }, 'Announcement saved.');
}

export async function setAnnouncementPublishedAction(editionId: string, announcementId: string, published: boolean): Promise<ActionResult> {
  return runAction(
    async () => {
      await setAnnouncementPublished(await requireActor(), id(announcementId), published === true);
      refresh(editionId);
    },
    published ? 'Published. Exhibitors can see it now.' : 'Taken off the portal. It is kept as a draft.',
  );
}

export async function deleteAnnouncementAction(editionId: string, announcementId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteAnnouncement(await requireActor(), id(announcementId));
    refresh(editionId);
  }, 'Announcement deleted.');
}

export async function emailAnnouncementAction(editionId: string, announcementId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const c = await emailDraftFromAnnouncement(await requireActor(), id(announcementId));
    refresh(editionId);
    return { id: c.id };
  }, 'Email draft created. Check it, then send it.');
}
