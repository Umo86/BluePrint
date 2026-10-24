import { NextResponse } from 'next/server';
import { getActorForApi } from '@/server/auth/current';
import { exportOrdersCsv } from '@/server/services/orders';
import { AppError } from '@/server/errors';

export async function GET(_req: Request, ctx: RouteContext<'/manage/[editionId]/orders/export'>) {
  const { editionId } = await ctx.params;
  const actor = await getActorForApi();
  if (!actor || !/^[0-9a-f-]{36}$/i.test(editionId)) return new NextResponse('Not found', { status: 404 });
  try {
    const csv = await exportOrdersCsv(actor, editionId);
    return new NextResponse(`﻿${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new NextResponse('Not found', { status: 404 });
    throw err;
  }
}
