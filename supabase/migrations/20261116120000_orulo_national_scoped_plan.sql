-- Read-only plan for an existing frozen national operation. This function
-- neither authorizes CAS nor changes the original authorization contract.
BEGIN;

CREATE FUNCTION orulo_audit.national_scoped_plan(
  p_run uuid, p_lot integer, p_ids uuid[], p_github_run text, p_code_sha text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
  v_targets jsonb;
  v_count bigint;
  v_total bigint;
BEGIN
  IF p_run IS DISTINCT FROM '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
    OR p_lot IS NULL OR p_lot NOT BETWEEN 1 AND 10
    OR coalesce(p_github_run,'') !~ '^[1-9][0-9]*$'
    OR coalesce(p_code_sha,'') !~ '^[a-f0-9]{40}$'
    OR (p_ids IS NOT NULL AND (
      cardinality(p_ids) NOT BETWEEN 1 AND 5684
      OR cardinality(p_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_ids) AS u(id))
    ))
  THEN RAISE EXCEPTION 'NATIONAL_SCOPED_PLAN_INVALID'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM orulo_audit.entries e
    WHERE e.run_uuid=p_run AND e.sequence=6241 AND e.kind='NATIONAL_MANIFEST_SEALED'
      AND e.hash='80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f'
      AND e.event->>'manifestHash'='ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288'
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPED_SEAL_MISMATCH'; END IF;

  WITH frozen AS (
    SELECT e.event->'target'->>'id' AS id,
           jsonb_array_length(e.event->'target'->'patches') AS occurrences
    FROM orulo_audit.entries e
    WHERE e.run_uuid=p_run AND e.kind='NATIONAL_TARGET' AND e.sequence<6241
  ), ordered AS (
    SELECT f.*, sum(occurrences) OVER (ORDER BY id COLLATE "C" ROWS UNBOUNDED PRECEDING)
      - occurrences AS before_count
    FROM frozen f
  ), eligible AS (
    SELECT id FROM ordered
    WHERE least(10, floor((before_count+occurrences/2.0)*10.0/42893)::integer+1)=p_lot
      AND (p_ids IS NULL OR id::uuid=ANY(p_ids))
  )
  SELECT (SELECT jsonb_agg(id ORDER BY id COLLATE "C") FROM eligible),
         (SELECT count(*) FROM frozen), (SELECT sum(occurrences) FROM frozen)
    INTO v_targets,v_count,v_total;

  IF v_count<>5684 OR v_total IS DISTINCT FROM 42893 OR v_targets IS NULL
    OR (p_ids IS NOT NULL AND jsonb_array_length(v_targets)<>cardinality(p_ids))
  THEN RAISE EXCEPTION 'NATIONAL_SCOPED_TARGET_MISMATCH'; END IF;

  v_plan := jsonb_build_object(
    'version',1,'runUuid',p_run,'lot',p_lot,'targetIds',v_targets,
    'githubRunId',p_github_run,'controlSha',p_code_sha,'sealSequence',6241,
    'sealHash','80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f',
    'manifestHash','ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288'
  );
  RETURN v_plan || jsonb_build_object(
    'planSha256',encode(sha256(convert_to(v_plan::text,'UTF8')),'hex')
  );
END;
$$;

REVOKE ALL ON FUNCTION orulo_audit.national_scoped_plan(uuid,integer,uuid[],text,text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
