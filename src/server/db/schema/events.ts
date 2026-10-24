import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { COMMISSION_TYPES, createdAt, id, tz, updatedAt } from './common';
import { companies, users } from './core';

export const shows = pgTable(
  'shows',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    archivedAt: timestamp('archived_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('shows_slug_unique').on(t.slug)],
);

export const EDITION_STATUSES = ['draft', 'live', 'onsite', 'closed', 'archived'] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];

export type EditionBranding = {
  logoFileId?: string | null;
  headerImageFileId?: string | null;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string;
};

export type EditionEmailSettings = {
  senderName?: string;
  /** Full address on the show's verified sending subdomain, e.g. manual@mail.example.com */
  senderAddress?: string;
  replyTo?: string;
  /** Separate address for campaigns, on its own subdomain. */
  campaignSenderAddress?: string;
};

export type SpaceOnlyRules = {
  maxHeightM: number;
  maxPlatformMm: number;
  stepsMakeComplex: boolean;
  minInsuranceGbp: number;
  /** Document types every space-only pack must include. */
  requiredDocs: string[];
  /** Extra documents asked for when a stand counts as complex. */
  complexDocs: string[];
};

export const editions = pgTable(
  'editions',
  {
    id: id(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    venue: text('venue'),
    city: text('city'),
    timezone: text('timezone').notNull().default('Europe/London'),
    currency: text('currency').notNull().default('GBP'),
    vatRateBps: integer('vat_rate_bps').notNull().default(2000),
    buildUpStartsAt: timestamp('build_up_starts_at', tz),
    openStartsAt: timestamp('open_starts_at', tz),
    openEndsAt: timestamp('open_ends_at', tz),
    breakdownEndsAt: timestamp('breakdown_ends_at', tz),
    status: text('status', { enum: EDITION_STATUSES }).notNull().default('draft'),
    /** The exhibitor assistant for this show (it also has to be switched on for the platform). */
    assistantEnabled: boolean('assistant_enabled').notNull().default(true),
    branding: jsonb('branding').$type<EditionBranding>().notNull().default({}),
    emailSettings: jsonb('email_settings').$type<EditionEmailSettings>().notNull().default({}),
    spaceOnlyRules: jsonb('space_only_rules').$type<SpaceOnlyRules | null>(),
    /** Overrides the platform card-fee setting for this edition when set. */
    feeMode: text('fee_mode', { enum: ['exhibitor_pays', 'deduct_from_supplier'] }),
    defaultCommissionType: text('default_commission_type', { enum: COMMISSION_TYPES }),
    defaultCommissionValue: integer('default_commission_value'),
    clonedFromId: uuid('cloned_from_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('editions_slug_unique').on(t.slug), index('editions_show_idx').on(t.showId)],
);

export const EDITION_ROLES = ['show_admin', 'show_team', 'hs_reviewer'] as const;
export type EditionRole = (typeof EDITION_ROLES)[number];

/** Permissions a show team member can be granted. Show admins hold all of them. */
export const EDITION_PERMISSIONS = [
  'view',
  'edit_content',
  'manage_exhibitors',
  'review_space_only',
  'manage_orders',
  'send_emails',
  'helpdesk',
  'view_reports',
] as const;
export type EditionPermission = (typeof EDITION_PERMISSIONS)[number];

export const editionStaff = pgTable(
  'edition_staff',
  {
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: EDITION_ROLES }).notNull(),
    permissions: jsonb('permissions').$type<EditionPermission[]>().notNull().default([]),
    addedBy: uuid('added_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.editionId, t.userId] }), index('edition_staff_user_idx').on(t.userId)],
);

export const exhibitorTypes = pgTable(
  'exhibitor_types',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    /** Stable key: shell_scheme, space_only, or a custom slug. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Space-only types get the contractor nomination and approval flow. */
    isSpaceOnly: boolean('is_space_only').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('exhibitor_types_key_unique').on(t.editionId, t.key)],
);

export const halls = pgTable(
  'halls',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('halls_name_unique').on(t.editionId, t.name)],
);

export const stands = pgTable(
  'stands',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    hallId: uuid('hall_id').references(() => halls.id, { onDelete: 'set null' }),
    number: text('number').notNull(),
    exhibitorTypeId: uuid('exhibitor_type_id')
      .notNull()
      .references(() => exhibitorTypes.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    sizeSqm: numeric('size_sqm', { precision: 8, scale: 2 }),
    openSides: integer('open_sides').notNull().default(1),
    status: text('status', { enum: ['active', 'cancelled'] }).notNull().default('active'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('stands_number_unique').on(t.editionId, t.number),
    index('stands_company_idx').on(t.companyId),
  ],
);

/** The stand contractor an exhibitor nominates for a space-only stand. */
export const standContractors = pgTable(
  'stand_contractors',
  {
    id: id(),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'cascade' }),
    contractorCompanyName: text('contractor_company_name').notNull(),
    contactName: text('contact_name').notNull(),
    contactEmail: text('contact_email').notNull(),
    contactPhone: text('contact_phone'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['invited', 'active', 'removed'] }).notNull().default('invited'),
    nominatedBy: uuid('nominated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('stand_contractors_stand_unique').on(t.standId), index('stand_contractors_user_idx').on(t.userId)],
);

export const FILE_PURPOSES = [
  'submission',
  'space_only',
  'manual',
  'branding',
  'product',
  'invoice',
  'certificate',
  'company_logo',
  'ticket',
] as const;

export const files = pgTable(
  'files',
  {
    id: id(),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    purpose: text('purpose', { enum: FILE_PURPOSES }).notNull(),
    editionId: uuid('edition_id'),
    companyId: uuid('company_id'),
    standId: uuid('stand_id'),
    supplierId: uuid('supplier_id'),
    /** Public files (branding, logos, product photos) can be fetched without signing in, e.g. by email clients. */
    isPublic: boolean('is_public').notNull().default(false),
    uploadedBy: uuid('uploaded_by'),
    /** Set once the upload has been checked (real type, size). Unchecked files are never served. */
    verifiedAt: timestamp('verified_at', tz),
    deletedAt: timestamp('deleted_at', tz),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('files_key_unique').on(t.storageKey), index('files_stand_idx').on(t.standId)],
);

/** Internal notes on an exhibitor, visible to the show team only. */
export const exhibitorNotes = pgTable(
  'exhibitor_notes',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('exhibitor_notes_company_idx').on(t.editionId, t.companyId)],
);
