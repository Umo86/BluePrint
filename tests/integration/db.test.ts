import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, useInMemoryDatabaseForTests, type Db } from '@/server/db/client';
import { users } from '@/server/db/schema';

let db: Db;
beforeAll(async () => {
  db = await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

describe('database', () => {
  it('applies every migration and accepts writes', async () => {
    const [row] = await db.insert(users).values({ email: 'a@example.com', name: 'A' }).returning();
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
    const tables = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = (tables as any).rows?.[0]?.n ?? (tables as any)[0]?.n;
    expect(n).toBeGreaterThan(40);
  });

  it('rejects a duplicate email', async () => {
    await expect(db.insert(users).values({ email: 'a@example.com' })).rejects.toThrow();
  });
});
