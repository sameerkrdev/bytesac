CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."actor_type" AS ENUM('user', 'ops', 'system');--> statement-breakpoint
CREATE TYPE "app"."address_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "app"."chain" AS ENUM('ethereum', 'base', 'bnb', 'arbitrum', 'solana');--> statement-breakpoint
CREATE TYPE "app"."chain_family" AS ENUM('evm', 'solana');--> statement-breakpoint
CREATE TYPE "app"."challenge_purpose" AS ENUM('sign_in', 'add_chain_account');--> statement-breakpoint
CREATE TYPE "app"."challenge_status" AS ENUM('pending', 'processing', 'consumed', 'rejected');--> statement-breakpoint
CREATE TYPE "app"."client_kind" AS ENUM('web', 'mobile');--> statement-breakpoint
CREATE TYPE "app"."contact_status" AS ENUM('unverified', 'verified', 'replaced');--> statement-breakpoint
CREATE TYPE "app"."contact_type" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "app"."otp_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "app"."revoke_reason" AS ENUM('logout', 'logout_all', 'user_revoked', 'rotated', 'user_suspended', 'admin');--> statement-breakpoint
CREATE TYPE "app"."user_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "app"."verification_method" AS ENUM('eoa_ecdsa', 'erc1271', 'erc6492', 'ed25519');--> statement-breakpoint
CREATE TYPE "app"."contact_verification_status" AS ENUM('pending', 'verified', 'superseded', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "app"."wallet_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "app"."auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"purpose" "app"."challenge_purpose" NOT NULL,
	"chain_family" "app"."chain_family" NOT NULL,
	"chain" "app"."chain" NOT NULL,
	"address" text NOT NULL,
	"message" text NOT NULL,
	"domain" text NOT NULL,
	"uri" text NOT NULL,
	"chain_id" text NOT NULL,
	"status" "app"."challenge_status" DEFAULT 'pending' NOT NULL,
	"claim_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"session_id" uuid,
	CONSTRAINT "auth_challenges_nonce_key" UNIQUE("nonce"),
	CONSTRAINT "auth_challenges_session_for_add" CHECK ("app"."auth_challenges"."purpose" <> 'add_chain_account' OR "app"."auth_challenges"."session_id" IS NOT NULL OR "app"."auth_challenges"."status" <> 'pending')
);
--> statement-breakpoint
CREATE TABLE "app"."investment_wallets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_provider" text,
	"status" "app"."wallet_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"client" "app"."client_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" "app"."revoke_reason",
	"replaced_by_session_id" uuid,
	"user_agent" text,
	"ip_prefix" text,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" "app"."user_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."wallet_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"investment_wallet_id" uuid NOT NULL,
	"chain_family" "app"."chain_family" NOT NULL,
	"chain" "app"."chain" NOT NULL,
	"address" text NOT NULL,
	"status" "app"."address_status" DEFAULT 'active' NOT NULL,
	"verification_method" "app"."verification_method" NOT NULL,
	"verified_on_chain" "app"."chain" NOT NULL,
	"verification_challenge_id" uuid,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_addresses_chain_family" CHECK (("app"."wallet_addresses"."chain_family" = 'solana') = ("app"."wallet_addresses"."chain" = 'solana')),
	CONSTRAINT "wallet_addresses_method_family" CHECK (("app"."wallet_addresses"."chain_family" = 'solana') = ("app"."wallet_addresses"."verification_method" = 'ed25519')),
	CONSTRAINT "wallet_addresses_disabled_reason" CHECK ("app"."wallet_addresses"."status" = 'active' OR "app"."wallet_addresses"."disabled_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."contact_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"channel" "app"."otp_channel" NOT NULL,
	"status" "app"."contact_verification_status" DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "app"."contact_type" NOT NULL,
	"value" text NOT NULL,
	"status" "app"."contact_status" DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"rebalance" boolean DEFAULT true NOT NULL,
	"portfolio_updates" boolean DEFAULT true NOT NULL,
	"manager_updates" boolean DEFAULT true NOT NULL,
	"offers" boolean DEFAULT false NOT NULL,
	"product_updates" boolean DEFAULT false NOT NULL,
	"marketing" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_type" "app"."actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_ops_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"request_id" text NOT NULL,
	"session_id" uuid,
	"challenge_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."auth_challenges" ADD CONSTRAINT "auth_challenges_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."investment_wallets" ADD CONSTRAINT "investment_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_replaced_by_session_id_sessions_id_fk" FOREIGN KEY ("replaced_by_session_id") REFERENCES "app"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD CONSTRAINT "wallet_addresses_investment_wallet_id_investment_wallets_id_fk" FOREIGN KEY ("investment_wallet_id") REFERENCES "app"."investment_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."wallet_addresses" ADD CONSTRAINT "wallet_addresses_verification_challenge_id_auth_challenges_id_fk" FOREIGN KEY ("verification_challenge_id") REFERENCES "app"."auth_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contact_verifications" ADD CONSTRAINT "contact_verifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "app"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_at_idx" ON "app"."auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_wallets_one_active_per_user" ON "app"."investment_wallets" USING btree ("user_id") WHERE "app"."investment_wallets"."status" = 'active';--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "app"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_chain_address_key" ON "app"."wallet_addresses" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "wallet_addresses_wallet_idx" ON "app"."wallet_addresses" USING btree ("investment_wallet_id");--> statement-breakpoint
CREATE INDEX "contact_verifications_contact_idx" ON "app"."contact_verifications" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_verifications_one_pending" ON "app"."contact_verifications" USING btree ("contact_id") WHERE "app"."contact_verifications"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_one_current_per_type" ON "app"."contacts" USING btree ("user_id","type") WHERE "app"."contacts"."status" <> 'replaced';--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "app"."audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "app"."audit_events" USING btree ("actor_user_id");