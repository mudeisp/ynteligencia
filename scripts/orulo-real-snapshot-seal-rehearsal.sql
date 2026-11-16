-- Full real-snapshot rehearsal: NEVER run on an external/hosted database.
-- Uses only a reconstructed frozen ledger and the exact unmodified seal-only SQL.
-- The replica has 6,240 real events, original canonical hashes, and real
-- PostgreSQL function definitions; images and public.properties are NOT updated.
\set ON_ERROR_STOP on
DO $preflight$
DECLARE r uuid:='1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
BEGIN
  -- The GitHub runner connects to 127.0.0.1, but inside Docker the server
  -- has an RFC1918 bridge IP. Require both private networking and the
  -- fixture-only marker that is created by the offline fixture constructor.
  IF current_database()<>'postgres'
     OR inet_server_addr() IS NULL
     OR NOT (
       inet_server_addr() <<= '127.0.0.0/8'::cidr OR
       inet_server_addr() <<= '10.0.0.0/8'::cidr OR
       inet_server_addr() <<= '172.16.0.0/12'::cidr OR
       inet_server_addr() <<= '192.168.0.0/16'::cidr)
     OR to_regclass('public._orulo_ephemeral_rehearsal_guard') IS NULL
     OR (SELECT count(*) FROM public._orulo_ephemeral_rehearsal_guard
         WHERE stamp='ORULO_EPHEMERAL_ONLY_6240')<>1
  THEN RAISE EXCEPTION 'REAL_SNAPSHOT_DISPOSABLE_PG_ONLY'; END IF;
  IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=r)<>6240 OR
     (SELECT hash FROM orulo_audit.entries WHERE run_uuid=r AND sequence=6240)
       <> 'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6'
  THEN RAISE EXCEPTION 'REAL_SNAPSHOT_FROZEN_LEDGER_DIVERGED'; END IF;
  IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=r
      AND kind='NATIONAL_TARGET')<>5684
  THEN RAISE EXCEPTION 'REAL_SNAPSHOT_TARGETS_INCOMPLETE'; END IF;
END $preflight$;

-- Role is switched only inside disposable PostgreSQL to match the existing
-- require_service() gate on the original checkpoint page function.
SET ROLE service_role;
DO $pages$
DECLARE
 r uuid:='1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
 h text:='ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288';
 page_offset integer; p jsonb; result jsonb;
BEGIN
 FOR page_offset IN SELECT generate_series(0,5650,50) LOOP
   SELECT jsonb_agg(target ORDER BY target_id) INTO p FROM (
     SELECT event->'target' AS target,event->'target'->>'id' AS target_id
     FROM orulo_audit.entries WHERE run_uuid=r AND kind='NATIONAL_TARGET'
     ORDER BY event->'target'->>'id' LIMIT 50 OFFSET page_offset
   ) s;
   result:=orulo_audit.national_seal_checkpoint_page(r,h,page_offset,p);
   IF result->>'status'<>'VERIFIED'
   THEN RAISE EXCEPTION 'REAL_SNAPSHOT_PAGE_FAILED %',page_offset; END IF;
 END LOOP;
END $pages$;
RESET ROLE;

DO $positive$
DECLARE
 r uuid:='1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
 receipt jsonb; initial_hash text;
BEGIN
 IF (SELECT next_offset FROM orulo_audit.national_seal_page_progress
   WHERE run_uuid=r)<>5684 OR
   (SELECT count(*) FROM orulo_audit.national_seal_page_proofs
   WHERE run_uuid=r)<>114
 THEN RAISE EXCEPTION 'REAL_SNAPSHOT_PAGE_COVERAGE_INVALID'; END IF;
 IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=r)<>6240
 THEN RAISE EXCEPTION 'REAL_SNAPSHOT_PRESEAL_CHANGED'; END IF;
 BEGIN
   receipt:=orulo_audit.national_seal_only_frozen_v1();
   IF receipt->>'status'<>'SEALED_ONLY'
   THEN RAISE EXCEPTION 'REAL_SNAPSHOT_SEAL_NOT_EMITTED'; END IF;
   RAISE EXCEPTION 'REAL_SNAPSHOT_INJECT_ROLLBACK';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> 'REAL_SNAPSHOT_INJECT_ROLLBACK' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=r)<>6240
 THEN RAISE EXCEPTION 'REAL_SNAPSHOT_ATOMIC_ROLLBACK_FAILED'; END IF;
 receipt:=orulo_audit.national_seal_only_frozen_v1();
 IF receipt->>'status'<>'SEALED_ONLY' OR
   (receipt->>'sequence')::integer<>6241 OR
   receipt->>'writeAuthorized'<>'false'
 THEN RAISE EXCEPTION 'REAL_SNAPSHOT_SEAL_RECEIPT_INVALID'; END IF;
 SELECT hash INTO initial_hash FROM orulo_audit.entries
   WHERE run_uuid=r AND sequence=6241 AND kind='NATIONAL_MANIFEST_SEALED';
 IF initial_hash IS NULL OR initial_hash<>receipt->>'hash' OR
   (SELECT previous_hash FROM orulo_audit.entries
     WHERE run_uuid=r AND sequence=6241)
      <> 'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6'
 THEN RAISE EXCEPTION 'REAL_SNAPSHOT_SEAL_CHAIN_BROKEN'; END IF;
 receipt:=orulo_audit.national_seal_only_frozen_v1();
 IF receipt->>'status'<>'ALREADY_SEALED' OR receipt->>'hash'<>initial_hash
   OR (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=r)<>6241
 THEN RAISE EXCEPTION 'REAL_SNAPSHOT_SEAL_REPLAY_DIVERGED'; END IF;
 IF EXISTS(SELECT 1 FROM orulo_audit.entries WHERE run_uuid=r
   AND kind IN ('WRITE_AUTHORIZED','INTENT','CAS_RESULT'))
 THEN RAISE EXCEPTION 'REAL_SNAPSHOT_UNAUTHORIZED_WRITE'; END IF;
 RAISE NOTICE 'PASS REAL_SNAPSHOT_SEAL_ONLY full real ledger 6240 -> isolated seal 6241; atomic rollback, replay, zero CAS';
END $positive$;
