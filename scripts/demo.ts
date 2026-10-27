/**
 * Adds the demo data (an invented organiser's shows, with an account of every kind and things already
 * happening) and gives the test logins' accounts their passwords. Safe to run again: it adds the demo
 * data once, replaces an older version of it, and never adds it back once a super admin has removed
 * it (Super admin → Demo data).
 *
 * It is part of the Vercel build, where it does nothing unless DEMO_DATA=load. Locally:
 *   DEMO_DATA=load TEST_LOGINS='[{"role":"Show admin","email":"olivia@buildexpo.test","password":"…"}]' npm run demo
 */
import { closeDb } from '../src/server/db/client';
import { loadDemoData } from '../src/server/demo/data';
import { testLogins } from '../src/server/test-logins';

async function main() {
  if (process.env.DEMO_DATA !== 'load') {
    console.log('Demo data: skipped (DEMO_DATA is not "load").');
    return;
  }
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    console.log('Demo data: skipped (no database for this deployment).');
    return;
  }
  const started = Date.now();
  for (const note of await loadDemoData(testLogins())) console.log(`Demo data: ${note}`);
  console.log(`Demo data: done in ${Math.round((Date.now() - started) / 1000)} s.`);
  await closeDb();
}

main().catch((err) => {
  console.error('Demo data failed:', err);
  process.exit(1);
});
