import 'server-only';
import { z } from 'zod';

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

  // Email
  EMAIL_PROVIDER: z.enum(['resend', 'outbox']).default('outbox'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_DEFAULT_FROM: z.string().default('BluePrint <no-reply@localhost>'),

  // File storage
  STORAGE_PROVIDER: z.enum(['r2', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/files'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  // Payments
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Scheduled jobs (Vercel Cron sends this as a bearer token)
  CRON_SECRET: z.string().optional(),

  // AI assistant
  AI_PROVIDER: z.enum(['anthropic', 'builtin']).default('builtin'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),

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
    if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (value.STORAGE_PROVIDER === 'r2') {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
        if (!value[k]) missing.push(k);
      }
    }
    if (missing.length && process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION !== 'true') {
      throw new Error(`Missing required production settings: ${missing.join(', ')}`);
    }
  }
  cached = value;
  return value;
}

export function isProduction() {
  return env().NODE_ENV === 'production';
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
