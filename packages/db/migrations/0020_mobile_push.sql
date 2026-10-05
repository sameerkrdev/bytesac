CREATE TYPE "app"."push_platform" AS ENUM('web', 'ios', 'android');--> statement-breakpoint
CREATE TYPE "app"."push_provider" AS ENUM('fcm', 'expo');--> statement-breakpoint
ALTER TABLE "app"."push_tokens" ADD COLUMN "platform" "app"."push_platform" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."push_tokens" ADD COLUMN "provider" "app"."push_provider" DEFAULT 'fcm' NOT NULL;