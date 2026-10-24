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
    if (!value.DATABASE_URL) missing.push('DATABASE_URL');
    if (!value.APP_ENCRYPTION_KEY) missing.push('APP_ENCRYPTION_KEY');
    if (!value.CRON_SECRET) missing.push('CRON_SECRET');
    // A real deployment must send real email and keep files in R2 (a server's own disk is wiped).
    if (value.EMAIL_PROVIDER !== 'resend') missing.push('EMAIL_PROVIDER=resend');
    if (!value.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (value.STORAGE_PROVIDER !== 'r2') missing.push('STORAGE_PROVIDER=r2');
    for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
      if (!value[k]) missing.push(k);
    }
    // Card payments are optional, but once switched on the webhook secret is needed to confirm them.
    if (value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
    if (value.STRIPE_SECRET_KEY && /^pk_/.test(value.STRIPE_SECRET_KEY)) missing.push('STRIPE_SECRET_KEY (a publishable key was given; use the secret or restricted key)');
    if (missing.length && !localProductionAllowed(value.APP_URL)) {
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
export function localProductionAllowed(appUrl: string | undefined = process.env.APP_URL) {
  return process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION === 'true' && !process.env.VERCEL && isLocalAddress(appUrl);
}

export function isProduction() {
  return env().NODE_ENV === 'production';
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
