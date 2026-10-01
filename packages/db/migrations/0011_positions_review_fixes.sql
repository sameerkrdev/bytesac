ALTER TYPE "app"."leg_status" ADD VALUE 'SUBMITTING' BEFORE 'SUBMITTED';--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "gas_reserved" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_legs_source_tx" ON "app"."operation_legs" USING btree ("from_chain","source_tx") WHERE "app"."operation_legs"."source_tx" is not null;