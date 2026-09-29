-- Retention runs inside Postgres. app.purge_expired() applies the purge rules and audits the result;
-- pg_cron schedules it daily at 03:00 UTC when the extension is enabled in this database
-- (Supabase: Dashboard -> Database -> Extensions -> pg_cron). Without pg_cron the schedule is skipped.
CREATE OR REPLACE FUNCTION app.purge_expired() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  n_challenges integer;
  n_sessions integer;
  n_verifications integer;
  result jsonb;
BEGIN
  DELETE FROM app.auth_challenges c
   WHERE c.expires_at < now() - interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM app.wallet_addresses w WHERE w.verification_challenge_id = c.id);
  GET DIAGNOSTICS n_challenges = ROW_COUNT;

  DELETE FROM app.sessions
   WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '90 days')
      OR (revoked_at IS NULL AND LEAST(idle_expires_at, absolute_expires_at) < now() - interval '90 days');
  GET DIAGNOSTICS n_sessions = ROW_COUNT;

  DELETE FROM app.contact_verifications
   WHERE (resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days')
      OR (status = 'pending' AND expires_at < now() - interval '90 days');
  GET DIAGNOSTICS n_verifications = ROW_COUNT;

  result := jsonb_build_object('challenges', n_challenges, 'sessions', n_sessions, 'verifications', n_verifications);
  INSERT INTO app.audit_events (id, actor_type, action, entity_type, entity_id, request_id, metadata)
  VALUES (gen_random_uuid(), 'system', 'retention.purged', 'system', 'retention', 'retention-' || gen_random_uuid(), result);
  RETURN result;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.purge_expired() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('bytesac-retention', '0 3 * * *', 'select app.purge_expired()');
  END IF;
END $$;
--> statement-breakpoint
-- The dedicated worker role is no longer needed. Roles are cluster-wide: when another database on the
-- cluster still holds grants for it, only this database is cleaned up and the role itself is left in place.
DROP POLICY IF EXISTS retention_all ON app.auth_challenges;
DROP POLICY IF EXISTS retention_all ON app.sessions;
DROP POLICY IF EXISTS retention_all ON app.contact_verifications;
DROP POLICY IF EXISTS retention_read ON app.wallet_addresses;
DROP POLICY IF EXISTS retention_audit ON app.audit_events;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bytesac_retention') THEN
    DROP OWNED BY bytesac_retention;
    BEGIN
      DROP ROLE bytesac_retention;
    EXCEPTION WHEN dependent_objects_still_exist THEN
      NULL;
    END;
  END IF;
END $$;
