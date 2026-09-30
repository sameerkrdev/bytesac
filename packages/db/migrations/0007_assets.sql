CREATE TYPE "app"."asset_chain" AS ENUM('solana', 'ethereum', 'base', 'bnb', 'arbitrum', 'polygon', 'bitcoin');--> statement-breakpoint
CREATE TYPE "app"."asset_event_entity" AS ENUM('instrument', 'deployment', 'route', 'rule', 'price');--> statement-breakpoint
CREATE TYPE "app"."asset_event_kind" AS ENUM('created', 'updated', 'verified', 'submitted', 'decided', 'approved', 'activated', 'paused', 'resumed', 'deprecated', 'retired', 'nav_recorded');--> statement-breakpoint
CREATE TYPE "app"."asset_item_status" AS ENUM('DRAFT', 'APPROVED', 'ACTIVE', 'PAUSED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "app"."asset_provider_kind" AS ENUM('dex_aggregator', 'issuer_platform', 'venue', 'bridge', 'other');--> statement-breakpoint
CREATE TYPE "app"."asset_type" AS ENUM('CRYPTO', 'STABLECOIN', 'TOKENIZED_TREASURY', 'TOKENIZED_EQUITY', 'TOKENIZED_FUND', 'TOKENIZED_BOND', 'TOKENIZED_COMMODITY', 'TOKENIZED_PRIVATE_CREDIT', 'TOKENIZED_OTHER');--> statement-breakpoint
CREATE TYPE "app"."deployment_verification" AS ENUM('onchain', 'manual');--> statement-breakpoint
CREATE TYPE "app"."eligibility_action" AS ENUM('acquire', 'sell', 'redeem', 'transfer');--> statement-breakpoint
CREATE TYPE "app"."eligibility_outcome" AS ENUM('ALLOWED', 'RESTRICTED', 'KYC_REQUIRED', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "app"."execution_method" AS ENUM('swap', 'subscription', 'secondary_market', 'platform_inventory', 'redemption', 'cross_chain_transfer');--> statement-breakpoint
CREATE TYPE "app"."instrument_status" AS ENUM('DRAFT', 'UNDER_REVIEW', 'CHANGES_REQUIRED', 'APPROVED', 'ACTIVE', 'PAUSED', 'DEPRECATED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "app"."price_kind" AS ENUM('market', 'nav');--> statement-breakpoint
CREATE TYPE "app"."price_provider" AS ENUM('coinmarketcap', 'issuer');--> statement-breakpoint
CREATE TYPE "app"."processing_model" AS ENUM('sync', 'async');--> statement-breakpoint
CREATE TYPE "app"."rule_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "app"."token_standard" AS ENUM('native', 'erc20', 'spl', 'spl_token_2022', 'other');--> statement-breakpoint
CREATE TABLE "app"."asset_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"entity_type" "app"."asset_event_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "app"."asset_event_kind" NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_user_id" uuid,
	"message" text,
	"internal_note" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."asset_issuers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"website" text,
	"jurisdiction" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_issuers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app"."asset_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "app"."asset_provider_kind" NOT NULL,
	"website" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app"."eligibility_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"route_id" uuid,
	"jurisdiction" text NOT NULL,
	"action" "app"."eligibility_action" NOT NULL,
	"outcome" "app"."eligibility_outcome" NOT NULL,
	"kyc_requirement" text,
	"transfer_restrictions" text,
	"source_text" text,
	"source_url" text,
	"status" "app"."rule_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."execution_routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"method" "app"."execution_method" NOT NULL,
	"settlement_instrument_id" uuid,
	"minimum_amount" numeric,
	"processing_model" "app"."processing_model" NOT NULL,
	"notes" text,
	"status" "app"."asset_item_status" DEFAULT 'DRAFT' NOT NULL,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."instrument_deployments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"chain" "app"."asset_chain" NOT NULL,
	"token_standard" "app"."token_standard" NOT NULL,
	"address" text,
	"decimals" integer NOT NULL,
	"verification" "app"."deployment_verification" NOT NULL,
	"observed_decimals" integer,
	"observed_symbol" text,
	"observed_name" text,
	"observed_at" timestamp with time zone,
	"source_url" text,
	"status" "app"."asset_item_status" DEFAULT 'DRAFT' NOT NULL,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_deployments_address_iff_not_native" CHECK (("app"."instrument_deployments"."address" is null) = ("app"."instrument_deployments"."token_standard" = 'native')),
	CONSTRAINT "instrument_deployments_decimals_range" CHECK ("app"."instrument_deployments"."decimals" between 0 and 36)
);
--> statement-breakpoint
CREATE TABLE "app"."instruments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"asset_type" "app"."asset_type" NOT NULL,
	"description" text,
	"issuer_id" uuid,
	"risk_notes" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "app"."instrument_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"submitted_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."nav_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"price_reference_id" uuid NOT NULL,
	"value" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"as_of" date NOT NULL,
	"source_url" text NOT NULL,
	"entered_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."price_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"kind" "app"."price_kind" NOT NULL,
	"provider" "app"."price_provider" NOT NULL,
	"external_id" text,
	"quote_currency" text DEFAULT 'USD' NOT NULL,
	"status" "app"."rule_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_references_kind_provider" CHECK (("app"."price_references"."kind" = 'market' and "app"."price_references"."provider" = 'coinmarketcap' and "app"."price_references"."external_id" is not null) or ("app"."price_references"."kind" = 'nav' and "app"."price_references"."provider" = 'issuer' and "app"."price_references"."external_id" is null))
);
--> statement-breakpoint
ALTER TABLE "app"."asset_events" ADD CONSTRAINT "asset_events_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."asset_events" ADD CONSTRAINT "asset_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_rules" ADD CONSTRAINT "eligibility_rules_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_rules" ADD CONSTRAINT "eligibility_rules_route_id_execution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "app"."execution_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."execution_routes" ADD CONSTRAINT "execution_routes_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."execution_routes" ADD CONSTRAINT "execution_routes_deployment_id_instrument_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "app"."instrument_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."execution_routes" ADD CONSTRAINT "execution_routes_provider_id_asset_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "app"."asset_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."execution_routes" ADD CONSTRAINT "execution_routes_settlement_instrument_id_instruments_id_fk" FOREIGN KEY ("settlement_instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."execution_routes" ADD CONSTRAINT "execution_routes_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instrument_deployments" ADD CONSTRAINT "instrument_deployments_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instrument_deployments" ADD CONSTRAINT "instrument_deployments_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instruments" ADD CONSTRAINT "instruments_issuer_id_asset_issuers_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "app"."asset_issuers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instruments" ADD CONSTRAINT "instruments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instruments" ADD CONSTRAINT "instruments_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instruments" ADD CONSTRAINT "instruments_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nav_observations" ADD CONSTRAINT "nav_observations_price_reference_id_price_references_id_fk" FOREIGN KEY ("price_reference_id") REFERENCES "app"."price_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."nav_observations" ADD CONSTRAINT "nav_observations_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."price_references" ADD CONSTRAINT "price_references_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_events_instrument_idx" ON "app"."asset_events" USING btree ("instrument_id","created_at");--> statement-breakpoint
CREATE INDEX "eligibility_rules_instrument_idx" ON "app"."eligibility_rules" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "execution_routes_instrument_idx" ON "app"."execution_routes" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_deployments_chain_address_live" ON "app"."instrument_deployments" USING btree ("chain","address") WHERE "app"."instrument_deployments"."address" is not null and "app"."instrument_deployments"."status" <> 'RETIRED';--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_deployments_native_live" ON "app"."instrument_deployments" USING btree ("instrument_id","chain") WHERE "app"."instrument_deployments"."token_standard" = 'native' and "app"."instrument_deployments"."status" <> 'RETIRED';--> statement-breakpoint
CREATE INDEX "instrument_deployments_instrument_idx" ON "app"."instrument_deployments" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "instruments_queue_idx" ON "app"."instruments" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "nav_observations_latest_idx" ON "app"."nav_observations" USING btree ("price_reference_id","as_of","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_references_one_active" ON "app"."price_references" USING btree ("instrument_id","kind") WHERE "app"."price_references"."status" = 'ACTIVE';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.asset_issuers, app.asset_providers, app.instruments, app.instrument_deployments, app.execution_routes, app.eligibility_rules, app.price_references, app.nav_observations, app.asset_events
TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.asset_issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.asset_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.instrument_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.execution_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.eligibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.price_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.nav_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.asset_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.asset_issuers FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.asset_providers FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.instruments FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.instrument_deployments FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.execution_routes FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.eligibility_rules FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.price_references FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.nav_observations FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.asset_events FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
