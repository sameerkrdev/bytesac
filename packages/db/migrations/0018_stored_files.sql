CREATE TYPE "app"."stored_file_purpose" AS ENUM('instrument_logo', 'basket_file');--> statement-breakpoint
CREATE TYPE "app"."basket_file_kind" AS ENUM('thesis', 'factsheet', 'methodology', 'research', 'other');--> statement-breakpoint
CREATE TABLE "app"."stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "app"."stored_file_purpose" NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"original_name" text,
	"status" "app"."organization_document_status" DEFAULT 'pending_upload' NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."basket_version_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" "app"."basket_file_kind" NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "basket_version_files_title" CHECK (length("app"."basket_version_files"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "app"."instruments" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."stored_files" ADD CONSTRAINT "stored_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_version_files" ADD CONSTRAINT "basket_version_files_version_id_basket_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."basket_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."basket_version_files" ADD CONSTRAINT "basket_version_files_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "app"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_files_uploader_idx" ON "app"."stored_files" USING btree ("uploaded_by_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "basket_version_files_live" ON "app"."basket_version_files" USING btree ("version_id","file_id") WHERE "app"."basket_version_files"."removed_at" is null;--> statement-breakpoint
ALTER TABLE "app"."instruments" ADD CONSTRAINT "instruments_logo_file_id_stored_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "app"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.stored_files, app.basket_version_files TO bytesac_api;
--> statement-breakpoint
ALTER TABLE app.stored_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.basket_version_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_all ON app.stored_files FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.basket_version_files FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
