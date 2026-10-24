import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './common';
import { companies } from './core';
import { editions, stands } from './events';

// ---------------------------------------------------------------------------
// Email templates, outbox and delivery events
// ---------------------------------------------------------------------------

export type EmailBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'button'; label: string; url: string }
  | { type: 'tasks_due' }
  | { type: 'image'; fileId: string; alt: string }
  | { type: 'divider' }
  | { type: 'html'; html: string };

/** System emails every edition has; custom templates use the key `custom`. */
export const SYSTEM_EMAIL_KEYS = [
  'invite_exhibitor',
  'invite_colleague',
  'invite_contractor',
  'invite_staff',
  'invite_supplier',
  'sign_in_code',
  'reminder_digest',
  'overdue_digest',
  'submission_approved',
  'submission_changes_needed',
  'space_only_outcome',
  'order_confirmation',
  'payment_receipt',
  'refund_notice',
  'supplier_new_order',
  'ticket_reply',
  'type_changed',
] as const;
export type SystemEmailKey = (typeof SYSTEM_EMAIL_KEYS)[number];

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: id(),
    /** Null for the platform default of a system email. */
    editionId: uuid('edition_id').references(() => editions.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    preheader: text('preheader').notNull().default(''),
    blocks: jsonb('blocks').$type<EmailBlock[]>().notNull().default([]),
    category: text('category', { enum: ['transactional', 'reminder', 'campaign'] }).notNull().default('transactional'),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('email_templates_edition_idx').on(t.editionId, t.key)],
);

export const EMAIL_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'failed',
  'suppressed',
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: id(),
    editionId: uuid('edition_id'),
    toEmail: text('to_email').notNull(),
    toUserId: uuid('to_user_id'),
    companyId: uuid('company_id'),
    standId: uuid('stand_id'),
    templateKey: text('template_key').notNull(),
    category: text('category', { enum: ['transactional', 'reminder', 'campaign', 'security'] }).notNull(),
    fromAddress: text('from_address').notNull(),
    replyTo: text('reply_to'),
    subject: text('subject').notNull(),
    html: text('html').notNull(),
    text: text('text').notNull(),
    status: text('status', { enum: EMAIL_STATUSES }).notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    campaignId: uuid('campaign_id'),
    sentBy: uuid('sent_by'),
    /** Extra headers to send with it (for example List-Unsubscribe on campaign emails). */
    headers: jsonb('headers').$type<Record<string, string>>(),
    sentAt: timestamp('sent_at', tz),
    lastEventAt: timestamp('last_event_at', tz),
    createdAt: createdAt(),
  },
  (t) => [
    index('email_outbox_status_idx').on(t.status, t.createdAt),
    index('email_outbox_company_idx').on(t.editionId, t.companyId),
    uniqueIndex('email_outbox_provider_unique').on(t.providerMessageId),
  ],
);

export const emailEvents = pgTable(
  'email_events',
  {
    id: id(),
    outboxId: uuid('outbox_id')
      .notNull()
      .references(() => emailOutbox.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    at: timestamp('at', tz).notNull().defaultNow(),
    providerEventId: text('provider_event_id'),
  },
  (t) => [index('email_events_outbox_idx').on(t.outboxId), uniqueIndex('email_events_provider_unique').on(t.providerEventId)],
);

/** Addresses that bounced or complained; nothing more is sent to them. */
export const emailSuppressions = pgTable('email_suppressions', {
  email: text('email').primaryKey(),
  reason: text('reason', { enum: ['bounced', 'complained', 'manual'] }).notNull(),
  createdAt: createdAt(),
});

/** Campaign unsubscribes. Service emails (deadlines, orders) still go. */
export const unsubscribes = pgTable(
  'unsubscribes',
  {
    id: id(),
    email: text('email').notNull(),
    editionId: uuid('edition_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('unsubscribes_unique').on(t.email, t.editionId)],
);

export type CampaignFilter = {
  exhibitorTypeIds?: string[];
  hallIds?: string[];
  taskNotDoneId?: string | null;
  categoryNotOrderedId?: string | null;
  neverSignedIn?: boolean;
  standIds?: string[];
  /** Main contacts only (default), or everyone at each company. */
  audience?: 'main_contacts' | 'everyone';
};

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    blocks: jsonb('blocks').$type<EmailBlock[]>().notNull().default([]),
    filter: jsonb('filter').$type<CampaignFilter>().notNull().default({}),
    kind: text('kind', { enum: ['campaign', 'reminder'] }).notNull().default('campaign'),
    status: text('status', { enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled'] }).notNull().default('draft'),
    scheduledFor: timestamp('scheduled_for', tz),
    sentAt: timestamp('sent_at', tz),
    recipients: integer('recipients').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('campaigns_edition_idx').on(t.editionId)],
);

/** One row per reminder step already handled, so the ladder never sends the same step twice. */
export const reminderLog = pgTable(
  'reminder_log',
  {
    id: id(),
    editionId: uuid('edition_id').notNull(),
    standId: uuid('stand_id').notNull(),
    /** task:<id> or category:<id> */
    subject: text('subject').notNull(),
    /** d14, d7, d1, overdue, or opened */
    step: text('step').notNull(),
    channel: text('channel', { enum: ['email', 'assistant'] }).notNull(),
    outboxId: uuid('outbox_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('reminder_log_unique').on(t.standId, t.subject, t.step, t.channel)],
);

export const announcements = pgTable(
  'announcements',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    bodyHtml: text('body_html').notNull().default(''),
    visibleToTypes: jsonb('visible_to_types').$type<string[]>().notNull().default([]),
    pinned: boolean('pinned').notNull().default(false),
    publishedAt: timestamp('published_at', tz),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('announcements_edition_idx').on(t.editionId)],
);

// ---------------------------------------------------------------------------
// Help desk
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    standId: uuid('stand_id').references(() => stands.id, { onDelete: 'set null' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    openedBy: uuid('opened_by'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    /** Reference shown to exhibitors, for example HD-000012. */
    number: text('number'),
    subject: text('subject').notNull(),
    status: text('status', { enum: ['open', 'pending', 'closed'] }).notNull().default('open'),
    lastMessageAt: timestamp('last_message_at', tz),
    lastMessageBy: text('last_message_by', { enum: ['exhibitor', 'staff'] }),
    source: text('source', { enum: ['portal', 'assistant', 'staff'] }).notNull().default('portal'),
    assignedTo: uuid('assigned_to'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tickets_edition_idx').on(t.editionId, t.status)],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id'),
    body: text('body').notNull(),
    /** Internal notes are never shown to the exhibitor. */
    internal: boolean('internal').notNull().default(false),
    /** Uploaded files (ticket purpose) attached to this message. */
    attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId)],
);

export const savedReplies = pgTable('saved_replies', {
  id: id(),
  editionId: uuid('edition_id').references(() => editions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// AI assistant
// ---------------------------------------------------------------------------

export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    standId: uuid('stand_id').references(() => stands.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    /** Set when the exhibitor starts a new conversation; old ones stay for the record. */
    closedAt: timestamp('closed_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assistant_conversations_user_idx').on(t.userId, t.editionId)],
);

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    /** Links, drafted form answers and actions the assistant proposed. */
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('assistant_messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const assistantUnanswered = pgTable(
  'assistant_unanswered',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    conversationId: uuid('conversation_id'),
    resolvedAt: timestamp('resolved_at', tz),
    resolvedBy: uuid('resolved_by'),
    createdAt: createdAt(),
  },
  (t) => [index('assistant_unanswered_edition_idx').on(t.editionId)],
);

/** Questions and answers the show team adds for the assistant (often from questions it could not answer). */
export const assistantFaqs = pgTable(
  'assistant_faqs',
  {
    id: id(),
    editionId: uuid('edition_id')
      .notNull()
      .references(() => editions.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assistant_faqs_edition_idx').on(t.editionId)],
);
