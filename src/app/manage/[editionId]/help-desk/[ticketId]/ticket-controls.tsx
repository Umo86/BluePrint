'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, CloseButton, Group, SegmentedControl, Select, Stack, Switch, Text, Textarea } from '@mantine/core';
import { IconPaperclip } from '@tabler/icons-react';
import { FileUpload } from '@/components/file-upload';
import { useAction } from '@/lib/use-action';
import { assignTicketAction, setTicketStatusAction, staffReplyAction } from '../../../helpdesk-actions';

type Saved = { id: string; title: string; body: string };

export function StaffReplyForm({ editionId, ticketId, standId, savedReplies }: { editionId: string; ticketId: string; standId: string | null; savedReplies: Saved[] }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState<'pending' | 'closed' | 'open'>('pending');
  const [files, setFiles] = useState<{ fileId: string; name: string }[]>([]);
  const [attach, setAttach] = useState(false);
  const reply = useAction(staffReplyAction, {
    onSuccess: () => {
      setBody('');
      setFiles([]);
      setAttach(false);
      router.refresh();
    },
  });
  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Switch label="Internal note (the exhibitor does not see it)" checked={internal} onChange={(e) => setInternal(e.currentTarget.checked)} />
        {savedReplies.length ? (
          <Select
            aria-label="Insert a saved reply"
            placeholder="Insert a saved reply…"
            data={savedReplies.map((r) => ({ value: r.id, label: r.title }))}
            value={null}
            onChange={(v) => {
              const r = savedReplies.find((x) => x.id === v);
              if (r) setBody((b) => (b.trim() ? `${b.trim()}\n\n${r.body}` : r.body));
            }}
            w={240}
          />
        ) : null}
      </Group>
      <Textarea label={internal ? 'Note' : 'Reply to the exhibitor'} autosize minRows={4} maxRows={14} value={body} onChange={(e) => setBody(e.currentTarget.value)} maxLength={5000} error={reply.fieldErrors.body} />
      {files.map((f) => (
        <Group key={f.fileId} gap={6}>
          <IconPaperclip size={14} />
          <Text fz="sm">{f.name}</Text>
          <CloseButton size="sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.fileId !== f.fileId))} />
        </Group>
      ))}
      {standId ? (
        attach ? (
          <FileUpload purpose="ticket" scope={{ standId }} label="Drop a PDF or an image here" onUploaded={(f) => setFiles((x) => [...x, { fileId: f.fileId, name: f.name }].slice(0, 5))} />
        ) : (
          <Button variant="subtle" size="compact-sm" leftSection={<IconPaperclip size={14} />} onClick={() => setAttach(true)} style={{ alignSelf: 'flex-start' }}>
            Attach a file
          </Button>
        )
      ) : null}
      {!internal ? (
        <div>
          <Text fz="sm" fw={500} mb={4}>
            After sending
          </Text>
          <SegmentedControl
            value={after}
            onChange={(v) => setAfter(v as typeof after)}
            data={[
              { value: 'pending', label: 'Wait for the exhibitor' },
              { value: 'closed', label: 'Close it' },
              { value: 'open', label: 'Keep it with the team' },
            ]}
          />
        </div>
      ) : null}
      <Group>
        <Button loading={reply.pending} disabled={!body.trim()} onClick={() => reply.run(editionId, ticketId, { body, internal, attachments: files.map((f) => f.fileId), status: internal ? undefined : after })}>
          {internal ? 'Add note' : 'Send reply'}
        </Button>
      </Group>
    </Stack>
  );
}

export function AssignControl({ editionId, ticketId, assignedTo, team, disabled }: { editionId: string; ticketId: string; assignedTo: string | null; team: { id: string; name: string }[]; disabled: boolean }) {
  const router = useRouter();
  const assign = useAction(assignTicketAction, { onSuccess: () => router.refresh() });
  return (
    <Select
      label="Assigned to"
      placeholder="Nobody yet"
      data={team.map((p) => ({ value: p.id, label: p.name }))}
      value={assignedTo}
      onChange={(v) => assign.run(editionId, ticketId, v)}
      clearable
      disabled={disabled || assign.pending}
    />
  );
}

export function StatusControl({ editionId, ticketId, status, disabled }: { editionId: string; ticketId: string; status: 'open' | 'pending' | 'closed'; disabled: boolean }) {
  const router = useRouter();
  const set = useAction(setTicketStatusAction, { onSuccess: () => router.refresh() });
  return (
    <Select
      label="Status"
      data={[
        { value: 'open', label: 'Waiting for the team' },
        { value: 'pending', label: 'Waiting for the exhibitor' },
        { value: 'closed', label: 'Closed' },
      ]}
      value={status}
      onChange={(v) => v && set.run(editionId, ticketId, v as typeof status)}
      allowDeselect={false}
      disabled={disabled || set.pending}
    />
  );
}
