-- PostgreSQL 17 isolated regression: actual function and transaction semantics.
DO $test$
DECLARE
  run uuid := '1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
  manifest text := 'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288';
  p jsonb; bad jsonb; result jsonb; refused boolean;
  page_offset integer;
BEGIN
  SELECT jsonb_agg(target ORDER BY id) INTO p FROM (
    SELECT event->'target' AS target,event->'target'->>'id' AS id
    FROM orulo_audit.entries WHERE run_uuid=run AND kind='NATIONAL_TARGET'
    ORDER BY event->'target'->>'id' LIMIT 50 OFFSET 0
  ) s;
  result := orulo_audit.national_seal_checkpoint_page(run,manifest,0,p);
  IF result->>'status'<>'VERIFIED' OR (result->>'nextOffset')::integer<>50
    THEN RAISE EXCEPTION 'FIRST_PAGE_FAILED: %', result; END IF;

  result := orulo_audit.national_seal_checkpoint_page(run,manifest,0,p);
  IF result->>'status'<>'ALREADY_VERIFIED' THEN RAISE EXCEPTION 'REPLAY_FAILED'; END IF;
  SELECT count(*) INTO page_offset FROM orulo_audit.national_seal_page_proofs;
  IF page_offset<>1 THEN RAISE EXCEPTION 'DUPLICATE_PROOF_WRITTEN'; END IF;

  bad := jsonb_set(p,'{0,buildingId}','"changed"'::jsonb);
  refused:=false;
  BEGIN
    PERFORM orulo_audit.national_seal_checkpoint_page(run,manifest,0,bad);
  EXCEPTION WHEN OTHERS THEN refused:=true; END;
  IF NOT refused THEN RAISE EXCEPTION 'ALTERED_PAGE_ACCEPTED'; END IF;

  refused:=false;
  BEGIN
    PERFORM orulo_audit.national_seal_checkpoint_page(run,manifest,100,p);
  EXCEPTION WHEN OTHERS THEN refused:=true; END;
  IF NOT refused THEN RAISE EXCEPTION 'GAPPED_PAGE_ACCEPTED'; END IF;

  SELECT jsonb_agg(target ORDER BY id) INTO p FROM (
    SELECT event->'target' AS target,event->'target'->>'id' AS id
    FROM orulo_audit.entries WHERE run_uuid=run AND kind='NATIONAL_TARGET'
    ORDER BY event->'target'->>'id' LIMIT 50 OFFSET 50
  ) s;
  result := orulo_audit.national_seal_checkpoint_page(run,manifest,50,p);
  IF result->>'status'<>'VERIFIED' OR (result->>'nextOffset')::integer<>100
    THEN RAISE EXCEPTION 'SECOND_PAGE_FAILED'; END IF;

  -- Exception block is a PostgreSQL subtransaction. Any proof and cursor
  -- advance caused by the checkpoint must BOTH roll back on injected crash.
  SELECT jsonb_agg(target ORDER BY id) INTO p FROM (
    SELECT event->'target' AS target,event->'target'->>'id' AS id
    FROM orulo_audit.entries WHERE run_uuid=run AND kind='NATIONAL_TARGET'
    ORDER BY event->'target'->>'id' LIMIT 50 OFFSET 100
  ) s;
  BEGIN
    result := orulo_audit.national_seal_checkpoint_page(run,manifest,100,p);
    RAISE EXCEPTION 'INJECTED_CLIENT_ABORT';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  SELECT next_offset INTO page_offset FROM orulo_audit.national_seal_page_progress WHERE run_uuid=run;
  IF page_offset<>100 THEN RAISE EXCEPTION 'CRASH_ROLLBACK_DID_NOT_PRESERVE_CURSOR'; END IF;
  IF EXISTS (SELECT 1 FROM orulo_audit.national_seal_page_proofs WHERE page_offset=100)
    THEN RAISE EXCEPTION 'CRASH_LEFT_ORPHAN_PROOF'; END IF;

  refused:=false;
  BEGIN
    PERFORM orulo_audit.national_seal_checkpoint_page(run,repeat('f',64),100,p);
  EXCEPTION WHEN OTHERS THEN refused:=true; END;
  IF NOT refused THEN RAISE EXCEPTION 'SOURCE_HASH_SUBSTITUTION_ACCEPTED'; END IF;

  refused:=false;
  BEGIN
    PERFORM orulo_audit.national_seal_checkpoint_page(gen_random_uuid(),manifest,100,p);
  EXCEPTION WHEN OTHERS THEN refused:=true; END;
  IF NOT refused THEN RAISE EXCEPTION 'DIFFERENT_RUN_ACCEPTED'; END IF;

  IF has_function_privilege('anon',
      'orulo_audit.national_seal_checkpoint_page(uuid,text,integer,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated',
      'orulo_audit.national_seal_checkpoint_page(uuid,text,integer,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'PUBLIC_RPC_ACCESS_DETECTED'; END IF;

  IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=run)<>6240
    OR EXISTS(SELECT 1 FROM orulo_audit.entries WHERE kind IN
      ('NATIONAL_MANIFEST_SEALED','WRITE_AUTHORIZED','CAS_RESULT'))
  THEN RAISE EXCEPTION 'ORIGINAL_LEDGER_CHANGED'; END IF;
  RAISE NOTICE 'PASS: real PostgreSQL checkpoint, idempotence, isolation, rollback, scope, ACL';
END $test$;
