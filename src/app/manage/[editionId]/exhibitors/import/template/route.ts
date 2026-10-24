import { getActorForApi } from '@/server/auth/current';
import { getEditionAccess } from '@/server/authz';
import { importTemplateCsv } from '@/server/services/exhibitor-import';

export async function GET(_req: Request, ctx: RouteContext<'/manage/[editionId]/exhibitors/import/template'>) {
  const { editionId } = await ctx.params;
  const actor = await getActorForApi();
  if (!actor || !/^[0-9a-f-]{36}$/i.test(editionId)) return new Response('Not found', { status: 404 });
  const access = await getEditionAccess(actor, editionId);
  if (!access?.permissions.has('manage_exhibitors')) return new Response('Not found', { status: 404 });
  return new Response('﻿' + importTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="blueprint-exhibitor-import-template.csv"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
