'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Grid, GridCol, Group, Paper, Stack, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useAction } from '@/lib/use-action';
import { EmailBlockEditor, type Block } from '@/components/email-block-editor';
import { EmailPreview } from '@/components/email-preview';
import { previewTemplateAction, resetTemplateAction, saveTemplateAction, sendTemplateTestAction } from '../../../../email-actions';

type Content = { subject: string; preheader: string; blocks: Block[] };

export function TemplateEditor({
  editionId,
  templateKey,
  initial,
  custom,
  variables,
  allowTasksDue,
}: {
  editionId: string;
  templateKey: string;
  initial: Content;
  custom: boolean;
  variables: { key: string; label: string }[];
  allowTasksDue: boolean;
}) {
  const router = useRouter();
  const [c, setC] = useState<Content>(initial);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const save = useAction(saveTemplateAction, { onSuccess: () => router.refresh() });
  const reset = useAction(resetTemplateAction, { onSuccess: () => window.location.reload() });
  const test = useAction(sendTemplateTestAction);
  const prev = useAction(previewTemplateAction, { onSuccess: (d) => d && setPreview(d), notifyErrors: true });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    prev.run(editionId, templateKey, initial);
  }, [prev, editionId, templateKey, initial]);
  const errors = { ...save.fieldErrors, ...test.fieldErrors };
  return (
    <Grid>
      <GridCol span={{ base: 12, lg: 6 }}>
        <Stack>
          <Paper withBorder p="md">
            <Stack>
              <TextInput label="Subject" value={c.subject} onChange={(e) => setC({ ...c, subject: e.currentTarget.value })} maxLength={250} error={errors.subject} />
              <TextInput label="Preview line" description="The grey text email apps show after the subject." value={c.preheader} onChange={(e) => setC({ ...c, preheader: e.currentTarget.value })} maxLength={200} />
            </Stack>
          </Paper>
          <EmailBlockEditor blocks={c.blocks} onChange={(blocks) => setC({ ...c, blocks })} variables={variables} editionId={editionId} allowTasksDue={allowTasksDue} errors={errors} />
          <Group>
            <Button loading={save.pending} onClick={() => save.run(editionId, templateKey, c)}>
              Save
            </Button>
            <Button variant="default" loading={test.pending} onClick={() => test.run(editionId, templateKey, c)}>
              Send me a test
            </Button>
            {custom ? (
              <Button
                variant="subtle"
                color="red"
                loading={reset.pending}
                onClick={() =>
                  modals.openConfirmModal({
                    title: 'Go back to the standard wording?',
                    children: 'Your changes to this email are removed.',
                    labels: { confirm: 'Use the standard wording', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => reset.run(editionId, templateKey),
                  })
                }
              >
                Use the standard wording
              </Button>
            ) : null}
          </Group>
        </Stack>
      </GridCol>
      <GridCol span={{ base: 12, lg: 6 }}>
        <EmailPreview preview={preview} loading={prev.pending} onRefresh={() => prev.run(editionId, templateKey, c)} />
      </GridCol>
    </Grid>
  );
}
