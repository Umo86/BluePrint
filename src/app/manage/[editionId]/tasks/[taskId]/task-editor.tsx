'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { RichTextEditor } from '@/components/rich-text-editor';
import { FormRenderer } from '@/components/form-renderer';
import { useAction } from '@/lib/use-action';
import { REQUIREMENT_LABELS, TASK_KIND_HELP, TASK_KIND_LABELS } from '@/lib/task-labels';
import type { FormField } from '@/lib/forms';
import { saveTaskAction, saveTaskToLibraryAction } from '../../../actions';
import { FormBuilder } from './form-builder';
import { ResponsesPanel, type ResponseRow } from './responses-panel';

type Deadline = { mode: 'none' } | { mode: 'offset'; offsetDays: number } | { mode: 'fixed'; at: string };
type Values = {
  title: string;
  descriptionHtml: string;
  kind: 'form' | 'upload' | 'declaration' | 'order' | 'contractor_nomination' | 'space_only_pack' | 'info';
  formSchema: FormField[];
  deadline: Deadline;
  requiresApproval: boolean;
  locksAtDeadline: boolean;
  linkedPageId: string | null;
  linkedCategoryId: string | null;
  reminderOffsets: number[] | null;
  published: boolean;
  requirements: Record<string, 'required' | 'if_applicable' | 'optional' | 'hidden'>;
};

const HAS_QUESTIONS = ['form', 'upload', 'declaration'];

export function TaskEditor(props: {
  editionId: string;
  taskId: string | null;
  canEdit: boolean;
  canReview: boolean;
  canExport: boolean;
  canSaveToLibrary: boolean;
  initialTab?: string;
  initial: Values;
  types: { id: string; name: string; isSpaceOnly: boolean; standCount: number }[];
  pages: { value: string; label: string }[];
  buildUpStartsAt: string | null;
  responses: ResponseRow[];
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>(props.initial);
  const [preview, setPreview] = useState<Record<string, unknown>>({});
  const tabs = ['settings', ...(HAS_QUESTIONS.includes(v.kind) ? ['questions', 'preview'] : []), ...(props.taskId ? ['responses'] : [])];
  const [tab, setTab] = useState<string>(props.initialTab && tabs.includes(props.initialTab) ? props.initialTab : props.taskId && !props.canEdit ? 'responses' : 'settings');
  const save = useAction(saveTaskAction, {
    onSuccess: (data) => {
      if (!props.taskId && data?.id) router.replace(`/manage/${props.editionId}/tasks/${data.id}`);
    },
  });
  const toLibrary = useAction(saveTaskToLibraryAction);
  const ro = !props.canEdit;

  const setKind = (kind: Values['kind']) => {
    let formSchema = v.formSchema;
    if (kind === 'upload' && !formSchema.some((f) => f.type === 'file')) formSchema = [...formSchema, { id: 'upload_1', type: 'file', label: 'Upload your document', required: true }];
    if (kind === 'declaration' && !formSchema.some((f) => f.type === 'declaration')) {
      formSchema = [...formSchema, { id: 'declaration_1', type: 'declaration', label: 'Declaration', statement: 'I confirm that the information I have given is correct.', required: true }];
    }
    setV({ ...v, kind, formSchema, requiresApproval: kind === 'space_only_pack' ? true : v.requiresApproval });
  };

  const deadlineHint =
    v.deadline.mode === 'offset' && props.buildUpStartsAt
      ? new Date(new Date(props.buildUpStartsAt).getTime() - v.deadline.offsetDays * 86400_000).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' })
      : null;

  const saveBar = props.canEdit ? (
    <Group justify="space-between">
      <Switch label="Published (exhibitors can see it)" checked={v.published} onChange={(e) => setV({ ...v, published: e.currentTarget.checked })} />
      <Group gap="xs">
        {props.canSaveToLibrary && props.taskId ? (
          <Button variant="default" loading={toLibrary.pending} onClick={() => toLibrary.run(props.taskId!)}>
            Save to library
          </Button>
        ) : null}
        <Button loading={save.pending} onClick={() => save.run(props.editionId, props.taskId, { ...v, reminderOffsets: v.reminderOffsets?.length ? v.reminderOffsets : null })}>
          Save task
        </Button>
      </Group>
    </Group>
  ) : null;

  return (
    <Stack>
      {save.error ? (
        <Alert color="red" title="Not saved">
          {save.error}
          {Object.keys(save.fieldErrors).length ? (
            <Text fz="xs" mt={4}>
              {Object.values(save.fieldErrors).join(' ')}
            </Text>
          ) : null}
        </Alert>
      ) : null}
      <Tabs value={tab} onChange={(t) => t && setTab(t)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
          {HAS_QUESTIONS.includes(v.kind) ? <Tabs.Tab value="questions">Questions ({v.formSchema.filter((f) => f.type !== 'heading').length})</Tabs.Tab> : null}
          {HAS_QUESTIONS.includes(v.kind) ? <Tabs.Tab value="preview">Preview</Tabs.Tab> : null}
          {props.taskId ? (
            <Tabs.Tab value="responses" rightSection={<Badge size="xs">{props.responses.filter((r) => r.state === 'submitted').length || ''}</Badge>}>
              Responses
            </Tabs.Tab>
          ) : null}
        </Tabs.List>

        <Tabs.Panel value="settings">
          <SimpleGrid cols={{ base: 1, lg: 3 }}>
            <Paper withBorder p="md" style={{ gridColumn: 'span 2' }}>
              <Stack>
                <TextInput label="Title" required value={v.title} onChange={(e) => setV({ ...v, title: e.currentTarget.value })} readOnly={ro} error={save.fieldErrors.title} />
                <Select
                  label="What the exhibitor does"
                  data={Object.entries(TASK_KIND_LABELS).map(([value, label]) => ({ value, label }))}
                  value={v.kind}
                  onChange={(k) => k && setKind(k as Values['kind'])}
                  description={TASK_KIND_HELP[v.kind]}
                  allowDeselect={false}
                  disabled={ro}
                />
                <RichTextEditor label="Instructions" value={v.descriptionHtml} onChange={(html) => setV((x) => ({ ...x, descriptionHtml: html }))} minHeight={180} />
                <Select
                  label="Related manual page"
                  description="Shown as a link on the task."
                  placeholder="None"
                  data={props.pages}
                  value={v.linkedPageId}
                  onChange={(p) => setV({ ...v, linkedPageId: p })}
                  clearable
                  disabled={ro}
                />
              </Stack>
            </Paper>
            <Stack>
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Text fw={600} fz="sm">
                    Deadline
                  </Text>
                  <SegmentedControl
                    value={v.deadline.mode}
                    onChange={(m) =>
                      setV({
                        ...v,
                        deadline: m === 'offset' ? { mode: 'offset', offsetDays: 21 } : m === 'fixed' ? { mode: 'fixed', at: '' } : { mode: 'none' },
                      })
                    }
                    data={[
                      { value: 'offset', label: 'Before build-up' },
                      { value: 'fixed', label: 'Fixed date' },
                      { value: 'none', label: 'None' },
                    ]}
                    disabled={ro}
                    fullWidth
                  />
                  {v.deadline.mode === 'offset' ? (
                    <>
                      <NumberInput
                        label="Days before build-up starts"
                        value={v.deadline.offsetDays}
                        onChange={(n) => setV({ ...v, deadline: { mode: 'offset', offsetDays: Number(n || 0) } })}
                        min={-60}
                        max={365}
                        readOnly={ro}
                      />
                      <Text fz="xs" c="dimmed">
                        {deadlineHint ? `That is ${deadlineHint}.` : 'Set the build-up date in show settings to see the exact date.'}
                      </Text>
                    </>
                  ) : null}
                  {v.deadline.mode === 'fixed' ? (
                    <DateTimePicker label="Deadline (UK time)" value={v.deadline.at || null} onChange={(d) => setV({ ...v, deadline: { mode: 'fixed', at: d ?? '' } })} readOnly={ro} />
                  ) : null}
                  <Switch
                    label="Lock answers after the deadline"
                    description="You can still reopen it for one stand."
                    checked={v.locksAtDeadline}
                    onChange={(e) => setV({ ...v, locksAtDeadline: e.currentTarget.checked })}
                    disabled={ro || v.deadline.mode === 'none'}
                  />
                  <TagsInput
                    label="Reminders (days before)"
                    description="Leave empty to use the show’s default reminders."
                    value={(v.reminderOffsets ?? []).map(String)}
                    onChange={(vals) => setV({ ...v, reminderOffsets: [...new Set(vals.map((x) => Number.parseInt(x, 10)).filter((n) => n >= 1 && n <= 365))].sort((a, b) => b - a).slice(0, 6) })}
                    disabled={ro}
                  />
                </Stack>
              </Paper>
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Text fw={600} fz="sm">
                    Who has to do it
                  </Text>
                  {props.types.map((t) => (
                    <div key={t.id}>
                      <Text fz="sm">
                        {t.name}{' '}
                        <Text span c="dimmed" fz="xs">
                          ({t.standCount} stands)
                        </Text>
                      </Text>
                      <SegmentedControl
                        aria-label={`Requirement for ${t.name}`}
                        size="xs"
                        fullWidth
                        value={v.requirements[t.id] ?? 'hidden'}
                        onChange={(r) => setV({ ...v, requirements: { ...v.requirements, [t.id]: r as Values['requirements'][string] } })}
                        data={(['required', 'if_applicable', 'optional', 'hidden'] as const).map((r) => ({ value: r, label: REQUIREMENT_LABELS[r] }))}
                        disabled={ro}
                      />
                    </div>
                  ))}
                  <Switch
                    label="The team checks and approves answers"
                    checked={v.requiresApproval}
                    onChange={(e) => setV({ ...v, requiresApproval: e.currentTarget.checked })}
                    disabled={ro}
                  />
                </Stack>
              </Paper>
            </Stack>
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="questions">
          <FormBuilder fields={v.formSchema} onChange={(f) => setV({ ...v, formSchema: f })} readOnly={ro} />
        </Tabs.Panel>

        <Tabs.Panel value="preview">
          <Paper withBorder p="md" maw={760}>
            <Text fz="sm" c="dimmed" mb="md">
              This is what exhibitors see. Try it out: nothing here is saved.
            </Text>
            <FormRenderer fields={v.formSchema} value={preview} onChange={setPreview} />
          </Paper>
        </Tabs.Panel>

        {props.taskId ? (
          <Tabs.Panel value="responses">
            <ResponsesPanel
              editionId={props.editionId}
              taskId={props.taskId}
              rows={props.responses}
              fields={props.initial.formSchema}
              canReview={props.canReview}
              canExport={props.canExport}
              requiresApproval={props.initial.requiresApproval}
            />
          </Tabs.Panel>
        ) : null}
      </Tabs>
      {tab !== 'responses' ? saveBar : null}
      {!props.canEdit && tab !== 'responses' ? (
        <Text fz="sm" c="dimmed">
          You can see this task but not change it.
        </Text>
      ) : null}
    </Stack>
  );
}

