'use client';

import { useState } from 'react';
import { Button, CopyButton, Group, Paper, ScrollArea, SegmentedControl, Stack, Text } from '@mantine/core';

/**
 * Shows a rendered email: as it looks (in a sandboxed frame that cannot run anything), as HTML
 * (for checking or copying), and as the plain-text version.
 */
export function EmailPreview({ preview, loading, onRefresh }: { preview: { subject: string; html: string; text: string } | null; loading: boolean; onRefresh: () => void }) {
  const [view, setView] = useState<'preview' | 'html' | 'text'>('preview');
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between">
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => setView(v as typeof view)}
            data={[
              { value: 'preview', label: 'Preview' },
              { value: 'html', label: 'HTML' },
              { value: 'text', label: 'Plain text' },
            ]}
          />
          <Button size="xs" variant="default" loading={loading} onClick={onRefresh}>
            Refresh preview
          </Button>
        </Group>
        {preview ? (
          <>
            <Text fz="sm">
              <strong>Subject:</strong> {preview.subject}
            </Text>
            {view === 'preview' ? (
              <iframe title="Email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 640, border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6, background: '#fff' }} />
            ) : view === 'html' ? (
              <Stack gap={4}>
                <Group justify="flex-end">
                  <CopyButton value={preview.html}>{({ copied, copy }) => <Button size="xs" variant="light" onClick={copy}>{copied ? 'Copied' : 'Copy HTML'}</Button>}</CopyButton>
                </Group>
                <ScrollArea h={600}>
                  <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{preview.html}</pre>
                </ScrollArea>
              </Stack>
            ) : (
              <ScrollArea h={600}>
                <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>{preview.text}</pre>
              </ScrollArea>
            )}
          </>
        ) : (
          <Text fz="sm" c="dimmed">
            Press “Refresh preview” to see the email.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
