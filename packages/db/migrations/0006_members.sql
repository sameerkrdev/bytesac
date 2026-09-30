CREATE TYPE "app"."member_verification_status" AS ENUM('draft', 'in_review', 'changes_required', 'approved', 'rejected');
--> statement-breakpoint
CREATE TYPE "app"."membership_actor" AS ENUM('member', 'org', 'ops', 'system');
--> statement-breakpoint
CREATE TYPE "app"."membership_event_kind" AS ENUM('invited', 'linked', 'accepted', 'declined', 'cancelled', 'expired', 'verification_submitted', 'verification_decided', 'role_changed', 'role_requested', 'removal_requested', 'removal_cancelled', 'removed', 'left', 'ownership_transferred', 'profile_updated');
--> statement-breakpoint
CREATE TYPE "app"."template_subject" AS ENUM('individual', 'firm', 'member');
--> statement-breakpoint
-- Status values change from lowercase to the Spec 4 lifecycle: active -> ACTIVE, revoked -> REVOKED. Indexes and the default that reference the old enum go first.
DROP INDEX "app"."organization_memberships_active";
ALTER TABLE "app"."organization_memberships" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "app"."membership_status_v2" AS ENUM('PENDING_WALLET_VERIFICATION','INVITED','PENDING_DOCUMENTS','UNDER_REVIEW','CHANGES_REQUIRED','ACTIVE','REJECTED','REMOVAL_REQUESTED','REVOKED');
ALTER TABLE "app"."organization_memberships" ALTER COLUMN "status" TYPE "app"."membership_status_v2"
  USING (CASE "status"::text WHEN 'active' THEN 'ACTIVE' WHEN 'revoked' THEN 'REVOKED' END)::"app"."membership_status_v2";
DROP TYPE "app"."membership_status";
ALTER TYPE "app"."membership_status_v2" RENAME TO "membership_status";
--> statement-breakpoint
-- Templates are keyed by subject: the organization types plus 'member'.
DROP INDEX "app"."verification_requirement_templates_active";
ALTER TABLE "app"."verification_requirement_templates" RENAME COLUMN "organization_type" TO "subject";
ALTER TABLE "app"."verification_requirement_templates" ALTER COLUMN "subject" TYPE "app"."template_subject" USING "subject"::text::"app"."template_subject";
CREATE UNIQUE INDEX "verification_requirement_templates_active" ON "app"."verification_requirement_templates" USING btree ("subject",coalesce("jurisdiction", '')) WHERE "app"."verification_requirement_templates"."retired_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "app"."member_verification_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"verification_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."member_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" "app"."member_verification_status" DEFAULT 'draft' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."membership_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_type" "app"."membership_actor" NOT NULL,
	"actor_user_id" uuid,
	"kind" "app"."membership_event_kind" NOT NULL,
	"from_status" "app"."membership_status",
	"to_status" "app"."membership_status",
	"from_role" "app"."membership_role",
	"to_role" "app"."membership_role",
	"decision" text,
	"message_to_member" text,
	"internal_note" text,
	"reason" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."organization_documents" ADD COLUMN "membership_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "requested_role" "app"."membership_role";
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "invited_wallet_chain" "app"."chain";
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "invited_wallet_family" "app"."chain_family";
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "invited_wallet_address" text;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "invited_email" text;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "invited_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "invite_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "removal_requested_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "public_display_name" text;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "public_title" text;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "activated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "decided_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."member_verification_documents" ADD CONSTRAINT "member_verification_documents_verification_id_member_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "app"."member_verifications"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."member_verification_documents" ADD CONSTRAINT "member_verification_documents_document_id_organization_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."organization_documents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."member_verifications" ADD CONSTRAINT "member_verifications_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "app"."organization_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."member_verifications" ADD CONSTRAINT "member_verifications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."membership_events" ADD CONSTRAINT "membership_events_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "app"."organization_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."membership_events" ADD CONSTRAINT "membership_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."membership_events" ADD CONSTRAINT "membership_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_verification_documents_active" ON "app"."member_verification_documents" USING btree ("verification_id","document_id") WHERE "app"."member_verification_documents"."removed_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "member_verifications_one_open" ON "app"."member_verifications" USING btree ("membership_id") WHERE "app"."member_verifications"."status" in ('draft', 'in_review', 'changes_required');
--> statement-breakpoint
CREATE INDEX "membership_events_membership_idx" ON "app"."membership_events" USING btree ("membership_id","created_at");
--> statement-breakpoint
CREATE INDEX "membership_events_org_idx" ON "app"."membership_events" USING btree ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "app"."organization_documents" ADD CONSTRAINT "organization_documents_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "app"."organization_memberships"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD CONSTRAINT "organization_memberships_removal_requested_by_user_id_users_id_fk" FOREIGN KEY ("removal_requested_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD CONSTRAINT "organization_memberships_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_one_open" ON "app"."organization_memberships" USING btree ("organization_id","user_id") WHERE "app"."organization_memberships"."user_id" is not null and "app"."organization_memberships"."status" not in ('REJECTED', 'REVOKED');
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_one_open_invite" ON "app"."organization_memberships" USING btree ("organization_id","invited_wallet_family","invited_wallet_address") WHERE "app"."organization_memberships"."status" in ('PENDING_WALLET_VERIFICATION', 'INVITED');
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_one_owner" ON "app"."organization_memberships" USING btree ("organization_id") WHERE "app"."organization_memberships"."role" = 'OWNER' and "app"."organization_memberships"."status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "organization_memberships_wallet_idx" ON "app"."organization_memberships" USING btree ("invited_wallet_family","invited_wallet_address");
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD CONSTRAINT "organization_memberships_user_or_pending" CHECK ("app"."organization_memberships"."user_id" is not null or "app"."organization_memberships"."status" in ('PENDING_WALLET_VERIFICATION', 'REVOKED'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.member_verifications, app.member_verification_documents, app.membership_events TO bytesac_api;
ALTER TABLE app.member_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.member_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.member_verifications FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.member_verification_documents FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.membership_events FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Member verification template (jurisdiction null). Keep in sync with DEFAULT_TEMPLATES.member in @repo/validator (checked by apps/api/test/db).
INSERT INTO app.verification_requirement_templates (id, subject, jurisdiction, required_fields, required_documents) VALUES
  (gen_random_uuid(), 'member', NULL, ARRAY['legalName','dateOfBirth','residentialAddress','professionalHistory'], ARRAY['government_id','proof_of_address']);
