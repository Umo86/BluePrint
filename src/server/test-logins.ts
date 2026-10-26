import 'server-only';
import { z } from 'zod';
import { env } from './env';

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
