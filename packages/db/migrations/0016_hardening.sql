ALTER TYPE "app"."notification_kind" ADD VALUE 'instrument_not_investable';--> statement-breakpoint
ALTER TABLE "app"."basket_versions" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."operation_fees" ADD COLUMN "settled_chain_at" timestamp with time zone;