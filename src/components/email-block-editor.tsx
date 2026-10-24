'use client';

import { ActionIcon, Badge, Button, Group, Image, Menu, Paper, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { FileUpload } from '@/components/file-upload';

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'button'; label: string; url: string }
  | { type: 'tasks_due' }
  | { type: 'image'; fileId: string; alt: string }
  | { type: 'divider' }
  | { type: 'html'; html: string };

const LABELS: Record<Block['type'], string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  button: 'Button',
  tasks_due: 'List of things due',
  image: 'Image',
  divider: 'Divider',
  html: 'HTML',
};

function blank(type: Block['type']): Block | null {
  switch (type) {
    case 'heading':
      return { type, text: '' };
    case 'paragraph':
      return { type, text: '' };
    case 'button':
      return { type, label: 'Open your exhibitor portal', url: '{{portal_link}}' };
    case 'tasks_due':
      return { type };
    case 'divider':
      return { type };
    case 'html':
      return { type, html: '<p></p>' };
    default:
      return null;
  }
}

/**
 * Builds an email from blocks. Text is plain (it is escaped when sent); {{variables}} are filled
 * in for each person. The HTML block is for anything the blocks cannot do, and is cleaned of
 * scripts and tracking before sending.
 */
export function EmailBlockEditor({
  blocks,
  onChange,
  variables,
  editionId,
  allowTasksDue,
  errors,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  variables: { key: string; label: string }[];
  editionId: string;
  allowTasksDue: boolean;
  errors?: Record<string, string>;
}) {
  const set = (i: number, b: Block) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (type: Block['type']) => {
    const b = blank(type);
    if (b) onChange([...blocks, b]);
  };
  return (
    <Stack gap="sm">
      <Group gap={6}>
        <Text fz="xs" c="dimmed">
          Insert details with:
        </Text>
        {variables.map((v) => (
          <Tooltip key={v.key} label={v.label}>
            <Badge variant="light" tt="none" style={{ cursor: 'help' }}>{`{{${v.key}}}`}</Badge>
          </Tooltip>
        ))}
      </Group>
      {blocks.map((b, i) => (
        <Paper key={i} withBorder p="sm">
          <Group justify="space-between" mb={6}>
            <Text fz="xs" fw={700} c="dimmed" tt="uppercase">
              {LABELS[b.type]}
            </Text>
            <Group gap={2}>
              <ActionIcon variant="subtle" size="sm" aria-label={`Move block ${i + 1} up`} onClick={() => move(i, -1)}>
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" size="sm" aria-label={`Move block ${i + 1} down`} onClick={() => move(i, 1)}>
                <IconArrowDown size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Remove block ${i + 1}`} onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Group>
          {b.type === 'heading' ? <TextInput aria-label={`Heading ${i + 1}`} value={b.text} onChange={(e) => set(i, { ...b, text: e.currentTarget.value })} maxLength={300} /> : null}
          {b.type === 'paragraph' ? (
            <Textarea aria-label={`Paragraph ${i + 1}`} value={b.text} onChange={(e) => set(i, { ...b, text: e.currentTarget.value })} autosize minRows={2} maxLength={5000} />
          ) : null}
          {b.type === 'button' ? (
            <Group grow>
              <TextInput label="Button text" value={b.label} onChange={(e) => set(i, { ...b, label: e.currentTarget.value })} maxLength={80} error={errors?.[`blocks.${i}.label`]} />
              <TextInput label="Link" value={b.url} onChange={(e) => set(i, { ...b, url: e.currentTarget.value })} maxLength={1000} error={errors?.[`blocks.${i}.url`]} description="https://… or a {{variable}}" />
            </Group>
          ) : null}
          {b.type === 'tasks_due' ? (
            <Text fz="sm" c="dimmed">
              Each person sees their own stand’s tasks that are due soon or overdue, with links.
            </Text>
          ) : null}
          {b.type === 'divider' ? <div style={{ borderTop: '1px solid var(--mantine-color-gray-3)', margin: '8px 0' }} /> : null}
          {b.type === 'image' ? (
            <Group align="flex-start">
              <Image src={`/files/${b.fileId}`} alt="" w={160} h={80} fit="contain" />
              <TextInput label="Description for screen readers" value={b.alt} onChange={(e) => set(i, { ...b, alt: e.currentTarget.value })} maxLength={200} style={{ flex: 1 }} />
            </Group>
          ) : null}
          {b.type === 'html' ? (
            <Textarea
              aria-label={`HTML ${i + 1}`}
              value={b.html}
              onChange={(e) => set(i, { ...b, html: e.currentTarget.value })}
              autosize
              minRows={4}
              maxLength={50_000}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              description="Tables, links and formatting are kept; scripts, forms and tracking are removed when it is sent."
            />
          ) : null}
        </Paper>
      ))}
      {errors?.blocks ? (
        <Text c="red" fz="sm">
          {errors.blocks}
        </Text>
      ) : null}
      <Group>
        <Menu position="bottom-start">
          <Menu.Target>
            <Button variant="light" size="xs" leftSection={<IconPlus size={14} />}>
              Add a block
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {(['heading', 'paragraph', 'button', 'divider', 'html'] as const).map((t) => (
              <Menu.Item key={t} onClick={() => add(t)}>
                {LABELS[t]}
              </Menu.Item>
            ))}
            {allowTasksDue ? <Menu.Item onClick={() => add('tasks_due')}>{LABELS.tasks_due}</Menu.Item> : null}
          </Menu.Dropdown>
        </Menu>
        <ImageBlockUpload editionId={editionId} onUploaded={(fileId) => onChange([...blocks, { type: 'image', fileId, alt: '' }])} />
      </Group>
    </Stack>
  );
}

function ImageBlockUpload({ editionId, onUploaded }: { editionId: string; onUploaded: (fileId: string) => void }) {
  return (
    <div style={{ minWidth: 260 }}>
      <FileUpload purpose="branding" scope={{ editionId }} onUploaded={(f) => onUploaded(f.fileId)} label="Add an image (drop or click)" />
    </div>
  );
}
