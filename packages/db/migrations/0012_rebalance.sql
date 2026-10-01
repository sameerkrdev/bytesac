CREATE TYPE "app"."allocation_status" AS ENUM('ALIGNED', 'WEIGHT_DRIFT', 'CUSTOMIZED');--> statement-breakpoint
CREATE TYPE "app"."cash_reason" AS ENUM('rebalance_sell', 'rebalance_buy', 'network_fee', 'sell', 'sync');--> statement-breakpoint
CREATE TYPE "app"."decision_kind" AS ENUM('skip', 'keep_custom', 'revert_custom', 'sync');--> statement-breakpoint
CREATE TYPE "app"."notification_kind" AS ENUM('rebalance_available', 'drifted', 'repair_required', 'execution_incomplete', 'basket_paused', 'basket_unpaused', 'basket_retirement_pending', 'basket_retired', 'lead_changed');--> statement-breakpoint
ALTER TYPE "app"."ledger_reason" ADD VALUE 'rebalance';--> statement-breakpoint
ALTER TYPE "app"."ledger_reason" ADD VALUE 'repair';--> statement-breakpoint
ALTER TYPE "app"."ledger_reason" ADD VALUE 'sync';--> statement-breakpoint
ALTER TYPE "app"."operation_kind" ADD VALUE 'rebalance';--> statement-breakpoint
ALTER TYPE "app"."operation_kind" ADD VALUE 'repair';--> statement-breakpoint
CREATE TABLE "app"."position_cash_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position_id" uuid NOT NULL,
	"amount_micro" numeric NOT NULL,
	"reason" "app"."cash_reason" NOT NULL,
	"leg_id" uuid,
	"decision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_cash_source" CHECK (num_nonnulls("app"."position_cash_entries"."leg_id", "app"."position_cash_entries"."decision_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "app"."position_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position_id" uuid NOT NULL,
	"kind" "app"."decision_kind" NOT NULL,
	"version_id" uuid,
	"data" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "app"."notification_kind" NOT NULL,
	"basket_id" uuid,
	"position_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."push_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DROP INDEX "app"."position_ledger_leg_deployment";--> statement-breakpoint
ALTER TABLE "app"."operations" ALTER COLUMN "basket_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."position_ledger_entries" ALTER COLUMN "leg_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."position_reconciliations" ALTER COLUMN "deployment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."basket_positions" ADD COLUMN "allocation_status" "app"."allocation_status" DEFAULT 'ALIGNED' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."basket_positions" ADD COLUMN "allocation_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "deployment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "repair_shares" jsonb;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD COLUMN "buy_scale" jsonb;--> statement-breakpoint
ALTER TABLE "app"."position_ledger_entries" ADD COLUMN "decision_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."position_cash_entries" ADD CONSTRAINT "position_cash_entries_position_id_basket_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "app"."basket_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_cash_entries" ADD CONSTRAINT "position_cash_entries_leg_id_operation_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_cash_entries" ADD CONSTRAINT "position_cash_entries_decision_id_position_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "app"."position_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_decisions" ADD CONSTRAINT "position_decisions_position_id_basket_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "app"."basket_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_decisions" ADD CONSTRAINT "position_decisions_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_decisions" ADD CONSTRAINT "position_decisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_position_id_basket_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "app"."basket_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "position_cash_leg_position_reason" ON "app"."position_cash_entries" USING btree ("leg_id","position_id","reason");--> statement-breakpoint
CREATE INDEX "position_cash_position_idx" ON "app"."position_cash_entries" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "position_decisions_skip_once" ON "app"."position_decisions" USING btree ("position_id","version_id") WHERE "app"."position_decisions"."kind" = 'skip';--> statement-breakpoint
CREATE INDEX "position_decisions_position_idx" ON "app"."position_decisions" USING btree ("position_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe" ON "app"."notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "app"."notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "app"."push_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "app"."operations" ADD CONSTRAINT "operations_deployment_id_instrument_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "app"."instrument_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_ledger_entries" ADD CONSTRAINT "position_ledger_entries_decision_id_position_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "app"."position_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "position_ledger_leg_position_deployment" ON "app"."position_ledger_entries" USING btree ("leg_id","position_id","deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "position_ledger_decision_position_deployment" ON "app"."position_ledger_entries" USING btree ("decision_id","position_id","deployment_id");--> statement-breakpoint
ALTER TABLE "app"."operations" ADD CONSTRAINT "operations_repair_basket" CHECK (("app"."operations"."kind"::text = 'repair') = ("app"."operations"."basket_id" is null));--> statement-breakpoint
ALTER TABLE "app"."position_ledger_entries" ADD CONSTRAINT "position_ledger_source" CHECK (num_nonnulls("app"."position_ledger_entries"."leg_id", "app"."position_ledger_entries"."decision_id") = 1);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.notifications, app.push_tokens TO bytesac_api;
--> statement-breakpoint
-- Append-only: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON app.position_cash_entries, app.position_decisions TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.position_cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.position_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.position_cash_entries FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.position_decisions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.notifications FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.push_tokens FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
