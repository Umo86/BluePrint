'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, CloseButton, Group, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconPaperclip } from '@tabler/icons-react';
import { FileUpload } from '@/components/file-upload';
import { useAction } from '@/lib/use-action';
import { closeTicketAction, openTicketAction, replyTicketAction } from '../../help-actions';

type Attachment = { fileId: string; name: string };

function Attachments({ standId, files, onChange, disabled }: { standId: string; files: Attachment[]; onChange: (f: Attachment[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap={6}>
      {files.map((f) => (
        <Group key={f.fileId} gap={6}>
          <IconPaperclip size={14} />
          <Text fz="sm">{f.name}</Text>
          <CloseButton size="sm" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((x) => x.fileId !== f.fileId))} />
        </Group>
      ))}
      {open ? (
        <FileUpload purpose="ticket" scope={{ standId }} label="Drop a PDF or an image here" onUploaded={(f) => onChange([...files, { fileId: f.fileId, name: f.name }].slice(0, 5))} disabled={disabled} />
      ) : files.length < 5 ? (
        <Button variant="subtle" size="compact-sm" leftSection={<IconPaperclip size={14} />} onClick={() => setOpen(true)} disabled={disabled} style={{ alignSelf: 'flex-start' }}>
          Attach a file
        </Button>
      ) : null}
    </Stack>
  );
}

export function AskTeamForm({ slug, standId, readOnly }: { slug: string; standId: string; readOnly: boolean }) {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [phone, setPhone] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const send = useAction(openTicketAction, { onSuccess: (d) => d && router.push(`/portal/${slug}/help/${d.id}`) });
  if (readOnly) return <Alert color="gray">You are viewing as someone else, so you cannot send questions.</Alert>;
  return (
    <Stack>
      <TextInput label="Subject" required value={subject} onChange={(e) => setSubject(e.currentTarget.value)} maxLength={150} error={send.fieldErrors.subject} />
      <Textarea label="Your question" required autosize minRows={4} maxRows={12} value={body} onChange={(e) => setBody(e.currentTarget.value)} maxLength={5000} error={send.fieldErrors.body} />
      <TextInput label="Phone (optional)" description="If it is easier for the team to call you." value={phone} onChange={(e) => setPhone(e.currentTarget.value)} maxLength={40} />
      <Attachments standId={standId} files={files} onChange={setFiles} />
      <Group>
        <Button loading={send.pending} onClick={() => send.run(slug, standId, { subject, body, phone: phone || null, attachments: files.map((f) => f.fileId) })}>
          Send to the show team
        </Button>
      </Group>
    </Stack>
  );
}

export function ReplyForm({ slug, standId, ticketId, closed, readOnly }: { slug: string; standId: string; ticketId: string; closed: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const reply = useAction(replyTicketAction, {
    onSuccess: () => {
      setBody('');
      setFiles([]);
      router.refresh();
    },
  });
  const close = useAction(closeTicketAction, { onSuccess: () => router.refresh() });
  if (readOnly) return null;
  return (
    <Stack>
      <Textarea
        label={closed ? 'Reopen with a new message' : 'Reply'}
        autosize
        minRows={3}
        maxRows={10}
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        maxLength={5000}
        error={reply.fieldErrors.body}
      />
      <Attachments standId={standId} files={files} onChange={setFiles} />
      <Group>
        <Button loading={reply.pending} disabled={!body.trim()} onClick={() => reply.run(slug, standId, ticketId, { body, attachments: files.map((f) => f.fileId) })}>
          Send
        </Button>
        {!closed ? (
          <Button variant="default" loading={close.pending} onClick={() => close.run(slug, standId, ticketId)}>
            Mark as solved
          </Button>
        ) : null}
      </Group>
    </Stack>
  );
}
