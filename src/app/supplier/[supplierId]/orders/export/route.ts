import { getActorForApi } from '@/server/auth/current';
import { supplierOrdersCsv } from '@/server/services/orders';
import { AppError } from '@/server/errors';

export async function GET(_req: Request, ctx: RouteContext<'/supplier/[supplierId]/orders/export'>) {
  const { supplierId } = await ctx.params;
  const actor = await getActorForApi();
  if (!actor || !/^[0-9a-f-]{36}$/i.test(supplierId)) return new Response('Not found', { status: 404 });
  try {
    const csv = await supplierOrdersCsv(actor, supplierId, null);
    return new Response('﻿' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response('Not found', { status: 404 });
    throw err;
  }
}
