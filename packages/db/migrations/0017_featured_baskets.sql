ALTER TABLE "app"."baskets" ADD COLUMN "featured_rank" integer;--> statement-breakpoint
ALTER TABLE "app"."baskets" ADD COLUMN "featured_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "baskets_featured_idx" ON "app"."baskets" USING btree ("featured_rank") WHERE "app"."baskets"."featured_rank" is not null;--> statement-breakpoint
ALTER TABLE "app"."baskets" ADD CONSTRAINT "baskets_featured_rank" CHECK ("app"."baskets"."featured_rank" is null or "app"."baskets"."featured_rank" between 1 and 99);