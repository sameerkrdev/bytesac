CREATE TABLE "app"."waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"country" char(2),
	"welcome_email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_signups_email_lower_key" ON "app"."waitlist_signups" USING btree (lower(trim("email")));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.waitlist_signups TO bytesac_api;
--> statement-breakpoint
ALTER TABLE "app"."waitlist_signups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_all ON app.waitlist_signups FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
