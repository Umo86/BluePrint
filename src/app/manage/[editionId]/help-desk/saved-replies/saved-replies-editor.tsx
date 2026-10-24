'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, Paper, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useAction } from '@/lib/use-action';
import { deleteSavedReplyAction, saveSavedReplyAction } from '../../../helpdesk-actions';

type Reply = { id: string; title: string; body: string };

function ReplyCard({ editionId, reply, canEdit }: { editionId: string; reply: Reply | null; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ title: reply?.title ?? '', body: reply?.body ?? '' });
  const save = useAction(saveSavedReplyAction, {
    onSuccess: () => {
      if (!reply) setV({ title: '', body: '' });
      router.refresh();
    },
  });
  const del = useAction(deleteSavedReplyAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        {!reply ? (
          <Text fz="sm" fw={600}>
            New saved reply
          </Text>
        ) : null}
        <TextInput label="Name" value={v.title} onChange={(e) => setV({ ...v, title: e.currentTarget.value })} maxLength={100} disabled={!canEdit} error={save.fieldErrors.title} />
        <Textarea label="Reply" autosize minRows={3} maxRows={12} value={v.body} onChange={(e) => setV({ ...v, body: e.currentTarget.value })} maxLength={5000} disabled={!canEdit} error={save.fieldErrors.body} />
        {canEdit ? (
          <Group>
            <Button size="xs" loading={save.pending} onClick={() => save.run(editionId, reply?.id ?? null, v)}>
              {reply ? 'Save' : 'Add saved reply'}
            </Button>
            {reply ? (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={del.pending}
                onClick={() =>
                  modals.openConfirmModal({
                    title: `Delete “${reply.title}”?`,
                    labels: { confirm: 'Delete', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => del.run(editionId, reply.id),
                  })
                }
              >
                Delete
              </Button>
            ) : null}
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}

export function SavedRepliesEditor({ editionId, replies, canEdit }: { editionId: string; replies: Reply[]; canEdit: boolean }) {
  return (
    <Stack maw={820}>
      {canEdit ? <ReplyCard editionId={editionId} reply={null} canEdit /> : null}
      {replies.map((r) => (
        <ReplyCard key={`${r.id}:${r.title}:${r.body.length}`} editionId={editionId} reply={r} canEdit={canEdit} />
      ))}
      {replies.length === 0 ? (
        <Text fz="sm" c="dimmed">
          No saved replies yet.
        </Text>
      ) : null}
    </Stack>
  );
}
