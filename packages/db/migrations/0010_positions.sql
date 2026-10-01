CREATE TYPE "app"."gas_drop_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "app"."gas_payer" AS ENUM('platform_fee_payer', 'platform_gas_drop', 'user_btc_inputs');--> statement-breakpoint
CREATE TYPE "app"."ledger_reason" AS ENUM('invest', 'sell');--> statement-breakpoint
CREATE TYPE "app"."leg_kind" AS ENUM('network_fee', 'swap', 'cross_chain');--> statement-breakpoint
CREATE TYPE "app"."leg_status" AS ENUM('PLANNED', 'SUBMITTED', 'PENDING_CHAIN', 'SETTLED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "app"."operation_kind" AS ENUM('invest', 'sell_to_usdc', 'sell_former');--> statement-breakpoint
CREATE TYPE "app"."operation_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "app"."platform_wallet_purpose" AS ENUM('solana_fee_payer', 'evm_gas', 'gas_treasury');--> statement-breakpoint
CREATE TYPE "app"."position_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "app"."reconciliation_status" AS ENUM('OK', 'SHORT', 'SURPLUS');--> statement-breakpoint
ALTER TYPE "app"."chain" ADD VALUE 'bitcoin';--> statement-breakpoint
ALTER TYPE "app"."chain_family" ADD VALUE 'bitcoin';--> statement-breakpoint
ALTER TYPE "app"."verification_method" ADD VALUE 'bip322';--> statement-breakpoint
ALTER TYPE "app"."verification_method" ADD VALUE 'bip137';--> statement-breakpoint
CREATE TABLE "app"."basket_positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"basket_id" uuid NOT NULL,
	"status" "app"."position_status" DEFAULT 'OPEN' NOT NULL,
	"applied_version_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "basket_positions_closed_at" CHECK (("app"."basket_positions"."status" = 'CLOSED') = ("app"."basket_positions"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."gas_drops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"leg_id" uuid NOT NULL,
	"chain" "app"."asset_chain" NOT NULL,
	"recipient" text NOT NULL,
	"amount_native" numeric NOT NULL,
	"tx_hash" text,
	"status" "app"."gas_drop_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."operation_legs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" "app"."leg_kind" NOT NULL,
	"from_chain" "app"."asset_chain" NOT NULL,
	"from_deployment_id" uuid,
	"to_chain" "app"."asset_chain" NOT NULL,
	"to_deployment_id" uuid,
	"amount_in" numeric NOT NULL,
	"min_out" numeric,
	"provider" text,
	"route_summary" jsonb,
	"quote_expires_at" timestamp with time zone,
	"built_message_hash" text,
	"expected_tx" jsonb,
	"status" "app"."leg_status" DEFAULT 'PLANNED' NOT NULL,
	"source_tx" text,
	"destination_tx" text,
	"amount_received" numeric,
	"gas_payer" "app"."gas_payer",
	"failure_reason" text,
	"submitted_at" timestamp with time zone,
	"unknown_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_legs_amount_positive" CHECK ("app"."operation_legs"."amount_in" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"basket_id" uuid NOT NULL,
	"position_id" uuid,
	"kind" "app"."operation_kind" NOT NULL,
	"status" "app"."operation_status" DEFAULT 'PLANNED' NOT NULL,
	"amount_usdc" numeric,
	"sell_percent" integer,
	"slippage_bps" integer NOT NULL,
	"network_fee_usdc" numeric NOT NULL,
	"version_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_slippage_range" CHECK ("app"."operations"."slippage_bps" between 1 and 300),
	CONSTRAINT "operations_sell_percent_range" CHECK ("app"."operations"."sell_percent" is null or "app"."operations"."sell_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "app"."platform_wallets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chain" "app"."asset_chain" NOT NULL,
	"purpose" "app"."platform_wallet_purpose" NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."position_ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"quantity_delta" numeric NOT NULL,
	"reason" "app"."ledger_reason" NOT NULL,
	"leg_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."position_reconciliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"ledger_quantity" numeric NOT NULL,
	"allocated_quantity" numeric NOT NULL,
	"wallet_balance" numeric NOT NULL,
	"status" "app"."reconciliation_status" NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sponsor_usage" (
	"user_id" uuid NOT NULL,
	"chain" "app"."asset_chain" NOT NULL,
	"day" date NOT NULL,
	"amount_native" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "sponsor_usage_user_id_chain_day_pk" PRIMARY KEY("user_id","chain","day")
);
--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" DROP CONSTRAINT "wallet_addresses_chain_family";--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" DROP CONSTRAINT "wallet_addresses_method_family";--> statement-breakpoint
ALTER TABLE "app"."basket_positions" ADD CONSTRAINT "basket_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_positions" ADD CONSTRAINT "basket_positions_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_positions" ADD CONSTRAINT "basket_positions_applied_version_id_basket_versions_id_fk" FOREIGN KEY ("applied_version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."gas_drops" ADD CONSTRAINT "gas_drops_leg_id_operation_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_from_deployment_id_instrument_deployments_id_fk" FOREIGN KEY ("from_deployment_id") REFERENCES "app"."instrument_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_legs" ADD CONSTRAINT "operation_legs_to_deployment_id_instrument_deployments_id_fk" FOREIGN KEY ("to_deployment_id") REFERENCES "app"."instrument_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD CONSTRAINT "operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD CONSTRAINT "operations_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD CONSTRAINT "operations_position_id_basket_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "app"."basket_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operations" ADD CONSTRAINT "operations_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_ledger_entries" ADD CONSTRAINT "position_ledger_entries_position_id_basket_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "app"."basket_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_ledger_entries" ADD CONSTRAINT "position_ledger_entries_deployment_id_instrument_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "app"."instrument_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_ledger_entries" ADD CONSTRAINT "position_ledger_entries_leg_id_operation_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_reconciliations" ADD CONSTRAINT "position_reconciliations_position_id_basket_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "app"."basket_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."position_reconciliations" ADD CONSTRAINT "position_reconciliations_deployment_id_instrument_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "app"."instrument_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sponsor_usage" ADD CONSTRAINT "sponsor_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "basket_positions_one_open" ON "app"."basket_positions" USING btree ("user_id","basket_id") WHERE "app"."basket_positions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "basket_positions_user_idx" ON "app"."basket_positions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gas_drops_leg_key" ON "app"."gas_drops" USING btree ("leg_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_legs_sequence" ON "app"."operation_legs" USING btree ("operation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_user_idempotency_key" ON "app"."operations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_one_active_per_user" ON "app"."operations" USING btree ("user_id") WHERE "app"."operations"."status" in ('PLANNED', 'IN_PROGRESS');--> statement-breakpoint
CREATE UNIQUE INDEX "platform_wallets_chain_purpose" ON "app"."platform_wallets" USING btree ("chain","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "position_ledger_leg_deployment" ON "app"."position_ledger_entries" USING btree ("leg_id","deployment_id");--> statement-breakpoint
CREATE INDEX "position_ledger_position_idx" ON "app"."position_ledger_entries" USING btree ("position_id","deployment_id");--> statement-breakpoint
CREATE INDEX "position_reconciliations_latest_idx" ON "app"."position_reconciliations" USING btree ("position_id","deployment_id","checked_at");--> statement-breakpoint
CREATE INDEX "sponsor_usage_chain_day_idx" ON "app"."sponsor_usage" USING btree ("chain","day");--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD CONSTRAINT "wallet_addresses_chain_family" CHECK (("app"."wallet_addresses"."chain_family"::text = 'solana') = ("app"."wallet_addresses"."chain"::text = 'solana') and ("app"."wallet_addresses"."chain_family"::text = 'bitcoin') = ("app"."wallet_addresses"."chain"::text = 'bitcoin'));--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD CONSTRAINT "wallet_addresses_method_family" CHECK (("app"."wallet_addresses"."chain_family"::text = 'solana') = ("app"."wallet_addresses"."verification_method"::text = 'ed25519') and ("app"."wallet_addresses"."chain_family"::text = 'bitcoin') = ("app"."wallet_addresses"."verification_method"::text in ('bip322', 'bip137')));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.basket_positions, app.operations, app.operation_legs, app.platform_wallets, app.gas_drops, app.sponsor_usage
TO bytesac_api;
--> statement-breakpoint
-- Append-only: no UPDATE, no DELETE.
GRANT SELECT, INSERT ON app.position_ledger_entries, app.position_reconciliations TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.basket_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operation_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.position_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.gas_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sponsor_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.position_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.basket_positions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.operations FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.operation_legs FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.position_ledger_entries FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.platform_wallets FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.gas_drops FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.sponsor_usage FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.position_reconciliations FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
