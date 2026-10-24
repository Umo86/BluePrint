import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { safeEqual } from '@/server/security/crypto';
import { isCronJob, runCronJob } from '@/server/cron';

export const maxDuration = 300;

/**
 * Scheduled jobs. Only callers presenting CRON_SECRET (Vercel Cron sends it as a bearer token)
 * can run them; anything else gets "not found".
 */
export async function GET(req: Request, ctx: RouteContext<'/api/cron/[job]'>) {
  const { job } = await ctx.params;
  const secret = env().CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), secret) || !isCronJob(job)) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const result = await runCronJob(job);
    return NextResponse.json({ ok: true, job, result });
  } catch (err) {
    console.error(`Cron job ${job} failed`, err);
    return NextResponse.json({ ok: false, job }, { status: 500 });
  }
}
