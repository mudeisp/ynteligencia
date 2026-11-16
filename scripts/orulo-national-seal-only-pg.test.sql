-- Disposable PostgreSQL negative regression. Checks draft seal refuses incomplete
-- evidence and never appends the 6241st event. No CAS or property writes.
DO $test$
DECLARE
  run uuid := '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid;
  old_count bigint;
  old_head text;
  refused boolean := false;
BEGIN
  SELECT count(*),max(hash) FILTER (WHERE sequence=6240)
    INTO old_count,old_head FROM orulo_audit.entries WHERE run_uuid=run;
  IF old_count<>6240 THEN RAISE EXCEPTION 'FIXTURE_NOT_FROZEN'; END IF;
  BEGIN
    PERFORM orulo_audit.national_seal_only_frozen_v1();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SEAL_ONLY_CHECKPOINTS_INCOMPLETE'
    THEN RAISE EXCEPTION 'WRONG_REFUSAL: %',SQLERRM; END IF;
    refused:=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'INCOMPLETE_PROOFS_WERE_ACCEPTED'; END IF;
  IF (SELECT count(*) FROM orulo_audit.entries WHERE run_uuid=run)<>old_count OR
     (SELECT hash FROM orulo_audit.entries WHERE run_uuid=run AND sequence=6240)<>old_head
  THEN RAISE EXCEPTION 'FAILED_SEAL_MODIFIED_LEDGER'; END IF;
  IF EXISTS(SELECT 1 FROM orulo_audit.entries
    WHERE run_uuid=run AND kind IN ('NATIONAL_MANIFEST_SEALED','WRITE_AUTHORIZED','INTENT','CAS_RESULT'))
  THEN RAISE EXCEPTION 'FORBIDDEN_EVENT_EMITTED'; END IF;
  IF has_function_privilege('anon','orulo_audit.national_seal_only_frozen_v1()','EXECUTE') OR
     has_function_privilege('authenticated','orulo_audit.national_seal_only_frozen_v1()','EXECUTE') OR
     has_function_privilege('service_role','orulo_audit.national_seal_only_frozen_v1()','EXECUTE')
  THEN RAISE EXCEPTION 'UNEXPECTED_RPC_PERMISSION'; END IF;
  RAISE NOTICE 'PASS: seal-only negative test, frozen run untouched, no public/service grant';
END $test$;
