import 'server-only';
import { z } from 'zod';
import { R2_JURISDICTIONS } from '@/lib/storage-origin';
import { isLocalAddress } from '@/lib/local-address';

/**
 * Environment configuration, validated once on first use.
 * Production refuses to start without the secrets it needs; development falls back to safe local stand-ins.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database: Neon (or any Postgres) in production; an embedded PGlite database locally.
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('.data/pglite'),

  // 32 random bytes, base64. Encrypts two-factor secrets at rest.
  APP_ENCRYPTION_KEY: z.string().optional(),
  // Only while changing the key: the old key, so existing secrets can still be read (see docs/security.md).
  APP_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),

  // Email
  EMAIL_PROVIDER: z.enum(['resend', 'outbox']).default('outbox'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_DEFAULT_FROM: z.string().default('BluePrint <no-reply@localhost>'),

  // File storage
  STORAGE_PROVIDER: z.enum(['r2', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/files'),
  R2_ACCOUNT_ID: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/i, 'R2_ACCOUNT_ID should be the 32-character Cloudflare account ID')
    .optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // Set to "eu" for a bucket created with the EU jurisdiction (it has its own address).
  R2_JURISDICTION: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : undefined), z.enum(R2_JURISDICTIONS).optional()),

  // Payments
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Signing secret of a second endpoint for connected-account events (account.updated), if used.
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),

  // Scheduled jobs (Vercel Cron sends this as a bearer token)
  CRON_SECRET: z.string().optional(),

  // AI assistant
  ANTHROPIC_API_KEY: z.string().optional(),

  // First super admin, created by `npm run bootstrap`
  BOOTSTRAP_SUPER_ADMIN_EMAIL: z.string().email().optional(),

  // Two-factor sign-in for staff: "on" (the default) or "off". While it is off, nobody is asked to set up
  // or use an authenticator app, including people who already have one. Turn it back on before launch.
  TWO_FACTOR: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? (['off', 'false', '0', 'no'].includes(v.trim().toLowerCase()) ? 'off' : 'on') : undefined),
    z.enum(['on', 'off']).default('on'),
  ),

  // A test login shown on the sign-in page while the site is being tried out. Remove both (and the
  // account) when testing is over.
  TEST_LOGIN_EMAIL: z.string().trim().email().optional(),
  TEST_LOGIN_PASSWORD: z.string().optional(),
  // More test logins, one per kind of account, as JSON: [{"role":"Show admin","email":"…","password":"…"}].
  // Shown on the sign-in page; `npm run demo` gives the demo accounts these passwords.
  TEST_LOGINS: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  const value = parsed.data;
  if (value.NODE_ENV === 'production') {
    const missing: string[] = [];
    // Links in emails and the same-site checks depend on the real address.
    if (!process.env.APP_URL) missing.push('APP_URL');
    if (!value.DATABASE_URL) missing.push('DATABASE_URL');
    if (!value.APP_ENCRYPTION_KEY) missing.push('APP_ENCRYPTION_KEY');
    if (!value.CRON_SECRET) missing.push('CRON_SECRET');
    // Email (Resend) and file storage (R2) can be added later. Until then a live site records emails
    // without sending them and switches uploads off (see emailMode and storageMode), and the super
    // admin overview lists what is still to set up. It never falls back to a server's own disk.
    // Card payments are optional, but once switched on the webhook secret is needed to confirm them.
    if (value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
    if (value.STRIPE_SECRET_KEY && /^pk_/.test(value.STRIPE_SECRET_KEY)) missing.push('STRIPE_SECRET_KEY (a publishable key was given; use the secret or restricted key)');
    if (missing.length && !localProductionAllowed()) {
      throw new Error(`Missing required production settings: ${missing.join(', ')}`);
    }
  }
  cached = value;
  return value;
}

/**
 * Trying a production build on your own computer (BLUEPRINT_ALLOW_LOCAL_PRODUCTION=true) relaxes a
 * few rules: no real email, files or encryption key needed. It only ever applies when the site's
 * address is this computer and it is not running on Vercel, so a live site can never use it.
 */
export function localProductionAllowed() {
  // The address as actually set: a missing APP_URL never counts as "this computer".
  return process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION === 'true' && !process.env.VERCEL && isLocalAddress(process.env.APP_URL);
}

export function isProduction() {
  return env().NODE_ENV === 'production';
}

/** A live site, as opposed to development, tests or a production build tried on this computer. */
function liveSite(e: Env) {
  return e.NODE_ENV === 'production' && !localProductionAllowed();
}

/**
 * How email goes out: through Resend once its key is set; kept in the outbox for development and
 * tests; or "off" on a live site that has no Resend key yet, where each email is recorded as not
 * sent (with any sign-in code or personal link taken out of the copy).
 */
export function emailMode(): 'resend' | 'outbox' | 'off' {
  const e = env();
  if (e.EMAIL_PROVIDER === 'resend' && e.RESEND_API_KEY) return 'resend';
  if (liveSite(e) || e.EMAIL_PROVIDER === 'resend') return 'off';
  return 'outbox';
}

/**
 * Where files are kept: Cloudflare R2 once all its settings are in; a local folder for development;
 * or "off" on a live site without R2, where uploads are refused with a clear message (a server's
 * own disk is wiped, so files must never be kept there).
 */
export function storageMode(): 'r2' | 'local' | 'off' {
  const e = env();
  if (e.STORAGE_PROVIDER === 'r2' && e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET) return 'r2';
  if (liveSite(e) || e.STORAGE_PROVIDER === 'r2') return 'off';
  return 'local';
}

/** Whether staff must use two-factor sign-in (TWO_FACTOR=off switches it off for everyone). */
export function twoFactorOn() {
  return env().TWO_FACTOR === 'on';
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
