import { getActorForApi } from '@/server/auth/current';
import { canReadFile, getFile } from '@/server/services/files';
import { contentDisposition, storage } from '@/server/storage';

const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Serves an uploaded file after checking the person may see it. Public files (branding, logos,
 * product photos) are open so they work in emails. Everything else needs a signed-in user with access.
 */
export async function GET(req: Request, ctx: RouteContext<'/files/[id]'>) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const file = await getFile(id);
  if (!file) return new Response('Not found', { status: 404 });
  const actor = file.isPublic ? null : await getActorForApi();
  if (!(await canReadFile(actor, file))) return new Response('Not found', { status: 404 });

  const wantsInline = new URL(req.url).searchParams.get('download') !== '1';
  const s = storage();
  if (s.presignGet) {
    // Served from the storage domain, so even inline PDFs never run on BluePrint's own origin.
    const inline = wantsInline && (INLINE_TYPES.has(file.mimeType) || file.mimeType === 'application/pdf');
    const url = await s.presignGet(file.storageKey, { filename: file.originalName, contentType: file.mimeType, inline, expiresSeconds: 60 });
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': file.isPublic ? 'public, max-age=30' : 'private, no-store' },
    });
  }
  const body = await s.stream(file.storageKey);
  if (!body) return new Response('Not found', { status: 404 });
  const inline = wantsInline && INLINE_TYPES.has(file.mimeType);
  return new Response(body, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': contentDisposition(file.originalName, inline),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': file.isPublic ? 'public, max-age=3600' : 'private, no-store',
      'Cross-Origin-Resource-Policy': file.isPublic ? 'cross-origin' : 'same-origin',
    },
  });
}
