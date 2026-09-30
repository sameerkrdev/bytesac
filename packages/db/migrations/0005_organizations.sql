CREATE TYPE "app"."organization_document_status" AS ENUM('pending_upload', 'uploaded', 'rejected_file');--> statement-breakpoint
CREATE TYPE "app"."membership_role" AS ENUM('OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER');--> statement-breakpoint
CREATE TYPE "app"."membership_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "app"."organization_actor" AS ENUM('owner', 'ops', 'system');--> statement-breakpoint
CREATE TYPE "app"."organization_event_kind" AS ENUM('status_changed', 'note', 'version_submitted', 'version_decided', 'document_uploaded', 'document_unlinked', 'version_created', 'payout_wallet_changed');--> statement-breakpoint
CREATE TYPE "app"."organization_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUIRED', 'RESUBMITTED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "app"."organization_type" AS ENUM('individual', 'firm');--> statement-breakpoint
CREATE TYPE "app"."payout_wallet_status" AS ENUM('UNVERIFIED', 'VERIFYING', 'VERIFIED', 'REPLACEMENT_PENDING', 'REVOKED');--> statement-breakpoint
CREATE TYPE "app"."document_scan_status" AS ENUM('not_scanned');--> statement-breakpoint
CREATE TYPE "app"."organization_version_status" AS ENUM('draft', 'in_review', 'changes_required', 'approved', 'rejected', 'superseded');--> statement-breakpoint
ALTER TYPE "app"."challenge_purpose" ADD VALUE 'payout_wallet';--> statement-breakpoint
CREATE TABLE "app"."organization_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" "app"."organization_document_status" DEFAULT 'pending_upload' NOT NULL,
	"scan_status" "app"."document_scan_status" DEFAULT 'not_scanned' NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."organization_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_type" "app"."organization_actor" NOT NULL,
	"actor_user_id" uuid,
	"kind" "app"."organization_event_kind" NOT NULL,
	"from_status" "app"."organization_status",
	"to_status" "app"."organization_status",
	"version_id" uuid,
	"payout_wallet_id" uuid,
	"decision" text,
	"internal_note" text,
	"message_to_owner" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."organization_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."membership_role" NOT NULL,
	"status" "app"."membership_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."organization_payout_wallets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"chain" "app"."chain" DEFAULT 'solana' NOT NULL,
	"address" text NOT NULL,
	"status" "app"."payout_wallet_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_challenge_id" uuid,
	"verification_signature" text,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"requested_by_user_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_payout_wallets_solana" CHECK ("app"."organization_payout_wallets"."chain" = 'solana')
);
--> statement-breakpoint
CREATE TABLE "app"."organization_version_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."organization_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "app"."organization_version_status" DEFAULT 'draft' NOT NULL,
	"public_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"private_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "app"."organization_type" NOT NULL,
	"status" "app"."organization_status" DEFAULT 'DRAFT' NOT NULL,
	"jurisdiction" text NOT NULL,
	"current_version_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."verification_requirement_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_type" "app"."organization_type" NOT NULL,
	"jurisdiction" text,
	"required_fields" text[] NOT NULL,
	"required_documents" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."auth_challenges" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."organization_documents" ADD CONSTRAINT "organization_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_documents" ADD CONSTRAINT "organization_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_events" ADD CONSTRAINT "organization_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_events" ADD CONSTRAINT "organization_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_events" ADD CONSTRAINT "organization_events_version_id_organization_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."organization_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_events" ADD CONSTRAINT "organization_events_payout_wallet_id_organization_payout_wallets_id_fk" FOREIGN KEY ("payout_wallet_id") REFERENCES "app"."organization_payout_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_payout_wallets" ADD CONSTRAINT "organization_payout_wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_payout_wallets" ADD CONSTRAINT "organization_payout_wallets_verification_challenge_id_auth_challenges_id_fk" FOREIGN KEY ("verification_challenge_id") REFERENCES "app"."auth_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_payout_wallets" ADD CONSTRAINT "organization_payout_wallets_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_payout_wallets" ADD CONSTRAINT "organization_payout_wallets_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_version_documents" ADD CONSTRAINT "organization_version_documents_version_id_organization_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."organization_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_version_documents" ADD CONSTRAINT "organization_version_documents_document_id_organization_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."organization_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_versions" ADD CONSTRAINT "organization_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_versions" ADD CONSTRAINT "organization_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_versions" ADD CONSTRAINT "organization_versions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_current_version_id_organization_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "app"."organization_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD CONSTRAINT "organizations_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_documents_org_idx" ON "app"."organization_documents" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_events_org_idx" ON "app"."organization_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_active" ON "app"."organization_memberships" USING btree ("organization_id","user_id") WHERE "app"."organization_memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "app"."organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_payout_wallets_one_verified" ON "app"."organization_payout_wallets" USING btree ("organization_id") WHERE "app"."organization_payout_wallets"."status" = 'VERIFIED';--> statement-breakpoint
CREATE UNIQUE INDEX "organization_payout_wallets_one_pending" ON "app"."organization_payout_wallets" USING btree ("organization_id") WHERE "app"."organization_payout_wallets"."status" in ('UNVERIFIED', 'VERIFYING', 'REPLACEMENT_PENDING');--> statement-breakpoint
CREATE UNIQUE INDEX "organization_version_documents_active" ON "app"."organization_version_documents" USING btree ("version_id","document_id") WHERE "app"."organization_version_documents"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_versions_number_key" ON "app"."organization_versions" USING btree ("organization_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_versions_one_open" ON "app"."organization_versions" USING btree ("organization_id") WHERE "app"."organization_versions"."status" in ('draft', 'in_review', 'changes_required');--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_one_open_per_user" ON "app"."organizations" USING btree ("created_by_user_id") WHERE "app"."organizations"."status" <> 'REJECTED';--> statement-breakpoint
CREATE INDEX "organizations_queue_idx" ON "app"."organizations" USING btree ("updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_requirement_templates_active" ON "app"."verification_requirement_templates" USING btree ("organization_type",coalesce("jurisdiction", '')) WHERE "app"."verification_requirement_templates"."retired_at" IS NULL;--> statement-breakpoint
ALTER TABLE "app"."auth_challenges" ADD CONSTRAINT "auth_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_challenges" ADD CONSTRAINT "auth_challenges_org_for_payout" CHECK ("app"."auth_challenges"."purpose"::text <> 'payout_wallet' OR ("app"."auth_challenges"."organization_id" IS NOT NULL AND "app"."auth_challenges"."session_id" IS NOT NULL));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.organizations, app.organization_memberships, app.organization_versions, app.organization_documents, app.organization_version_documents, app.verification_requirement_templates, app.organization_payout_wallets, app.organization_events
TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_version_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.verification_requirement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_payout_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_all ON app.organizations FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.organization_memberships FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.organization_versions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.organization_documents FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.organization_version_documents FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.verification_requirement_templates FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.organization_payout_wallets FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.organization_events FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Default verification templates (jurisdiction null). Keep in sync with DEFAULT_TEMPLATES in @repo/validator (checked by apps/api/test/db).
INSERT INTO app.verification_requirement_templates (id, organization_type, jurisdiction, required_fields, required_documents) VALUES
  (gen_random_uuid(), 'individual', NULL,
    ARRAY['displayName','about','experience','legalName','dateOfBirth','residentialAddress','professionalHistory'],
    ARRAY['government_id','proof_of_address']),
  (gen_random_uuid(), 'firm', NULL,
    ARRAY['displayName','about','experience','legalCompanyName','registrationNumber','registeredAddress','directors','beneficialOwners','authorizedRepresentatives'],
    ARRAY['company_registration','ownership_structure','director_id','proof_of_address']);

--> statement-breakpoint
-- Extends app.purge_expired() (0004 body, unchanged except the challenge rule): challenges that prove a payout wallet are kept, like sign-in wallet proofs.
CREATE OR REPLACE FUNCTION app.purge_expired() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  n_challenges integer;
  n_sessions integer;
  n_verifications integer;
  n_codes integer;
  n_applications integer;
  result jsonb;
BEGIN
  DELETE FROM app.auth_challenges c
   WHERE c.expires_at < now() - interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM app.wallet_addresses w WHERE w.verification_challenge_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM app.organization_payout_wallets p WHERE p.verification_challenge_id = c.id);
  GET DIAGNOSTICS n_challenges = ROW_COUNT;

  DELETE FROM app.sessions
   WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '90 days')
      OR (revoked_at IS NULL AND LEAST(idle_expires_at, absolute_expires_at) < now() - interval '90 days');
  GET DIAGNOSTICS n_sessions = ROW_COUNT;

  DELETE FROM app.contact_verifications
   WHERE (resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days')
      OR (status = 'pending' AND expires_at < now() - interval '90 days');
  GET DIAGNOSTICS n_verifications = ROW_COUNT;

  DELETE FROM app.application_email_codes
   WHERE (resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days')
      OR application_id IN (SELECT id FROM app.manager_applications WHERE status = 'EMAIL_PENDING' AND created_at < now() - interval '24 hours');
  GET DIAGNOSTICS n_codes = ROW_COUNT;

  DELETE FROM app.application_events
   WHERE application_id IN (SELECT id FROM app.manager_applications WHERE status = 'EMAIL_PENDING' AND created_at < now() - interval '24 hours');

  DELETE FROM app.manager_applications WHERE status = 'EMAIL_PENDING' AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS n_applications = ROW_COUNT;

  result := jsonb_build_object('challenges', n_challenges, 'sessions', n_sessions, 'verifications', n_verifications, 'email_codes', n_codes, 'applications', n_applications);
  INSERT INTO app.audit_events (id, actor_type, action, entity_type, entity_id, request_id, metadata)
  VALUES (gen_random_uuid(), 'system', 'retention.purged', 'system', 'retention', 'retention-' || gen_random_uuid(), result);
  RETURN result;
END
$$;
