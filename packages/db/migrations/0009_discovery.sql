CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "app"."instrument_sector" AS ENUM('store_of_value', 'smart_contract_platform', 'layer2', 'defi', 'stablecoin', 'oracle_infra', 'gaming_metaverse', 'ai_data', 'meme', 'rwa_treasury', 'rwa_credit', 'rwa_commodity', 'rwa_equity', 'other');--> statement-breakpoint
CREATE TYPE "app"."asset_tag_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "app"."embedding_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "app"."manager_profile_status" AS ENUM('draft', 'published', 'hidden');--> statement-breakpoint
CREATE TABLE "app"."asset_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"status" "app"."asset_tag_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "asset_tags_key_unique" UNIQUE("key"),
	CONSTRAINT "asset_tags_key_format" CHECK ("app"."asset_tags"."key" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "asset_tags_label_length" CHECK (char_length("app"."asset_tags"."label") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "app"."basket_performance_days" (
	"basket_id" uuid NOT NULL,
	"day" date NOT NULL,
	"version_id" uuid NOT NULL,
	"index_gross" numeric NOT NULL,
	"index_net" numeric NOT NULL,
	"gap" boolean DEFAULT false NOT NULL,
	"holdings" jsonb NOT NULL,
	CONSTRAINT "basket_performance_days_basket_id_day_pk" PRIMARY KEY("basket_id","day")
);
--> statement-breakpoint
CREATE TABLE "app"."basket_search_index" (
	"basket_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "app"."basket_status" NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"short_description" text,
	"exposures" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_weight_bps" integer NOT NULL,
	"minimum_investment_usdc" numeric NOT NULL,
	"fee_entry_bps" integer NOT NULL,
	"fee_management_bps" integer NOT NULL,
	"fee_rebalance_bps" integer NOT NULL,
	"fee_subscription_bps" integer,
	"review_frequency" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"current_version_id" uuid NOT NULL,
	"manager_handles" text[] DEFAULT '{}'::text[] NOT NULL,
	"manager_max_experience_years" integer,
	"metrics" jsonb NOT NULL,
	"search_text" "tsvector" NOT NULL,
	"embedding" vector(768),
	"embedding_status" "app"."embedding_status" DEFAULT 'pending' NOT NULL,
	"embedding_attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."instrument_price_snapshots" (
	"instrument_id" uuid NOT NULL,
	"day" date NOT NULL,
	"price_usd" numeric NOT NULL,
	"source" text DEFAULT 'coinmarketcap' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_price_snapshots_instrument_id_day_pk" PRIMARY KEY("instrument_id","day"),
	CONSTRAINT "instrument_price_snapshots_positive" CHECK ("app"."instrument_price_snapshots"."price_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."instrument_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."manager_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"headline" text,
	"bio" text,
	"experience_years" integer,
	"background" text,
	"qualifications" text[] DEFAULT '{}'::text[] NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "app"."manager_profile_status" DEFAULT 'draft' NOT NULL,
	"hidden_reason" text,
	"hidden_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manager_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "manager_profiles_handle_unique" UNIQUE("handle"),
	CONSTRAINT "manager_profiles_handle_format" CHECK ("app"."manager_profiles"."handle" ~ '^[a-z0-9-]{3,30}$'),
	CONSTRAINT "manager_profiles_display_name_length" CHECK (char_length("app"."manager_profiles"."display_name") between 2 and 80),
	CONSTRAINT "manager_profiles_headline_length" CHECK ("app"."manager_profiles"."headline" is null or char_length("app"."manager_profiles"."headline") <= 120),
	CONSTRAINT "manager_profiles_bio_length" CHECK ("app"."manager_profiles"."bio" is null or char_length("app"."manager_profiles"."bio") <= 2000),
	CONSTRAINT "manager_profiles_background_length" CHECK ("app"."manager_profiles"."background" is null or char_length("app"."manager_profiles"."background") <= 2000),
	CONSTRAINT "manager_profiles_experience_range" CHECK ("app"."manager_profiles"."experience_years" is null or "app"."manager_profiles"."experience_years" between 0 and 60),
	CONSTRAINT "manager_profiles_qualifications_count" CHECK (cardinality("app"."manager_profiles"."qualifications") <= 10),
	CONSTRAINT "manager_profiles_links_count" CHECK (jsonb_array_length("app"."manager_profiles"."links") <= 5),
	CONSTRAINT "manager_profiles_hidden_reason_length" CHECK ("app"."manager_profiles"."hidden_reason" is null or char_length("app"."manager_profiles"."hidden_reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "app"."instruments" ADD COLUMN "sector" "app"."instrument_sector" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."asset_tags" ADD CONSTRAINT "asset_tags_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_performance_days" ADD CONSTRAINT "basket_performance_days_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_performance_days" ADD CONSTRAINT "basket_performance_days_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_search_index" ADD CONSTRAINT "basket_search_index_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_search_index" ADD CONSTRAINT "basket_search_index_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_search_index" ADD CONSTRAINT "basket_search_index_current_version_id_basket_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instrument_price_snapshots" ADD CONSTRAINT "instrument_price_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instrument_tags" ADD CONSTRAINT "instrument_tags_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instrument_tags" ADD CONSTRAINT "instrument_tags_tag_id_asset_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "app"."asset_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instrument_tags" ADD CONSTRAINT "instrument_tags_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."manager_profiles" ADD CONSTRAINT "manager_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."manager_profiles" ADD CONSTRAINT "manager_profiles_hidden_by_user_id_users_id_fk" FOREIGN KEY ("hidden_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "basket_search_index_search_text_idx" ON "app"."basket_search_index" USING gin ("search_text");--> statement-breakpoint
CREATE INDEX "basket_search_index_tags_idx" ON "app"."basket_search_index" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "basket_search_index_listing_idx" ON "app"."basket_search_index" USING btree ("status","published_at","basket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_tags_one_live" ON "app"."instrument_tags" USING btree ("instrument_id","tag_id") WHERE "app"."instrument_tags"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "manager_profiles_status_idx" ON "app"."manager_profiles" USING btree ("status","updated_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.asset_tags, app.instrument_tags, app.manager_profiles, app.instrument_price_snapshots, app.basket_performance_days, app.basket_search_index
TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.asset_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.instrument_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.manager_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.instrument_price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_performance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_search_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.asset_tags FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.instrument_tags FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.manager_profiles FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.instrument_price_snapshots FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_performance_days FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_search_index FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
