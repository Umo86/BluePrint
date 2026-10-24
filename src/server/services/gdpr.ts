import 'server-only';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  assistantConversations,
  assistantMessages,
  auditLog,
  companies,
  companyMembers,
  editionStaff,
  editions,
  emailOutbox,
  emailSuppressions,
  invitations,
  loginCodes,
  orders,
  sessions,
  standContractors,
  submissions,
  supplierUsers,
  suppliers,
  ticketMessages,
  tickets,
  unsubscribes,
  users,
} from '../db/schema';
import { assertSuperAdmin } from '../authz';
import { conflict, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { revokeAllSessions } from '../auth/sessions';
import { normaliseEmail } from '../auth/login';
import type { Actor } from '../auth/actor';

/** Everything BluePrint holds about one person, for a subject access request. */
export async function exportPersonData(actor: Actor, userId: string) {
  assertSuperAdmin(actor);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound();
  const memberships = await db
    .select({ company: companies.name, role: companyMembers.role, canPay: companyMembers.canPay, since: companyMembers.createdAt })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, userId));
  const staffRoles = await db
    .select({ edition: editions.name, role: editionStaff.role, permissions: editionStaff.permissions })
    .from(editionStaff)
    .innerJoin(editions, eq(editions.id, editionStaff.editionId))
    .where(eq(editionStaff.userId, userId));
  const supplierRoles = await db
    .select({ supplier: suppliers.name })
    .from(supplierUsers)
    .innerJoin(suppliers, eq(suppliers.id, supplierUsers.supplierId))
    .where(eq(supplierUsers.userId, userId));
  const contractorRoles = await db.select().from(standContractors).where(eq(standContractors.userId, userId));
  const submitted = await db.select().from(submissions).where(eq(submissions.submittedBy, userId));
  const placedOrders = await db.select().from(orders).where(eq(orders.placedBy, userId));
  const ticketRows = await db.select().from(tickets).where(eq(tickets.openedBy, userId));
  const messageRows = await db.select().from(ticketMessages).where(and(eq(ticketMessages.authorId, userId), eq(ticketMessages.internal, false)));
  const conversations = await db.select().from(assistantConversations).where(eq(assistantConversations.userId, userId));
  const assistantRows = conversations.length
    ? await db
        .select()
        .from(assistantMessages)
        .where(inArray(assistantMessages.conversationId, conversations.map((c) => c.id)))
    : [];
  const emails = await db
    .select({ subject: emailOutbox.subject, status: emailOutbox.status, sentAt: emailOutbox.sentAt, createdAt: emailOutbox.createdAt })
    .from(emailOutbox)
    .where(eq(emailOutbox.toEmail, user.email))
    .orderBy(desc(emailOutbox.createdAt));
  const activity = await db.select().from(auditLog).where(eq(auditLog.actorUserId, userId)).orderBy(desc(auditLog.at)).limit(5000);

  await audit(actor, 'gdpr.exported', { entityType: 'user', entityId: userId });
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      jobTitle: user.jobTitle,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      twoFactorEnabled: Boolean(user.totpEnabledAt),
      hasPassword: Boolean(user.passwordHash),
    },
    companyMemberships: memberships,
    showStaffRoles: staffRoles,
    supplierRoles,
    contractorNominations: contractorRoles,
    formSubmissions: submitted.map((s) => ({ taskId: s.taskId, standId: s.standId, status: s.status, data: s.data, submittedAt: s.submittedAt })),
    orders: placedOrders.map((o) => ({ number: o.number, status: o.status, totalPence: o.totalPence, createdAt: o.createdAt })),
    helpDeskTickets: ticketRows,
    helpDeskMessages: messageRows,
    assistantMessages: assistantRows.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
    emailsSent: emails,
    activityLog: activity.map((a) => ({ at: a.at, action: a.action, entityType: a.entityType, ip: a.ip })),
  };
}

/**
 * Right to erasure: removes personal details and access, keeps business records (orders,
 * approvals) that UK law requires, now attached to an anonymous placeholder.
 */
export async function anonymisePerson(actor: Actor, userId: string) {
  assertSuperAdmin(actor);
  if (userId === actor.realUserId) throw forbidden('You cannot erase your own account.');
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound();
  if (user.anonymisedAt) return;
  if (user.isSuperAdmin) {
    const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.isSuperAdmin, true));
    if (Number(n) <= 1) throw conflict('BluePrint must keep at least one super admin.');
  }
  const placeholder = `deleted-${user.id}@anonymised.invalid`;
  const oldEmail = user.email;

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        name: 'Deleted user',
        email: placeholder,
        phone: null,
        jobTitle: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodeHashes: [],
        isSuperAdmin: false,
        status: 'disabled',
        anonymisedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(loginCodes).where(eq(loginCodes.email, oldEmail));
    await tx.delete(companyMembers).where(eq(companyMembers.userId, userId));
    await tx.delete(editionStaff).where(eq(editionStaff.userId, userId));
    await tx.delete(supplierUsers).where(eq(supplierUsers.userId, userId));
    await tx
      .update(standContractors)
      .set({ contactName: 'Deleted contact', contactEmail: placeholder, contactPhone: null, userId: null, status: 'removed' })
      .where(eq(standContractors.userId, userId));
    await tx.update(tickets).set({ contactName: null, contactEmail: null, contactPhone: null }).where(eq(tickets.openedBy, userId));
    await tx.delete(assistantConversations).where(eq(assistantConversations.userId, userId));
    await tx.update(emailOutbox).set({ toEmail: placeholder, html: '[removed]', text: '[removed]' }).where(eq(emailOutbox.toEmail, oldEmail));
    await tx.update(invitations).set({ email: placeholder, revokedAt: new Date() }).where(eq(invitations.email, oldEmail));
    await tx.delete(unsubscribes).where(eq(unsubscribes.email, oldEmail));
    await tx.delete(emailSuppressions).where(eq(emailSuppressions.email, oldEmail));
    await tx.update(auditLog).set({ actorEmail: placeholder }).where(eq(auditLog.actorUserId, userId));
    // Remove the address from any log details that mention it.
    await tx
      .update(auditLog)
      .set({ details: { redacted: true } })
      .where(sql`${auditLog.details}::text ilike ${'%' + oldEmail.replace(/[%_\\]/g, (m) => '\\' + m) + '%'}`);
  });
  await revokeAllSessions(userId);
  await audit(actor, 'gdpr.anonymised', { entityType: 'user', entityId: userId });
}

/** Finds the account and other records that hold an email address, for a privacy request. */
export async function findPersonRecords(actor: Actor, emailRaw: string) {
  assertSuperAdmin(actor);
  const email = normaliseEmail(emailRaw);
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const [{ n: emails }] = await db.select({ n: count() }).from(emailOutbox).where(eq(emailOutbox.toEmail, email));
  const [{ n: invites }] = await db.select({ n: count() }).from(invitations).where(eq(invitations.email, email));
  const [{ n: contractorContacts }] = await db.select({ n: count() }).from(standContractors).where(eq(standContractors.contactEmail, email));
  const [{ n: ticketContacts }] = await db.select({ n: count() }).from(tickets).where(eq(tickets.contactEmail, email));
  const [{ n: unsubscribed }] = await db.select({ n: count() }).from(unsubscribes).where(eq(unsubscribes.email, email));
  const [{ n: suppressed }] = await db.select({ n: count() }).from(emailSuppressions).where(eq(emailSuppressions.email, email));
  return {
    email,
    user: user ?? null,
    counts: {
      emails: Number(emails),
      invitations: Number(invites),
      contractorContacts: Number(contractorContacts),
      helpDeskContacts: Number(ticketContacts),
      unsubscribes: Number(unsubscribed),
      suppressions: Number(suppressed),
    },
  };
}

/**
 * Erases an email address that has no BluePrint account (for example a contractor contact who
 * never signed in): removes it from emails, invitations, contractor contacts and help desk tickets.
 */
export async function eraseEmailAddress(actor: Actor, emailRaw: string) {
  assertSuperAdmin(actor);
  const email = normaliseEmail(emailRaw);
  const db = await getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user) throw conflict('This address belongs to an account. Erase the account instead.');
  const placeholder = `erased-${Date.now().toString(36)}@anonymised.invalid`;
  await db.transaction(async (tx) => {
    await tx.update(emailOutbox).set({ toEmail: placeholder, html: '[removed]', text: '[removed]' }).where(eq(emailOutbox.toEmail, email));
    await tx.update(invitations).set({ email: placeholder, revokedAt: new Date() }).where(eq(invitations.email, email));
    await tx
      .update(standContractors)
      .set({ contactName: 'Deleted contact', contactEmail: placeholder, contactPhone: null, status: 'removed' })
      .where(eq(standContractors.contactEmail, email));
    await tx.update(tickets).set({ contactName: null, contactEmail: null, contactPhone: null }).where(eq(tickets.contactEmail, email));
    await tx.delete(loginCodes).where(eq(loginCodes.email, email));
    await tx.delete(unsubscribes).where(eq(unsubscribes.email, email));
    await tx.delete(emailSuppressions).where(eq(emailSuppressions.email, email));
    await tx
      .update(auditLog)
      .set({ details: { redacted: true } })
      .where(sql`${auditLog.details}::text ilike ${'%' + email.replace(/[%_\\]/g, (m) => '\\' + m) + '%'}`);
  });
  await audit(actor, 'gdpr.address_erased', { details: { placeholder } });
}
