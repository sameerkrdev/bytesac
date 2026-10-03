CREATE TYPE "app"."investor_status" AS ENUM('retail', 'accredited', 'qualified', 'professional');--> statement-breakpoint
CREATE TABLE "app"."eligibility_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid,
	"leg_id" uuid,
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"route_id" uuid,
	"action" "app"."eligibility_action" NOT NULL,
	"outcome" "app"."eligibility_outcome" NOT NULL,
	"rule_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"declaration_id" uuid,
	"ip_country" char(2),
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."eligibility_declarations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"country" char(2) NOT NULL,
	"investor_status" "app"."investor_status" NOT NULL,
	"attestation_version" text NOT NULL,
	"ip_country" char(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."eligibility_rules" ADD COLUMN "investor_statuses" "app"."investor_status"[] DEFAULT '{}'::app.investor_status[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."instrument_deployments" ADD COLUMN "permissioned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_leg_id_operation_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "app"."operation_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "app"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_route_id_execution_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "app"."execution_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_declaration_id_eligibility_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "app"."eligibility_declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."eligibility_declarations" ADD CONSTRAINT "eligibility_declarations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eligibility_decisions_operation_idx" ON "app"."eligibility_decisions" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "eligibility_decisions_user_idx" ON "app"."eligibility_decisions" USING btree ("user_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "eligibility_declarations_user_idx" ON "app"."eligibility_declarations" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.eligibility_declarations, app.eligibility_decisions TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.eligibility_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.eligibility_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.eligibility_declarations FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.eligibility_decisions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
