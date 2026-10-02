CREATE TYPE "app"."fee_kind" AS ENUM('network', 'manager_entry', 'manager_rebalance', 'platform');--> statement-breakpoint
CREATE TYPE "app"."fee_scope" AS ENUM('default', 'organization', 'basket');--> statement-breakpoint
CREATE TYPE "app"."platform_fee_operation" AS ENUM('invest', 'rebalance_apply', 'rebalance_drift', 'repair', 'sell_to_usdc', 'sell_former');--> statement-breakpoint
ALTER TYPE "app"."platform_wallet_purpose" ADD VALUE 'revenue_treasury';--> statement-breakpoint
CREATE TABLE "app"."operation_fees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"leg_id" uuid,
	"kind" "app"."fee_kind" NOT NULL,
	"base_micro" numeric NOT NULL,
	"bps" integer,
	"cap_micro" numeric,
	"amount_micro" numeric NOT NULL,
	"recipient_address" text,
	"organization_id" uuid,
	"basket_id" uuid,
	"schedule_id" uuid,
	"waived_reason" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."platform_fee_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "app"."fee_scope" NOT NULL,
	"scope_id" uuid,
	"operation_kind" "app"."platform_fee_operation" NOT NULL,
	"bps" integer NOT NULL,
	"min_micro" numeric,
	"max_micro" numeric,
	"ends_at" timestamp with time zone,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "platform_fee_bps_range" CHECK ("app"."platform_fee_schedules"."bps" between 0 and 100),
	CONSTRAINT "platform_fee_min_max" CHECK ("app"."platform_fee_schedules"."min_micro" is null or "app"."platform_fee_schedules"."max_micro" is null or "app"."platform_fee_schedules"."min_micro" <= "app"."platform_fee_schedules"."max_micro")
);
--> statement-breakpoint
ALTER TABLE "app"."operation_fees" ADD CONSTRAINT "operation_fees_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_fees" ADD CONSTRAINT "operation_fees_leg_id_operation_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_fees" ADD CONSTRAINT "operation_fees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_fees" ADD CONSTRAINT "operation_fees_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_fees" ADD CONSTRAINT "operation_fees_schedule_id_platform_fee_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "app"."platform_fee_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."platform_fee_schedules" ADD CONSTRAINT "platform_fee_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_fees_org_settled_idx" ON "app"."operation_fees" USING btree ("organization_id","settled_at");--> statement-breakpoint
CREATE INDEX "operation_fees_kind_settled_idx" ON "app"."operation_fees" USING btree ("kind","settled_at");--> statement-breakpoint
CREATE INDEX "operation_fees_operation_idx" ON "app"."operation_fees" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_fee_active" ON "app"."platform_fee_schedules" USING btree ("scope",coalesce("scope_id", '00000000-0000-0000-0000-000000000000'),"operation_kind") WHERE "app"."platform_fee_schedules"."superseded_at" is null;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.operation_fees, app.platform_fee_schedules TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.operation_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_fee_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.operation_fees FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.platform_fee_schedules FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
