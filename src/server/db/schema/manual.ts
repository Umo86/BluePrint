import {
  boolean,
  date,
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
import { createdAt, id, tz, updatedAt } from './common';
import { editions, exhibitorTypes, stands } from './events';

// ---------------------------------------------------------------------------
// Manual pages
// ---------------------------------------------------------------------------

export const manualPages = pgTable(
  'manual_pages',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    /** Sanitised HTML from the page editor. */
    bodyHtml: text('body_html').notNull().default(''),
    /** Exhibitor type ids that can see the page; empty means everyone. */
    visibleToTypes: jsonb('visible_to_types').$type<string[]>().notNull().default([]),
    published: boolean('published').notNull().default(true),
    pinned: boolean('pinned').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('manual_pages_slug_unique').on(t.editionId, t.slug)],
);

// ---------------------------------------------------------------------------
// Tasks and forms
// ---------------------------------------------------------------------------

export const FORM_FIELD_TYPES = [
  'heading',
  'text',
  'textarea',
  'number',
  'email',
  'phone',
  'select',
  'multiselect',
  'date',
  'checkbox',
  'file',
  'declaration',
  'repeater',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  help?: string;
  required?: boolean;
  options?: string[];
  maxLength?: number;
  min?: number;
  max?: number;
  /** For declarations: the statement the exhibitor signs. */
  statement?: string;
  /** Repeating rows (for example several vehicles). */
  fields?: FormField[];
  maxRows?: number;
  /** Conditional question: only shown when another field has this value. */
  showIf?: { fieldId: string; equals: string | boolean };
};

export const TASK_KINDS = [
  'form',
  'upload',
  'declaration',
  'order',
  'contractor_nomination',
  'space_only_pack',
  'info',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    descriptionHtml: text('description_html').notNull().default(''),
    kind: text('kind', { enum: TASK_KINDS }).notNull().default('form'),
    formSchema: jsonb('form_schema').$type<FormField[]>().notNull().default([]),
    /** Days before build-up starts. A cloned edition recalculates every deadline from this. */
    deadlineOffsetDays: integer('deadline_offset_days'),
    /** Fixed deadline; used instead of the offset when set. */
    deadlineAt: timestamp('deadline_at', tz),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    /** Exhibitors cannot change their answers after the deadline unless the team reopens it for them. */
    locksAtDeadline: boolean('locks_at_deadline').notNull().default(true),
    linkedPageId: uuid('linked_page_id'),
    /** For order tasks: the service category whose paid order completes the task. */
    linkedCategoryId: uuid('linked_category_id'),
    /** Reminder steps in days before the deadline; null uses the edition default (14, 7, 1). */
    reminderOffsets: jsonb('reminder_offsets').$type<number[] | null>(),
    published: boolean('published').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tasks_edition_idx').on(t.editionId)],
);

export const TASK_REQUIREMENTS = ['required', 'if_applicable', 'optional'] as const;
export type TaskRequirement = (typeof TASK_REQUIREMENTS)[number];

/** Which exhibitor types see a task, and how strongly. No row means the type never sees it. */
export const taskRequirements = pgTable(
  'task_requirements',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    exhibitorTypeId: uuid('exhibitor_type_id')
      .notNull()
      .references(() => exhibitorTypes.id, { onDelete: 'cascade' }),
    requirement: text('requirement', { enum: TASK_REQUIREMENTS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.exhibitorTypeId] })],
);

export const SUBMISSION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'changes_needed',
  'rejected',
  'completed',
  'not_needed',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'cascade' }),
    status: text('status', { enum: SUBMISSION_STATUSES }).notNull().default('draft'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    version: integer('version').notNull().default(0),
    /** A later deadline for this stand only. */
    deadlineOverrideAt: timestamp('deadline_override_at', tz),
    /** Lets one exhibitor edit a locked form until this time. */
    reopenedUntil: timestamp('reopened_until', tz),
    submittedBy: uuid('submitted_by'),
    submittedAt: timestamp('submitted_at', tz),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', tz),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('submissions_task_stand_unique').on(t.taskId, t.standId), index('submissions_stand_idx').on(t.standId)],
);

// ---------------------------------------------------------------------------
// Space-only stand approvals
// ---------------------------------------------------------------------------

export const SPACE_ONLY_DOC_TYPES = [
  'drawings',
  'risk_assessment',
  'method_statement',
  'construction_phase_plan',
  'contractor_insurance',
  'hs_declaration',
  'structural_calculations',
] as const;
export type SpaceOnlyDocType = (typeof SPACE_ONLY_DOC_TYPES)[number];

export const SPACE_ONLY_STATUSES = [
  'not_started',
  'submitted',
  'under_review',
  'changes_needed',
  'approved',
  'approved_with_conditions',
  'rejected',
] as const;
export type SpaceOnlyStatus = (typeof SPACE_ONLY_STATUSES)[number];

export const spaceOnlyPacks = pgTable(
  'space_only_packs',
  {
    id: id(),
    standId: uuid('stand_id')
      .notNull()
      .references(() => stands.id, { onDelete: 'cascade' }),
    status: text('status', { enum: SPACE_ONLY_STATUSES }).notNull().default('not_started'),
    currentVersion: integer('current_version').notNull().default(0),
    declaredHeightM: numeric('declared_height_m', { precision: 6, scale: 2 }),
    declaredPlatformMm: integer('declared_platform_mm'),
    hasSteps: boolean('has_steps').notNull().default(false),
    isComplex: boolean('is_complex').notNull().default(false),
    insuranceExpiresOn: date('insurance_expires_on'),
    insuranceCoverGbp: integer('insurance_cover_gbp'),
    conditions: text('conditions'),
    decidedAt: timestamp('decided_at', tz),
    decidedBy: uuid('decided_by'),
    certificateFileId: uuid('certificate_file_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('space_only_packs_stand_unique').on(t.standId)],
);

export const spaceOnlyVersions = pgTable(
  'space_only_versions',
  {
    id: id(),
    packId: uuid('pack_id')
      .notNull()
      .references(() => spaceOnlyPacks.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Document type to uploaded file ids. */
    documents: jsonb('documents').$type<Partial<Record<SpaceOnlyDocType, string[]>>>().notNull().default({}),
    declarations: jsonb('declarations').$type<Record<string, unknown>>().notNull().default({}),
    completeness: jsonb('completeness').$type<{ missing: string[]; warnings: string[] }>().notNull().default({ missing: [], warnings: [] }),
    submittedBy: uuid('submitted_by'),
    submittedAt: timestamp('submitted_at', tz).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('space_only_versions_unique').on(t.packId, t.version)],
);

export const SPACE_ONLY_OUTCOMES = [
  'approved',
  'approved_with_conditions',
  'changes_needed',
  'rejected',
  'comment',
] as const;

export const spaceOnlyReviews = pgTable(
  'space_only_reviews',
  {
    id: id(),
    packId: uuid('pack_id')
      .notNull()
      .references(() => spaceOnlyPacks.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    reviewerId: uuid('reviewer_id'),
    reviewerRole: text('reviewer_role', { enum: ['ops', 'hs'] }).notNull(),
    outcome: text('outcome', { enum: SPACE_ONLY_OUTCOMES }).notNull(),
    docType: text('doc_type'),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [index('space_only_reviews_pack_idx').on(t.packId)],
);
