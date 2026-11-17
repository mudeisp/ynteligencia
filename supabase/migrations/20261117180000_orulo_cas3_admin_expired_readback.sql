-- CAS3 expired-lease readback recovery, strictly READBACK_V2 only.
-- No write authorization; immutable existing baseline and CAS receipts preserved.
-- Accessed by admin SQL session: BEGIN; SET LOCAL ROLE service_role;
-- SELECT public.orulo_audit_control('snapshot_begin' | 'snapshot_page' |
-- 'snapshot_seal', ... p_event with adminReadbackExpired=true); COMMIT.
BEGIN;
DO $patch$
DECLARE
  v_oid oid := 'orulo_audit.national_scope_snapshot(text,uuid,bigint,text,jsonb)'::regprocedure;
  v_definition text;
  v_old text := '  v_auth:=orulo_audit.national_scope_context(p_run,(p_event->>''id'')::uuid,p_event->''scope'');';
  v_new text := $recovery_patch$
  -- CAS3-only administrative recovery of an EXPIRED lease. It permits ONLY
  -- the scoped READBACK_V2 snapshot; it does not extend a lease or authorize CAS.
  IF p_event->>'adminReadbackExpired'='true' THEN
    IF p_run IS DISTINCT FROM '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
      OR p_event->>'kind' IS DISTINCT FROM 'READBACK_V2'
      OR p_event->'scope'->>'authorizationId' IS DISTINCT FROM
           '959774b0-c175-444c-a224-dcde9392ed07'
      OR session_user NOT IN ('postgres','supabase_admin')
      OR current_setting('role',true) IS DISTINCT FROM 'service_role'
    THEN RAISE EXCEPTION 'NATIONAL_SCOPE_ADMIN_READBACK_DENIED'; END IF;
    PERFORM orulo_audit.lock_run(p_run);
    SELECT e.event INTO v_auth FROM orulo_audit.entries e
    WHERE e.run_uuid=p_run AND e.kind='NATIONAL_SCOPE_AUTHORIZED'
      AND e.event_uuid='959774b0-c175-444c-a224-dcde9392ed07'::uuid;
    IF v_auth IS NULL
      OR v_auth->>'lot' IS DISTINCT FROM '3'
      OR v_auth->>'githubRunId' IS DISTINCT FROM '44119484397'
      OR v_auth->>'controlSha' IS DISTINCT FROM '182d5765a7eaa024bdbc236c3bb8c230ea7f6e4e'
      OR v_auth->>'planSha256' IS DISTINCT FROM '7acd317c82663e771fd3e378a48f4775ca2985b4cb06465db44f10abf9c7a1c4'
      OR (v_auth->>'expiresAt')::timestamptz >= clock_timestamp()
      OR NOT (v_auth->'targetIds' ? (p_event->>'id'))
      OR p_event->'scope'->>'lot' IS DISTINCT FROM v_auth->>'lot'
      OR p_event->'scope'->>'githubRunId' IS DISTINCT FROM v_auth->>'githubRunId'
      OR p_event->'scope'->>'controlSha' IS DISTINCT FROM v_auth->>'controlSha'
      OR p_event->'scope'->>'planSha256' IS DISTINCT FROM v_auth->>'planSha256'
      OR EXISTS (
        SELECT 1 FROM orulo_audit.entries e WHERE e.run_uuid=p_run
        AND (e.kind IN ('FINISHED','ABORTED')
          OR (e.kind IN ('NATIONAL_SCOPE_REVOKED','NATIONAL_SCOPE_FINISHED')
            AND e.event->>'authorizationId'=v_auth->>'authorizationId'))
      )
      OR EXISTS (
        SELECT 1 FROM orulo_audit.entries i WHERE i.run_uuid=p_run AND i.kind='INTENT'
          AND NOT EXISTS (
            SELECT 1 FROM orulo_audit.entries c WHERE c.run_uuid=i.run_uuid
              AND c.kind='CAS_RESULT' AND c.operation_uuid=i.operation_uuid
          )
      )
    THEN RAISE EXCEPTION 'NATIONAL_SCOPE_ADMIN_READBACK_DENIED'; END IF;
  ELSE
    v_auth:=orulo_audit.national_scope_context(p_run,(p_event->>'id')::uuid,p_event->'scope');
  END IF;
$recovery_patch$;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=v_oid
      AND pg_get_userbyid(p.proowner)='orulo_audit_owner'
      AND p.prosecdef=false
      AND p.proacl::text='{orulo_audit_owner=X/orulo_audit_owner}'
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
        'd444a67042a2f2ca42dd11437b8ff81421769a3d57f9d38c2b7043c598307280'
  ) THEN RAISE EXCEPTION 'CAS3_ADMIN_READBACK_CONTRACT_DRIFT'; END IF;
  v_definition:=pg_get_functiondef(v_oid);
  IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1
  THEN RAISE EXCEPTION 'CAS3_ADMIN_READBACK_PATCH_ANCHOR_MISMATCH'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$patch$;
COMMIT;
