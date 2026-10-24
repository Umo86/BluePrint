import 'server-only';
import { env } from './env';

/** The development mailbox only exists when emails are not really sent. */
export function devMailboxEnabled() {
  const e = env();
  if (e.EMAIL_PROVIDER !== 'outbox') return false;
  return e.NODE_ENV !== 'production' || process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION === 'true';
}
