/**
 * The person a request acts for. Every service function takes an Actor explicitly,
 * so access checks never depend on hidden global state and are easy to test.
 */
export type Actor = {
  /** Effective user: the target user while viewing as someone else. */
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /** True while viewing as another user: every write is refused. */
  readOnly: boolean;
  /** The person actually signed in. */
  realUserId: string;
  realEmail: string;
  sessionId?: string;
  ip?: string | null;
  userAgent?: string | null;
};

/** For background jobs (cron, webhooks) that act on behalf of the platform. */
export const SYSTEM_ACTOR: Actor = {
  userId: '00000000-0000-0000-0000-000000000000',
  email: 'system@blueprint',
  name: 'BluePrint',
  isSuperAdmin: true,
  readOnly: false,
  realUserId: '00000000-0000-0000-0000-000000000000',
  realEmail: 'system@blueprint',
};

export function isSystemActor(actor: Actor) {
  return actor.userId === SYSTEM_ACTOR.userId;
}
