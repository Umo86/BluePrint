'use client';

import {
  ActionIcon,
  Anchor,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconFile, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { FileUpload } from './file-upload';
import { isVisible, type Declaration, type FormField } from '@/lib/forms';
import { formatBytes } from '@/lib/upload-rules';

type Values = Record<string, unknown>;
/** Names and sizes of uploaded files; `canOpen: false` shows the name without a link. */
export type FileInfo = Record<string, { name: string; size: number; canOpen?: boolean }>;

type Props = {
  fields: FormField[];
  value: Values;
  onChange?: (v: Values) => void;
  errors?: Record<string, string>;
  readOnly?: boolean;
  /** Needed for file questions: uploads are stored against this stand. */
  standId?: string;
  files?: FileInfo;
  onFileUploaded?: (id: string, info: { name: string; size: number }) => void;
};

function FieldInput({ field, value, set, error, readOnly, standId, files, onFileUploaded }: {
  field: FormField;
  value: unknown;
  set: (v: unknown) => void;
  error?: string;
  readOnly?: boolean;
  standId?: string;
  files?: FileInfo;
  onFileUploaded?: Props['onFileUploaded'];
}) {
  const common = { label: field.label, description: field.help, required: field.required, error, readOnly, disabled: readOnly && !['text', 'textarea'].includes(field.type) };
  switch (field.type) {
    case 'heading':
      return (
        <div>
          <Title order={3} fz="md" mt="sm">
            {field.label}
          </Title>
          {field.help ? (
            <Text fz="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
              {field.help}
            </Text>
          ) : null}
        </div>
      );
    case 'text':
    case 'phone':
      return <TextInput {...common} value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.currentTarget.value)} maxLength={field.maxLength} type={field.type === 'phone' ? 'tel' : 'text'} />;
    case 'email':
      return <TextInput {...common} type="email" value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.currentTarget.value)} />;
    case 'textarea':
      return <Textarea {...common} autosize minRows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.currentTarget.value)} maxLength={field.maxLength} />;
    case 'number':
      return <NumberInput {...common} value={typeof value === 'number' ? value : ''} onChange={(v) => set(v === '' ? undefined : Number(v))} min={field.min} max={field.max} />;
    case 'select':
      return <Select {...common} data={field.options ?? []} value={typeof value === 'string' ? value : null} onChange={(v) => set(v ?? undefined)} clearable={!field.required} />;
    case 'multiselect':
      return <MultiSelect {...common} data={field.options ?? []} value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => set(v)} />;
    case 'date':
      return <DateInput {...common} value={typeof value === 'string' ? value : null} onChange={(v) => set(v ?? undefined)} valueFormat="D MMMM YYYY" clearable />;
    case 'checkbox':
      return <Checkbox label={field.label} description={field.help} checked={value === true} onChange={(e) => set(e.currentTarget.checked)} error={error} disabled={readOnly} />;
    case 'declaration': {
      const d = (value as Declaration) ?? { agreed: false, name: '' };
      return (
        <Paper withBorder p="md" bg="var(--mantine-color-gray-0)">
          <Stack gap="xs">
            <Text fw={600} fz="sm">
              {field.label}
              {field.required ? <Text span c="red"> *</Text> : null}
            </Text>
            {field.statement ? (
              <Text fz="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {field.statement}
              </Text>
            ) : null}
            <Checkbox label="I confirm the statement above" checked={d.agreed} onChange={(e) => set({ ...d, agreed: e.currentTarget.checked })} disabled={readOnly} />
            <TextInput label="Your full name" value={d.name} onChange={(e) => set({ ...d, name: e.currentTarget.value })} readOnly={readOnly} maxLength={120} w={320} />
            {d.signedAt ? (
              <Text fz="xs" c="dimmed">
                Signed {new Date(d.signedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}
              </Text>
            ) : null}
            {error ? (
              <Text fz="xs" c="red">
                {error}
              </Text>
            ) : null}
          </Stack>
        </Paper>
      );
    }
    case 'file': {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Stack gap={6}>
          <Text fz="sm" fw={600}>
            {field.label}
            {field.required ? <Text span c="red"> *</Text> : null}
          </Text>
          {field.help ? (
            <Text fz="xs" c="dimmed">
              {field.help}
            </Text>
          ) : null}
          {ids.map((id) => (
            <Group key={id} gap="xs">
              <IconFile size={16} />
              {files?.[id]?.canOpen === false ? (
                <Text fz="sm">{files[id].name}</Text>
              ) : (
                <Anchor href={`/files/${id}?download=1`} fz="sm">
                  {files?.[id]?.name ?? 'Uploaded file'}
                </Anchor>
              )}
              {files?.[id] ? (
                <Text fz="xs" c="dimmed">
                  {formatBytes(files[id].size)}
                </Text>
              ) : null}
              {!readOnly ? (
                <ActionIcon size="sm" variant="subtle" color="red" aria-label={`Remove ${files?.[id]?.name ?? 'file'}`} onClick={() => set(ids.filter((x) => x !== id))}>
                  <IconX size={14} />
                </ActionIcon>
              ) : null}
            </Group>
          ))}
          {!readOnly && standId ? (
            <FileUpload
              purpose="submission"
              scope={{ standId }}
              multiple
              onUploaded={(f) => {
                onFileUploaded?.(f.fileId, { name: f.name, size: f.size });
                set([...(Array.isArray(value) ? (value as string[]) : []), f.fileId]);
              }}
            />
          ) : null}
          {readOnly && !ids.length ? (
            <Text fz="sm" c="dimmed">
              No file
            </Text>
          ) : null}
          {error ? (
            <Text fz="xs" c="red">
              {error}
            </Text>
          ) : null}
        </Stack>
      );
    }
    case 'repeater': {
      const rows = Array.isArray(value) ? (value as Values[]) : [];
      const max = field.maxRows ?? 50;
      return (
        <Stack gap="xs">
          <Text fz="sm" fw={600}>
            {field.label}
          </Text>
          {field.help ? (
            <Text fz="xs" c="dimmed">
              {field.help}
            </Text>
          ) : null}
          {rows.map((row, i) => (
            <Paper key={i} withBorder p="sm">
              <Group align="flex-end" wrap="wrap" gap="sm">
                {(field.fields ?? []).map((sub) => (
                  <div key={sub.id} style={{ minWidth: 160, flex: 1 }}>
                    <FieldInput field={sub} value={row[sub.id]} readOnly={readOnly} set={(v) => set(rows.map((r, j) => (j === i ? { ...r, [sub.id]: v } : r)))} />
                  </div>
                ))}
                {!readOnly ? (
                  <ActionIcon variant="subtle" color="red" aria-label={`Remove row ${i + 1}`} onClick={() => set(rows.filter((_, j) => j !== i))}>
                    <IconTrash size={16} />
                  </ActionIcon>
                ) : null}
              </Group>
            </Paper>
          ))}
          {!readOnly && rows.length < max ? (
            <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => set([...rows, {}])} style={{ alignSelf: 'flex-start' }}>
              Add a row
            </Button>
          ) : null}
          {error ? (
            <Text fz="xs" c="red">
              {error}
            </Text>
          ) : null}
        </Stack>
      );
    }
    default:
      return null;
  }
}

/** Shows a task's form, for exhibitors to fill in or for the team to read. */
export function FormRenderer({ fields, value, onChange, errors = {}, readOnly, standId, files, onFileUploaded }: Props) {
  return (
    <Stack>
      {fields.map((field) =>
        isVisible(field, value) ? (
          <FieldInput
            key={field.id}
            field={field}
            value={value[field.id]}
            error={errors[field.id]}
            readOnly={readOnly}
            standId={standId}
            files={files}
            onFileUploaded={onFileUploaded}
            set={(v) => onChange?.({ ...value, [field.id]: v })}
          />
        ) : null,
      )}
    </Stack>
  );
}
