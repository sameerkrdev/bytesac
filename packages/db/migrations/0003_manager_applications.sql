CREATE TYPE "app"."applicant_type" AS ENUM('individual', 'firm');--> statement-breakpoint
CREATE TYPE "app"."application_actor" AS ENUM('applicant', 'ops', 'system');--> statement-breakpoint
CREATE TYPE "app"."application_event_kind" AS ENUM('status_changed', 'note', 'applicant_reply', 'permission_granted');--> statement-breakpoint
CREATE TYPE "app"."application_status" AS ENUM('EMAIL_PENDING', 'SUBMITTED', 'SCREENING', 'CONTACTED', 'ADDITIONAL_INFORMATION_REQUIRED', 'SCREENING_APPROVED', 'SCREENING_REJECTED');--> statement-breakpoint
CREATE TYPE "app"."email_code_status" AS ENUM('pending', 'verified', 'superseded', 'failed');--> statement-breakpoint
CREATE TYPE "app"."platform_role" AS ENUM('ops_reviewer', 'ops_admin');--> statement-breakpoint
CREATE TYPE "app"."user_permission" AS ENUM('create_manager_organization');--> statement-breakpoint
CREATE TABLE "app"."application_email_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "app"."email_code_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."application_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"actor_type" "app"."application_actor" NOT NULL,
	"actor_user_id" uuid,
	"kind" "app"."application_event_kind" NOT NULL,
	"from_status" "app"."application_status",
	"to_status" "app"."application_status",
	"internal_note" text,
	"message_to_applicant" text,
	"applicant_message" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."manager_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"applicant_type" "app"."applicant_type" NOT NULL,
	"full_name" text NOT NULL,
	"firm_name" text,
	"email" text NOT NULL,
	"email_confirmed_at" timestamp with time zone,
	"phone" text,
	"country" text NOT NULL,
	"website" text,
	"professional_background" text NOT NULL,
	"investment_experience" text NOT NULL,
	"qualifications" text,
	"reason" text NOT NULL,
	"intended_baskets" text NOT NULL,
	"wallet_chain" "app"."chain" NOT NULL,
	"wallet_family" "app"."chain_family" NOT NULL,
	"wallet_address" text NOT NULL,
	"status" "app"."application_status" DEFAULT 'EMAIL_PENDING' NOT NULL,
	"status_token_hash" text,
	"user_id" uuid,
	"wallet_proven_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manager_applications_status_token_hash_key" UNIQUE("status_token_hash"),
	CONSTRAINT "manager_applications_firm_name" CHECK ("app"."manager_applications"."applicant_type" <> 'firm' OR "app"."manager_applications"."firm_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."platform_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."platform_role" NOT NULL,
	"granted_by_user_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."user_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "app"."user_permission" NOT NULL,
	"source_application_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."application_email_codes" ADD CONSTRAINT "application_email_codes_application_id_manager_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "app"."manager_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."application_events" ADD CONSTRAINT "application_events_application_id_manager_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "app"."manager_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."application_events" ADD CONSTRAINT "application_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."manager_applications" ADD CONSTRAINT "manager_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."manager_applications" ADD CONSTRAINT "manager_applications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."platform_roles" ADD CONSTRAINT "platform_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."platform_roles" ADD CONSTRAINT "platform_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."platform_roles" ADD CONSTRAINT "platform_roles_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_permissions" ADD CONSTRAINT "user_permissions_source_application_id_manager_applications_id_fk" FOREIGN KEY ("source_application_id") REFERENCES "app"."manager_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_email_codes_one_pending" ON "app"."application_email_codes" USING btree ("application_id") WHERE "app"."application_email_codes"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "application_events_application_idx" ON "app"."application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "manager_applications_open_email" ON "app"."manager_applications" USING btree ("email") WHERE "app"."manager_applications"."status" <> 'SCREENING_REJECTED';--> statement-breakpoint
CREATE UNIQUE INDEX "manager_applications_open_wallet" ON "app"."manager_applications" USING btree ("wallet_family","wallet_address") WHERE "app"."manager_applications"."status" <> 'SCREENING_REJECTED';--> statement-breakpoint
CREATE INDEX "manager_applications_queue_idx" ON "app"."manager_applications" USING btree ("submitted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_roles_active" ON "app"."platform_roles" USING btree ("user_id","role") WHERE "app"."platform_roles"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_permissions_active" ON "app"."user_permissions" USING btree ("user_id","permission") WHERE "app"."user_permissions"."revoked_at" IS NULL;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.manager_applications, app.application_events, app.application_email_codes, app.platform_roles, app.user_permissions
TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.manager_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.application_email_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_all ON app.manager_applications FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.application_events FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.application_email_codes FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.platform_roles FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.user_permissions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
