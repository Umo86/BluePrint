'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, Paper, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useAction } from '@/lib/use-action';
import { deleteFaqAction, resolveUnansweredAction, saveFaqAction } from '../../helpdesk-actions';

function Unanswered({ editionId, item, canWrite }: { editionId: string; item: { id: string; question: string; at: string }; canWrite: boolean }) {
  const router = useRouter();
  const [answer, setAnswer] = useState('');
  const [open, setOpen] = useState(false);
  const resolve = useAction(resolveUnansweredAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text fz="sm" fw={600}>
            {item.question}
          </Text>
          <Text fz="xs" c="dimmed">
            Asked {item.at}
          </Text>
        </div>
        {canWrite && !open ? (
          <Group gap={6} wrap="nowrap">
            <Button size="compact-xs" onClick={() => setOpen(true)}>
              Add an answer
            </Button>
            <Button size="compact-xs" variant="default" loading={resolve.pending} onClick={() => resolve.run(editionId, item.id, null)}>
              Dealt with
            </Button>
          </Group>
        ) : null}
      </Group>
      {open ? (
        <Stack gap="xs" mt="xs">
          <Textarea aria-label={`Answer to: ${item.question}`} autosize minRows={2} maxRows={8} value={answer} onChange={(e) => setAnswer(e.currentTarget.value)} maxLength={4000} />
          <Group gap="xs">
            <Button size="xs" loading={resolve.pending} disabled={!answer.trim()} onClick={() => resolve.run(editionId, item.id, answer)}>
              Save answer
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Paper>
  );
}

export function UnansweredList({ editionId, items, canWrite }: { editionId: string; items: { id: string; question: string; at: string }[]; canWrite: boolean }) {
  if (!items.length) return <Text fz="sm" c="dimmed">Nothing waiting. Well done.</Text>;
  return (
    <Stack gap="xs">
      {items.map((i) => (
        <Unanswered key={i.id} editionId={editionId} item={i} canWrite={canWrite} />
      ))}
    </Stack>
  );
}

type Faq = { id: string; question: string; answer: string };

function FaqCard({ editionId, faq, canWrite }: { editionId: string; faq: Faq | null; canWrite: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ question: faq?.question ?? '', answer: faq?.answer ?? '' });
  const save = useAction(saveFaqAction, {
    onSuccess: () => {
      if (!faq) setV({ question: '', answer: '' });
      router.refresh();
    },
  });
  const del = useAction(deleteFaqAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <TextInput label={faq ? 'Question' : 'New question'} value={v.question} onChange={(e) => setV({ ...v, question: e.currentTarget.value })} maxLength={500} disabled={!canWrite} error={save.fieldErrors.question} />
        <Textarea label="Answer" autosize minRows={2} maxRows={8} value={v.answer} onChange={(e) => setV({ ...v, answer: e.currentTarget.value })} maxLength={4000} disabled={!canWrite} error={save.fieldErrors.answer} />
        {canWrite ? (
          <Group gap="xs">
            <Button size="xs" loading={save.pending} onClick={() => save.run(editionId, faq?.id ?? null, v)}>
              {faq ? 'Save' : 'Add answer'}
            </Button>
            {faq ? (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={del.pending}
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Delete this answer?',
                    labels: { confirm: 'Delete', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => del.run(editionId, faq.id),
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

export function FaqEditor({ editionId, faqs, canWrite }: { editionId: string; faqs: Faq[]; canWrite: boolean }) {
  return (
    <Stack gap="xs">
      {canWrite ? <FaqCard editionId={editionId} faq={null} canWrite /> : null}
      {faqs.map((f) => (
        <FaqCard key={`${f.id}:${f.question}:${f.answer.length}`} editionId={editionId} faq={f} canWrite={canWrite} />
      ))}
    </Stack>
  );
}
