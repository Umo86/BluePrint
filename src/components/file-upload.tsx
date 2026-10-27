'use client';

import { useState } from 'react';
import { Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconCloudOff, IconCloudUpload, IconFile, IconX } from '@tabler/icons-react';
import { usePracticeUploads, useUploadsOn } from './uploads-context';
import { beginUploadAction, completeUploadAction, type UploadedFile } from '@/app/file-actions';
import { UPLOAD_RULES, formatBytes, type UploadPurpose } from '@/lib/upload-rules';

/** Matches PRACTICE_MAX_BYTES on the server. */
const PRACTICE_UPLOAD_BYTES = 4 * 1024 * 1024;

type Scope = { editionId?: string; standId?: string; companyId?: string; supplierId?: string };

function putWithProgress(url: string, file: File, contentType: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.send(file);
  });
}

/** Uploads one file: asks permission, sends the bytes, then has the server check what arrived. */
export async function uploadFile(file: File, purpose: UploadPurpose, scope: Scope, onProgress: (pct: number) => void = () => undefined): Promise<UploadedFile> {
  const begin = await beginUploadAction({ purpose, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, ...scope });
  if (!begin.ok || !begin.data) throw new Error(begin.ok ? 'Upload could not start.' : begin.error);
  await putWithProgress(begin.data.uploadUrl, file, begin.data.contentType, onProgress);
  const done = await completeUploadAction(begin.data.fileId);
  if (!done.ok || !done.data) throw new Error(done.ok ? 'Upload could not be checked.' : done.error);
  return done.data;
}

/** A drop area for uploading files, with progress and the server-side checks built in. */
export function FileUpload({
  purpose,
  scope,
  onUploaded,
  multiple = false,
  label,
  disabled,
}: {
  purpose: UploadPurpose;
  scope: Scope;
  onUploaded: (file: UploadedFile) => void;
  multiple?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const practice = usePracticeUploads();
  // In a demo show without file storage, files are kept in the database, so they are smaller.
  const rules = practice
    ? { ...UPLOAD_RULES[purpose], maxBytes: Math.min(UPLOAD_RULES[purpose].maxBytes, PRACTICE_UPLOAD_BYTES), label: UPLOAD_RULES[purpose].label.replace(/up to \d+ MB/, 'up to 4 MB in the demo shows') }
    : UPLOAD_RULES[purpose];
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const uploadsOn = useUploadsOn();

  if (!uploadsOn) {
    // Said up front rather than after someone has chosen a file.
    return (
      <Paper withBorder p="md" style={{ borderStyle: 'dashed' }}>
        <Group justify="center" gap="sm" mih={60} wrap="nowrap">
          <IconCloudOff size={28} aria-hidden />
          <div>
            <Text fz="sm" fw={600}>
              File uploads are not switched on yet
            </Text>
            <Text fz="xs" c="dimmed">
              Nothing can be uploaded on this site for now.
            </Text>
          </div>
        </Group>
      </Paper>
    );
  }

  const handle = async (list: File[]) => {
    for (const file of list) {
      if (file.size > rules.maxBytes) {
        notifications.show({ color: 'red', title: 'Too big', message: `${file.name} is ${formatBytes(file.size)}. Allowed: ${rules.label}.` });
        continue;
      }
      setProgress({ name: file.name, pct: 0 });
      try {
        const uploaded = await uploadFile(file, purpose, scope, (pct) => setProgress({ name: file.name, pct }));
        onUploaded(uploaded);
      } catch (err) {
        notifications.show({ color: 'red', title: 'Upload failed', message: err instanceof Error ? err.message : 'Please try again.' });
      } finally {
        setProgress(null);
      }
    }
  };

  return (
    <Stack gap={6}>
      <Dropzone
        onDrop={handle}
        onReject={(rejections) =>
          notifications.show({ color: 'red', title: 'Not accepted', message: `${rejections.map((r) => r.file.name).join(', ')}: allowed ${rules.label}.` })
        }
        maxSize={rules.maxBytes}
        multiple={multiple}
        disabled={disabled || Boolean(progress)}
        loading={Boolean(progress)}
        // Some files (DWG drawings, Illustrator, EPS, Photoshop) often have no browser type, so allow them by extension; the server checks the bytes.
        accept={rules.extensions ? { ...Object.fromEntries(rules.types.map((t) => [t, []])), 'application/octet-stream': rules.extensions } : rules.types}
        p="md"
      >
        <Group justify="center" gap="sm" mih={60} style={{ pointerEvents: 'none' }}>
          <Dropzone.Accept>
            <IconCloudUpload size={28} />
          </Dropzone.Accept>
          <Dropzone.Reject>
            <IconX size={28} />
          </Dropzone.Reject>
          <Dropzone.Idle>
            <IconFile size={28} />
          </Dropzone.Idle>
          <div>
            <Text fz="sm" fw={600}>
              {label ?? (multiple ? 'Drop files here or click to choose' : 'Drop a file here or click to choose')}
            </Text>
            <Text fz="xs" c="dimmed">
              {rules.label}
            </Text>
          </div>
        </Group>
      </Dropzone>
      {progress ? (
        <div>
          <Text fz="xs" c="dimmed">
            Uploading {progress.name}…
          </Text>
          <Progress value={progress.pct} size="sm" animated aria-label={`Uploading: ${progress.pct}%`} />
        </div>
      ) : null}
    </Stack>
  );
}
