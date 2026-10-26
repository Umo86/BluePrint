ALTER TABLE "editions" ADD COLUMN "contacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stands" ADD COLUMN "width_m" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "stands" ADD COLUMN "depth_m" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "product_code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "code" text;