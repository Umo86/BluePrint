ALTER TABLE "invoices" ADD COLUMN "refund_id" uuid;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "cart_item_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "line_amounts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "card_fee_pence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_transfers" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_transfers" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "vat_registered" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_refund_unique" ON "invoices" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "supplier_transfers_supplier_idx" ON "supplier_transfers" USING btree ("supplier_id");