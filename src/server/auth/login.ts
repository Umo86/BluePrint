import 'server-only';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import QRCode from 'qrcode';
import { getDb } from '../db/client';
import { loginCodes, users } from '../db/schema';
import { decryptSecret, encryptSecret, numericCode, safeEqual, sha256Hex } from '../security/crypto';
import { hashPassword, passwordProblems, verifyPassword } from '../security/password';
import { assertRateLimit } from '../security/rate-limit';
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from '../security/totp';
import { invalid } from '../errors';
import { audit } from '../audit';
import { sendEmail } from '../email/send';
import { renderSimpleEmail } from '../email/simple';
import { env } from '../env';
import { revokeAllSessions } from './sessions';
import type { Actor } from './actor';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_PASSWORD_FAILURES = 10;
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;

const GENERIC_CODE_ERROR = 'That code is wrong or has expired. Request a new one and try again.';
const GENERIC_PASSWORD_ERROR = 'That email and password do not match.';

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
  await assertRateLimit(`email-code-verify:email:${email}`, 10, 15 * 60);
  await assertRateLimit(`email-code-verify:ip:${ctx.ip ?? 'unknown'}`, 50, 15 * 60);
  if (!/^\d{6}$/.test(code)) throw invalid(GENERIC_CODE_ERROR);

  const db = await getDb();
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!row) throw invalid(GENERIC_CODE_ERROR);

  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));
    throw invalid(GENERIC_CODE_ERROR);
  }
  await db.update(loginCodes).set({ attempts: row.attempts + 1 }).where(eq(loginCodes.id, row.id));

  if (!safeEqual(row.codeHash, codeHash(email, code))) {
    await audit(anonymousActor(email, ctx), 'auth.code_failed', { details: { email } });
    throw invalid(GENERIC_CODE_ERROR);
  }
  await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));
}

/**
 * Emails a six-digit sign-in code. Always behaves the same whether or not the address has an
 * account, so the form cannot be used to find out who is registered.
 */
export async function requestSignInCode(emailRaw: string, ctx: RequestContext): Promise<void> {
  const email = normaliseEmail(emailRaw);
  if (!isValidEmail(email)) throw invalid('Enter a valid email address.', { email: 'Enter a valid email address.' });
  await assertRateLimit(`signin-code:email:${email}`, 5, 15 * 60);
  await assertRateLimit(`signin-code:ip:${ctx.ip ?? 'unknown'}`, 30, 15 * 60);

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== 'active' || user.anonymisedAt) {
    await audit(anonymousActor(email, ctx), 'auth.code_requested_no_account', { details: { email } });
    return;
  }
  await issueEmailCode(email, { userId: user.id, purpose: 'sign_in', ctx });
  await audit(userActor(user, ctx), 'auth.code_requested', { entityType: 'user', entityId: user.id });
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
    throw invalid('Too many wrong passwords. Wait 15 minutes, or sign in with an email code instead.');
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

export async function setPassword(actor: Actor, newPassword: string, currentSessionId?: string) {
  if (actor.readOnly) throw invalid('Changes are switched off while viewing as someone else.');
  const problem = passwordProblems(newPassword, actor.email);
  if (problem) throw invalid(problem, { password: problem });
  const db = await getDb();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), failedPasswordAttempts: 0, lockedUntil: null })
    .where(eq(users.id, actor.userId));
  // Changing a password signs out every other device.
  await revokeAllSessions(actor.userId, currentSessionId);
  await audit(actor, 'auth.password_set', { entityType: 'user', entityId: actor.userId });
}

export async function removePassword(actor: Actor) {
  if (actor.readOnly) throw invalid('Changes are switched off while viewing as someone else.');
  const db = await getDb();
  await db.update(users).set({ passwordHash: null }).where(eq(users.id, actor.userId));
  await audit(actor, 'auth.password_removed', { entityType: 'user', entityId: actor.userId });
}

// ---------------------------------------------------------------------------
// Two-factor (TOTP authenticator apps + recovery codes)
// ---------------------------------------------------------------------------

export async function beginTotpEnrollment(actor: Actor) {
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  if (!user) throw invalid('Account not found.');
  if (user.totpEnabledAt) throw invalid('Two-factor sign-in is already set up.');
  const secret = generateTotpSecret();
  await db.update(users).set({ totpSecretEnc: encryptSecret(secret), totpLastStep: null }).where(eq(users.id, user.id));
  const uri = otpauthUri(secret, user.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { secret, uri, qrDataUrl };
}

export async function confirmTotpEnrollment(actor: Actor, code: string): Promise<string[]> {
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
  await audit(actor, 'auth.2fa_enabled', { entityType: 'user', entityId: user.id });
  return recovery;
}

/** Checks a TOTP or recovery code for the signed-in user. Returns true when it matches. */
export async function verifySecondFactor(userId: string, codeRaw: string, ctx: RequestContext): Promise<boolean> {
  await assertRateLimit(`2fa:${userId}`, 10, 15 * 60);
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

/** Super admin support action: clears a user's two-factor so they can set it up again. */
export async function resetTwoFactor(actor: Actor, userId: string) {
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
