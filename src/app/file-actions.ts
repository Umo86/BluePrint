'use server';

import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { beginUpload, completeUpload, type beginUploadSchema } from '@/server/services/files';
import type { z } from 'zod';

export type UploadedFile = { fileId: string; name: string; size: number; type: string; url: string };

export async function beginUploadAction(input: z.input<typeof beginUploadSchema>): Promise<ActionResult<{ fileId: string; uploadUrl: string; contentType: string }>> {
  return runAction(async () => beginUpload(await requireActor(), input));
}

export async function completeUploadAction(fileId: string): Promise<ActionResult<UploadedFile>> {
  return runAction(async () => {
    const row = await completeUpload(await requireActor(), String(fileId));
    return { fileId: row.id, name: row.originalName, size: row.sizeBytes, type: row.mimeType, url: `/files/${row.id}` };
  });
}
