CREATE TYPE "app"."group_status" AS ENUM('QUOTED', 'CLAIMED', 'SENT', 'EXPIRED', 'RELEASED');--> statement-breakpoint
CREATE TYPE "app"."signing_tier" AS ENUM('sign_all', 'sign_and_send', 'single', 'evm_calls', 'evm_single', 'psbt');--> statement-breakpoint
ALTER TYPE "app"."gas_payer" ADD VALUE 'user_solana';--> statement-breakpoint
CREATE TABLE "app"."operation_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"chain" "app"."asset_chain" NOT NULL,
	"tier" "app"."signing_tier" NOT NULL,
	"status" "app"."group_status" DEFAULT 'QUOTED' NOT NULL,
	"fee_leg_id" uuid,
	"quote_block_height" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"send_by" timestamp with time zone NOT NULL,
	"wallet_name" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."operation_fee_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_fee_id" uuid NOT NULL,
	"fee_leg_id" uuid NOT NULL,
	"amount_micro" numeric NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_chain_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "fee_share" jsonb;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "fee_covered_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "retry_of" uuid;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "needs_action_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "sol_required_lamports" numeric;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "approvals_estimate" integer;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "last_continue_key" text;--> statement-breakpoint
ALTER TABLE "app"."operation_groups" ADD CONSTRAINT "operation_groups_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_groups" ADD CONSTRAINT "operation_groups_fee_leg_id_operation_legs_id_fk" FOREIGN KEY ("fee_leg_id") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_fee_charges" ADD CONSTRAINT "operation_fee_charges_operation_fee_id_operation_fees_id_fk" FOREIGN KEY ("operation_fee_id") REFERENCES "app"."operation_fees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_fee_charges" ADD CONSTRAINT "operation_fee_charges_fee_leg_id_operation_legs_id_fk" FOREIGN KEY ("fee_leg_id") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_groups_key" ON "app"."operation_groups" USING btree ("operation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_groups_one_open" ON "app"."operation_groups" USING btree ("operation_id","chain") WHERE "app"."operation_groups"."status" in ('QUOTED', 'CLAIMED');--> statement-breakpoint
CREATE UNIQUE INDEX "operation_fee_charges_fee_leg" ON "app"."operation_fee_charges" USING btree ("operation_fee_id","fee_leg_id");--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_group_id_operation_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "app"."operation_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_fee_covered_by_operation_legs_id_fk" FOREIGN KEY ("fee_covered_by") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_retry_of_operation_legs_id_fk" FOREIGN KEY ("retry_of") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_retry_of_unique" UNIQUE("retry_of");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.operation_groups, app.operation_fee_charges TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.operation_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.operation_groups FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE app.operation_fee_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.operation_fee_charges FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Every fee that already settled becomes one charge, paid by the operation's (single) fee leg, so earnings and revenue keep their history.
INSERT INTO app.operation_fee_charges (id, operation_fee_id, fee_leg_id, amount_micro, settled_at, settled_chain_at, created_at)
SELECT gen_random_uuid(), f.id, f.leg_id, f.amount_micro, f.settled_at, f.settled_chain_at, f.settled_at
FROM app.operation_fees f WHERE f.settled_at IS NOT NULL AND f.amount_micro > 0 AND f.leg_id IS NOT NULL;
