/**
 * Applies database migrations. Run during deployment:  npm run db:migrate
 * Uses DATABASE_URL (Neon) when set, otherwise the local PGlite database.
 */
import path from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL;
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  if (url) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: url, max: 1 });
    await migrate(drizzle({ client: pool }), { migrationsFolder });
    await pool.end();
  } else {
    const { getDb, closeDb } = await import('../src/server/db/client');
    await getDb(); // PGlite migrates itself on open
    await closeDb();
  }
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
