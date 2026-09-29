-- Runtime and retention roles. Passwords/LOGIN are set per environment outside migrations
-- (local: pnpm db:dev-roles; Supabase: ALTER ROLE ... LOGIN PASSWORD by an operator).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bytesac_api') THEN CREATE ROLE bytesac_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bytesac_retention') THEN CREATE ROLE bytesac_retention NOLOGIN; END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON SCHEMA app FROM authenticated'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated'; END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO bytesac_api, bytesac_retention;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.users, app.investment_wallets, app.wallet_addresses, app.auth_challenges, app.sessions,
  app.contacts, app.contact_verifications, app.notification_preferences
TO bytesac_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.audit_events TO bytesac_api;
--> statement-breakpoint
GRANT SELECT, DELETE ON app.auth_challenges, app.sessions, app.contact_verifications TO bytesac_retention;
--> statement-breakpoint
GRANT SELECT ON app.wallet_addresses TO bytesac_retention;
--> statement-breakpoint
GRANT INSERT ON app.audit_events TO bytesac_retention;
--> statement-breakpoint
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.investment_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.wallet_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contact_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Role-scoped permissive policies: only the backend roles see rows; Supabase client roles see nothing.
CREATE POLICY api_all ON app.users FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.investment_wallets FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.wallet_addresses FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.auth_challenges FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.sessions FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.contacts FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.contact_verifications FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.notification_preferences FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY api_all ON app.audit_events FOR ALL TO bytesac_api USING (true) WITH CHECK (true);
CREATE POLICY retention_all ON app.auth_challenges FOR ALL TO bytesac_retention USING (true);
CREATE POLICY retention_all ON app.sessions FOR ALL TO bytesac_retention USING (true);
CREATE POLICY retention_all ON app.contact_verifications FOR ALL TO bytesac_retention USING (true);
CREATE POLICY retention_read ON app.wallet_addresses FOR SELECT TO bytesac_retention USING (true);
CREATE POLICY retention_audit ON app.audit_events FOR INSERT TO bytesac_retention WITH CHECK (true);
