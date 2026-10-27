import { getActorForApi } from '@/server/auth/current';
import { receiveLocalUpload } from '@/server/services/files';
import { env } from '@/server/env';
import { AppError } from '@/server/errors';
import { PRACTICE_MAX_BYTES, storage } from '@/server/storage';

const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Receives upload bytes when files are stored on local disk (development), and for the demo shows
 * while file storage is not connected (kept in the database; `receiveLocalUpload` checks the file is
 * one of those). Otherwise uploads go straight to R2 with a short-lived signed URL instead.
 */
export async function PUT(req: Request, ctx: RouteContext<'/api/files/upload/[id]'>) {
  const local = env().STORAGE_PROVIDER === 'local' && storage().kind === 'local';
  if (!local && storage().kind !== 'off') return new Response('Not found', { status: 404 });
  const limit = local ? MAX_BYTES : PRACTICE_MAX_BYTES;
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return new Response('Forbidden', { status: 403 });
  const actor = await getActorForApi();
  if (!actor || actor.readOnly) return new Response('Not found', { status: 404 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > limit) return new Response('Too large', { status: 413 });

  // Read the body with a hard cap, whatever the headers said.
  const reader = req.body?.getReader();
  if (!reader) return new Response('No file', { status: 400 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) return new Response('Too large', { status: 413 });
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  try {
    await receiveLocalUpload(actor, id, body);
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.code === 'not_found' ? 404 : 400 });
    throw err;
  }
  return new Response(null, { status: 204 });
}
