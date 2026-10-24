import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { RateLimitedError } from './security/rate-limit';

import type { ActionResult } from '@/lib/action-result';

export type { ActionResult };

/**
 * Wraps a server action body: known errors become friendly messages, anything unexpected is
 * logged and hidden behind a generic message (no stack traces or internals reach the browser).
 */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof RateLimitedError) return { ok: false, error: err.message };
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.');
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return { ok: false, error: 'Please check the highlighted fields.', fieldErrors };
    }
    console.error('Unexpected error in server action', err);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
