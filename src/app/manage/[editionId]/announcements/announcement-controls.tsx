'use client';

import { useRouter } from 'next/navigation';
import { ActionIcon, Group, Menu, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { deleteAnnouncementAction, emailAnnouncementAction, setAnnouncementPublishedAction } from '../../announcement-actions';

export function AnnouncementRowActions({
  editionId,
  announcementId,
  title,
  state,
  canEdit,
  canEmail,
}: {
  editionId: string;
  announcementId: string;
  title: string;
  state: 'draft' | 'scheduled' | 'published';
  canEdit: boolean;
  canEmail: boolean;
}) {
  const router = useRouter();
  const publish = useAction(setAnnouncementPublishedAction);
  const del = useAction(deleteAnnouncementAction);
  const email = useAction(emailAnnouncementAction, {
    onSuccess: (data) => {
      if (data?.id) router.push(`/manage/${editionId}/emails/campaigns/${data.id}`);
    },
  });
  return (
    <Group justify="flex-end">
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={`Actions for ${title}`} loading={publish.pending || del.pending || email.pending}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {canEdit ? (
            state === 'draft' ? (
              <Menu.Item onClick={() => publish.run(editionId, announcementId, true)}>Publish now</Menu.Item>
            ) : (
              <Menu.Item onClick={() => publish.run(editionId, announcementId, false)}>Take off the portal</Menu.Item>
            )
          ) : null}
          {canEmail ? <Menu.Item onClick={() => email.run(editionId, announcementId)}>Email it to exhibitors…</Menu.Item> : null}
          {canEdit ? (
            <Menu.Item
              color="red"
              onClick={() =>
                modals.openConfirmModal({
                  title: `Delete “${title}”?`,
                  children: <Text fz="sm">It disappears from the exhibitor portal. Emails already sent are not affected.</Text>,
                  labels: { confirm: 'Delete', cancel: 'Cancel' },
                  confirmProps: { color: 'red' },
                  onConfirm: () => del.run(editionId, announcementId),
                })
              }
            >
              Delete
            </Menu.Item>
          ) : null}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
