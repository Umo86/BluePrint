'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, MultiSelect, Paper, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { RichTextEditor } from '@/components/rich-text-editor';
import { FileUpload } from '@/components/file-upload';
import { useAction } from '@/lib/use-action';
import { emailAnnouncementAction, saveAnnouncementAction, type AnnouncementForm } from '../../../announcement-actions';

type Option = { value: string; label: string };

function escapeText(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function AnnouncementEditor({
  editionId,
  announcementId,
  initial,
  liveSince,
  types,
  canEmail,
}: {
  editionId: string;
  announcementId: string | null;
  initial: AnnouncementForm;
  liveSince: string | null;
  types: Option[];
  canEmail: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const save = useAction(saveAnnouncementAction, {
    onSuccess: (data) => {
      setSaved(v);
      if (!announcementId && data?.id) router.replace(`/manage/${editionId}/announcements/${data.id}`);
    },
  });
  const email = useAction(emailAnnouncementAction, {
    onSuccess: (data) => {
      if (data?.id) router.push(`/manage/${editionId}/emails/campaigns/${data.id}`);
    },
  });
  const whenHelp =
    v.when === 'draft'
      ? 'Exhibitors cannot see it yet.'
      : v.when === 'scheduled'
        ? 'It appears on the portal at this time.'
        : liveSince && initial.when === 'now'
          ? `On the portal since ${liveSince}.`
          : 'Exhibitors see it as soon as you save.';
  return (
    <SimpleGrid cols={{ base: 1, lg: 3 }}>
      <Paper withBorder p="md" style={{ gridColumn: 'span 2' }}>
        <Stack>
          <TextInput label="Title" required value={v.title} onChange={(e) => setV({ ...v, title: e.currentTarget.value })} error={save.fieldErrors.title} maxLength={200} />
          <RichTextEditor label="Message" value={v.bodyHtml} onChange={(html) => setV((x) => ({ ...x, bodyHtml: html }))} minHeight={220} />
          {save.fieldErrors.bodyHtml ? (
            <Text c="red" fz="sm">
              {save.fieldErrors.bodyHtml}
            </Text>
          ) : null}
          <div>
            <Text fz="sm" fw={600} mb={4}>
              Add a download
            </Text>
            <FileUpload
              purpose="manual"
              scope={{ editionId }}
              label="Drop a PDF or document here to add a download link"
              onUploaded={(f) => setV((x) => ({ ...x, bodyHtml: `${x.bodyHtml}<p><a href="/files/${f.fileId}">${escapeText(f.name)}</a></p>` }))}
            />
          </div>
        </Stack>
      </Paper>
      <Stack>
        <Paper withBorder p="md">
          <Stack>
            <MultiSelect
              label="Shown to"
              description="Leave empty to show it to every stand type."
              placeholder="Every stand type"
              data={types}
              value={v.visibleToTypes}
              onChange={(x) => setV({ ...v, visibleToTypes: x })}
            />
            <Switch label="Pinned" description="Kept at the top of the portal home page." checked={v.pinned} onChange={(e) => setV({ ...v, pinned: e.currentTarget.checked })} />
            <div>
              <Text fz="sm" fw={500} mb={4}>
                On the portal
              </Text>
              <SegmentedControl
                fullWidth
                value={v.when}
                onChange={(x) => setV({ ...v, when: x as AnnouncementForm['when'] })}
                data={[
                  { value: 'draft', label: 'Not yet' },
                  { value: 'now', label: 'Now' },
                  { value: 'scheduled', label: 'Later' },
                ]}
              />
              <Text fz="xs" c="dimmed" mt={4}>
                {whenHelp}
              </Text>
            </div>
            {v.when === 'scheduled' ? (
              <DateTimePicker
                label="Show from (UK time)"
                value={v.publishAt}
                onChange={(x) => setV({ ...v, publishAt: x })}
                minDate={new Date()}
                valueFormat="D MMM YYYY HH:mm"
                error={save.fieldErrors.publishAt}
              />
            ) : null}
            {save.error ? <Alert color="red">{save.error}</Alert> : null}
            <Group>
              <Button loading={save.pending} disabled={v.when === 'scheduled' && !v.publishAt} onClick={() => save.run(editionId, announcementId, v)}>
                Save announcement
              </Button>
            </Group>
          </Stack>
        </Paper>
        {canEmail && announcementId ? (
          <Paper withBorder p="md">
            <Text fz="sm" mb="xs">
              Email this announcement to the main contacts of the same stands. You check the email before it is sent.
            </Text>
            <Button variant="light" size="xs" loading={email.pending} disabled={dirty} onClick={() => email.run(editionId, announcementId)}>
              Email it to exhibitors…
            </Button>
            {dirty ? (
              <Text fz="xs" c="dimmed" mt={4}>
                Save your changes first.
              </Text>
            ) : null}
          </Paper>
        ) : null}
      </Stack>
    </SimpleGrid>
  );
}
