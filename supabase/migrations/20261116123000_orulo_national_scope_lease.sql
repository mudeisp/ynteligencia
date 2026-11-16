BEGIN;

GRANT EXECUTE ON FUNCTION orulo_audit.national_scoped_plan(uuid,integer,uuid[],text,text)
  TO orulo_audit_owner;

CREATE FUNCTION orulo_audit.national_scope_admin() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin')
     OR current_setting('role',true) NOT IN ('none','postgres','supabase_admin')
  THEN RAISE insufficient_privilege; END IF;
END;
$$;

CREATE FUNCTION orulo_audit.authorize_national_scope(
  p_run uuid, p_lot integer, p_ids uuid[], p_github_run text, p_code_sha text,
  p_plan_sha text, p_head text, p_minutes integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC'
SET synchronous_commit = 'on' SET lock_timeout = '5s'
AS $$
DECLARE
  v_plan jsonb;
  v_head orulo_audit.entries%ROWTYPE;
  v_now timestamptz;
  v_id uuid := gen_random_uuid();
BEGIN
  PERFORM orulo_audit.national_scope_admin();
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'NATIONAL_SCOPE_DURATION_INVALID';
  END IF;
  PERFORM orulo_audit.lock_run(p_run);
  v_plan := orulo_audit.national_scoped_plan(p_run,p_lot,p_ids,p_github_run,p_code_sha);
  SELECT * INTO v_head FROM orulo_audit.entries
    WHERE run_uuid=p_run ORDER BY sequence DESC LIMIT 1;
  v_now := clock_timestamp();

  IF v_head.hash IS DISTINCT FROM p_head
    OR v_plan->>'planSha256' IS DISTINCT FROM p_plan_sha
    OR EXISTS (
      SELECT 1 FROM orulo_audit.entries e
      WHERE e.run_uuid=p_run AND (
        e.kind IN ('WRITE_AUTHORIZED','CONTINUATION_AUTHORIZED')
        OR (e.kind='NATIONAL_SCOPE_AUTHORIZED' AND
          (e.event->>'githubRunId'=p_github_run OR
           ((e.event->>'expiresAt')::timestamptz>v_now AND NOT EXISTS (
             SELECT 1 FROM orulo_audit.entries r
             WHERE r.run_uuid=p_run AND r.kind IN ('NATIONAL_SCOPE_REVOKED','NATIONAL_SCOPE_FINISHED')
               AND r.event->>'authorizationId'=e.event->>'authorizationId'
           ))))
        OR (e.kind='INTENT' AND NOT EXISTS (
          SELECT 1 FROM orulo_audit.entries c
          WHERE c.run_uuid=p_run AND c.kind='CAS_RESULT' AND c.operation_uuid=e.operation_uuid
        ))
      )
    )
  THEN RAISE EXCEPTION 'NATIONAL_SCOPE_APPROVAL_CONFLICT'; END IF;

  -- The first lease for the frozen operation is the exact single-property pilot.
  IF NOT EXISTS (
    SELECT 1 FROM orulo_audit.entries e
    JOIN orulo_audit.entries i ON i.run_uuid=e.run_uuid AND i.operation_uuid=e.operation_uuid AND i.kind='INTENT'
    JOIN orulo_audit.entries f ON f.run_uuid=i.run_uuid AND f.kind='NATIONAL_SCOPE_FINISHED'
      AND f.event->>'authorizationId'=i.event->'scope'->>'authorizationId'
    WHERE e.run_uuid=p_run AND e.kind='CAS_RESULT' AND e.event->>'id'='000a4d50-a014-4270-bb89-26adb841f142'
      AND e.event->'result'->>'status'='UPDATED' AND f.event->'counts'='{"UPDATED":1}'
  )
     AND (p_lot<>1 OR v_plan->'targetIds' IS DISTINCT FROM
       '["000a4d50-a014-4270-bb89-26adb841f142"]'::jsonb)
  THEN RAISE EXCEPTION 'NATIONAL_SCOPE_PILOT_REQUIRED'; END IF;

  RETURN orulo_audit.append(p_run,v_head.sequence+1,v_head.hash,
    v_plan || jsonb_build_object(
      'type','NATIONAL_SCOPE_AUTHORIZED','eventUuid',v_id,'authorizationId',v_id,
      'administrator',session_user,'issuedAt',v_now,'expiresAt',v_now+make_interval(mins=>p_minutes)
    ));
END;
$$;

CREATE FUNCTION orulo_audit.revoke_national_scope(p_run uuid,p_id uuid,p_head text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC'
SET synchronous_commit = 'on' SET lock_timeout = '5s'
AS $$
DECLARE v_head orulo_audit.entries%ROWTYPE;
BEGIN
  PERFORM orulo_audit.national_scope_admin();
  PERFORM orulo_audit.lock_run(p_run);
  SELECT * INTO v_head FROM orulo_audit.entries
    WHERE run_uuid=p_run ORDER BY sequence DESC LIMIT 1;
  IF v_head.hash IS DISTINCT FROM p_head OR NOT EXISTS (
    SELECT 1 FROM orulo_audit.entries e WHERE e.run_uuid=p_run
      AND e.kind='NATIONAL_SCOPE_AUTHORIZED' AND e.event_uuid=p_id
  ) OR EXISTS (
    SELECT 1 FROM orulo_audit.entries e WHERE e.run_uuid=p_run
      AND e.kind='NATIONAL_SCOPE_REVOKED' AND e.event->>'authorizationId'=p_id::text
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPE_REVOCATION_CONFLICT'; END IF;
  RETURN orulo_audit.append(p_run,v_head.sequence+1,v_head.hash,jsonb_build_object(
    'type','NATIONAL_SCOPE_REVOKED','eventUuid',gen_random_uuid(),
    'authorizationId',p_id,'administrator',session_user,'revokedAt',clock_timestamp()
  ));
END;
$$;

-- Entry points integrating this helper must hold the run lock through their
-- transaction. This serializes checks with administrative revocation.
CREATE FUNCTION orulo_audit.require_national_scope(
  p_run uuid,p_id uuid,p_lot integer,p_target uuid,p_github_run text,p_code_sha text,p_plan_sha text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_scope jsonb;
BEGIN
  PERFORM orulo_audit.lock_run(p_run);
  SELECT event INTO v_scope FROM orulo_audit.entries
    WHERE run_uuid=p_run AND kind='NATIONAL_SCOPE_AUTHORIZED' AND event_uuid=p_id;
  IF v_scope IS NULL OR p_target IS NULL
    OR v_scope->>'lot' IS DISTINCT FROM p_lot::text
    OR v_scope->>'githubRunId' IS DISTINCT FROM p_github_run
    OR v_scope->>'controlSha' IS DISTINCT FROM p_code_sha
    OR v_scope->>'planSha256' IS DISTINCT FROM p_plan_sha
    OR NOT (v_scope->'targetIds' ? p_target::text)
    OR (v_scope->>'expiresAt')::timestamptz<=clock_timestamp()
    OR EXISTS (
      SELECT 1 FROM orulo_audit.entries e WHERE e.run_uuid=p_run AND (
        e.kind IN ('FINISHED','ABORTED') OR
        (e.kind='NATIONAL_SCOPE_REVOKED' AND e.event->>'authorizationId'=p_id::text)
      )
    )
  THEN RAISE EXCEPTION 'NATIONAL_SCOPE_DENIED'; END IF;
  RETURN v_scope;
END;
$$;

ALTER FUNCTION orulo_audit.national_scope_admin() OWNER TO orulo_audit_owner;
ALTER FUNCTION orulo_audit.authorize_national_scope(uuid,integer,uuid[],text,text,text,text,integer) OWNER TO orulo_audit_owner;
ALTER FUNCTION orulo_audit.revoke_national_scope(uuid,uuid,text) OWNER TO orulo_audit_owner;
ALTER FUNCTION orulo_audit.require_national_scope(uuid,uuid,integer,uuid,text,text,text) OWNER TO orulo_audit_owner;

REVOKE ALL ON FUNCTION
  orulo_audit.national_scope_admin(),
  orulo_audit.authorize_national_scope(uuid,integer,uuid[],text,text,text,text,integer),
  orulo_audit.revoke_national_scope(uuid,uuid,text),
  orulo_audit.require_national_scope(uuid,uuid,integer,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
