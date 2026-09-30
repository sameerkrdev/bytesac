-- Extends app.purge_expired(): EMAIL_PENDING applications never confirmed within 24 h (with their codes and events, in FK order)
-- and email codes resolved more than 90 days ago. The 0002 body is otherwise unchanged.
CREATE OR REPLACE FUNCTION app.purge_expired() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  n_challenges integer;
  n_sessions integer;
  n_verifications integer;
  n_codes integer;
  n_applications integer;
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

  DELETE FROM app.application_email_codes
   WHERE (resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days')
      OR application_id IN (SELECT id FROM app.manager_applications WHERE status = 'EMAIL_PENDING' AND created_at < now() - interval '24 hours');
  GET DIAGNOSTICS n_codes = ROW_COUNT;

  DELETE FROM app.application_events
   WHERE application_id IN (SELECT id FROM app.manager_applications WHERE status = 'EMAIL_PENDING' AND created_at < now() - interval '24 hours');

  DELETE FROM app.manager_applications WHERE status = 'EMAIL_PENDING' AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS n_applications = ROW_COUNT;

  result := jsonb_build_object('challenges', n_challenges, 'sessions', n_sessions, 'verifications', n_verifications, 'email_codes', n_codes, 'applications', n_applications);
  INSERT INTO app.audit_events (id, actor_type, action, entity_type, entity_id, request_id, metadata)
  VALUES (gen_random_uuid(), 'system', 'retention.purged', 'system', 'retention', 'retention-' || gen_random_uuid(), result);
  RETURN result;
END
$$;
