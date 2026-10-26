'use client';

import { useState } from 'react';
import { ActionIcon, Button, Group, Menu, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconDots, IconPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { archiveShowAction, createEditionAction, createShowAction, deleteShowAction, updateShowAction } from '../actions';

export function NewShowButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useAction(createShowAction, { onSuccess: () => { setOpen(false); setName(''); setDescription(''); } });
  return (
    <>
      <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
        New show
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="New show">
        <form onSubmit={(e) => { e.preventDefault(); create.run({ name, description }); }}>
          <Stack>
            <TextInput label="Show name" placeholder="Spring Trade Expo" required value={name} onChange={(e) => setName(e.currentTarget.value)} error={create.fieldErrors.name} data-autofocus />
            <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />
            <Group justify="flex-end">
              <Button type="submit" loading={create.pending}>Create show</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function NewEditionButton({ showId, showName }: { showId: string; showName: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', venue: '', city: '', buildUpStartsAt: null as string | null, openStartsAt: null as string | null, openEndsAt: null as string | null, breakdownEndsAt: null as string | null });
  const create = useAction(createEditionAction);
  return (
    <>
      <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => setOpen(true)}>
        New edition
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={`New edition of ${showName}`} size="lg">
        <form onSubmit={(e) => { e.preventDefault(); create.run(showId, form); }}>
          <Stack>
            <TextInput label="Edition name" placeholder={`${showName} London 2027`} required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} error={create.fieldErrors.name} />
            <Group grow>
              <TextInput label="Venue" placeholder="ExCeL London" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.currentTarget.value })} />
              <TextInput label="City" placeholder="London" value={form.city} onChange={(e) => setForm({ ...form, city: e.currentTarget.value })} />
            </Group>
            <Group grow>
              <DateTimePicker label="Build-up starts" value={form.buildUpStartsAt} onChange={(v) => setForm({ ...form, buildUpStartsAt: v })} clearable description="Deadlines count back from this." />
              <DateTimePicker label="Breakdown ends" value={form.breakdownEndsAt} onChange={(v) => setForm({ ...form, breakdownEndsAt: v })} clearable />
            </Group>
            <Group grow>
              <DateTimePicker label="Show opens" value={form.openStartsAt} onChange={(v) => setForm({ ...form, openStartsAt: v })} clearable />
              <DateTimePicker label="Show closes" value={form.openEndsAt} onChange={(v) => setForm({ ...form, openEndsAt: v })} clearable />
            </Group>
            <Group justify="flex-end">
              <Button type="submit" loading={create.pending}>Create edition</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function ShowMenu({ show }: { show: { id: string; name: string; description: string; archived: boolean; editionCount: number } }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(show.name);
  const [description, setDescription] = useState(show.description);
  const save = useAction(updateShowAction, { onSuccess: () => setEdit(false) });
  const archive = useAction(archiveShowAction);
  const del = useAction(deleteShowAction);
  return (
    <>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={`More actions for ${show.name}`}>
            <IconDots size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => setEdit(true)}>Rename</Menu.Item>
          <Menu.Item onClick={() => archive.run(show.id, !show.archived)}>{show.archived ? 'Restore' : 'Archive'}</Menu.Item>
          <Menu.Item
            color="red"
            disabled={show.editionCount > 0}
            onClick={() =>
              modals.openConfirmModal({
                title: `Delete ${show.name}?`,
                children: 'This cannot be undone.',
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => del.run(show.id),
              })
            }
          >
            Delete{show.editionCount > 0 ? ' (has editions)' : ''}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={edit} onClose={() => setEdit(false)} title="Edit show">
        <form onSubmit={(e) => { e.preventDefault(); save.run(show.id, { name, description }); }}>
          <Stack>
            <TextInput label="Show name" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />
            <Group justify="flex-end">
              <Button type="submit" loading={save.pending}>Save</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
