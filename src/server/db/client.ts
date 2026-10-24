import 'server-only';
import path from 'node:path';
import fs from 'node:fs';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from './schema';
import { env } from '../env';

export type Schema = typeof schema;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run a query: the database itself or an open transaction. */
export type DbLike = Db | Tx;

type Holder = { db: Db; ready: Promise<void>; close: () => Promise<void> };

const globalStore = globalThis as unknown as { __blueprintDb?: Holder };

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

async function createPostgres(url: string): Promise<Holder> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new Pool({
    connectionString: url,
    max: 5,
    // Neon requires TLS; the connection string carries sslmode=require.
    idleTimeoutMillis: 10_000,
  });
  const db = drizzle({ client: pool, schema }) as unknown as Db;
  return { db, ready: Promise.resolve(), close: () => pool.end() };
}

async function createPglite(dataDir: string | null): Promise<Holder> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  const db = drizzle({ client, schema }) as unknown as Db;
  // Local databases migrate themselves; production runs `npm run db:migrate` during deploy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, ready: Promise.resolve(), close: () => client.close() };
}

let pending: Promise<Holder> | null = null;

/** Returns the shared database connection, creating it on first use. */
export async function getDb(): Promise<Db> {
  if (globalStore.__blueprintDb) return globalStore.__blueprintDb.db;
  if (!pending) {
    const e = env();
    pending = (e.DATABASE_URL ? createPostgres(e.DATABASE_URL) : createPglite(path.resolve(e.PGLITE_DIR))).then((h) => {
      globalStore.__blueprintDb = h;
      return h;
    });
    pending.catch(() => {
      pending = null;
    });
  }
  const holder = await pending;
  return holder.db;
}

/** Test helper: run against a fresh in-memory database. */
export async function useInMemoryDatabaseForTests(): Promise<Db> {
  const holder = await createPglite(null);
  globalStore.__blueprintDb = holder;
  return holder.db;
}

export async function closeDb() {
  const h = globalStore.__blueprintDb;
  globalStore.__blueprintDb = undefined;
  pending = null;
  if (h) await h.close();
}
