import { notFound } from 'next/navigation';
import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { getAnnouncement } from '@/server/services/announcements';
import { listExhibitorTypes } from '@/server/services/show-setup';
import { AppError } from '@/server/errors';
import { toLocalDateTimeString } from '@/lib/dates';
import { dateTime } from '@/lib/format';
import { loadEdition } from '../../load';
import { AnnouncementEditor } from './announcement-editor';

export default async function EditAnnouncement({ params }: PageProps<'/manage/[editionId]/announcements/[announcementId]'>) {
  const { editionId, announcementId } = await params;
  const { actor, edition, access } = await loadEdition(editionId, 'edit_content');
  const isNew = announcementId === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(announcementId)) notFound();
  let a: Awaited<ReturnType<typeof getAnnouncement>> | null = null;
  if (!isNew) {
    try {
      a = await getAnnouncement(actor, announcementId);
    } catch (err) {
      if (err instanceof AppError) notFound();
      throw err;
    }
    if (a.editionId !== edition.id) notFound();
  }
  const types = await listExhibitorTypes(actor, edition.id);
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/announcements`} fz="sm">
        ← Announcements
      </TextLink>
      <PageHeader eyebrow="Announcement" title={a ? a.title : 'New announcement'} />
      <AnnouncementEditor
        editionId={edition.id}
        announcementId={a?.id ?? null}
        initial={{
          title: a?.title ?? '',
          bodyHtml: a?.bodyHtml ?? '',
          visibleToTypes: a?.visibleToTypes ?? [],
          pinned: a?.pinned ?? false,
          when: !a || a.state === 'draft' ? 'draft' : a.state === 'scheduled' ? 'scheduled' : 'now',
          publishAt: a?.state === 'scheduled' ? toLocalDateTimeString(a.publishedAt) : null,
        }}
        liveSince={a?.state === 'published' && a.publishedAt ? dateTime(a.publishedAt) : null}
        types={types.map((t) => ({ value: t.id, label: t.name }))}
        canEmail={access.permissions.has('send_emails') && !actor.readOnly}
      />
    </Stack>
  );
}
