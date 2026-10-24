'use client';

import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react';
import { FIELD_TYPES, newFieldId, type FormField, type FormFieldType } from '@/lib/forms';

const NESTED: FormFieldType[] = ['text', 'textarea', 'number', 'email', 'phone', 'select', 'date', 'checkbox'];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label]));

function blank(type: FormFieldType, ids: string[]): FormField {
  const base: FormField = { id: newFieldId(ids), type, label: '' };
  if (type === 'select' || type === 'multiselect') base.options = ['Option 1', 'Option 2'];
  if (type === 'declaration') {
    base.label = 'Declaration';
    base.statement = 'I confirm that the information I have given is correct.';
    base.required = true;
  }
  if (type === 'heading') base.label = 'Section';
  if (type === 'repeater') base.fields = [{ id: newFieldId(ids), type: 'text', label: 'Name', required: true }];
  if (type === 'file') base.label = 'Upload your document';
  return base;
}

function FieldCard({
  field,
  index,
  all,
  onChange,
  onMove,
  onRemove,
  onDuplicate,
}: {
  field: FormField;
  index: number;
  all: FormField[];
  onChange: (f: FormField) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const earlier = all.slice(0, index).filter((f) => ['select', 'checkbox', 'multiselect'].includes(f.type));
  const condField = field.showIf ? all.find((f) => f.id === field.showIf!.fieldId) : undefined;
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Badge variant="light">{TYPE_LABEL[field.type]}</Badge>
            {field.required ? (
              <Badge variant="outline" color="red" size="sm">
                Required
              </Badge>
            ) : null}
          </Group>
          <Group gap={2} wrap="nowrap">
            <ActionIcon variant="subtle" aria-label="Move question up" disabled={index === 0} onClick={() => onMove(-1)}>
              <IconArrowUp size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" aria-label="Move question down" disabled={index === all.length - 1} onClick={() => onMove(1)}>
              <IconArrowDown size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" aria-label="Copy question" onClick={onDuplicate}>
              <IconCopy size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="red" aria-label="Delete question" onClick={onRemove}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Group>
        <TextInput label={field.type === 'heading' ? 'Heading' : 'Question'} value={field.label} onChange={(e) => onChange({ ...field, label: e.currentTarget.value })} required />
        <Textarea
          label={field.type === 'heading' ? 'Text under the heading' : 'Help text'}
          autosize
          minRows={1}
          value={field.help ?? ''}
          onChange={(e) => onChange({ ...field, help: e.currentTarget.value || undefined })}
        />
        {field.type === 'select' || field.type === 'multiselect' ? (
          <TagsInput label="Options" description="Type an option and press Enter." value={field.options ?? []} onChange={(v) => onChange({ ...field, options: v })} />
        ) : null}
        {field.type === 'number' ? (
          <Group grow>
            <NumberInput label="Lowest allowed" value={field.min ?? ''} onChange={(v) => onChange({ ...field, min: v === '' ? undefined : Number(v) })} />
            <NumberInput label="Highest allowed" value={field.max ?? ''} onChange={(v) => onChange({ ...field, max: v === '' ? undefined : Number(v) })} />
          </Group>
        ) : null}
        {field.type === 'text' || field.type === 'textarea' ? (
          <NumberInput label="Maximum length (characters)" value={field.maxLength ?? ''} onChange={(v) => onChange({ ...field, maxLength: v === '' ? undefined : Number(v) })} min={1} max={20000} w={260} />
        ) : null}
        {field.type === 'declaration' ? (
          <Textarea label="Statement they confirm" autosize minRows={2} value={field.statement ?? ''} onChange={(e) => onChange({ ...field, statement: e.currentTarget.value })} />
        ) : null}
        {field.type === 'repeater' ? (
          <Stack gap={6}>
            <Text fz="sm" fw={600}>
              Columns
            </Text>
            {(field.fields ?? []).map((sub, j) => (
              <Group key={sub.id} align="flex-end" gap="xs" wrap="nowrap">
                <TextInput
                  label="Column"
                  value={sub.label}
                  onChange={(e) => onChange({ ...field, fields: field.fields!.map((x, k) => (k === j ? { ...x, label: e.currentTarget.value } : x)) })}
                  style={{ flex: 1 }}
                />
                <Select
                  label="Type"
                  data={NESTED.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
                  value={sub.type}
                  onChange={(v) =>
                    v &&
                    onChange({
                      ...field,
                      fields: field.fields!.map((x, k) => (k === j ? { ...x, type: v as FormFieldType, options: v === 'select' ? x.options ?? ['Option 1'] : undefined } : x)),
                    })
                  }
                  allowDeselect={false}
                  w={150}
                />
                {sub.type === 'select' ? (
                  <TagsInput
                    label="Options"
                    value={sub.options ?? []}
                    onChange={(v) => onChange({ ...field, fields: field.fields!.map((x, k) => (k === j ? { ...x, options: v } : x)) })}
                    w={220}
                  />
                ) : null}
                <Switch
                  label="Required"
                  checked={Boolean(sub.required)}
                  onChange={(e) => onChange({ ...field, fields: field.fields!.map((x, k) => (k === j ? { ...x, required: e.currentTarget.checked } : x)) })}
                  mb={8}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Remove column ${sub.label}`}
                  disabled={(field.fields ?? []).length <= 1}
                  onClick={() => onChange({ ...field, fields: field.fields!.filter((_, k) => k !== j) })}
                  mb={6}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Group>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => onChange({ ...field, fields: [...(field.fields ?? []), { id: newFieldId([...all.map((f) => f.id), ...(field.fields ?? []).map((f) => f.id)]), type: 'text', label: '' }] })}
              >
                Add column
              </Button>
              <NumberInput label="Most rows" value={field.maxRows ?? ''} onChange={(v) => onChange({ ...field, maxRows: v === '' ? undefined : Number(v) })} min={1} max={200} w={120} />
            </Group>
          </Stack>
        ) : null}
        {field.type !== 'heading' ? (
          <Group align="flex-end" gap="md">
            <Switch label="Required" checked={Boolean(field.required)} onChange={(e) => onChange({ ...field, required: e.currentTarget.checked })} mb={6} />
            {earlier.length ? (
              <>
                <Select
                  label="Only show if"
                  placeholder="Always shown"
                  data={earlier.map((f) => ({ value: f.id, label: f.label || 'Untitled question' }))}
                  value={field.showIf?.fieldId ?? null}
                  onChange={(v) => {
                    const target = all.find((f) => f.id === v);
                    onChange({ ...field, showIf: v ? { fieldId: v, equals: target?.type === 'checkbox' ? true : target?.options?.[0] ?? '' } : undefined });
                  }}
                  clearable
                  w={240}
                />
                {condField ? (
                  condField.type === 'checkbox' ? (
                    <Select
                      label="is"
                      data={[
                        { value: 'true', label: 'Ticked' },
                        { value: 'false', label: 'Not ticked' },
                      ]}
                      value={String(field.showIf!.equals)}
                      onChange={(v) => onChange({ ...field, showIf: { fieldId: condField.id, equals: v === 'true' } })}
                      allowDeselect={false}
                      w={140}
                    />
                  ) : (
                    <Select
                      label="is"
                      data={condField.options ?? []}
                      value={String(field.showIf!.equals)}
                      onChange={(v) => v && onChange({ ...field, showIf: { fieldId: condField.id, equals: v } })}
                      allowDeselect={false}
                      w={180}
                    />
                  )
                ) : null}
              </>
            ) : null}
          </Group>
        ) : null}
      </Stack>
    </Paper>
  );
}

/** Lets the show team build a form question by question. */
export function FormBuilder({ fields, onChange, readOnly }: { fields: FormField[]; onChange: (f: FormField[]) => void; readOnly?: boolean }) {
  const ids = fields.flatMap((f) => [f.id, ...(f.fields ?? []).map((x) => x.id)]);
  const add = (type: FormFieldType) => onChange([...fields, blank(type, ids)]);
  return (
    <Stack>
      {fields.map((f, i) => (
        <FieldCard
          key={f.id}
          field={f}
          index={i}
          all={fields}
          onChange={(nf) => onChange(fields.map((x, j) => (j === i ? nf : x)))}
          onMove={(dir) => {
            const next = [...fields];
            const j = i + dir;
            [next[i], next[j]] = [next[j], next[i]];
            // A question cannot depend on one below it.
            onChange(next.map((x, k) => (x.showIf && !next.slice(0, k).some((y) => y.id === x.showIf!.fieldId) ? { ...x, showIf: undefined } : x)));
          }}
          onRemove={() => onChange(fields.filter((_, j) => j !== i).map((x) => (x.showIf?.fieldId === f.id ? { ...x, showIf: undefined } : x)))}
          onDuplicate={() => {
            const copy = { ...structuredClone(f), id: newFieldId(ids), label: `${f.label} (copy)` };
            onChange([...fields.slice(0, i + 1), copy, ...fields.slice(i + 1)]);
          }}
        />
      ))}
      {fields.length === 0 ? (
        <Text fz="sm" c="dimmed">
          No questions yet.
        </Text>
      ) : null}
      {!readOnly ? (
        <Menu position="bottom-start" width={300}>
          <Menu.Target>
            <Button variant="light" leftSection={<IconPlus size={16} />} style={{ alignSelf: 'flex-start' }}>
              Add a question
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {FIELD_TYPES.map((t) => (
              <Tooltip key={t.value} label={t.help} position="right" withArrow>
                <Menu.Item onClick={() => add(t.value)}>{t.label}</Menu.Item>
              </Tooltip>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : null}
    </Stack>
  );
}
