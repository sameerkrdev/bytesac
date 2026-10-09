ALTER TYPE "app"."address_status" ADD VALUE 'replaced';--> statement-breakpoint
ALTER TYPE "app"."chain" ADD VALUE 'polygon' BEFORE 'solana';--> statement-breakpoint
ALTER TYPE "app"."challenge_purpose" ADD VALUE 'reassign_chain';--> statement-breakpoint
ALTER TABLE "app"."auth_challenges" ADD COLUMN "chains" text[];--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD COLUMN "wallet_name" text;--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD COLUMN "replaced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD COLUMN "replaced_by_address_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD CONSTRAINT "wallet_addresses_replaced_by_address_id_wallet_addresses_id_fk" FOREIGN KEY ("replaced_by_address_id") REFERENCES "app"."wallet_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_active_chain_key" ON "app"."wallet_addresses" USING btree ("investment_wallet_id","chain") WHERE "app"."wallet_addresses"."status" = 'active';--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD CONSTRAINT "wallet_addresses_replaced" CHECK ("app"."wallet_addresses"."status"::text <> 'replaced' OR ("app"."wallet_addresses"."replaced_at" IS NOT NULL AND "app"."wallet_addresses"."replaced_by_address_id" IS NOT NULL));