CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"edition_id" uuid,
	"company_id" uuid,
	"ip" text,
	"user_agent" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'exhibitor' NOT NULL,
	"website" text,
	"description" text,
	"logo_file_id" uuid,
	"email" text,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"postcode" text,
	"country" text DEFAULT 'United Kingdom',
	"vat_number" text,
	"asp_exhibitor_id" text,
	"invoice_allowed" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'colleague' NOT NULL,
	"can_pay" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_members_company_id_user_id_pk" PRIMARY KEY("company_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"edition_id" uuid,
	"company_id" uuid,
	"stand_id" uuid,
	"supplier_id" uuid,
	"role" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_timeout_seconds" integer NOT NULL,
	"two_factor_verified" boolean DEFAULT false NOT NULL,
	"view_as_user_id" uuid,
	"view_as_edition_id" uuid,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text,
	"job_title" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"password_hash" text,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_password_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"anonymised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_staff" (
	"edition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_staff_edition_id_user_id_pk" PRIMARY KEY("edition_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"venue" text,
	"city" text,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"vat_rate_bps" integer DEFAULT 2000 NOT NULL,
	"build_up_starts_at" timestamp with time zone,
	"open_starts_at" timestamp with time zone,
	"open_ends_at" timestamp with time zone,
	"breakdown_ends_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"space_only_rules" jsonb,
	"fee_mode" text,
	"default_commission_type" text,
	"default_commission_value" integer,
	"cloned_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exhibitor_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exhibitor_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_space_only" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"purpose" text NOT NULL,
	"edition_id" uuid,
	"company_id" uuid,
	"stand_id" uuid,
	"supplier_id" uuid,
	"is_public" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "halls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stand_contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stand_id" uuid NOT NULL,
	"contractor_company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"user_id" uuid,
	"status" text DEFAULT 'invited' NOT NULL,
	"nominated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"hall_id" uuid,
	"number" text NOT NULL,
	"exhibitor_type_id" uuid NOT NULL,
	"company_id" uuid,
	"size_sqm" numeric(8, 2),
	"open_sides" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"visible_to_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_only_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stand_id" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"declared_height_m" numeric(6, 2),
	"declared_platform_mm" integer,
	"has_steps" boolean DEFAULT false NOT NULL,
	"is_complex" boolean DEFAULT false NOT NULL,
	"insurance_expires_on" date,
	"insurance_cover_gbp" integer,
	"conditions" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"certificate_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_only_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"reviewer_id" uuid,
	"reviewer_role" text NOT NULL,
	"outcome" text NOT NULL,
	"doc_type" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_only_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"documents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"declarations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completeness" jsonb DEFAULT '{"missing":[],"warnings":[]}'::jsonb NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"stand_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"deadline_override_at" timestamp with time zone,
	"reopened_until" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_requirements" (
	"task_id" uuid NOT NULL,
	"exhibitor_type_id" uuid NOT NULL,
	"requirement" text NOT NULL,
	CONSTRAINT "task_requirements_task_id_exhibitor_type_id_pk" PRIMARY KEY("task_id","exhibitor_type_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description_html" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'form' NOT NULL,
	"form_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deadline_offset_days" integer,
	"deadline_at" timestamp with time zone,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"linked_page_id" uuid,
	"linked_category_id" uuid,
	"reminder_offsets" jsonb,
	"published" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stand_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"total_pence" integer NOT NULL,
	"file_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"supplier_id" uuid,
	"category_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_pence" integer NOT NULL,
	"vat_rate_bps" integer NOT NULL,
	"net_pence" integer NOT NULL,
	"vat_pence" integer NOT NULL,
	"commission_pence" integer NOT NULL,
	"card_fee_share_pence" integer DEFAULT 0 NOT NULL,
	"supplier_payout_pence" integer NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fulfilment_status" text DEFAULT 'received' NOT NULL,
	"refunded_pence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"edition_id" uuid NOT NULL,
	"stand_id" uuid NOT NULL,
	"company_id" uuid,
	"placed_by" uuid,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"payment_method" text NOT NULL,
	"fee_mode" text NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"net_pence" integer NOT NULL,
	"vat_pence" integer NOT NULL,
	"commission_pence" integer NOT NULL,
	"card_fee_pence" integer DEFAULT 0 NOT NULL,
	"total_pence" integer NOT NULL,
	"refunded_pence" integer DEFAULT 0 NOT NULL,
	"po_number" text,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"supplier_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"image_file_id" uuid,
	"unit" text DEFAULT 'each' NOT NULL,
	"price_pence" integer NOT NULL,
	"early_price_pence" integer,
	"early_until_offset_days" integer,
	"late_price_pence" integer,
	"late_from_offset_days" integer,
	"vat_rate_bps" integer DEFAULT 2000 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stock_limit" integer,
	"visible_to_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"commission_type" text,
	"commission_value" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid,
	"amount_pence" integer NOT NULL,
	"reason" text,
	"stripe_refund_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"supplier_id" uuid,
	"commission_type" text,
	"commission_value" integer,
	"order_by_offset_days" integer,
	"visible_to_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "supplier_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"reversed_pence" integer DEFAULT 0 NOT NULL,
	"stripe_transfer_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_users" (
	"supplier_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_users_supplier_id_user_id_pk" PRIMARY KEY("supplier_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"website" text,
	"stripe_account_id" text,
	"stripe_charges_enabled" boolean DEFAULT false NOT NULL,
	"stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
	"stripe_details_submitted" boolean DEFAULT false NOT NULL,
	"commission_type" text,
	"commission_value" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"visible_to_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"stand_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_unanswered" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"question" text NOT NULL,
	"conversation_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kind" text DEFAULT 'campaign' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"type" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_event_id" text
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"to_email" text NOT NULL,
	"to_user_id" uuid,
	"company_id" uuid,
	"stand_id" uuid,
	"template_key" text NOT NULL,
	"category" text NOT NULL,
	"from_address" text NOT NULL,
	"reply_to" text,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"campaign_id" uuid,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text DEFAULT 'transactional' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"stand_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"step" text NOT NULL,
	"channel" text NOT NULL,
	"outbox_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"stand_id" uuid,
	"company_id" uuid,
	"opened_by" uuid,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'portal' NOT NULL,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unsubscribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"edition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_view_as_user_id_users_id_fk" FOREIGN KEY ("view_as_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_staff" ADD CONSTRAINT "edition_staff_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_staff" ADD CONSTRAINT "edition_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_notes" ADD CONSTRAINT "exhibitor_notes_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_notes" ADD CONSTRAINT "exhibitor_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_types" ADD CONSTRAINT "exhibitor_types_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "halls" ADD CONSTRAINT "halls_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stand_contractors" ADD CONSTRAINT "stand_contractors_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stand_contractors" ADD CONSTRAINT "stand_contractors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stands" ADD CONSTRAINT "stands_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stands" ADD CONSTRAINT "stands_hall_id_halls_id_fk" FOREIGN KEY ("hall_id") REFERENCES "public"."halls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stands" ADD CONSTRAINT "stands_exhibitor_type_id_exhibitor_types_id_fk" FOREIGN KEY ("exhibitor_type_id") REFERENCES "public"."exhibitor_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stands" ADD CONSTRAINT "stands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_pages" ADD CONSTRAINT "manual_pages_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_only_packs" ADD CONSTRAINT "space_only_packs_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_only_reviews" ADD CONSTRAINT "space_only_reviews_pack_id_space_only_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."space_only_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_only_versions" ADD CONSTRAINT "space_only_versions_pack_id_space_only_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."space_only_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirements" ADD CONSTRAINT "task_requirements_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirements" ADD CONSTRAINT "task_requirements_exhibitor_type_id_exhibitor_types_id_fk" FOREIGN KEY ("exhibitor_type_id") REFERENCES "public"."exhibitor_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfers" ADD CONSTRAINT "supplier_transfers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_transfers" ADD CONSTRAINT "supplier_transfers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_users" ADD CONSTRAINT "supplier_users_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_users" ADD CONSTRAINT "supplier_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_unanswered" ADD CONSTRAINT "assistant_unanswered_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_outbox_id_email_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."email_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_stand_id_stands_id_fk" FOREIGN KEY ("stand_id") REFERENCES "public"."stands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_edition_idx" ON "audit_log" USING btree ("edition_id","at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "company_members_user_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cron_runs_job_idx" ON "cron_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitations_edition_idx" ON "invitations" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "library_kind_idx" ON "library_items" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "login_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "edition_staff_user_idx" ON "edition_staff" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_slug_unique" ON "editions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "editions_show_idx" ON "editions" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "exhibitor_notes_company_idx" ON "exhibitor_notes" USING btree ("edition_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exhibitor_types_key_unique" ON "exhibitor_types" USING btree ("edition_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "files_key_unique" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_stand_idx" ON "files" USING btree ("stand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "halls_name_unique" ON "halls" USING btree ("edition_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "shows_slug_unique" ON "shows" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "stand_contractors_stand_unique" ON "stand_contractors" USING btree ("stand_id");--> statement-breakpoint
CREATE INDEX "stand_contractors_user_idx" ON "stand_contractors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stands_number_unique" ON "stands" USING btree ("edition_id","number");--> statement-breakpoint
CREATE INDEX "stands_company_idx" ON "stands" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_pages_slug_unique" ON "manual_pages" USING btree ("edition_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "space_only_packs_stand_unique" ON "space_only_packs" USING btree ("stand_id");--> statement-breakpoint
CREATE INDEX "space_only_reviews_pack_idx" ON "space_only_reviews" USING btree ("pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_only_versions_unique" ON "space_only_versions" USING btree ("pack_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_task_stand_unique" ON "submissions" USING btree ("task_id","stand_id");--> statement-breakpoint
CREATE INDEX "submissions_stand_idx" ON "submissions" USING btree ("stand_id");--> statement-breakpoint
CREATE INDEX "tasks_edition_idx" ON "tasks" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "cart_items_stand_idx" ON "cart_items" USING btree ("stand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_supplier_idx" ON "order_lines" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_unique" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "orders_edition_idx" ON "orders" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "orders_stand_idx" ON "orders" USING btree ("stand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_unique" ON "orders" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX "products_edition_idx" ON "products" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "service_categories_edition_idx" ON "service_categories" USING btree ("edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_transfers_unique" ON "supplier_transfers" USING btree ("order_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_users_user_idx" ON "supplier_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_stripe_unique" ON "suppliers" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "announcements_edition_idx" ON "announcements" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "assistant_conversations_user_idx" ON "assistant_conversations" USING btree ("user_id","edition_id");--> statement-breakpoint
CREATE INDEX "assistant_messages_conversation_idx" ON "assistant_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_unanswered_edition_idx" ON "assistant_unanswered" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "campaigns_edition_idx" ON "campaigns" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "email_events_outbox_idx" ON "email_events" USING btree ("outbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_provider_unique" ON "email_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_company_idx" ON "email_outbox" USING btree ("edition_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_provider_unique" ON "email_outbox" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "email_templates_edition_idx" ON "email_templates" USING btree ("edition_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_log_unique" ON "reminder_log" USING btree ("stand_id","subject","step","channel");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_edition_idx" ON "tickets" USING btree ("edition_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "unsubscribes_unique" ON "unsubscribes" USING btree ("email","edition_id");