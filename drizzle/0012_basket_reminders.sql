ALTER TABLE "editions" ADD COLUMN "basket_reminders" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "cart_items" SET "updated_at" = "created_at";
