import 'server-only';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { getDb } from '../db/client';
import { loginCodes, users } from '../db/schema';
import { decryptSecret, encryptSecret, numericCode, safeEqual, sha256Hex } from '../security/crypto';
import { hashPassword, passwordProblems, verifyPassword } from '../security/password';
import { assertRateLimit } from '../security/rate-limit';
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from '../security/totp';
import { forbidden, invalid } from '../errors';
import { audit } from '../audit';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { env } from '../env';
import { revokeAllSessions } from './sessions';
import { afterResponse } from '../after-response';
import type { Actor } from './actor';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_PASSWORD_FAILURES = 10;
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;

const GENERIC_CODE_ERROR = 'That code is wrong or has expired. Request a new one and try again.';
const GENERIC_PASSWORD_ERROR =
  'That email and password do not match. After several wrong tries password sign-in pauses for 15 minutes, but you can always sign in with an emailed code.';

export type RequestContext = { ip?: string | null; userAgent?: string | null };

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function codeHash(email: string, code: string) {
  return sha256Hex(`${email}:${code}`);
}

function anonymousActor(email: string, ctx: RequestContext): Actor {
  return {
    userId: '00000000-0000-0000-0000-000000000001',
    email,
    name: '',
    isSuperAdmin: false,
    readOnly: false,
    realUserId: '00000000-0000-0000-0000-000000000001',
    realEmail: email,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

function userActor(user: typeof users.$inferSelect, ctx: RequestContext): Actor {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    readOnly: false,
    realUserId: user.id,
    realEmail: user.email,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

/** Creates a fresh six-digit code for an email address and emails it. Older codes stop working. */
export async function issueEmailCode(email: string, opts: { userId?: string | null; purpose: 'sign_in' | 'accept_invite'; ctx: RequestContext }) {
  const db = await getDb();
  await db
    .update(loginCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt)));
  const code = numericCode(6);
  await db.insert(loginCodes).values({
    email,
    codeHash: codeHash(email, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    ip: opts.ctx.ip ?? null,
  });
  const heading = opts.purpose === 'sign_in' ? 'Your BluePrint sign-in code' : 'Confirm your email for BluePrint';
  const { html, text } = renderSimpleEmail({
    heading,
    paragraphs: [
      `Your code is ${code}. It works once and expires in 10 minutes.`,
      opts.purpose === 'sign_in'
        ? 'If you did not ask to sign in, you can ignore this email. Nobody can sign in without the code.'
        : 'Enter it on the invitation page to finish setting up your account.',
    ],
    footer: 'BluePrint, the Media10 exhibitor manual.',
  });
  await sendEmail({
    to: email,
    toUserId: opts.userId ?? null,
    templateKey: 'sign_in_code',
    category: 'security',
    subject: `${code} is your BluePrint ${opts.purpose === 'sign_in' ? 'sign-in' : 'confirmation'} code`,
    html,
    text,
  });
}

/** Checks and uses up an emailed code. Throws a generic error when it does not match. */
export async function consumeEmailCode(email: string, codeRaw: string, ctx: RequestContext) {
  const code = codeRaw.replace(/\s/g, '');
  await assertRateLimit(`email-code-verify:ip:${ctx.ip ?? 'unknown'}`, 200, 15 * 60);
  if (!/^\d{6}$/.test(code)) throw invalid(GENERIC_CODE_ERROR);

  const db = await getDb();
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  // With no code waiting there is nothing to guess, so the address's own limits are not used up
  // (otherwise anyone could lock a person out of signing in by typing wrong codes for them).
  if (!row) throw invalid(GENERIC_CODE_ERROR);
  await assertRateLimit(`email-code-verify:email:${email}`, 10, 15 * 60);
  // A ceiling per day as well, so guessing cannot simply carry on window after window.
  await assertRateLimit(`email-code-verify:email-day:${email}`, 100, 24 * 3600);

  // Count the attempt in one step, so guesses sent at the same moment cannot all see the same count.
  const [counted] = await db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.consumedAt), lt(loginCodes.attempts, MAX_CODE_ATTEMPTS)))
    .returning({ id: loginCodes.id });
  if (!counted) {
    await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));
    throw invalid(GENERIC_CODE_ERROR);
  }

  if (!safeEqual(row.codeHash, codeHash(email, code))) {
    await audit(anonymousActor(email, ctx), 'auth.code_failed', { details: { email } });
    throw invalid(GENERIC_CODE_ERROR);
  }
  // Use the code up; if the right code arrives twice at once, only one wins.
  const [used] = await db
    .update(loginCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.consumedAt)))
    .returning({ id: loginCodes.id });
  if (!used) throw invalid(GENERIC_CODE_ERROR);
}

/**
 * Emails a six-digit sign-in code. Always behaves the same whether or not the address has an
 * account, so the form cannot be used to find out who is registered.
 */
export async function requestSignInCode(emailRaw: string, ctx: RequestContext): Promise<void> {
  const email = normaliseEmail(emailRaw);
  if (!isValidEmail(email)) throw invalid('Enter a valid email address.', { email: 'Enter a valid email address.' });
  // Five codes per address from each network every 15 minutes, so someone elsewhere cannot use up a
  // person's allowance; plus a ceiling per address per hour against email flooding.
  await assertRateLimit(`signin-code:email:${email}:ip:${ctx.ip ?? 'unknown'}`, 5, 15 * 60);
  await assertRateLimit(`signin-code:email-hour:${email}`, 30, 3600);
  // Generous per network, because a whole venue or office can share one internet address.
  await assertRateLimit(`signin-code:ip:${ctx.ip ?? 'unknown'}`, 100, 15 * 60);

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const known = user && user.status === 'active' && !user.anonymisedAt ? user : null;
  // The slow part (sending the email) happens after the reply either way, so the answer takes
  // the same time whether or not the address has an account.
  await afterResponse(async () => {
    if (!known) {
      await audit(anonymousActor(email, ctx), 'auth.code_requested_no_account', { details: { email } });
      return;
    }
    await issueEmailCode(email, { userId: known.id, purpose: 'sign_in', ctx });
    await audit(userActor(known, ctx), 'auth.code_requested', { entityType: 'user', entityId: known.id });
  });
}

/** Checks a sign-in code. Returns the user on success. */
export async function verifySignInCode(emailRaw: string, codeRaw: string, ctx: RequestContext) {
  const email = normaliseEmail(emailRaw);
  await consumeEmailCode(email, codeRaw, ctx);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== 'active') throw invalid(GENERIC_CODE_ERROR);
  await audit(userActor(user, ctx), 'auth.sign_in', { entityType: 'user', entityId: user.id, details: { method: 'email_code' } });
  return user;
}

// A real argon2id hash of a random string, so unknown emails take as long as known ones.
let dummyHash: string | null = null;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing-only');
  return dummyHash;
}

export async function signInWithPassword(emailRaw: string, password: string, ctx: RequestContext) {
  const email = normaliseEmail(emailRaw);
  await assertRateLimit(`signin-password:email:${email}`, 20, 15 * 60);
  await assertRateLimit(`signin-password:ip:${ctx.ip ?? 'unknown'}`, 50, 15 * 60);

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.passwordHash || user.status !== 'active') {
    await verifyPassword(await getDummyHash(), password);
    throw invalid(GENERIC_PASSWORD_ERROR);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    // The same message as a wrong password, so the pause does not reveal that the account exists.
    await verifyPassword(await getDummyHash(), password);
    throw invalid(GENERIC_PASSWORD_ERROR);
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failures = user.failedPasswordAttempts + 1;
    await db
      .update(users)
      .set({
        failedPasswordAttempts: failures >= MAX_PASSWORD_FAILURES ? 0 : failures,
        lockedUntil: failures >= MAX_PASSWORD_FAILURES ? new Date(Date.now() + PASSWORD_LOCK_MS) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    await audit(userActor(user, ctx), failures >= MAX_PASSWORD_FAILURES ? 'auth.password_locked' : 'auth.password_failed', {
      entityType: 'user',
      entityId: user.id,
    });
    throw invalid(GENERIC_PASSWORD_ERROR);
  }
  await db.update(users).set({ failedPasswordAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await audit(userActor(user, ctx), 'auth.sign_in', { entityType: 'user', entityId: user.id, details: { method: 'password' } });
  return user;
}

/** Password changes need a sign-in from the last few minutes, so a borrowed or stolen session cannot make one. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

function assertRecentSignIn(session: { createdAt: Date } | null | undefined) {
  if (!session || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MS) {
    throw invalid('For your security, sign out and sign in again, then change your password within 15 minutes.');
  }
}

/** Tells the person about a change to how they sign in, in case it was not them. */
async function sendSecurityNotice(actor: Actor, heading: string, what: string) {
  const { html, text } = renderSimpleEmail({
    heading,
    paragraphs: [what, 'If this was not you, sign in with an emailed code straight away and contact the Media10 show team.'],
    footer: 'BluePrint, the Media10 exhibitor manual.',
  });
  await sendEmail({ to: actor.email, toUserId: actor.userId, templateKey: 'security_notice', category: 'security', subject: heading, html, text });
}

export async function setPassword(actor: Actor, newPassword: string, currentSession?: { id: string; createdAt: Date } | null) {
  if (actor.readOnly) throw invalid('Changes are switched off while viewing as someone else.');
  assertRecentSignIn(currentSession);
  const problem = passwordProblems(newPassword, actor.email);
  if (problem) throw invalid(problem, { password: problem });
  const db = await getDb();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), failedPasswordAttempts: 0, lockedUntil: null })
    .where(eq(users.id, actor.userId));
  // Changing a password signs out every other device.
  await revokeAllSessions(actor.userId, currentSession?.id);
  await audit(actor, 'auth.password_set', { entityType: 'user', entityId: actor.userId });
  await sendSecurityNotice(actor, 'Your BluePrint password was set', 'A password was just set for your BluePrint account, and your other devices were signed out.');
}

export async function removePassword(actor: Actor, currentSession?: { id: string; createdAt: Date } | null) {
  if (actor.readOnly) throw invalid('Changes are switched off while viewing as someone else.');
  assertRecentSignIn(currentSession);
  const db = await getDb();
  await db.update(users).set({ passwordHash: null }).where(eq(users.id, actor.userId));
  await audit(actor, 'auth.password_removed', { entityType: 'user', entityId: actor.userId });
  await sendSecurityNotice(actor, 'Your BluePrint password was removed', 'The password on your BluePrint account was just removed. You will sign in with emailed codes.');
}

// ---------------------------------------------------------------------------
// Two-factor (TOTP authenticator apps + recovery codes)
// ---------------------------------------------------------------------------

export async function beginTotpEnrollment(actor: Actor) {
  if (actor.readOnly) throw invalid('Changes are switched off while viewing as someone else.');
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  if (!user) throw invalid('Account not found.');
  if (user.totpEnabledAt) throw invalid('Two-factor sign-in is already set up.');
  // Reuse a set-up that was started but not finished (for example after a page refresh), so the
  // code the person already added to their app keeps working.
  let secret = user.totpSecretEnc ? decryptSecret(user.totpSecretEnc) : null;
  if (!secret) {
    secret = generateTotpSecret();
    await db.update(users).set({ totpSecretEnc: encryptSecret(secret), totpLastStep: null }).where(eq(users.id, user.id));
  }
  const uri = otpauthUri(secret, user.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { secret, uri, qrDataUrl };
}

export async function confirmTotpEnrollment(actor: Actor, code: string, currentSession?: { createdAt: Date } | null): Promise<string[]> {
  if (actor.readOnly) throw invalid('Changes are switched off while viewing as someone else.');
  // Like a password change: a borrowed session must not be able to lock the owner out.
  if (!currentSession || Date.now() - currentSession.createdAt.getTime() > RECENT_SIGN_IN_MS) {
    throw invalid('For your security, sign out and sign in again, then turn on two-factor sign-in within 15 minutes.');
  }
  await assertRateLimit(`totp-enrol:${actor.userId}`, 10, 15 * 60);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  if (!user?.totpSecretEnc) throw invalid('Start the set-up again.');
  if (user.totpEnabledAt) throw invalid('Two-factor sign-in is already set up.');
  const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, null);
  if (step === null) throw invalid('That code did not match. Check the time on your phone and try the newest code.');
  const recovery = generateRecoveryCodes();
  await db
    .update(users)
    .set({ totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: recovery.map((c) => sha256Hex(c)) })
    .where(eq(users.id, user.id));
  // Other devices signed in without two-factor; they must sign in again with it.
  await revokeAllSessions(user.id, actor.sessionId);
  await audit(actor, 'auth.2fa_enabled', { entityType: 'user', entityId: user.id });
  await sendSecurityNotice(actor, 'Two-factor sign-in is on', 'Two-factor sign-in was just turned on for your BluePrint account. Other devices were signed out.');
  return recovery;
}

/** Checks a TOTP or recovery code for the signed-in user. Returns true when it matches. */
export async function verifySecondFactor(userId: string, codeRaw: string, ctx: RequestContext): Promise<boolean> {
  await assertRateLimit(`2fa:${userId}`, 10, 15 * 60);
  await assertRateLimit(`2fa-day:${userId}`, 40, 24 * 3600);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.totpSecretEnc || !user.totpEnabledAt) return false;
  const code = codeRaw.trim().toLowerCase();

  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
    const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, user.totpLastStep ?? null);
    if (step === null) {
      await audit(userActor(user, ctx), 'auth.2fa_failed', { entityType: 'user', entityId: user.id });
      return false;
    }
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
    await audit(userActor(user, ctx), 'auth.2fa_passed', { entityType: 'user', entityId: user.id, details: { method: 'totp' } });
    return true;
  }

  const hash = sha256Hex(code.replace(/\s/g, ''));
  if (user.recoveryCodeHashes.includes(hash)) {
    await db
      .update(users)
      .set({ recoveryCodeHashes: user.recoveryCodeHashes.filter((h) => h !== hash) })
      .where(eq(users.id, user.id));
    await audit(userActor(user, ctx), 'auth.2fa_passed', {
      entityType: 'user',
      entityId: user.id,
      details: { method: 'recovery_code', remaining: user.recoveryCodeHashes.length - 1 },
    });
    return true;
  }
  await audit(userActor(user, ctx), 'auth.2fa_failed', { entityType: 'user', entityId: user.id });
  return false;
}

/** Super admins only: clears someone's two-factor set-up after checking who they are. */
export async function resetTwoFactor(actor: Actor, userId: string) {
  if (!actor.isSuperAdmin || actor.readOnly) throw forbidden();
  if (userId === actor.realUserId) throw forbidden('Ask another super admin to reset your two-factor sign-in.');
  const db = await getDb();
  await db
    .update(users)
    .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] })
    .where(eq(users.id, userId));
  await revokeAllSessions(userId);
  await audit(actor, 'auth.2fa_reset', { entityType: 'user', entityId: userId });
}

export function appUrl(path = '/') {
  return new URL(path, env().APP_URL).toString();
}
