-- Órulo National V2: bounded, append-only-ledger-preserving checkpoint prototype.
-- REVIEW ONLY. DO NOT APPLY TO PRODUCTION. NO NATIONAL SEAL OR CAS IS PROVIDED.
--
-- This staging migration checks each supplied JSONB page against the independently
-- frozen NATIONAL_TARGET ledger records. It DOES NOT attest that a client has the
-- original manifest artifact nor does it grant any write authority. Its receipts
-- are verification checkpoints, NOT replacements for the original document SHA.
--
-- Original immutable run: 1c8ec62a-9c38-41ac-8091-f1ceef98ca91.
-- Frozen head: 6240 / a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6.
-- Original manifest: ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288.
-- This SQL must be tested against an isolated PostgreSQL fixture before review.

BEGIN;

CREATE TABLE orulo_audit.national_seal_page_progress (
  run_uuid uuid PRIMARY KEY REFERENCES orulo_audit.runs(run_uuid),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  frozen_head_sequence bigint NOT NULL,
  frozen_head_hash text NOT NULL CHECK (frozen_head_hash ~ '^[a-f0-9]{64}$'),
  next_offset integer NOT NULL DEFAULT 0 CHECK (next_offset BETWEEN 0 AND 5684),
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 114),
  last_target_id text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fixed_frozen_head CHECK (frozen_head_sequence = 6240)
);

CREATE TABLE orulo_audit.national_seal_page_proofs (
  run_uuid uuid NOT NULL REFERENCES orulo_audit.runs(run_uuid),
  page_offset integer NOT NULL CHECK (page_offset BETWEEN 0 AND 5683),
  target_count integer NOT NULL CHECK (target_count BETWEEN 1 AND 50),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_page_sha256 text NOT NULL CHECK (canonical_page_sha256 ~ '^[a-f0-9]{64}$'),
  first_target_id text NOT NULL,
  last_target_id text NOT NULL,
  frozen_head_hash text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_uuid, page_offset)
);

-- Private schema, no API or browser table access.
REVOKE ALL ON orulo_audit.national_seal_page_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON orulo_audit.national_seal_page_proofs FROM PUBLIC, anon, authenticated;
ALTER TABLE orulo_audit.national_seal_page_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE orulo_audit.national_seal_page_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orulo_audit.national_seal_page_progress FORCE ROW LEVEL SECURITY;
ALTER TABLE orulo_audit.national_seal_page_proofs FORCE ROW LEVEL SECURITY;
ALTER TABLE orulo_audit.national_seal_page_progress OWNER TO orulo_audit_owner;
ALTER TABLE orulo_audit.national_seal_page_proofs OWNER TO orulo_audit_owner;
CREATE POLICY owner_only ON orulo_audit.national_seal_page_progress FOR ALL
  TO orulo_audit_owner USING (true) WITH CHECK (true);
CREATE POLICY owner_only ON orulo_audit.national_seal_page_proofs FOR ALL
  TO orulo_audit_owner USING (true) WITH CHECK (true);

CREATE FUNCTION orulo_audit.national_seal_checkpoint_page(
  p_run uuid,
  p_manifest_sha256 text,
  p_offset integer,
  p_expected_targets jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET "TimeZone" TO 'UTC'
SET synchronous_commit TO 'on'
SET lock_timeout TO '5s'
AS $$
DECLARE
  v_head_seq bigint;
  v_head_hash text;
  v_count integer;
  v_total integer;
  v_page jsonb;
  v_sha text;
  v_first text;
  v_last text;
  v_progress orulo_audit.national_seal_page_progress%ROWTYPE;
  v_existing orulo_audit.national_seal_page_proofs%ROWTYPE;
  v_exists boolean;
BEGIN
  PERFORM orulo_audit.require_service();
  PERFORM orulo_audit.lock_run(p_run);

  -- Deliberately scoped to the one historical run and immutable artifact.
  IF p_run IS DISTINCT FROM '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
     OR p_manifest_sha256 IS DISTINCT FROM
       'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288'
  THEN RAISE EXCEPTION 'CHECKPOINT_WRONG_FROZEN_RUN'; END IF;

  SELECT sequence, hash INTO v_head_seq, v_head_hash
    FROM orulo_audit.entries WHERE run_uuid = p_run ORDER BY sequence DESC LIMIT 1;
  IF v_head_seq IS DISTINCT FROM 6240
    OR v_head_hash IS DISTINCT FROM
      'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6'
    OR EXISTS (SELECT 1 FROM orulo_audit.entries
      WHERE run_uuid = p_run AND kind IN
        ('NATIONAL_MANIFEST_SEALED','WRITE_AUTHORIZED','INTENT','CAS_RESULT','ABORTED','FINISHED'))
  THEN RAISE EXCEPTION 'CHECKPOINT_FROZEN_LEDGER_DIVERGED'; END IF;

  IF p_offset IS NULL OR p_offset < 0 OR p_offset >= 5684
     OR jsonb_typeof(p_expected_targets) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'CHECKPOINT_INVALID_PAGE'; END IF;
  v_count := jsonb_array_length(p_expected_targets);
  IF v_count < 1 OR v_count > 50 OR p_offset + v_count > 5684
  THEN RAISE EXCEPTION 'CHECKPOINT_INVALID_PAGE_SIZE'; END IF;

  -- Avoid a global JSONB aggregate (measured dominant operation in the old seal).
  SELECT jsonb_agg(s.target ORDER BY s.target_id) INTO v_page
  FROM (
    SELECT e.event->'target' AS target, e.event->'target'->>'id' AS target_id
    FROM orulo_audit.entries e
    WHERE e.run_uuid = p_run AND e.kind = 'NATIONAL_TARGET'
    ORDER BY e.event->'target'->>'id'
    LIMIT v_count OFFSET p_offset
  ) s;

  IF v_page IS DISTINCT FROM p_expected_targets
  THEN RAISE EXCEPTION 'CHECKPOINT_TARGET_PAGE_DIVERGED'; END IF;

  SELECT COUNT(*) INTO v_total FROM orulo_audit.entries
    WHERE run_uuid=p_run AND kind='NATIONAL_TARGET';
  IF v_total <> 5684 THEN RAISE EXCEPTION 'CHECKPOINT_TARGET_COUNT_DIVERGED'; END IF;

  SELECT p_expected_targets->0->>'id',
         p_expected_targets->(v_count-1)->>'id'
    INTO v_first, v_last;
  IF v_first IS NULL OR v_last IS NULL
     OR EXISTS (
       SELECT 1 FROM (
         SELECT item->>'id' AS id,
           lag(item->>'id') OVER (ORDER BY pos) AS previous_id
         FROM jsonb_array_elements(p_expected_targets) WITH ORDINALITY AS x(item,pos)
       ) z WHERE z.id IS NULL OR (z.previous_id IS NOT NULL AND z.id <= z.previous_id)
     )
  THEN RAISE EXCEPTION 'CHECKPOINT_TARGET_IDS_UNSORTED'; END IF;

  v_sha := encode(sha256(convert_to(p_expected_targets::text, 'UTF8')), 'hex');

  -- The progress row and its proof are committed in the SAME transaction.
  INSERT INTO orulo_audit.national_seal_page_progress
    (run_uuid,manifest_sha256,frozen_head_sequence,frozen_head_hash)
  VALUES (p_run,p_manifest_sha256,v_head_seq,v_head_hash)
  ON CONFLICT (run_uuid) DO NOTHING;

  SELECT * INTO STRICT v_progress FROM orulo_audit.national_seal_page_progress
    WHERE run_uuid = p_run FOR UPDATE;

  IF v_progress.manifest_sha256 IS DISTINCT FROM p_manifest_sha256
     OR v_progress.frozen_head_hash IS DISTINCT FROM v_head_hash
  THEN RAISE EXCEPTION 'CHECKPOINT_PROGRESS_IDENTITY_DIVERGED'; END IF;

  IF p_offset < v_progress.next_offset THEN
    SELECT * INTO v_existing FROM orulo_audit.national_seal_page_proofs
      WHERE run_uuid=p_run AND page_offset=p_offset;
    IF NOT FOUND
       OR v_existing.target_count IS DISTINCT FROM v_count
       OR v_existing.canonical_page_sha256 IS DISTINCT FROM v_sha
       OR v_existing.manifest_sha256 IS DISTINCT FROM p_manifest_sha256
       OR v_existing.first_target_id IS DISTINCT FROM v_first
       OR v_existing.last_target_id IS DISTINCT FROM v_last
    THEN RAISE EXCEPTION 'CHECKPOINT_REPLAY_DIVERGED'; END IF;
    RETURN jsonb_build_object('status','ALREADY_VERIFIED','nextOffset',v_progress.next_offset,
      'pageOffset',p_offset,'pageSha256',v_sha);
  END IF;

  IF p_offset <> v_progress.next_offset OR
     (v_progress.last_target_id IS NOT NULL AND v_first <= v_progress.last_target_id)
  THEN RAISE EXCEPTION 'CHECKPOINT_PAGE_SEQUENCE_INVALID'; END IF;

  INSERT INTO orulo_audit.national_seal_page_proofs
    (run_uuid,page_offset,target_count,manifest_sha256,canonical_page_sha256,
      first_target_id,last_target_id,frozen_head_hash)
  VALUES (p_run,p_offset,v_count,p_manifest_sha256,v_sha,v_first,v_last,v_head_hash);

  UPDATE orulo_audit.national_seal_page_progress
    SET next_offset=p_offset+v_count, page_count=page_count+1,
      last_target_id=v_last,updated_at=clock_timestamp()
    WHERE run_uuid=p_run;

  RETURN jsonb_build_object('status','VERIFIED','pageOffset',p_offset,
    'pageSize',v_count,'nextOffset',p_offset+v_count,'pageSha256',v_sha,
    'sealed',false,'writeAuthorized',false);
END
$$;

ALTER FUNCTION orulo_audit.national_seal_checkpoint_page(uuid,text,integer,jsonb)
  OWNER TO orulo_audit_owner;
REVOKE ALL ON FUNCTION orulo_audit.national_seal_checkpoint_page(uuid,text,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION orulo_audit.national_seal_checkpoint_page(uuid,text,integer,jsonb)
  TO service_role;

COMMENT ON FUNCTION orulo_audit.national_seal_checkpoint_page(uuid,text,integer,jsonb)
  IS 'STAGING CHECKPOINT ONLY: no seal, no CAS, no authorization; requires original artifact verification independently.';

COMMIT;
