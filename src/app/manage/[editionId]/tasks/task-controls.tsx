'use client';

import { ActionIcon, Group, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { deleteTaskAction, moveTaskAction } from '../../actions';

export function TaskRowActions({ editionId, taskId, title }: { editionId: string; taskId: string; title: string }) {
  const move = useAction(moveTaskAction);
  const del = useAction(deleteTaskAction);
  return (
    <Group gap={4} justify="flex-end" wrap="nowrap">
      <ActionIcon variant="subtle" aria-label={`Move ${title} up`} onClick={() => move.run(editionId, taskId, 'up')}>
        <IconArrowUp size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" aria-label={`Move ${title} down`} onClick={() => move.run(editionId, taskId, 'down')}>
        <IconArrowDown size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Delete ${title}`}
        onClick={() =>
          modals.openConfirmModal({
            title: `Delete “${title}”?`,
            children: <Text fz="sm">Tasks exhibitors have already answered cannot be deleted; unpublish them instead.</Text>,
            labels: { confirm: 'Delete', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: () => del.run(editionId, taskId),
          })
        }
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );
}
