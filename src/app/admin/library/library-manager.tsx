'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  Menu,
  Paper,
  ScrollArea,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots, IconPlus } from '@tabler/icons-react';
import { RichTextEditor } from '@/components/rich-text-editor';
import { useAction } from '@/lib/use-action';
import { dateShort } from '@/lib/format';
import { deleteLibraryItemAction, saveLibraryItemAction } from '../actions';

type Kind = 'page' | 'task' | 'email_template' | 'catalogue';
type Item = { id: string; kind: Kind; name: string; description: string; data: Record<string, unknown>; updatedAt: string };

const KINDS: { value: Kind; label: string; help: string }[] = [
  { value: 'page', label: 'Manual pages', help: 'Standard pages such as health and safety, sustainability or venue information.' },
  { value: 'task', label: 'Tasks and forms', help: 'Saved from a show’s task builder with “Save to library”.' },
  { value: 'email_template', label: 'Email templates', help: 'Saved from a show’s email editor with “Save to library”.' },
  { value: 'catalogue', label: 'Service catalogues', help: 'Saved from a show’s services set-up with “Save to library”.' },
];

export function LibraryManager({ items }: { items: Item[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Item | null>(null);
  const [draft, setDraft] = useState({ name: '', description: '', title: '', bodyHtml: '' });
  const save = useAction(saveLibraryItemAction, {
    onSuccess: () => {
      setEditing(null);
      router.refresh();
    },
  });
  const del = useAction(deleteLibraryItemAction, { onSuccess: () => router.refresh() });

  const open = (item: Item | null, kind: Kind = 'page') => {
    const base: Item = item ?? { id: '', kind, name: '', description: '', data: {}, updatedAt: '' };
    setEditing(base);
    setDraft({
      name: base.name,
      description: base.description,
      title: typeof base.data.title === 'string' ? base.data.title : '',
      bodyHtml: typeof base.data.bodyHtml === 'string' ? base.data.bodyHtml : '',
    });
  };

  const submit = () => {
    if (!editing) return;
    const data = editing.kind === 'page' ? { title: draft.title || draft.name, bodyHtml: draft.bodyHtml } : editing.data;
    save.run(editing.id || null, { kind: editing.kind, name: draft.name, description: draft.description, data });
  };

  return (
    <>
      <Tabs defaultValue="page">
        <Tabs.List mb="md">
          {KINDS.map((k) => (
            <Tabs.Tab key={k.value} value={k.value} rightSection={<Badge size="xs" variant="light">{items.filter((i) => i.kind === k.value).length}</Badge>}>
              {k.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {KINDS.map((k) => {
          const rows = items.filter((i) => i.kind === k.value);
          return (
            <Tabs.Panel key={k.value} value={k.value}>
              <Group justify="space-between" mb="sm">
                <Text fz="sm" c="dimmed">
                  {k.help}
                </Text>
                {k.value === 'page' ? (
                  <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => open(null, 'page')}>
                    New page template
                  </Button>
                ) : null}
              </Group>
              <Paper withBorder>
                <Table verticalSpacing="sm">
                  <TableThead>
                    <TableTr>
                      <TableTh>Name</TableTh>
                      <TableTh>Updated</TableTh>
                      <TableTh w={40} />
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {rows.map((item) => (
                      <TableTr key={item.id}>
                        <TableTd>
                          <Text fz="sm" fw={600}>
                            {item.name}
                          </Text>
                          {item.description ? (
                            <Text fz="xs" c="dimmed">
                              {item.description}
                            </Text>
                          ) : null}
                        </TableTd>
                        <TableTd>{dateShort(item.updatedAt)}</TableTd>
                        <TableTd>
                          <Menu position="bottom-end">
                            <Menu.Target>
                              <ActionIcon variant="subtle" aria-label={`Actions for ${item.name}`}>
                                <IconDots size={16} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item onClick={() => open(item)}>Edit</Menu.Item>
                              <Menu.Item
                                color="red"
                                onClick={() =>
                                  modals.openConfirmModal({
                                    title: `Delete “${item.name}” from the library?`,
                                    children: <Text fz="sm">Shows that already copied it keep their copy.</Text>,
                                    labels: { confirm: 'Delete', cancel: 'Cancel' },
                                    confirmProps: { color: 'red' },
                                    onConfirm: () => del.run(item.id),
                                  })
                                }
                              >
                                Delete
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
                {rows.length === 0 ? (
                  <Text p="md" fz="sm" c="dimmed">
                    Nothing here yet.
                  </Text>
                ) : null}
              </Paper>
            </Tabs.Panel>
          );
        })}
      </Tabs>

      <Drawer
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        position="right"
        size="xl"
        title={editing?.id ? `Edit ${editing.name}` : 'New page template'}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {editing ? (
          <Stack>
            <TextInput label="Template name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} error={save.fieldErrors.name} />
            <Textarea label="Note for show teams" description="What it is and when to use it." autosize minRows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })} />
            {editing.kind === 'page' ? (
              <>
                <TextInput label="Page title" description="Shown to exhibitors. Leave blank to use the template name." value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })} />
                <RichTextEditor label="Page content" value={draft.bodyHtml} onChange={(html) => setDraft((d) => ({ ...d, bodyHtml: html }))} minHeight={320} />
              </>
            ) : (
              <Paper withBorder p="sm">
                <Text fz="sm" mb="xs">
                  The content of this template is edited in a show, then saved to the library again. Here you can rename or delete it.
                </Text>
                <Code block mah={260} style={{ overflow: 'auto' }}>
                  {JSON.stringify(editing.data, null, 2).slice(0, 4000)}
                </Code>
              </Paper>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button loading={save.pending} onClick={submit} disabled={!draft.name.trim()}>
                Save template
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Drawer>
    </>
  );
}
