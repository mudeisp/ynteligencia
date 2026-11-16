-- POSITIVE end-to-end seal-only rehearsal on the DISPOSABLE PostgreSQL CI fixture.
-- Test-only substitutions: the historical 72MB source cannot be fabricated.
-- Exactly the draft function body is compiled with its pinned *manifest SHA*
-- substituted by SHA(555 synthetic 'x' fragments), and columns_v2 ABI fingerprint
-- substituted by the test stub fingerprint. No production code is changed.
-- Real original artifact equality was separately attested in run 43842329053.
DO $guard$ BEGIN
 IF current_database()<>'postgres' OR (SELECT count(*) FROM orulo_audit.entries)<>6240
 THEN RAISE EXCEPTION 'SEAL_POSITIVE_TEST_DISPOSABLE_DB_ONLY'; END IF;
END $guard$;

-- Test append preserves sequence, previous hash, canonical hash, atomicity.
ALTER TABLE orulo_audit.entries
 ADD COLUMN event_uuid uuid,
 ADD COLUMN operation_uuid uuid,
 ADD COLUMN previous_hash text,
 ADD COLUMN canonical text;
CREATE FUNCTION orulo_audit.append(p_run uuid,p_sequence bigint,p_previous text,p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $append$
DECLARE n bigint; previous text; canonical text; new_hash text;
BEGIN
 PERFORM orulo_audit.lock_run(p_run);
 SELECT sequence+1,hash INTO n,previous FROM orulo_audit.entries
 WHERE run_uuid=p_run ORDER BY sequence DESC LIMIT 1;
 IF p_sequence IS DISTINCT FROM n OR p_previous IS DISTINCT FROM previous
 THEN RAISE EXCEPTION 'AUDIT_SEQUENCE_CONFLICT'; END IF;
 IF jsonb_typeof(p_event) IS DISTINCT FROM 'object'
 OR NOT(p_event ? 'eventUuid') OR NOT(p_event ? 'type')
 THEN RAISE EXCEPTION 'AUDIT_INVALID_EVENT'; END IF;
 canonical:=jsonb_build_object('runUuid',p_run,'sequence',n,
 'previousHash',previous,'event',p_event)::text;
 new_hash:=encode(sha256(convert_to(canonical,'UTF8')),'hex');
 INSERT INTO orulo_audit.entries
 (run_uuid,sequence,kind,event,hash,event_uuid,previous_hash,canonical)
 VALUES(p_run,n,p_event->>'type',p_event,new_hash,(p_event->>'eventUuid')::uuid,previous,canonical);
 RETURN jsonb_build_object('runUuid',p_run,'sequence',n,'hash',new_hash,
 'eventUuid',p_event->>'eventUuid');
END $append$;
CREATE FUNCTION orulo_audit.columns_v2() RETURNS jsonb
 LANGUAGE sql STABLE SET search_path='' AS $columns$
 SELECT '[["id","uuid"],["raw_data","jsonb"]]'::jsonb;
$columns$;

-- Supply 555 reproducible source fragments, 5,684 targets, 42,893 patches,
-- exactly 39,525 distinct URL strings and 2,116 distinct building IDs.
-- 3 image URLs / patch == 128,679 occurrences. This is a synthetic fixture.
UPDATE orulo_audit.entries
 SET event=jsonb_build_object('part',sequence-2,'text','x','type','NATIONAL_MANIFEST_PART')
 WHERE sequence BETWEEN 2 AND 556;

WITH all_patches AS (
 SELECT n,j, row_number() OVER(ORDER BY n,j) AS ordinal
 FROM generate_series(557,6240) AS n
 CROSS JOIN LATERAL generate_series(1,7+CASE WHEN n<=557+3105-1 THEN 1 ELSE 0 END) j
),patches AS (
 SELECT n,jsonb_agg(jsonb_build_object(
  'id',ordinal::text,'validation','SOURCE_IMAGE_VALID',
  'sourceChunk',0,'sourceResultSha256',repeat('0',64),
  'images',jsonb_build_array(
    'https://example.invalid/plan/'||((ordinal-1)%39525)::text,
    'https://example.invalid/plan/'||((ordinal-1)%39525)::text,
    'https://example.invalid/plan/'||((ordinal-1)%39525)::text
  )) ORDER BY j) AS p FROM all_patches GROUP BY n
)
UPDATE orulo_audit.entries e SET event=jsonb_set(
 jsonb_set(e.event,'{target,patches}',p.p,true),
 '{target,buildingId}',to_jsonb(((e.sequence-557)%2116)::text),true)
FROM patches p WHERE e.sequence=p.n;

UPDATE orulo_audit.runs SET metadata=jsonb_build_object(
  'mode','national-v2-once',
  'workflowSha','e660a30cd78a56b1fea4beff3daa0b8c4a032a35',
  'githubRunId','43003536521',
  'manifestHash',encode(sha256(convert_to(repeat('x',555),'UTF8')),'hex'))
WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid;

-- Reset any negative-test checkpoints in this disposable database only.
TRUNCATE orulo_audit.national_seal_page_proofs,orulo_audit.national_seal_page_progress;

-- All 114 page proofs are produced by the real checkpoint RPC, not inserted
-- manually; 113 pages of 50 plus one of 34 (5,684 target coverage).
DO $pages$
DECLARE r uuid:='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid;
 h text:='ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288';
 page_offset integer; p jsonb; response jsonb;
BEGIN
 FOR page_offset IN SELECT generate_series(0,5650,50) LOOP
  SELECT jsonb_agg(target ORDER BY id) INTO p FROM (
   SELECT event->'target' AS target,event->'target'->>'id' id
   FROM orulo_audit.entries WHERE run_uuid=r AND kind='NATIONAL_TARGET'
   ORDER BY event->'target'->>'id' LIMIT 50 OFFSET page_offset
  ) q;
  response:=orulo_audit.national_seal_checkpoint_page(r,h,page_offset,p);
  IF response->>'status'<>'VERIFIED'
    THEN RAISE EXCEPTION 'SYNTHETIC_PAGE_NOT_VERIFIED %',page_offset; END IF;
 END LOOP;
 IF (SELECT next_offset FROM orulo_audit.national_seal_page_progress WHERE run_uuid=r)<>5684
 THEN RAISE EXCEPTION 'SYNTHETIC_CHECKPOINTS_INCOMPLETE'; END IF;
END $pages$;

-- Align the test-only verified page receipts with the synthetic document hash.
-- There is no such mutation in the real workflow or production function.
UPDATE orulo_audit.national_seal_page_progress
 SET manifest_sha256=encode(sha256(convert_to(repeat('x',555),'UTF8')),'hex');
UPDATE orulo_audit.national_seal_page_proofs
 SET manifest_sha256=encode(sha256(convert_to(repeat('x',555),'UTF8')),'hex');

-- Override only the test PostgreSQL function's SOURCE SHA and COLUMNS ABI SHA.
-- The committed draft migration keeps its fixed production constants unchanged.
DO $compile$
DECLARE source text; synthetic_sha text; synthetic_columns_sha text;
BEGIN
 synthetic_sha:=encode(sha256(convert_to(repeat('x',555),'UTF8')),'hex');
 synthetic_columns_sha:=encode(sha256(convert_to(pg_get_functiondef(
   'orulo_audit.columns_v2()'::regprocedure),'UTF8')),'hex');
 source:=pg_get_functiondef('orulo_audit.national_seal_only_frozen_v1()'::regprocedure);
 source:=replace(source,
 'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288',synthetic_sha);
 source:=replace(source,
 '3aa4d73c7a7100a523c23507c836299bd90dee4dacfcf772f6084469b713cea3',synthetic_columns_sha);
 EXECUTE source;
END $compile$;

DO $positive$
DECLARE run uuid:='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid;
 response jsonb; initial_hash text; refused boolean; final_hash text;
BEGIN
 IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=run)<>6240
 THEN RAISE EXCEPTION 'LEDGER_PRESEAL_NOT_FROZEN'; END IF;
 IF (SELECT count(*) FROM orulo_audit.national_seal_page_proofs WHERE run_uuid=run)<>114
 THEN RAISE EXCEPTION 'PROOFS_NOT_COMPLETE'; END IF;

 -- Test atomicity: even successful append is rolled back if client aborts.
 BEGIN
  response:=orulo_audit.national_seal_only_frozen_v1();
  IF response->>'status'<>'SEALED_ONLY' THEN RAISE EXCEPTION 'SEAL_POSITIVE_FAILED'; END IF;
  RAISE EXCEPTION 'INJECTED_CLIENT_ABORT';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'INJECTED_CLIENT_ABORT' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM orulo_audit.entries WHERE run_uuid=run AND sequence=6241)
 THEN RAISE EXCEPTION 'SEAL_ROLLBACK_FAILED'; END IF;

 response:=orulo_audit.national_seal_only_frozen_v1();
 IF response->>'status'<>'SEALED_ONLY'
   OR (response->>'sequence')::integer<>6241
   OR response->>'writeAuthorized'<>'false'
 THEN RAISE EXCEPTION 'SEAL_ONLY_POSITIVE_RECEIPT_BAD %',response; END IF;
 SELECT hash INTO initial_hash FROM orulo_audit.entries WHERE run_uuid=run AND sequence=6241;
 IF initial_hash<>response->>'hash' THEN RAISE EXCEPTION 'SEAL_HASH_BAD'; END IF;
 IF (SELECT previous_hash FROM orulo_audit.entries WHERE run_uuid=run AND sequence=6241)
  <> 'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6'
 THEN RAISE EXCEPTION 'SEAL_PREVIOUS_HASH_BAD'; END IF;
 IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=run)<>6241
 THEN RAISE EXCEPTION 'SEAL_APPENDED_MULTIPLE_EVENTS'; END IF;
 IF EXISTS(SELECT 1 FROM orulo_audit.entries
  WHERE run_uuid=run AND kind IN ('WRITE_AUTHORIZED','INTENT','CAS_RESULT'))
 THEN RAISE EXCEPTION 'SEAL_GRANTED_WRITES'; END IF;

 response:=orulo_audit.national_seal_only_frozen_v1();
 SELECT hash INTO final_hash FROM orulo_audit.entries WHERE run_uuid=run AND sequence=6241;
 IF response->>'status'<>'ALREADY_SEALED'
  OR response->>'hash'<>initial_hash OR final_hash<>initial_hash
  OR (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=run)<>6241
 THEN RAISE EXCEPTION 'SEAL_IDEMPOTENCY_FAILED'; END IF;
 RAISE NOTICE 'PASS: synthetic-positive full scope, one seal at 6241, rollback, idempotence, no CAS authorization';
END $positive$;
