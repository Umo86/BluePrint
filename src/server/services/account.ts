import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { assertWritable } from '../authz';
import { audit } from '../audit';
import type { Actor } from '../auth/actor';

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
});

export async function updateProfile(actor: Actor, input: z.input<typeof profileSchema>) {
  assertWritable(actor);
  const data = profileSchema.parse(input);
  const db = await getDb();
  await db.update(users).set({ name: data.name, phone: data.phone || null, jobTitle: data.jobTitle || null }).where(eq(users.id, actor.userId));
  await audit(actor, 'account.profile_updated', { entityType: 'user', entityId: actor.userId });
}

export async function getAccount(actor: Actor) {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  return u;
}
