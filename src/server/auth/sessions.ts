import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { editionStaff, sessions, users } from '../db/schema';
import { randomToken, sha256Hex } from '../security/crypto';

/** Staff sign in again after 12 idle hours (7 days at most); everyone else stays signed in for 30 days. */
export const STAFF_IDLE_SECONDS = 12 * 3600;
export const STAFF_MAX_SECONDS = 7 * 24 * 3600;
export const MEMBER_IDLE_SECONDS = 30 * 24 * 3600;
export const MEMBER_MAX_SECONDS = 30 * 24 * 3600;
/** lastSeenAt is only written this often, to keep reads cheap. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionUser = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

/** Staff (super admins and anyone on a show team) must use two-factor sign-in. */
export async function isStaffUser(userId: string): Promise<boolean> {
  const db = await getDb();
  const [u] = await db.select({ isSuperAdmin: users.isSuperAdmin }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.isSuperAdmin) return true;
  const [s] = await db.select({ userId: editionStaff.userId }).from(editionStaff).where(eq(editionStaff.userId, userId)).limit(1);
  return Boolean(s);
}

export async function createSession(
  userId: string,
  opts: { ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date; session: SessionRow }> {
  const db = await getDb();
  const staff = await isStaffUser(userId);
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + (staff ? STAFF_MAX_SECONDS : MEMBER_MAX_SECONDS) * 1000);
  const [session] = await db
    .insert(sessions)
    .values({
      id: sha256Hex(token),
      userId,
      expiresAt,
      idleTimeoutSeconds: staff ? STAFF_IDLE_SECONDS : MEMBER_IDLE_SECONDS,
      // Staff must pass a two-factor check before the session unlocks anything.
      twoFactorVerified: !staff,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
    })
    .returning();
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return { token, expiresAt, session };
}

export type ValidSession = { session: SessionRow; user: SessionUser; viewAsUser: SessionUser | null };

/** Looks up a session token and checks it is still valid. Returns null for anything wrong. */
export async function validateSessionToken(token: string | undefined | null): Promise<ValidSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const db = await getDb();
  const id = sha256Hex(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  const { session, user } = row;
  const now = Date.now();
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= now) return null;
  if (session.lastSeenAt.getTime() + session.idleTimeoutSeconds * 1000 <= now) return null;
  if (user.status !== 'active' || user.anonymisedAt) return null;

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, id));
  }

  let viewAsUser: SessionUser | null = null;
  if (session.viewAsUserId) {
    const [target] = await db.select().from(users).where(eq(users.id, session.viewAsUserId)).limit(1);
    viewAsUser = target && target.status === 'active' ? target : null;
  }
  return { session, user, viewAsUser };
}

export async function revokeSession(sessionId: string) {
  const db = await getDb();
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

/** Signs a person out everywhere (optionally keeping the current session). */
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  const db = await getDb();
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, exceptSessionId))
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
  await db.update(sessions).set({ revokedAt: new Date() }).where(where);
}

export async function markSessionTwoFactorVerified(sessionId: string) {
  const db = await getDb();
  await db.update(sessions).set({ twoFactorVerified: true }).where(eq(sessions.id, sessionId));
}

export async function listActiveSessions(userId: string) {
  const db = await getDb();
  const rows = await db.select().from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  const now = Date.now();
  return rows.filter((s) => s.expiresAt.getTime() > now && s.lastSeenAt.getTime() + s.idleTimeoutSeconds * 1000 > now);
}
