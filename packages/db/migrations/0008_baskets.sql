CREATE TYPE "app"."basket_actor" AS ENUM('member', 'ops', 'system');--> statement-breakpoint
CREATE TYPE "app"."basket_assignment_role" AS ENUM('lead', 'co_manager');--> statement-breakpoint
CREATE TYPE "app"."basket_assignment_status" AS ENUM('PENDING_APPROVAL', 'ACTIVE', 'ENDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "app"."basket_category" AS ENUM('index', 'thematic', 'sector', 'yield', 'stablecoin', 'rwa', 'multi_asset');--> statement-breakpoint
CREATE TYPE "app"."basket_event_kind" AS ENUM('created', 'draft_saved', 'submitted', 'withdrawn', 'reviewed', 'approved', 'rejected', 'published', 'paused', 'resumed', 'retirement_requested', 'retirement_decided', 'retired', 'assignment_added', 'assignment_changed', 'assignment_ended', 'lead_decided', 'reassignment_required', 'disclosures_repinned');--> statement-breakpoint
CREATE TYPE "app"."basket_pause_kind" AS ENUM('manager', 'platform');--> statement-breakpoint
CREATE TYPE "app"."basket_review_decision" AS ENUM('changes_required', 'rejected', 'approved', 'escalated');--> statement-breakpoint
CREATE TYPE "app"."basket_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'REASSIGNMENT_REQUIRED', 'RETIREMENT_PENDING', 'RETIRED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "app"."basket_version_status" AS ENUM('draft', 'in_review', 'changes_required', 'approved', 'published', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "app"."disclosure_condition" AS ENUM('always', 'has_stablecoin', 'has_rwa');--> statement-breakpoint
CREATE TYPE "app"."disclosure_template_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "app"."basket_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"basket_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."basket_assignment_role" NOT NULL,
	"permissions" text[] NOT NULL,
	"status" "app"."basket_assignment_status" NOT NULL,
	"assigned_by_user_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "basket_assignments_flags" CHECK ("app"."basket_assignments"."permissions" <@ array['edit', 'submit', 'publish', 'lifecycle', 'assign']::text[]),
	CONSTRAINT "basket_assignments_lead_all_flags" CHECK ("app"."basket_assignments"."role" <> 'lead' or "app"."basket_assignments"."permissions" @> array['edit', 'submit', 'publish', 'lifecycle', 'assign']::text[])
);
--> statement-breakpoint
CREATE TABLE "app"."basket_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"basket_id" uuid NOT NULL,
	"version_id" uuid,
	"assignment_id" uuid,
	"kind" "app"."basket_event_kind" NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_type" "app"."basket_actor" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."basket_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"basket_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" "app"."basket_review_decision" NOT NULL,
	"checklist" jsonb NOT NULL,
	"section_comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_to_manager" text,
	"internal_note" text,
	"reviewed_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."basket_slug_aliases" (
	"slug" text PRIMARY KEY NOT NULL,
	"basket_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."basket_version_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"instrument_id" uuid NOT NULL,
	"target_weight_bps" integer NOT NULL,
	"min_weight_bps" integer,
	"max_weight_bps" integer,
	"rationale" text
);
--> statement-breakpoint
CREATE TABLE "app"."basket_version_disclosures" (
	"version_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"template_id" uuid NOT NULL,
	CONSTRAINT "basket_version_disclosures_version_id_revision_template_id_pk" PRIMARY KEY("version_id","revision","template_id")
);
--> statement-breakpoint
CREATE TABLE "app"."basket_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"basket_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "app"."basket_version_status" DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"short_description" text,
	"long_description" text,
	"category" "app"."basket_category" NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"objective" text,
	"thesis" text,
	"methodology" text,
	"intended_investor" text,
	"horizon" text,
	"key_assumptions" text,
	"known_limitations" text,
	"strategy_risks" text,
	"liquidity_notes" text,
	"conflicts_of_interest" text,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rebalance" jsonb DEFAULT '{"reviewFrequency":"none"}'::jsonb NOT NULL,
	"fees" jsonb NOT NULL,
	"minimum_investment_usdc" numeric,
	"minimum_increment_usdc" numeric,
	"rationale" text,
	"assets_revision" integer DEFAULT 0 NOT NULL,
	"disclosures_revision" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"approved_hash" text,
	"created_by_user_id" uuid NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."baskets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" "app"."basket_status" DEFAULT 'DRAFT' NOT NULL,
	"previous_status" "app"."basket_status",
	"pause_kind" "app"."basket_pause_kind",
	"pause_reason" text,
	"current_version_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baskets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "baskets_slug_format" CHECK ("app"."baskets"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length("app"."baskets"."slug") <= 90)
);
--> statement-breakpoint
CREATE TABLE "app"."disclosure_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"condition" "app"."disclosure_condition" NOT NULL,
	"status" "app"."disclosure_template_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "disclosure_templates_key_format" CHECK ("app"."disclosure_templates"."key" ~ '^[a-z_]{3,60}$')
);
--> statement-breakpoint
ALTER TABLE "app"."basket_assignments" ADD CONSTRAINT "basket_assignments_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_assignments" ADD CONSTRAINT "basket_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_assignments" ADD CONSTRAINT "basket_assignments_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "app"."organization_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_assignments" ADD CONSTRAINT "basket_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_assignments" ADD CONSTRAINT "basket_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_assignments" ADD CONSTRAINT "basket_assignments_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_events" ADD CONSTRAINT "basket_events_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_events" ADD CONSTRAINT "basket_events_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_events" ADD CONSTRAINT "basket_events_assignment_id_basket_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "app"."basket_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_events" ADD CONSTRAINT "basket_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_reviews" ADD CONSTRAINT "basket_reviews_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_reviews" ADD CONSTRAINT "basket_reviews_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_reviews" ADD CONSTRAINT "basket_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_slug_aliases" ADD CONSTRAINT "basket_slug_aliases_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_version_assets" ADD CONSTRAINT "basket_version_assets_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_version_assets" ADD CONSTRAINT "basket_version_assets_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_version_disclosures" ADD CONSTRAINT "basket_version_disclosures_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_version_disclosures" ADD CONSTRAINT "basket_version_disclosures_template_id_disclosure_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."disclosure_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_versions" ADD CONSTRAINT "basket_versions_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "app"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_versions" ADD CONSTRAINT "basket_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_versions" ADD CONSTRAINT "basket_versions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_versions" ADD CONSTRAINT "basket_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_versions" ADD CONSTRAINT "basket_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."baskets" ADD CONSTRAINT "baskets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."baskets" ADD CONSTRAINT "baskets_current_version_id_basket_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."baskets" ADD CONSTRAINT "baskets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disclosure_templates" ADD CONSTRAINT "disclosure_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "basket_assignments_one_open_per_user" ON "app"."basket_assignments" USING btree ("basket_id","user_id") WHERE "app"."basket_assignments"."status" in ('ACTIVE', 'PENDING_APPROVAL');--> statement-breakpoint
CREATE UNIQUE INDEX "basket_assignments_one_active_lead" ON "app"."basket_assignments" USING btree ("basket_id") WHERE "app"."basket_assignments"."role" = 'lead' and "app"."basket_assignments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "basket_assignments_one_pending_lead" ON "app"."basket_assignments" USING btree ("basket_id") WHERE "app"."basket_assignments"."role" = 'lead' and "app"."basket_assignments"."status" = 'PENDING_APPROVAL';--> statement-breakpoint
CREATE INDEX "basket_assignments_membership_idx" ON "app"."basket_assignments" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "basket_events_basket_idx" ON "app"."basket_events" USING btree ("basket_id","created_at");--> statement-breakpoint
CREATE INDEX "basket_reviews_version_idx" ON "app"."basket_reviews" USING btree ("version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "basket_version_assets_unique" ON "app"."basket_version_assets" USING btree ("version_id","revision","instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "basket_versions_number" ON "app"."basket_versions" USING btree ("basket_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "basket_versions_one_open" ON "app"."basket_versions" USING btree ("basket_id") WHERE "app"."basket_versions"."status" in ('draft', 'in_review', 'changes_required', 'approved');--> statement-breakpoint
CREATE INDEX "basket_versions_review_idx" ON "app"."basket_versions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "baskets_org_idx" ON "app"."baskets" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_templates_key_version" ON "app"."disclosure_templates" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_templates_one_active" ON "app"."disclosure_templates" USING btree ("key") WHERE "app"."disclosure_templates"."status" = 'active';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.baskets, app.basket_slug_aliases, app.basket_versions, app.basket_version_assets, app.disclosure_templates, app.basket_version_disclosures, app.basket_assignments, app.basket_reviews, app.basket_events
TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_slug_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_version_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.disclosure_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_version_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.baskets FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_slug_aliases FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_versions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_version_assets FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.disclosure_templates FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_version_disclosures FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_assignments FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_reviews FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_events FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
--> statement-breakpoint
INSERT INTO app.disclosure_templates (id, key, version, title, body, condition, status) VALUES
  (gen_random_uuid(), 'no_guarantee', 1, 'No guarantee', 'Placeholder — final wording pending compliance review. Baskets are model portfolios. Nothing in a basket is a promise of return, and the value of assets can fall as well as rise.', 'always', 'active'),
  (gen_random_uuid(), 'self_custody_wallet', 1, 'Self-custody wallet', 'Placeholder — final wording pending compliance review. Assets are held in your own wallet. You are responsible for your wallet, its keys and its security; Bytesac does not hold your assets.', 'always', 'active'),
  (gen_random_uuid(), 'fees_and_costs', 1, 'Fees and costs', 'Placeholder — final wording pending compliance review. A basket may list fees, and network and execution costs can apply. Fees shown are disclosed terms and may change in a new version.', 'always', 'active'),
  (gen_random_uuid(), 'user_consent_rebalance', 1, 'Your consent to changes', 'Placeholder — final wording pending compliance review. A manager can publish a new version of a basket. Nothing changes in your wallet unless you explicitly approve it.', 'always', 'active'),
  (gen_random_uuid(), 'platform_fee', 1, 'Platform fee', 'Placeholder — final wording pending compliance review. Bytesac may charge a platform fee. Any platform fee is disclosed before you invest.', 'always', 'active'),
  (gen_random_uuid(), 'stablecoin_depeg', 1, 'Stablecoin risk', 'Placeholder — final wording pending compliance review. A stablecoin can lose its peg to the currency it tracks, and an issuer may fail to honor redemptions.', 'has_stablecoin', 'active'),
  (gen_random_uuid(), 'rwa_issuer_transfer_redemption', 1, 'Tokenized asset risk', 'Placeholder — final wording pending compliance review. Tokenized real-world assets depend on their issuer. Transfers may be restricted and redemption may be delayed, limited or unavailable.', 'has_rwa', 'active');
