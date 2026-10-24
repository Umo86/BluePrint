CREATE TABLE "assistant_faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "assistant_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_unanswered" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_message_by" text;--> statement-breakpoint
ALTER TABLE "assistant_faqs" ADD CONSTRAINT "assistant_faqs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_faqs_edition_idx" ON "assistant_faqs" USING btree ("edition_id");