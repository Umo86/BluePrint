import { NextResponse } from 'next/server';
import { unsubscribeWithToken } from '@/server/services/campaigns';

/**
 * One-click unsubscribe (RFC 8058): mail apps call this with POST when someone presses their
 * built-in "unsubscribe" button. The signed token says who and for which show.
 */
export async function POST(_req: Request, ctx: RouteContext<'/api/unsubscribe/[token]'>) {
  const { token } = await ctx.params;
  const done = await unsubscribeWithToken(token);
  if (!done) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ unsubscribed: true });
}
