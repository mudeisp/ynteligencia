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
        'bacb575f3fc131b77246d2e768fccb65da74aee14e4f3f5b69e4a9f4c129e632'
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


CREATE FUNCTION orulo_audit.national_scope_finish(
  p_run uuid,p_sequence bigint,p_previous_hash text,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='30s'
AS $$
DECLARE
  v_auth jsonb;
  v_suffix text;
  v_counts jsonb;
  v_prior jsonb;
BEGIN
  v_auth:=orulo_audit.national_scope_context(p_run,(p_event->>'id')::uuid,p_event->'scope');
  v_suffix:=':'||(v_auth->>'authorizationId');
  SELECT event INTO v_prior FROM orulo_audit.entries WHERE run_uuid=p_run
    AND kind='NATIONAL_SCOPE_FINISHED' AND event->>'authorizationId'=v_auth->>'authorizationId';
  IF v_prior IS NOT NULL THEN RAISE EXCEPTION 'NATIONAL_SCOPE_ALREADY_FINISHED'; END IF;
  IF EXISTS (SELECT 1 FROM orulo_audit.entries i WHERE i.run_uuid=p_run AND i.kind='INTENT'
    AND NOT EXISTS (SELECT 1 FROM orulo_audit.entries c WHERE c.run_uuid=p_run
      AND c.kind='CAS_RESULT' AND c.operation_uuid=i.operation_uuid))
  OR (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=p_run
      AND kind IN ('BASELINE_V2'||v_suffix,'READBACK_V2'||v_suffix)
      AND event->'snapshot'->>'membershipStable'='true'
      AND event->'snapshot'->'columns'=orulo_audit.columns_v2())<>2
  THEN RAISE EXCEPTION 'NATIONAL_SCOPE_FINISH_SNAPSHOT_REQUIRED'; END IF;

  IF EXISTS (
    WITH b AS (SELECT id,record FROM orulo_audit.snapshot_records
      WHERE run_uuid=p_run AND kind='BASELINE_V2'||v_suffix),
    a AS (SELECT id,record FROM orulo_audit.snapshot_records
      WHERE run_uuid=p_run AND kind='READBACK_V2'||v_suffix),
    verified AS (
      SELECT (c.event->>'id')::uuid id,c.event->'result'->'receipt' receipt
      FROM orulo_audit.entries c
      JOIN orulo_audit.entries i USING (run_uuid,operation_uuid)
      JOIN orulo_audit.entries rb USING (run_uuid,operation_uuid)
      WHERE c.run_uuid=p_run AND c.kind='CAS_RESULT' AND i.kind='INTENT'
        AND rb.kind='CLIENT_READBACK' AND rb.event->>'stage'='NATIONAL_ROW_VERIFIED'
        AND i.event->'scope'->>'authorizationId'=v_auth->>'authorizationId'
        AND c.event->'result'->>'status'='UPDATED'
        AND c.event->'result'->'receipt'->>'verified'='true'
        AND rb.event->>'sha256'=c.event->'result'->'receipt'->>'afterSha256'
    )
    SELECT 1 FROM b FULL JOIN a USING (id) LEFT JOIN verified v USING (id)
    WHERE b.record IS DISTINCT FROM a.record AND (
      v.id IS NULL OR b.record->>4 IS DISTINCT FROM v.receipt->>'beforeFullHash'
      OR a.record->>4 IS DISTINCT FROM v.receipt->>'afterFullHash'
      OR b.record->>5 IS DISTINCT FROM v.receipt->>'expectedBeforeContentHash'
      OR a.record->>5 IS DISTINCT FROM v.receipt->>'expectedAfterContentHash'
    )
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPE_GLOBAL_READBACK_DIVERGENCE'; END IF;

  WITH statuses AS (
    SELECT CASE
      WHEN c.event->'result'->>'status'='UPDATED' AND rb.operation_uuid IS NOT NULL THEN 'UPDATED'
      WHEN c.operation_uuid IS NOT NULL THEN 'FAILED'
      WHEN t.event IS NULL OR p.id IS NULL THEN 'BLOCKED_DIVERGENCE'
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.event->'target'->'patches') x
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(p.raw_data#>'{building,floor_plans}')='array'
            THEN p.raw_data#>'{building,floor_plans}' ELSE '[]'::jsonb END
        ) y WHERE y->>'id'=x->>'id')
      ) THEN 'MISSING_PLAN'
      WHEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.event->'target'->'patches') x
        WHERE (SELECT count(*) FROM jsonb_array_elements(p.raw_data#>'{building,floor_plans}') y
          WHERE y->>'id'=x->>'id')<>1 OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p.raw_data#>'{building,floor_plans}') y
          WHERE y->>'id'=x->>'id' AND y->'images'=x->'images')
      ) THEN 'ALREADY_COMPLETE'
      WHEN encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') IS DISTINCT FROM
        t.event->'target'->>'baselineSha256' THEN 'BLOCKED_DIVERGENCE'
      ELSE 'PENDING'
    END AS status
    FROM jsonb_array_elements_text(v_auth->'targetIds') u(id)
    LEFT JOIN public.properties p ON p.id=u.id::uuid
    LEFT JOIN orulo_audit.entries t ON t.run_uuid=p_run AND t.kind='NATIONAL_TARGET' AND t.event->'target'->>'id'=u.id
    LEFT JOIN orulo_audit.entries i ON i.run_uuid=p_run AND i.kind='INTENT' AND i.event->>'id'=u.id
      AND i.event->'scope'->>'authorizationId'=v_auth->>'authorizationId'
    LEFT JOIN orulo_audit.entries c ON c.run_uuid=p_run AND c.kind='CAS_RESULT' AND c.operation_uuid=i.operation_uuid
    LEFT JOIN orulo_audit.entries rb ON rb.run_uuid=p_run AND rb.kind='CLIENT_READBACK' AND rb.operation_uuid=i.operation_uuid
      AND rb.event->>'stage'='NATIONAL_ROW_VERIFIED'
      AND rb.event->>'sha256'=c.event->'result'->'receipt'->>'afterSha256'
  )
  SELECT jsonb_object_agg(status,n) INTO v_counts FROM
    (SELECT status,count(*) n FROM statuses GROUP BY status) groups;
  RETURN orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object(
    'type','NATIONAL_SCOPE_FINISHED','eventUuid',p_event->>'eventUuid',
    'authorizationId',v_auth->>'authorizationId','lot',v_auth->'lot',
    'planSha256',v_auth->>'planSha256','manifestHash',v_auth->>'manifestHash',
    'counts',v_counts,'policy','STRICT_GLOBAL_V1'
  ));
END;
$$;

ALTER FUNCTION orulo_audit.national_scope_finish(uuid,bigint,text,jsonb) OWNER TO orulo_audit_owner;
REVOKE ALL ON FUNCTION orulo_audit.national_scope_finish(uuid,bigint,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
