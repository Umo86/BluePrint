'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconBooks, IconTrash } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { copyPageFromLibraryAction, copyTaskFromLibraryAction, deletePageAction, movePageAction } from '../../actions';

export function PageRowActions({ editionId, pageId, title }: { editionId: string; pageId: string; title: string }) {
  const move = useAction(movePageAction);
  const del = useAction(deletePageAction);
  return (
    <Group gap={4} justify="flex-end" wrap="nowrap">
      <ActionIcon variant="subtle" aria-label={`Move ${title} up`} onClick={() => move.run(editionId, pageId, 'up')}>
        <IconArrowUp size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" aria-label={`Move ${title} down`} onClick={() => move.run(editionId, pageId, 'down')}>
        <IconArrowDown size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Delete ${title}`}
        onClick={() =>
          modals.openConfirmModal({
            title: `Delete “${title}”?`,
            children: <Text fz="sm">Exhibitors will no longer see it. Tasks that linked to it keep working without the link.</Text>,
            labels: { confirm: 'Delete', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: () => del.run(editionId, pageId),
          })
        }
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );
}

export function FromLibraryButton({ editionId, kind, items }: { editionId: string; kind: 'page' | 'task'; items: { value: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const onDone = (data: { id: string } | undefined) => {
    setOpen(false);
    if (data?.id) router.push(`/manage/${editionId}/${kind === 'page' ? 'manual' : 'tasks'}/${data.id}`);
  };
  const copyPage = useAction(copyPageFromLibraryAction, { onSuccess: onDone });
  const copyTask = useAction(copyTaskFromLibraryAction, { onSuccess: onDone });
  return (
    <>
      <Button variant="default" leftSection={<IconBooks size={16} />} onClick={() => setOpen(true)}>
        From the library
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={kind === 'page' ? 'Copy a page from the library' : 'Copy a task from the library'}>
        <Stack>
          <Select label="Template" data={items} value={itemId} onChange={setItemId} searchable />
          <Text fz="xs" c="dimmed">
            A copy is added as a draft, so you can adjust it for this show before exhibitors see it.
          </Text>
          <Group justify="flex-end">
            <Button
              disabled={!itemId}
              loading={copyPage.pending || copyTask.pending}
              onClick={() => itemId && (kind === 'page' ? copyPage.run(editionId, itemId) : copyTask.run(editionId, itemId))}
            >
              Copy into this show
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
