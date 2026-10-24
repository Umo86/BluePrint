import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './common';

// ---------------------------------------------------------------------------
// People and access
// ---------------------------------------------------------------------------

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Always stored lower-cased and trimmed. */
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    phone: text('phone'),
    jobTitle: text('job_title'),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    /** argon2id hash; null when the person only signs in with email codes. */
    passwordHash: text('password_hash'),
    /** TOTP secret, encrypted with AES-256-GCM (see server/security/crypto). */
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabledAt: timestamp('totp_enabled_at', tz),
    /** Last accepted TOTP time step, to stop a code being replayed. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    /** SHA-256 hashes of unused recovery codes. */
    recoveryCodeHashes: jsonb('recovery_code_hashes').$type<string[]>().notNull().default([]),
    failedPasswordAttempts: integer('failed_password_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', tz),
    lastLoginAt: timestamp('last_login_at', tz),
    anonymisedAt: timestamp('anonymised_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 (hex) of the session token. The raw token only ever lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    lastSeenAt: timestamp('last_seen_at', tz).notNull().defaultNow(),
    idleTimeoutSeconds: integer('idle_timeout_seconds').notNull(),
    twoFactorVerified: boolean('two_factor_verified').notNull().default(false),
    /** Read-only "view as" of another user (super admin or show admin support tool). */
    viewAsUserId: uuid('view_as_user_id').references(() => users.id, { onDelete: 'set null' }),
    viewAsEditionId: uuid('view_as_edition_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', tz),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const loginCodes = pgTable(
  'login_codes',
  {
    id: id(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', tz).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', tz),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('login_codes_email_idx').on(t.email, t.createdAt)],
);

export const INVITATION_KINDS = [
  'super_admin',
  'edition_staff',
  'exhibitor',
  'colleague',
  'contractor',
  'supplier',
] as const;
export type InvitationKind = (typeof INVITATION_KINDS)[number];

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    kind: text('kind', { enum: INVITATION_KINDS }).notNull(),
    editionId: uuid('edition_id'),
    companyId: uuid('company_id'),
    standId: uuid('stand_id'),
    supplierId: uuid('supplier_id'),
    role: text('role'),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', tz).notNull(),
    acceptedAt: timestamp('accepted_at', tz),
    acceptedUserId: uuid('accepted_user_id').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', tz),
    lastSentAt: timestamp('last_sent_at', tz),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_unique').on(t.tokenHash),
    index('invitations_email_idx').on(t.email),
    index('invitations_edition_idx').on(t.editionId),
  ],
);

/** Fixed-window counters used for rate limiting sign-in, codes and other sensitive actions. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', tz).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** Append-only record of every security-relevant event and every change. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    at: timestamp('at', tz).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    editionId: uuid('edition_id'),
    companyId: uuid('company_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_at_idx').on(t.at),
    index('audit_edition_idx').on(t.editionId, t.at),
    index('audit_actor_idx').on(t.actorUserId, t.at),
    index('audit_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by'),
});

/** Atomic counters for human-readable numbers (orders, invoices). */
export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: bigint('value', { mode: 'number' }).notNull().default(0),
});

export const cronRuns = pgTable(
  'cron_runs',
  {
    id: id(),
    job: text('job').notNull(),
    startedAt: timestamp('started_at', tz).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', tz),
    status: text('status', { enum: ['running', 'ok', 'error'] }).notNull().default('running'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('cron_runs_job_idx').on(t.job, t.startedAt)],
);

// ---------------------------------------------------------------------------
// Companies (exhibitors and stand contractors)
// ---------------------------------------------------------------------------

export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['exhibitor', 'contractor'] }).notNull().default('exhibitor'),
    website: text('website'),
    description: text('description'),
    logoFileId: uuid('logo_file_id'),
    email: text('email'),
    phone: text('phone'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    postcode: text('postcode'),
    country: text('country').default('United Kingdom'),
    vatNumber: text('vat_number'),
    /** Identifier of the exhibitor on the ASP event website, for profile sync. */
    aspExhibitorId: text('asp_exhibitor_id'),
    invoiceAllowed: boolean('invoice_allowed').notNull().default(false),
    archivedAt: timestamp('archived_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('companies_name_idx').on(sql`lower(${t.name})`)],
);

export const COMPANY_ROLES = ['main_contact', 'colleague'] as const;

export const companyMembers = pgTable(
  'company_members',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: COMPANY_ROLES }).notNull().default('colleague'),
    canPay: boolean('can_pay').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.userId] }), index('company_members_user_idx').on(t.userId)],
);

/** Global library of reusable templates any show can pull in. */
export const libraryItems = pgTable(
  'library_items',
  {
    id: id(),
    kind: text('kind', { enum: ['page', 'task', 'email_template', 'catalogue'] }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('library_kind_idx').on(t.kind)],
);
