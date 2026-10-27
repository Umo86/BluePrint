import { getActorForApi } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { orderDocumentPdf } from '@/server/services/orders';
import { contentDisposition } from '@/server/storage';

/**
 * An order's VAT invoice or credit note, for the people who may see the order. A stored PDF is
 * served from its file link; while file storage is switched off the document is drawn from the
 * order instead, so it can always be downloaded.
 */
export async function GET(req: Request, ctx: RouteContext<'/files/documents/[id]'>) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const actor = await getActorForApi();
  if (!actor) return new Response('Not found', { status: 404 });
  let doc: Awaited<ReturnType<typeof orderDocumentPdf>>;
  try {
    doc = await orderDocumentPdf(actor, id);
  } catch (err) {
    if (err instanceof AppError && (err.code === 'not_found' || err.code === 'forbidden')) return new Response('Not found', { status: 404 });
    throw err;
  }
  if ('fileId' in doc) {
    const download = new URL(req.url).searchParams.get('download') === '1';
    return new Response(null, { status: 302, headers: { Location: `/files/${doc.fileId}${download ? '?download=1' : ''}`, 'Cache-Control': 'private, no-store' } });
  }
  return new Response(Buffer.from(doc.body), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(doc.body.byteLength),
      'Content-Disposition': contentDisposition(doc.filename, false),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
