'use server';

import { runAction, type ActionResult } from '@/server/actions';
import { unsubscribeWithToken } from '@/server/services/campaigns';
import { assertRateLimit } from '@/server/security/rate-limit';
import { requestContext } from '@/server/auth/current';
import { invalid } from '@/server/errors';

export async function unsubscribeAction(token: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requestContext();
    await assertRateLimit(`unsubscribe:${ctx.ip ?? 'unknown'}`, 60, 3600);
    const done = await unsubscribeWithToken(String(token ?? ''));
    if (!done) throw invalid('This unsubscribe link is not valid.');
  });
}
