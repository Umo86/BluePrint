import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import {
  companies,
  companyMembers,
  editionStaff,
  editions,
  emailOutbox,
  exhibitorTypes,
  shows,
  stands,
  users,
  type EditionPermission,
  type EditionRole,
} from '@/server/db/schema';
import type { Actor } from '@/server/auth/actor';

export async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({ email: `user-${randomUUID().slice(0, 8)}@example.com`, name: 'Test User', status: 'active', ...overrides })
    .returning();
  return u;
}

export function actorFor(u: typeof users.$inferSelect, overrides: Partial<Actor> = {}): Actor {
  return {
    userId: u.id,
    email: u.email,
    name: u.name,
    isSuperAdmin: u.isSuperAdmin,
    readOnly: false,
    realUserId: u.id,
    realEmail: u.email,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    ...overrides,
  };
}

export async function makeEdition(name = 'Demo Expo 2027') {
  const db = await getDb();
  const slug = `demo-${randomUUID().slice(0, 8)}`;
  const [show] = await db.insert(shows).values({ name: 'Demo Expo', slug }).returning();
  const [edition] = await db
    .insert(editions)
    .values({
      showId: show.id,
      name,
      slug,
      status: 'live',
      buildUpStartsAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
      openStartsAt: new Date(Date.now() + 62 * 24 * 3600 * 1000),
      openEndsAt: new Date(Date.now() + 64 * 24 * 3600 * 1000),
    })
    .returning();
  const [shell] = await db
    .insert(exhibitorTypes)
    .values({ editionId: edition.id, key: 'shell_scheme', name: 'Shell scheme', sort: 1 })
    .returning();
  const [space] = await db
    .insert(exhibitorTypes)
    .values({ editionId: edition.id, key: 'space_only', name: 'Space only', isSpaceOnly: true, sort: 2 })
    .returning();
  return { show, edition, shell, space };
}

export async function makeExhibitor(editionId: string, typeId: string, standNumber = `A${Math.floor(Math.random() * 9000) + 100}`) {
  const db = await getDb();
  const [company] = await db.insert(companies).values({ name: `Company ${standNumber}` }).returning();
  const [stand] = await db
    .insert(stands)
    .values({ editionId, number: standNumber, exhibitorTypeId: typeId, companyId: company.id })
    .returning();
  const user = await makeUser({ name: `Main contact ${standNumber}` });
  await db.insert(companyMembers).values({ companyId: company.id, userId: user.id, role: 'main_contact', canPay: true });
  return { company, stand, user };
}

export async function makeStaff(editionId: string, role: EditionRole, permissions: EditionPermission[] = []) {
  const db = await getDb();
  const user = await makeUser({ name: `Staff ${role}` });
  await db.insert(editionStaff).values({ editionId, userId: user.id, role, permissions });
  return user;
}

/** Reads the most recent email to an address from the outbox. */
export async function lastEmailTo(email: string) {
  const db = await getDb();
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email.toLowerCase())).orderBy(desc(emailOutbox.createdAt)).limit(1);
  return row;
}

export function codeFromEmail(subject: string) {
  const m = subject.match(/(\d{6})/);
  if (!m) throw new Error(`No code in "${subject}"`);
  return m[1];
}
