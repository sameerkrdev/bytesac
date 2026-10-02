CREATE TYPE "app"."route_tool_kind" AS ENUM('bridge', 'exchange');--> statement-breakpoint
CREATE TABLE "app"."route_policy_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "app"."route_tool_kind" NOT NULL,
	"tool_key" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."instrument_deployments" ADD COLUMN "fee_on_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "provider_substatus" text;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "recovery_of" uuid;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD COLUMN "recovery_token" jsonb;--> statement-breakpoint
ALTER TABLE "app"."route_policy_entries" ADD CONSTRAINT "route_policy_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_policy_entries" ADD CONSTRAINT "route_policy_entries_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "route_policy_active" ON "app"."route_policy_entries" USING btree ("kind","tool_key") WHERE "app"."route_policy_entries"."removed_at" is null;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_recovery_of_operation_legs_id_fk" FOREIGN KEY ("recovery_of") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_recovery_of_unique" UNIQUE("recovery_of");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.route_policy_entries TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.route_policy_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.route_policy_entries FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
