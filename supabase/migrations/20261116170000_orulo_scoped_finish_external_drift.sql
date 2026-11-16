BEGIN;
-- This migration changes only scoped completion. CAS, authorization and snapshot
-- collection remain unchanged. Refuse unexpected installed definitions.
DO $contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='orulo_audit.national_scope_finish(uuid,bigint,text,jsonb)'::regprocedure
      AND pg_get_userbyid(p.proowner)='orulo_audit_owner'
      AND p.prosecdef=false
      AND p.proacl::text='{orulo_audit_owner=X/orulo_audit_owner}'
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
        'd2a2060dbe68380f13bd7a4f693595b0876a55ae651d70b9c993d6f0ddf6a2ba'
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPE_FINISH_CONTRACT_DRIFT'; END IF;
END;
$contract$;

CREATE OR REPLACE FUNCTION orulo_audit.national_scope_finish(
  p_run uuid,p_sequence bigint,p_previous_hash text,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='30s'
AS $$
DECLARE
  v_auth jsonb;
  v_suffix text;
  v_counts jsonb;
  v_prior jsonb;
  v_external_count bigint;
  v_external_digest text;
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

  -- Outside the authorized target set, record immutable evidence of external
  -- application drift without attributing it to this scoped CAS operation.
  -- Authorized target changes remain subject to the original exact receipt rule.
  WITH b AS (
    SELECT id,record FROM orulo_audit.snapshot_records
    WHERE run_uuid=p_run AND kind='BASELINE_V2'||v_suffix
  ), a AS (
    SELECT id,record FROM orulo_audit.snapshot_records
    WHERE run_uuid=p_run AND kind='READBACK_V2'||v_suffix
  ), external_changes AS (
    SELECT coalesce(b.id,a.id) id,b.record before_record,a.record after_record
    FROM b FULL JOIN a USING (id)
    WHERE b.record IS DISTINCT FROM a.record
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_auth->'targetIds') target(id)
        WHERE target.id=coalesce(b.id,a.id)::text
      )
  )
  SELECT count(*),
    encode(sha256(convert_to(
      coalesce(jsonb_agg(jsonb_build_object(
        'id',id,'before',before_record,'after',after_record) ORDER BY id),
        '[]'::jsonb)::text,'UTF8')),'hex')
  INTO v_external_count,v_external_digest
  FROM external_changes;

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
    WHERE b.record IS DISTINCT FROM a.record
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_auth->'targetIds') target(id)
        WHERE target.id=coalesce(b.id,a.id)::text
      )
      AND (
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
    'counts',v_counts,
    'outsideScopeDrift',jsonb_build_object(
      'count',v_external_count,'snapshotPairSha256',v_external_digest,
      'disposition','EXTERNAL_UNATTRIBUTED_REQUIRES_SEPARATE_REVIEW'),
    'policy','STRICT_SCOPED_RECEIPTS_WITH_RECORDED_EXTERNAL_DRIFT_V1'
  ));
END;
$$;

COMMIT;
