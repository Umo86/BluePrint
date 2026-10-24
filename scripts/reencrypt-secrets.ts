/**
 * Moves every encrypted secret (two-factor keys) onto the current APP_ENCRYPTION_KEY.
 * Part of changing the encryption key (see docs/security.md):
 *   DATABASE_URL=… APP_ENCRYPTION_KEY=<new> APP_ENCRYPTION_KEY_PREVIOUS=<old> npm run secrets:reencrypt
 * Safe to run more than once: secrets already under the current key are left alone.
 */
import { eq, isNotNull } from 'drizzle-orm';
import { getDb, closeDb } from '../src/server/db/client';
import { users } from '../src/server/db/schema';
import { reencryptSecret } from '../src/server/security/crypto';

async function main() {
  const db = await getDb();
  const rows = await db.select({ id: users.id, secret: users.totpSecretEnc }).from(users).where(isNotNull(users.totpSecretEnc));
  let moved = 0;
  let unreadable = 0;
  for (const row of rows) {
    try {
      const next = reencryptSecret(row.secret!);
      if (next) {
        await db.update(users).set({ totpSecretEnc: next }).where(eq(users.id, row.id));
        moved++;
      }
    } catch {
      unreadable++;
    }
  }
  console.log(`Checked ${rows.length} two-factor keys: ${moved} moved to the current key, ${rows.length - moved - unreadable} already on it.`);
  if (unreadable) {
    console.log(`${unreadable} could not be opened with either key. Those people need their two-factor reset (Super admin → Users).`);
    process.exitCode = 1;
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
