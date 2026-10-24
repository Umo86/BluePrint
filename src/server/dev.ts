import 'server-only';
import { env, localProductionAllowed } from './env';

/**
 * The development mailbox only exists when emails are not really sent, on a developer's own
 * computer. It shows sign-in codes, so it can never appear on a site with a real address.
 */
export function devMailboxEnabled() {
  const e = env();
  if (e.EMAIL_PROVIDER !== 'outbox') return false;
  return e.NODE_ENV !== 'production' || localProductionAllowed();
}
