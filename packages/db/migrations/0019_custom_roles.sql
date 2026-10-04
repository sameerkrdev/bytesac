CREATE TABLE "app"."organization_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_role" "app"."membership_role" NOT NULL,
	"permissions" text[] NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "organization_roles_not_owner" CHECK ("app"."organization_roles"."base_role" <> 'OWNER'),
	CONSTRAINT "organization_roles_name" CHECK (length("app"."organization_roles"."name") between 2 and 40)
);
--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."organization_roles" ADD CONSTRAINT "organization_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_roles" ADD CONSTRAINT "organization_roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_roles_live_name" ON "app"."organization_roles" USING btree ("organization_id",lower("name")) WHERE "app"."organization_roles"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "app"."organization_memberships" ADD CONSTRAINT "organization_memberships_custom_role_id_organization_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "app"."organization_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.organization_roles TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.organization_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.organization_roles FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
