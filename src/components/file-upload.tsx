'use client';

import { useState } from 'react';
import { Group, Progress, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconCloudUpload, IconFile, IconX } from '@tabler/icons-react';
import { beginUploadAction, completeUploadAction, type UploadedFile } from '@/app/file-actions';
import { UPLOAD_RULES, formatBytes, type UploadPurpose } from '@/lib/upload-rules';

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
  const rules = UPLOAD_RULES[purpose];
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);

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
        // DWG files have no standard browser type, so allow them by extension; the server checks the bytes.
        accept={rules.types.includes('image/vnd.dwg') ? { ...Object.fromEntries(rules.types.map((t) => [t, []])), 'application/octet-stream': ['.dwg'] } : rules.types}
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
          <Progress value={progress.pct} size="sm" animated />
        </div>
      ) : null}
    </Stack>
  );
}
