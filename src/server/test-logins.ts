import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { env } from './env';
import { getDb } from './db/client';
import { users } from './db/schema';

const loginSchema = z.object({
  role: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export type TestLogin = z.infer<typeof loginSchema>;

/**
 * The test logins shown on the sign-in page while the site is being tried out: TEST_LOGINS (a JSON
 * list of { role, email, password }) and the older single TEST_LOGIN_EMAIL / TEST_LOGIN_PASSWORD,
 * which is shown as the super admin. Anything malformed is left out rather than breaking the page.
 */
export function testLogins(): TestLogin[] {
  const e = env();
  const out: TestLogin[] = [];
  if (e.TEST_LOGIN_EMAIL && e.TEST_LOGIN_PASSWORD) {
    const one = loginSchema.safeParse({ role: 'Super admin', email: e.TEST_LOGIN_EMAIL, password: e.TEST_LOGIN_PASSWORD });
    if (one.success) out.push(one.data);
  }
  if (e.TEST_LOGINS) {
    let list: unknown = null;
    try {
      list = JSON.parse(e.TEST_LOGINS);
    } catch {
      console.error('TEST_LOGINS is not valid JSON, so no test logins are shown from it.');
    }
    if (Array.isArray(list)) {
      for (const item of list) {
        const parsed = loginSchema.safeParse(item);
        if (parsed.success && !out.some((l) => l.email === parsed.data.email)) out.push(parsed.data);
      }
    }
  }
  return out.slice(0, 20);
}

/** What each demo account is for, shown under its test login (matched on the role's name). */
const ROLE_NOTES: Record<string, string> = {
  'super admin': 'Runs the whole platform: shows, users, suppliers, payments and the demo data.',
  'show admin': 'Runs BuildExpo London (live) and Green Homes Live (being set up): exhibitors, orders, approvals, emails and settings.',
  'show team': 'Exhibitor services at BuildExpo London: exhibitors, orders (but not refunds), reports and the help desk.',
  'health and safety reviewer': 'Reviews the space-only stand packs at BuildExpo London, and nothing else.',
  'exhibitor (shell scheme)': 'Acme Insulation: checklist, shop, orders, help and the AI assistant.',
  'exhibitor (space only)': 'Evergreen Timber Frames: the same, plus stand approval with their contractor.',
  'stand contractor': 'BuildRight Stands: builds five space-only stands and sends their packs.',
  supplier: 'Expo Furniture Hire: orders to fulfil, products and payouts.',
};

/**
 * The test logins whose accounts exist and can sign in, with a note on what each account is for.
 * Removing the demo data takes its accounts, and so their test logins, away.
 */
export async function availableTestLogins(): Promise<(TestLogin & { note: string | null })[]> {
  const all = testLogins();
  if (!all.length) return [];
  const db = await getDb();
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(inArray(users.email, all.map((l) => l.email)), eq(users.status, 'active')));
  const ok = new Set(rows.map((r) => r.email));
  return all.filter((l) => ok.has(l.email)).map((l) => ({ ...l, note: ROLE_NOTES[l.role.trim().toLowerCase()] ?? null }));
}
