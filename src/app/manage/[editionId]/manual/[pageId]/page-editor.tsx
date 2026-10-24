'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, MultiSelect, Paper, Select, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core';
import { RichTextEditor } from '@/components/rich-text-editor';
import { FileUpload } from '@/components/file-upload';
import { useAction } from '@/lib/use-action';
import { savePageAction, savePageToLibraryAction } from '../../../actions';

type Option = { value: string; label: string };
type Values = { title: string; bodyHtml: string; visibleToTypes: string[]; published: boolean; pinned: boolean; parentId: string | null };

function escapeText(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function PageEditor({
  editionId,
  pageId,
  initial,
  types,
  sections,
  canSaveToLibrary,
}: {
  editionId: string;
  pageId: string | null;
  initial: Values;
  types: Option[];
  sections: Option[];
  canSaveToLibrary: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const save = useAction(savePageAction, {
    onSuccess: (data) => {
      if (!pageId && data?.id) router.replace(`/manage/${editionId}/manual/${data.id}`);
    },
  });
  const toLibrary = useAction(savePageToLibraryAction);
  return (
    <SimpleGrid cols={{ base: 1, lg: 3 }}>
      <Paper withBorder p="md" style={{ gridColumn: 'span 2' }}>
        <Stack>
          <TextInput label="Title" required value={v.title} onChange={(e) => setV({ ...v, title: e.currentTarget.value })} error={save.fieldErrors.title} />
          <RichTextEditor label="Page content" value={v.bodyHtml} onChange={(html) => setV((x) => ({ ...x, bodyHtml: html }))} minHeight={360} />
          <div>
            <Text fz="sm" fw={600} mb={4}>
              Add a download
            </Text>
            <FileUpload
              purpose="manual"
              scope={{ editionId }}
              label="Drop a PDF or document here to add a download link to the page"
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
              description="Leave empty to show the page to every stand type."
              placeholder="Every stand type"
              data={types}
              value={v.visibleToTypes}
              onChange={(x) => setV({ ...v, visibleToTypes: x })}
            />
            <Select label="Section" description="Put this page inside another page." placeholder="Top level" data={sections} value={v.parentId} onChange={(x) => setV({ ...v, parentId: x })} clearable />
            <Switch label="Published" description="Exhibitors only see published pages." checked={v.published} onChange={(e) => setV({ ...v, published: e.currentTarget.checked })} />
            <Switch label="Pinned" description="Shown on the exhibitor dashboard." checked={v.pinned} onChange={(e) => setV({ ...v, pinned: e.currentTarget.checked })} />
            {save.error ? <Alert color="red">{save.error}</Alert> : null}
            <Group>
              <Button loading={save.pending} onClick={() => save.run(editionId, pageId, v)}>
                Save page
              </Button>
            </Group>
          </Stack>
        </Paper>
        {canSaveToLibrary && pageId ? (
          <Paper withBorder p="md">
            <Text fz="sm" mb="xs">
              Save this page as a template for other shows.
            </Text>
            <Button variant="light" size="xs" loading={toLibrary.pending} onClick={() => toLibrary.run(pageId)}>
              Save to library
            </Button>
          </Paper>
        ) : null}
      </Stack>
    </SimpleGrid>
  );
}
