import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, invitations, loginCodes, sessions, standContractors, users, companyMembers, editionStaff } from '@/server/db/schema';
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  removePassword,
  requestSignInCode,
  setPassword,
  signInWithPassword,
  verifySecondFactor,
  verifySignInCode,
} from '@/server/auth/login';
import { createSession, revokeAllSessions, validateSessionToken, STAFF_IDLE_SECONDS } from '@/server/auth/sessions';
import { acceptInvitation, createInvitation, findInvitation, sendInvitationCode } from '@/server/auth/invitations';
import { totpCode } from '@/server/security/totp';
import { decryptSecret } from '@/server/security/crypto';
import { actorFor, codeFromEmail, lastEmailTo, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

const ctx = { ip: '10.0.0.1', userAgent: 'vitest' };

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

describe('sign-in with an emailed code', () => {
  it('emails a code and signs the person in with it, once', async () => {
    const u = await makeUser({ email: 'code.person@example.com' });
    await requestSignInCode('Code.Person@Example.com ', ctx);
    const mail = await lastEmailTo('code.person@example.com');
    expect(mail.category).toBe('security');
    const code = codeFromEmail(mail.subject);
    const signedIn = await verifySignInCode('code.person@example.com', code, ctx);
    expect(signedIn.id).toBe(u.id);
    await expect(verifySignInCode('code.person@example.com', code, ctx)).rejects.toThrow(/wrong or has expired/);
  });

  it('gives no hint whether an account exists', async () => {
    await expect(requestSignInCode('nobody@example.com', ctx)).resolves.toBeUndefined();
    expect(await lastEmailTo('nobody@example.com')).toBeUndefined();
  });

  it('locks a code after five wrong guesses', async () => {
    await makeUser({ email: 'guesser@example.com' });
    await requestSignInCode('guesser@example.com', ctx);
    const code = codeFromEmail((await lastEmailTo('guesser@example.com')).subject);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(verifySignInCode('guesser@example.com', wrong, ctx)).rejects.toThrow();
    }
    // Even the right code no longer works.
    await expect(verifySignInCode('guesser@example.com', code, ctx)).rejects.toThrow();
  });

  it('rejects expired codes', async () => {
    await makeUser({ email: 'late@example.com' });
    await requestSignInCode('late@example.com', ctx);
    const code = codeFromEmail((await lastEmailTo('late@example.com')).subject);
    const db = await getDb();
    await db.update(loginCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginCodes.email, 'late@example.com'));
    await expect(verifySignInCode('late@example.com', code, ctx)).rejects.toThrow();
  });

  it('refuses disabled accounts', async () => {
    await makeUser({ email: 'disabled@example.com', status: 'disabled' });
    await requestSignInCode('disabled@example.com', ctx);
    expect(await lastEmailTo('disabled@example.com')).toBeUndefined();
  });

  it('rate-limits code requests per email', async () => {
    await makeUser({ email: 'spammy@example.com' });
    for (let i = 0; i < 5; i++) await requestSignInCode('spammy@example.com', ctx);
    await expect(requestSignInCode('spammy@example.com', ctx)).rejects.toThrow(/Too many attempts/);
  });
});

describe('passwords', () => {
  it('signs in with a password and locks after ten failures', async () => {
    const u = await makeUser({ email: 'pw@example.com' });
    await setPassword(actorFor(u), 'a long and unusual passphrase', { id: 'this-browser', createdAt: new Date() });
    expect((await signInWithPassword('pw@example.com', 'a long and unusual passphrase', ctx)).id).toBe(u.id);
    for (let i = 0; i < 9; i++) {
      await expect(signInWithPassword('pw@example.com', 'wrong password here', { ip: `10.1.0.${i}` })).rejects.toThrow(/do not match/);
    }
    await expect(signInWithPassword('pw@example.com', 'wrong password here', { ip: '10.2.0.1' })).rejects.toThrow();
    // Even the right password is refused during the pause, with the same message as a wrong one,
    // so the pause does not show that the account exists.
    await expect(signInWithPassword('pw@example.com', 'a long and unusual passphrase', { ip: '10.3.0.1' })).rejects.toThrow(/do not match/);
    const db = await getDb();
    const [locked] = await db.select().from(users).where(eq(users.id, u.id));
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives the same answer for unknown emails', async () => {
    await expect(signInWithPassword('ghost@example.com', 'whatever whatever', ctx)).rejects.toThrow(/do not match/);
  });

  it('rejects weak passwords', async () => {
    const u = await makeUser();
    await expect(setPassword(actorFor(u), 'password1234', { id: 'this-browser', createdAt: new Date() })).rejects.toThrow(/too common/);
  });
});

describe('sessions', () => {
  it('validates a fresh session and stores only a hash of the token', async () => {
    const u = await makeUser();
    const { token, session } = await createSession(u.id, ctx);
    expect(session.id).not.toBe(token);
    const v = await validateSessionToken(token);
    expect(v?.user.id).toBe(u.id);
    expect(v?.session.twoFactorVerified).toBe(true);
  });

  it('requires two-factor for staff and uses shorter timeouts', async () => {
    const { edition } = await makeEdition();
    const staff = await makeStaff(edition.id, 'show_admin');
    const { session } = await createSession(staff.id, ctx);
    expect(session.twoFactorVerified).toBe(false);
    expect(session.idleTimeoutSeconds).toBe(STAFF_IDLE_SECONDS);
  });

  it('rejects revoked, expired, idle and disabled sessions', async () => {
    const db = await getDb();
    const u = await makeUser();
    const a = await createSession(u.id, ctx);
    await revokeAllSessions(u.id);
    expect(await validateSessionToken(a.token)).toBeNull();

    const b = await createSession(u.id, ctx);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(sessions.id, b.session.id));
    expect(await validateSessionToken(b.token)).toBeNull();

    const c = await createSession(u.id, ctx);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) }).where(eq(sessions.id, c.session.id));
    expect(await validateSessionToken(c.token)).toBeNull();

    const d = await createSession(u.id, ctx);
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, u.id));
    expect(await validateSessionToken(d.token)).toBeNull();
  });

  it('ignores junk tokens', async () => {
    expect(await validateSessionToken('')).toBeNull();
    expect(await validateSessionToken('x'.repeat(500))).toBeNull();
    expect(await validateSessionToken('not-a-real-token-but-long-enough')).toBeNull();
  });

  it('changing a password signs out other devices and tells the person', async () => {
    const u = await makeUser();
    const s1 = await createSession(u.id, ctx);
    const s2 = await createSession(u.id, ctx);
    await setPassword(actorFor(u), 'another long passphrase here', s2.session);
    expect(await validateSessionToken(s1.token)).toBeNull();
    expect(await validateSessionToken(s2.token)).not.toBeNull();
    expect((await lastEmailTo(u.email)).subject).toBe('Your BluePrint password was set');
  });

  it('only lets a recent sign-in set or remove a password', async () => {
    const u = await makeUser();
    const { session } = await createSession(u.id, ctx);
    const old = { ...session, createdAt: new Date(Date.now() - 16 * 60 * 1000) };
    await expect(setPassword(actorFor(u), 'another long passphrase here', old)).rejects.toThrow(/sign in again/);
    await expect(setPassword(actorFor(u), 'another long passphrase here', null)).rejects.toThrow(/sign in again/);
    await expect(removePassword(actorFor(u), old)).rejects.toThrow(/sign in again/);
  });
});

describe('two-factor', () => {
  it('enrols an authenticator, then accepts TOTP and single-use recovery codes', async () => {
    const u = await makeUser({ isSuperAdmin: true });
    const actor = actorFor(u);
    const { secret } = await beginTotpEnrollment(actor);
    const db = await getDb();
    const [stored] = await db.select().from(users).where(eq(users.id, u.id));
    expect(stored.totpSecretEnc).not.toContain(secret);
    expect(decryptSecret(stored.totpSecretEnc!)).toBe(secret);

    await expect(confirmTotpEnrollment(actor, '000000')).rejects.toThrow();
    const recovery = await confirmTotpEnrollment(actor, totpCode(secret));
    expect(recovery).toHaveLength(10);

    // The code used for enrolment cannot be replayed.
    expect(await verifySecondFactor(u.id, totpCode(secret), ctx)).toBe(false);
    expect(await verifySecondFactor(u.id, recovery[0], ctx)).toBe(true);
    expect(await verifySecondFactor(u.id, recovery[0], ctx)).toBe(false);
  });

  it('applies to exhibitors and suppliers who turn it on, and signs out their other devices', async () => {
    const u = await makeUser();
    const before = await createSession(u.id, ctx);
    expect(before.session.twoFactorVerified).toBe(true);
    const current = await createSession(u.id, ctx);
    const actor = actorFor(u, { sessionId: current.session.id });
    const { secret } = await beginTotpEnrollment(actor);
    await confirmTotpEnrollment(actor, totpCode(secret));
    // The device that set it up stays signed in; the other one has to sign in again.
    expect(await validateSessionToken(before.token)).toBeNull();
    expect(await validateSessionToken(current.token)).not.toBeNull();
    // From now on a new sign-in is locked until the second factor is passed.
    const after = await createSession(u.id, ctx);
    expect(after.session.twoFactorVerified).toBe(false);
  });
});

describe('invitations', () => {
  it('lets a show admin invite an exhibitor, who signs in from the link once', async () => {
    const { edition, shell } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const { company } = await makeExhibitor(edition.id, shell.id, 'B10');
    const { token, invitation } = await createInvitation(actorFor(admin), {
      kind: 'exhibitor',
      email: 'New.Exhibitor@Example.com',
      editionId: edition.id,
      companyId: company.id,
      role: 'main_contact',
    });
    expect(invitation.tokenHash).not.toBe(token);
    const mail = await lastEmailTo('new.exhibitor@example.com');
    expect(mail.html).toContain(`/invite/${token}`);

    const found = await findInvitation(token);
    expect(found?.needsEmailCode).toBe(true);
    // The link alone is not enough: the person confirms the address with an emailed code.
    await expect(acceptInvitation(token, { name: 'New Exhibitor' }, ctx)).rejects.toThrow(/Enter the code/);
    await sendInvitationCode(token, ctx);
    const code = codeFromEmail((await lastEmailTo('new.exhibitor@example.com')).subject);
    const user = await acceptInvitation(token, { name: 'New Exhibitor', code }, ctx);
    const db = await getDb();
    const members = await db.select().from(companyMembers).where(eq(companyMembers.userId, user.id));
    expect(members[0]).toMatchObject({ companyId: company.id, role: 'main_contact' });
    await expect(acceptInvitation(token, { name: 'Again' }, ctx)).rejects.toThrow(/expired or has already been used/);
  });

  it('does not let a show team member without exhibitor rights invite exhibitors', async () => {
    const { edition, shell } = await makeEdition();
    const viewer = await makeStaff(edition.id, 'show_team', ['view']);
    const { company } = await makeExhibitor(edition.id, shell.id, 'C10');
    await expect(
      createInvitation(actorFor(viewer), { kind: 'exhibitor', email: 'x@example.com', editionId: edition.id, companyId: company.id }),
    ).rejects.toThrow(/permission/);
  });

  it('does not let staff of one show invite into another show', async () => {
    const a = await makeEdition('Show A');
    const b = await makeEdition('Show B');
    const adminA = await makeStaff(a.edition.id, 'show_admin');
    await expect(
      createInvitation(actorFor(adminA), { kind: 'edition_staff', email: 'y@example.com', editionId: b.edition.id, role: 'show_admin' }),
    ).rejects.toThrow(/could not find/);
  });

  it('requires an emailed code before a staff invitation can be accepted', async () => {
    const { edition } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const { token } = await createInvitation(actorFor(admin), {
      kind: 'edition_staff',
      email: 'hs.person@example.com',
      editionId: edition.id,
      role: 'hs_reviewer',
    });
    await expect(acceptInvitation(token, { name: 'H S' }, ctx)).rejects.toThrow(/Enter the code/);
    await sendInvitationCode(token, ctx);
    const code = codeFromEmail((await lastEmailTo('hs.person@example.com')).subject);
    const user = await acceptInvitation(token, { name: 'H S', code }, ctx);
    const db = await getDb();
    const [row] = await db.select().from(editionStaff).where(eq(editionStaff.userId, user.id));
    expect(row.role).toBe('hs_reviewer');
  });

  it('never lets an invitation link alone sign someone in to an existing account', async () => {
    const { edition, shell } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const { company } = await makeExhibitor(edition.id, shell.id, 'E10');
    // Someone who already has an account elsewhere (for example a supplier user).
    const existing = await makeUser({ email: 'fiona@supplier.example' });
    const other = await makeUser({ email: 'someone.else@example.com' });
    const { token } = await createInvitation(actorFor(admin), { kind: 'exhibitor', email: existing.email, editionId: edition.id, companyId: company.id });
    await expect(acceptInvitation(token, { name: 'Fiona' }, ctx)).rejects.toThrow(/Enter the code/);
    // Being signed in as somebody else does not count.
    await expect(acceptInvitation(token, { name: 'Fiona' }, ctx, { signedInEmail: other.email })).rejects.toThrow(/Enter the code/);
    // A code issued to another address does not work either.
    await requestSignInCode(other.email, ctx);
    const otherCode = codeFromEmail((await lastEmailTo(other.email)).subject);
    await expect(acceptInvitation(token, { name: 'Fiona', code: otherCode }, ctx)).rejects.toThrow(/wrong or has expired/);
    // The real person, with the code sent to their own mailbox, can accept.
    await sendInvitationCode(token, ctx);
    const user = await acceptInvitation(token, { name: 'Fiona', code: codeFromEmail((await lastEmailTo(existing.email)).subject) }, ctx);
    expect(user.id).toBe(existing.id);
  });

  it('rejects expired invitations', async () => {
    const { edition, shell } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const { company } = await makeExhibitor(edition.id, shell.id, 'D10');
    const { token, invitation } = await createInvitation(actorFor(admin), {
      kind: 'exhibitor',
      email: 'expired@example.com',
      editionId: edition.id,
      companyId: company.id,
    });
    const db = await getDb();
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, invitation.id));
    expect(await findInvitation(token)).toBeNull();
  });

  it('lets the main contact invite colleagues and nominate a contractor, but not a colleague', async () => {
    const { edition, space } = await makeEdition();
    const { stand, user: main, company } = await makeExhibitor(edition.id, space.id, 'S1');
    const { token } = await createInvitation(actorFor(main), { kind: 'colleague', email: 'colleague@example.com', standId: stand.id });
    await sendInvitationCode(token, ctx);
    const colleague = await acceptInvitation(token, { name: 'Colleague', code: codeFromEmail((await lastEmailTo('colleague@example.com')).subject) }, ctx);
    await expect(
      createInvitation(actorFor(colleague), { kind: 'colleague', email: 'another@example.com', standId: stand.id }),
    ).rejects.toThrow(/main contact/);

    const db = await getDb();
    await db.insert(standContractors).values({
      standId: stand.id,
      contractorCompanyName: 'Build Co',
      contactName: 'Builder',
      contactEmail: 'builder@example.com',
    });
    const { token: ct } = await createInvitation(actorFor(main), { kind: 'contractor', email: 'builder@example.com', standId: stand.id });
    // Already signed in as the invited address: no code needed.
    const builder = await acceptInvitation(ct, { name: 'Builder' }, ctx, { signedInEmail: 'Builder@Example.com' });
    const [sc] = await db.select().from(standContractors).where(eq(standContractors.standId, stand.id));
    expect(sc).toMatchObject({ userId: builder.id, status: 'active' });
    expect(company.id).toBeTruthy();
  });

  it('keeps an audit trail without secrets', async () => {
    const db = await getDb();
    const rows = await db.select().from(auditLog);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      const json = JSON.stringify(r.details);
      expect(json).not.toMatch(/\b\d{6}\b.*code/i);
    }
  });
});
