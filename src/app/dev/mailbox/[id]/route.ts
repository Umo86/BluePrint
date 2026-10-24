import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { emailOutbox } from '@/server/db/schema';
import { devMailboxEnabled } from '@/server/dev';

export async function GET(_req: Request, ctx: RouteContext<'/dev/mailbox/[id]'>) {
  if (!devMailboxEnabled()) return new Response('Not found', { status: 404 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const db = await getDb();
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id)).limit(1);
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(row.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Email HTML is shown in a locked-down sandbox: no scripts, no forms.
      'Content-Security-Policy': "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
