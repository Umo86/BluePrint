/**
 * Applies database migrations. Run during deployment:  npm run db:migrate
 * Uses Neon when DATABASE_URL is set, otherwise the local PGlite database. Migrations prefer the
 * direct (unpooled) connection when one is provided, as Neon recommends for schema changes.
 */
import path from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  if (!url && process.env.VERCEL) {
    // A Vercel build without a database (for example a preview with no settings yet): nothing to migrate.
    console.log('DATABASE_URL is not set for this deployment, so no migrations were applied.');
    return;
  }
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
