BEGIN;

-- Extend the existing paged storage with namespaces derived exclusively from
-- an administrative authorization UUID.
ALTER TABLE orulo_audit.snapshot_sets DROP CONSTRAINT snapshot_sets_kind_check;
ALTER TABLE orulo_audit.snapshot_sets ADD CONSTRAINT snapshot_sets_kind_check
  CHECK (kind IN ('BASELINE_V2','READBACK_V2')
      OR kind ~ '^(BASELINE_V2|READBACK_V2):[0-9a-f-]{36}$');

-- The shared capture implementation is reused. Its legacy entrypoints do not
-- accept scoped kinds unless the checked scoped dispatcher set the exact kind.
DO $install$
DECLARE
  v_oid oid := 'orulo_audit.control_paged(text,uuid,bigint,text,jsonb)'::regprocedure;
  v_definition text;
  v_old constant text := 'k not in (''BASELINE_V2'',''READBACK_V2'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid=v_oid AND prosecdef
      AND pg_get_userbyid(proowner)='orulo_audit_owner'
      AND proacl::text='{orulo_audit_owner=X/orulo_audit_owner}'
      AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')=
        'bacb575f3fc131b77246d2e768fccb65da74aee14e4f3b69e4a9f4c129e632'
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPED_SNAPSHOT_CONTRACT_DRIFT'; END IF;
  v_definition:=pg_get_functiondef(v_oid);
  IF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'NATIONAL_SCOPED_SNAPSHOT_ANCHOR_MISSING'; END IF;
  EXECUTE replace(v_definition,v_old,$guard$(k not in ('BASELINE_V2','READBACK_V2')
    and (k !~ '^(BASELINE_V2|READBACK_V2):[0-9a-f-]{36}$'
         or k is distinct from current_setting('orulo.scoped_snapshot_kind',true)))$guard$);
END;
$install$;

CREATE FUNCTION orulo_audit.national_scope_snapshot(
  p_action text,p_run uuid,p_sequence bigint,p_previous_hash text,p_event jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='5s'
AS $$
DECLARE
  v_auth jsonb;
  v_kind text;
  v_suffix text;
  v_response jsonb;
  v_previous text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('snapshot_begin','snapshot_page','snapshot_seal','state')
    OR coalesce(p_event->>'kind','') NOT IN ('BASELINE_V2','READBACK_V2')
  THEN RAISE EXCEPTION 'NATIONAL_SCOPED_SNAPSHOT_INVALID'; END IF;
  v_auth:=orulo_audit.national_scope_context(p_run,(p_event->>'id')::uuid,p_event->'scope');
  v_suffix:=':'||(v_auth->>'authorizationId');
  v_kind:=(p_event->>'kind')||v_suffix;
  IF p_event->>'kind'='READBACK_V2' AND NOT EXISTS (
    SELECT 1 FROM orulo_audit.entries WHERE run_uuid=p_run AND kind='BASELINE_V2'||v_suffix
      AND event->'snapshot'->>'membershipStable'='true'
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPED_BASELINE_REQUIRED'; END IF;
  IF p_action='state' THEN
    RETURN (SELECT jsonb_build_object(
      'sealed',EXISTS (SELECT 1 FROM orulo_audit.entries e WHERE e.run_uuid=p_run AND e.kind=v_kind),
      'keys',to_jsonb(s.keys),
      'processed',(SELECT count(*) FROM orulo_audit.snapshot_records x WHERE x.run_uuid=p_run AND x.kind=v_kind)
    ) FROM orulo_audit.snapshot_sets s WHERE s.run_uuid=p_run AND s.kind=v_kind);
  END IF;

  v_previous:=current_setting('orulo.scoped_snapshot_kind',true);
  PERFORM set_config('orulo.scoped_snapshot_kind',v_kind,true);
  v_response:=orulo_audit.control_paged(p_action,p_run,p_sequence,p_previous_hash,
      p_event||jsonb_build_object('kind',v_kind));
  PERFORM set_config('orulo.scoped_snapshot_kind',coalesce(v_previous,''),true);
  RETURN v_response;
END;
$$;

ALTER FUNCTION orulo_audit.national_scope_snapshot(text,uuid,bigint,text,jsonb) OWNER TO orulo_audit_owner;
REVOKE ALL ON FUNCTION orulo_audit.national_scope_snapshot(text,uuid,bigint,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
