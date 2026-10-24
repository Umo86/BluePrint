/**
 * Creates the first super admin and prints an invitation link.
 *   BOOTSTRAP_SUPER_ADMIN_EMAIL=you@media10.co.uk npm run bootstrap
 * The invitation asks for an emailed code and then two-factor set-up.
 */
import { eq } from 'drizzle-orm';
import { randomToken, sha256Hex } from '../src/server/security/crypto';
import { getDb, closeDb } from '../src/server/db/client';
import { invitations, users } from '../src/server/db/schema';
import { env } from '../src/server/env';

async function main() {
  const email = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? process.argv[2] ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Set BOOTSTRAP_SUPER_ADMIN_EMAIL or pass an email address.');
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  if (existing && process.env.FORCE !== 'true') {
    throw new Error(`A super admin already exists (${existing.email}). Invite further admins from the dashboard.`);
  }
  const token = randomToken(32);
  await db.insert(invitations).values({
    tokenHash: sha256Hex(token),
    email,
    kind: 'super_admin',
    expiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
  });
  console.log(`\nSuper admin invitation for ${email} (valid 48 hours):\n${new URL(`/invite/${token}`, env().APP_URL)}\n`);
  await closeDb();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
