import 'server-only';
import { after } from 'next/server';
import { env } from './env';

/**
 * Runs slow work, such as handing an email to Resend, after the reply has gone back to the browser.
 * Sign-in then takes the same time whether or not the address has an account, so timing cannot be
 * used to find out who is registered. Outside a request (tests, scripts), or when email is only
 * stored locally, the work simply runs straight away.
 */
export async function afterResponse(task: () => Promise<unknown>) {
  if (env().EMAIL_PROVIDER === 'resend') {
    try {
      after(async () => {
        try {
          await task();
        } catch (err) {
          console.error('Work after the response failed', err);
        }
      });
      return;
    } catch {
      // Not inside a request: run it now.
    }
  }
  await task();
}
