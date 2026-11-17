-- Review-only migration. Do NOT apply until the read-only benchmark and rollback plan are approved.
-- CAS2: replace the expensive per-target INTENT JSON join in the scoped finish classifier.
-- Immutable contract guard; preserves signature, ACL, owner, privileges, timeout, and the
-- authoritative per-target rules (UPDATED, FAILED, MISSING_PLAN, ALREADY_COMPLETE,
-- BLOCKED_DIVERGENCE, PENDING). No changes to CAS, lease, snapshot, or property updates.
BEGIN;
DO $patch$
DECLARE
  v_oid oid := 'orulo_audit.national_scope_finish(uuid,bigint,text,jsonb)'::regprocedure;
  v_definition text;
  v_old text := $old_classifier$
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
$old_classifier$;
  v_new text := $new_classifier$
  WITH verified AS MATERIALIZED (
    -- Project small typed fields once; do not materialize the large INTENT JSON documents for each target.
    SELECT i.event->>'id' AS id,
      c.operation_uuid AS cas_operation_uuid,
      c.event->'result'->>'status' AS cas_status,
      rb.operation_uuid IS NOT NULL AS has_readback
    FROM orulo_audit.entries i
    LEFT JOIN orulo_audit.entries c
      ON c.run_uuid=i.run_uuid AND c.kind='CAS_RESULT' AND c.operation_uuid=i.operation_uuid
    LEFT JOIN orulo_audit.entries rb
      ON rb.run_uuid=i.run_uuid AND rb.kind='CLIENT_READBACK'
      AND rb.operation_uuid=i.operation_uuid
      AND rb.event->>'stage'='NATIONAL_ROW_VERIFIED'
      AND rb.event->>'sha256'=c.event->'result'->'receipt'->>'afterSha256'
    WHERE i.run_uuid=p_run AND i.kind='INTENT'
      AND i.event->'scope'->>'authorizationId'=v_auth->>'authorizationId'
  ), statuses AS (
    SELECT CASE
      WHEN v.cas_status='UPDATED' AND v.has_readback THEN 'UPDATED'
      WHEN v.cas_operation_uuid IS NOT NULL THEN 'FAILED'
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
    LEFT JOIN verified v ON v.id=u.id
  )
  SELECT jsonb_object_agg(status,n) INTO v_counts FROM
    (SELECT status,count(*) n FROM statuses GROUP BY status) groups;
$new_classifier$;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=v_oid
      AND pg_get_userbyid(p.proowner)='orulo_audit_owner'
      AND p.prosecdef=false
      AND p.proacl::text='{orulo_audit_owner=X/orulo_audit_owner}'
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
        '8c99bc419cc0e7256d0fa932561500e82a61deb36843f6338a87d6e898aa8016'
  ) THEN RAISE EXCEPTION 'CAS2_SCOPED_FINISH_CONTRACT_DRIFT'; END IF;
  v_definition:=pg_get_functiondef(v_oid);
  IF (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1
  THEN RAISE EXCEPTION 'CAS2_SCOPED_FINISH_PATCH_ANCHOR_MISMATCH'; END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$patch$;
COMMIT;
