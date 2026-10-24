import { getActorForApi } from '@/server/auth/current';
import { exportResponses } from '@/server/services/submissions';
import { AppError } from '@/server/errors';
import { toCsv } from '@/lib/csv';
import { slugify } from '@/lib/slug';

export async function GET(_req: Request, ctx: RouteContext<'/manage/[editionId]/tasks/[taskId]/export'>) {
  const { taskId } = await ctx.params;
  const actor = await getActorForApi();
  if (!actor || !/^[0-9a-f-]{36}$/i.test(taskId)) return new Response('Not found', { status: 404 });
  try {
    const { task, header, body } = await exportResponses(actor, taskId);
    return new Response('﻿' + toCsv([header, ...body]), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slugify(task.title) || 'task'}-responses.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response('Not found', { status: 404 });
    throw err;
  }
}
