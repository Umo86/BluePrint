'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Checkbox, Grid, GridCol, Group, Modal, MultiSelect, Paper, SegmentedControl, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { useAction } from '@/lib/use-action';
import { EmailBlockEditor, type Block } from '@/components/email-block-editor';
import { EmailPreview } from '@/components/email-preview';
import {
  audienceSizeAction,
  createCampaignAction,
  deleteCampaignAction,
  previewCampaignAction,
  sendCampaignAction,
  sendCampaignTestAction,
  updateCampaignAction,
} from '../../../email-actions';

export type Filter = {
  exhibitorTypeIds: string[];
  hallIds: string[];
  taskNotDoneId: string | null;
  categoryNotOrderedId: string | null;
  neverSignedIn: boolean;
  standIds: string[];
  audience: 'main_contacts' | 'everyone';
};

type Options = { types: { id: string; name: string }[]; halls: { id: string; name: string }[]; tasks: { id: string; title: string }[]; categories: { id: string; name: string }[] };

const VARIABLES = [
  { key: 'first_name', label: 'First name' },
  { key: 'company', label: 'Company name' },
  { key: 'stand', label: 'Stand number' },
  { key: 'hall', label: 'Hall' },
  { key: 'show', label: 'Show name' },
  { key: 'portal_link', label: 'Link to the exhibitor portal' },
];

export function CampaignEditor({
  editionId,
  campaignId,
  initial,
  options,
  editable,
}: {
  editionId: string;
  campaignId: string | null;
  initial: { name: string; subject: string; blocks: Block[]; filter: Filter };
  options: Options;
  editable: boolean;
}) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  const [size, setSize] = useState<{ recipients: number; unsubscribed: number; stands: number } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState<string | null>(null);
  const create = useAction(createCampaignAction, { onSuccess: (d) => d && router.push(`/manage/${editionId}/emails/campaigns/${d.id}`) });
  const update = useAction(updateCampaignAction);
  const del = useAction(deleteCampaignAction, { onSuccess: () => router.push(`/manage/${editionId}/emails?tab=campaigns`) });
  const test = useAction(sendCampaignTestAction);
  const prev = useAction(previewCampaignAction, { onSuccess: (d) => d && setPreview(d) });
  const count = useAction(audienceSizeAction, { onSuccess: (d) => d && setSize(d), notifyErrors: false });
  const send = useAction(sendCampaignAction, {
    onSuccess: (d) => {
      setSendOpen(false);
      router.push(`/manage/${editionId}/emails?tab=campaigns&${d?.scheduled ? 'scheduled' : 'sent'}=1`);
    },
  });
  const filterKey = JSON.stringify(c.filter);
  const { run: runCount } = count;
  useEffect(() => {
    const t = setTimeout(() => runCount(editionId, JSON.parse(filterKey)), 300);
    return () => clearTimeout(t);
  }, [filterKey, editionId, runCount]);
  const setF = (patch: Partial<Filter>) => setC((cur) => ({ ...cur, filter: { ...cur.filter, ...patch } }));
  const errors = { ...create.fieldErrors, ...update.fieldErrors };
  const saveDraft = () => (campaignId ? update.run(campaignId, c) : create.run(editionId, c));

  return (
    <Grid>
      <GridCol span={{ base: 12, lg: 6 }}>
        <Stack>
          <Paper withBorder p="md">
            <Stack>
              <TextInput label="Name" description="For your team only, for example “Build-up times changed”." value={c.name} onChange={(e) => setC({ ...c, name: e.currentTarget.value })} maxLength={150} error={errors.name} disabled={!editable} />
              <TextInput label="Subject" value={c.subject} onChange={(e) => setC({ ...c, subject: e.currentTarget.value })} maxLength={250} error={errors.subject} disabled={!editable} />
            </Stack>
          </Paper>
          <Paper withBorder p="md">
            <Stack>
              <Title order={2} fz="md">
                Who gets it
              </Title>
              {c.filter.standIds.length ? (
                <Alert color="blue">
                  <Text fz="sm">
                    Only the {c.filter.standIds.length} {c.filter.standIds.length === 1 ? 'stand' : 'stands'} you chose. The filters below narrow this further.
                  </Text>
                  {editable ? (
                    <Button size="compact-xs" variant="subtle" mt={4} onClick={() => setF({ standIds: [] })}>
                      Send to every stand that matches the filters instead
                    </Button>
                  ) : null}
                </Alert>
              ) : null}
              <SegmentedControl
                value={c.filter.audience}
                onChange={(v) => setF({ audience: v as Filter['audience'] })}
                data={[
                  { value: 'main_contacts', label: 'Main contacts' },
                  { value: 'everyone', label: 'Everyone at each company' },
                ]}
                disabled={!editable}
              />
              <MultiSelect label="Stand types" placeholder="All stand types" data={options.types.map((t) => ({ value: t.id, label: t.name }))} value={c.filter.exhibitorTypeIds} onChange={(v) => setF({ exhibitorTypeIds: v })} clearable disabled={!editable} />
              <MultiSelect label="Halls" placeholder="All halls" data={options.halls.map((h) => ({ value: h.id, label: h.name }))} value={c.filter.hallIds} onChange={(v) => setF({ hallIds: v })} clearable disabled={!editable} />
              <Select label="Only stands that have not done this task" placeholder="Any" data={options.tasks.map((t) => ({ value: t.id, label: t.title }))} value={c.filter.taskNotDoneId} onChange={(v) => setF({ taskNotDoneId: v })} clearable disabled={!editable} />
              <Select label="Only stands that have not ordered from" placeholder="Any" data={options.categories.map((t) => ({ value: t.id, label: t.name }))} value={c.filter.categoryNotOrderedId} onChange={(v) => setF({ categoryNotOrderedId: v })} clearable disabled={!editable} />
              <Checkbox label="Only people who have never signed in" checked={c.filter.neverSignedIn} onChange={(e) => setF({ neverSignedIn: e.currentTarget.checked })} disabled={!editable} />
              <Text fz="sm" fw={600} aria-live="polite">
                {size ? `${size.recipients} ${size.recipients === 1 ? 'person' : 'people'} at ${size.stands} ${size.stands === 1 ? 'stand' : 'stands'}${size.unsubscribed ? ` (${size.unsubscribed} unsubscribed, not included)` : ''}` : 'Counting…'}
              </Text>
            </Stack>
          </Paper>
          {editable ? (
            <EmailBlockEditor blocks={c.blocks} onChange={(blocks) => setC({ ...c, blocks })} variables={VARIABLES} editionId={editionId} allowTasksDue={false} errors={errors} />
          ) : null}
          {editable ? (
            <Group>
              <Button variant="default" loading={create.pending || update.pending} onClick={saveDraft}>
                Save draft
              </Button>
              {campaignId ? (
                <>
                  <Button variant="default" loading={test.pending} onClick={() => test.run(campaignId)}>
                    Send me a test
                  </Button>
                  <Button onClick={() => setSendOpen(true)} disabled={!size?.recipients}>
                    Send…
                  </Button>
                  <Button
                    variant="subtle"
                    color="red"
                    onClick={() =>
                      modals.openConfirmModal({
                        title: 'Delete this draft?',
                        labels: { confirm: 'Delete', cancel: 'Cancel' },
                        confirmProps: { color: 'red' },
                        onConfirm: () => del.run(campaignId),
                      })
                    }
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <Text fz="sm" c="dimmed">
                  Save the draft to send a test or send it.
                </Text>
              )}
            </Group>
          ) : null}
        </Stack>
      </GridCol>
      <GridCol span={{ base: 12, lg: 6 }}>
        <EmailPreview preview={preview} loading={prev.pending} onRefresh={() => prev.run(editionId, { subject: c.subject, blocks: c.blocks })} />
      </GridCol>
      <Modal opened={sendOpen} onClose={() => setSendOpen(false)} title="Send this email">
        <Stack>
          <Alert color="blue">
            It goes to {size?.recipients ?? 0} {size?.recipients === 1 ? 'person' : 'people'}. Save any changes first: what was last saved is what is sent.
          </Alert>
          <SegmentedControl
            value={when}
            onChange={(v) => setWhen(v as 'now' | 'later')}
            data={[
              { value: 'now', label: 'Send now' },
              { value: 'later', label: 'Schedule' },
            ]}
          />
          {when === 'later' ? <DateTimePicker label="Send at (UK time)" value={at} onChange={(v) => setAt(v)} minDate={new Date()} valueFormat="D MMM YYYY HH:mm" /> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button loading={send.pending} disabled={when === 'later' && !at} onClick={() => campaignId && send.run(campaignId, when === 'later' ? at : null)}>
              {when === 'now' ? 'Send now' : 'Schedule'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Grid>
  );
}
