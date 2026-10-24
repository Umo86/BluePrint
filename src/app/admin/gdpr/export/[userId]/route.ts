import { getActorForApi } from '@/server/auth/current';
import { exportPersonData } from '@/server/services/gdpr';
import { AppError } from '@/server/errors';

export async function GET(_req: Request, ctx: RouteContext<'/admin/gdpr/export/[userId]'>) {
  const actor = await getActorForApi();
  if (!actor || !actor.isSuperAdmin || actor.readOnly) return new Response('Not found', { status: 404 });
  const { userId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new Response('Not found', { status: 404 });
  try {
    const data = await exportPersonData(actor, userId);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="blueprint-personal-data-${userId.slice(0, 8)}-${stamp}.json"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response('Not found', { status: 404 });
    throw err;
  }
}
