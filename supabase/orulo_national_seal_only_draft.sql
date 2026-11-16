-- Órulo national: DRAFT seal-only function. REVIEW / TEST ONLY.
-- DO NOT DEPLOY OR MERGE WITHOUT SEPARATE OWNER APPROVAL AND REAL-SNAPSHOT TEST.
-- Prerequisite: checkpoint staging migration; 114 verified pages from authenticated
-- artifact runner. Preserves STRICT_GLOBAL_V1, never authorizes CAS or properties DML.
BEGIN;

CREATE FUNCTION orulo_audit.national_seal_only_frozen_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO '' SET timezone TO 'UTC' SET synchronous_commit TO 'on'
SET lock_timeout TO '5s' AS $seal$
DECLARE
  r constant uuid := '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid;
  h constant text := 'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288';
  historical_head constant text := 'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6';
  e orulo_audit.entries%ROWTYPE;
  progress orulo_audit.national_seal_page_progress%ROWTYPE;
  meta jsonb;
  recovered_text_hash text;
  total_fragments bigint; unique_fragments bigint;
  total_targets bigint; total_patches bigint; total_buildings bigint; total_urls bigint;
  total_proofs bigint; total_covered bigint; bad_pages bigint;
  columns jsonb; ack jsonb;
  expected_stats jsonb := '{
    "properties":5684,"eligibleOccurrences":42893,"buildings":2116,
    "distinctUrls":39525,"imageUrlOccurrences":128679,
    "candidateOccurrences":43130,"blockedOccurrences":237,
    "blockedReasons":{
      "BASELINE_CHANGED_SINCE_RECONCILIATION":63,
      "SOURCE_HTTP_ERROR":21,"SOURCE_RESOURCE_LIMIT":2,
      "SOURCE_TIMEOUT":4,"TARGET_IMAGES_PRESENT":147
    }
  }'::jsonb;
BEGIN
  -- Only a direct, trusted PostgreSQL owner session can seal. The existing
  -- require_service() deliberately accepts service_role, which MUST NOT be
  -- permitted to invoke this manual seal-only entrypoint via PostgREST.
  -- SECURITY DEFINER changes current_user, so check the original session.
  IF session_user IS DISTINCT FROM 'postgres'
     OR current_setting('role',true) NOT IN ('none','postgres')
  THEN RAISE EXCEPTION 'SEAL_ONLY_DIRECT_DATABASE_OWNER_REQUIRED'; END IF;
  -- Serialize with all other national actions using the SAME historical run lock.
  PERFORM orulo_audit.lock_run(r);

  SELECT * INTO e FROM orulo_audit.entries
    WHERE run_uuid=r ORDER BY sequence DESC LIMIT 1;
  -- Replay only a verified seal at 6241. No new mutation.
  IF e.kind='NATIONAL_MANIFEST_SEALED' THEN
    IF e.sequence<>6241 OR e.previous_hash<>historical_head
       OR e.event->>'manifestHash'<>h OR (e.event->>'targetCount')::int<>5684
    THEN RAISE EXCEPTION 'SEAL_ONLY_REPLAY_DIVERGED'; END IF;
    RETURN jsonb_build_object('status','ALREADY_SEALED','runUuid',r,
      'sequence',e.sequence,'hash',e.hash,'writeAuthorized',false);
  END IF;

  IF e.sequence IS DISTINCT FROM 6240 OR e.hash IS DISTINCT FROM historical_head
    OR EXISTS(SELECT 1 FROM orulo_audit.entries
      WHERE run_uuid=r AND kind IN
        ('NATIONAL_MANIFEST_SEALED','WRITE_AUTHORIZED','INTENT','CAS_RESULT',
         'ABORTED','FINISHED'))
  THEN RAISE EXCEPTION 'SEAL_ONLY_FROZEN_HEAD_DIVERGED'; END IF;
  SELECT metadata INTO meta FROM orulo_audit.runs WHERE run_uuid=r;
  IF meta->>'mode'<>'national-v2-once' OR meta->>'manifestHash'<>h
     OR meta->>'workflowSha'<>'e660a30cd78a56b1fea4beff3daa0b8c4a032a35'
     OR meta->>'githubRunId'<>'43003536521'
  THEN RAISE EXCEPTION 'SEAL_ONLY_HISTORICAL_RUN_DIVERGED'; END IF;

  SELECT * INTO progress FROM orulo_audit.national_seal_page_progress
    WHERE run_uuid=r FOR UPDATE;
  IF NOT FOUND OR progress.manifest_sha256<>h
    OR progress.frozen_head_sequence<>6240
    OR progress.frozen_head_hash<>historical_head
    OR progress.next_offset<>5684 OR progress.page_count<>114
  THEN RAISE EXCEPTION 'SEAL_ONLY_CHECKPOINTS_INCOMPLETE'; END IF;

  -- Verify every stored proof (including page continuity). The original page
  -- checkpoint RPC previously compared each complete JSONB page to the ledger.
  WITH ordered AS (
    SELECT p.*, lag(page_offset+target_count,1,0) OVER
      (ORDER BY page_offset) AS expected_offset
    FROM orulo_audit.national_seal_page_proofs p WHERE run_uuid=r
  )
  SELECT count(*),coalesce(sum(target_count),0),
    count(*) FILTER (WHERE page_offset<>expected_offset OR manifest_sha256<>h
      OR frozen_head_hash<>historical_head OR target_count NOT BETWEEN 1 AND 50
      OR first_target_id>last_target_id)
  INTO total_proofs,total_covered,bad_pages FROM ordered;
  IF total_proofs<>114 OR total_covered<>5684 OR bad_pages<>0
  THEN RAISE EXCEPTION 'SEAL_ONLY_PROOF_COVERAGE_DIVERGED'; END IF;

  -- Original byte identity, independently recomputed in PostgreSQL.
  -- Avoids the historical full-document JSONB parse or global jsonb_agg.
  SELECT count(*),count(DISTINCT (event->>'part')::integer),
    encode(sha256(convert_to(string_agg(event->>'text',''
      ORDER BY (event->>'part')::integer),'UTF8')),'hex')
  INTO total_fragments,unique_fragments,recovered_text_hash
  FROM orulo_audit.entries
  WHERE run_uuid=r AND kind='NATIONAL_MANIFEST_PART';
  IF total_fragments<>555 OR unique_fragments<>555
    OR recovered_text_hash<>h
    OR EXISTS(SELECT 1 FROM orulo_audit.entries
      WHERE run_uuid=r AND kind='NATIONAL_MANIFEST_PART'
      AND (event->>'part')::integer NOT BETWEEN 0 AND 554)
  THEN RAISE EXCEPTION 'SEAL_ONLY_SOURCE_HASH_DIVERGED'; END IF;

  SELECT count(*),coalesce(sum(jsonb_array_length(event->'target'->'patches')),0),
    count(DISTINCT event->'target'->>'buildingId')
  INTO total_targets,total_patches,total_buildings
  FROM orulo_audit.entries WHERE run_uuid=r AND kind='NATIONAL_TARGET';
  IF total_targets<>5684 OR total_patches<>42893 OR total_buildings<>2116
     OR EXISTS(SELECT 1 FROM orulo_audit.entries
       WHERE run_uuid=r AND kind='NATIONAL_TARGET'
         AND (jsonb_typeof(event->'target'->'patches')<>'array'
           OR jsonb_array_length(event->'target'->'patches')=0))
  THEN RAISE EXCEPTION 'SEAL_ONLY_SCOPE_DIVERGED'; END IF;

  SELECT count(DISTINCT image #>> '{}') INTO total_urls
  FROM orulo_audit.entries source_entry
  CROSS JOIN LATERAL jsonb_array_elements(source_entry.event->'target'->'patches') patch
  CROSS JOIN LATERAL jsonb_array_elements(patch->'images') AS images(image)
  WHERE source_entry.run_uuid=r AND source_entry.kind='NATIONAL_TARGET';
  IF total_urls<>39525 THEN RAISE EXCEPTION 'SEAL_ONLY_URL_COUNT_DIVERGED'; END IF;

  -- Pin the historical columns function definition, no untrusted caller columns.
  IF encode(sha256(convert_to(pg_get_functiondef(
      'orulo_audit.columns_v2()'::regprocedure),'UTF8')),'hex')
     <> '3aa4d73c7a7100a523c23507c836299bd90dee4dacfcf772f6084469b713cea3'
  THEN RAISE EXCEPTION 'SEAL_ONLY_COLUMN_CONTRACT_DIVERGED'; END IF;
  columns := orulo_audit.columns_v2();

  -- Only the historical seal event. No WRITE_AUTHORIZED, INTENT or CAS calls.
  ack := orulo_audit.append(r,6241,historical_head,jsonb_build_object(
    'type','NATIONAL_MANIFEST_SEALED','eventUuid',gen_random_uuid(),
    'manifestHash',h,'columns',columns,'stats',expected_stats,
    'targetCount',5684));
  IF (ack->>'sequence')::bigint<>6241
  THEN RAISE EXCEPTION 'SEAL_ONLY_APPEND_RECEIPT_INVALID'; END IF;
  RETURN jsonb_build_object('status','SEALED_ONLY','runUuid',r,
    'sequence',6241,'hash',ack->>'hash','writeAuthorized',false);
END
$seal$;

ALTER FUNCTION orulo_audit.national_seal_only_frozen_v1()
  OWNER TO orulo_audit_owner;
REVOKE ALL ON FUNCTION orulo_audit.national_seal_only_frozen_v1()
  FROM PUBLIC,anon,authenticated,service_role;
-- Only explicit SQL Editor invocation by the trusted DB owner after APPROVAL.
-- Intentionally no exposed public/PostgREST RPC and no GRANT to service_role.
COMMENT ON FUNCTION orulo_audit.national_seal_only_frozen_v1()
 IS 'DRAFT ONLY: historical national seal-only, no CAS authorization. Requires 114 verified checkpoints, frozen manifest bytes and explicit separately approved DB execution.';
COMMIT;
