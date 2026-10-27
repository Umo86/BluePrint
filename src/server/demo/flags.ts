import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { companies, editions, shows, suppliers } from '../db/schema';

/**
 * Whether something belongs to the demo data. Demo shows are invented: their card payments are
 * always practice payments, their uploads can be kept in the database while file storage is not
 * connected, and their numbers (orders, invoices, questions) have their own DEMO- sequence so real
 * numbering is never interrupted. Only the demo loader marks anything as demo, and a flag never
 * changes afterwards, so the answers are cached for the life of the process.
 */
const cache = new Map<string, boolean>();

async function cached(key: string, load: () => Promise<boolean>) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await load();
  cache.set(key, value);
  return value;
}

export async function isDemoEdition(editionId: string | null | undefined): Promise<boolean> {
  if (!editionId) return false;
  return cached(`edition:${editionId}`, async () => {
    const db = await getDb();
    const [row] = await db.select({ demo: shows.isDemo }).from(editions).innerJoin(shows, eq(shows.id, editions.showId)).where(eq(editions.id, editionId)).limit(1);
    return Boolean(row?.demo);
  });
}

export async function isDemoSupplier(supplierId: string | null | undefined): Promise<boolean> {
  if (!supplierId) return false;
  return cached(`supplier:${supplierId}`, async () => {
    const db = await getDb();
    const [row] = await db.select({ demo: suppliers.isDemo }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
    return Boolean(row?.demo);
  });
}

export async function isDemoCompany(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  return cached(`company:${companyId}`, async () => {
    const db = await getDb();
    const [row] = await db.select({ demo: companies.isDemo }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return Boolean(row?.demo);
  });
}

/** A file's place (show, supplier or company) is part of the demo data. The show decides when there is one. */
export async function isDemoScope(scope: { editionId?: string | null; supplierId?: string | null; companyId?: string | null }) {
  if (scope.editionId) return isDemoEdition(scope.editionId);
  if (scope.supplierId) return isDemoSupplier(scope.supplierId);
  return isDemoCompany(scope.companyId);
}

/** After the demo loader sets flags or the demo data is removed. */
export function clearDemoFlags() {
  cache.clear();
}
