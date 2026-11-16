-- Rollback ONLY the review-only checkpoint extension. Never touches original ledger.
-- Execute solely in isolated test database until reviewed separately.
BEGIN;
DROP FUNCTION IF EXISTS orulo_audit.national_seal_checkpoint_page(uuid,text,integer,jsonb);
DROP TABLE IF EXISTS orulo_audit.national_seal_page_proofs;
DROP TABLE IF EXISTS orulo_audit.national_seal_page_progress;
DO $$
BEGIN
  IF (SELECT count(*) FROM orulo_audit.entries
      WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91') <> 6240
  THEN RAISE EXCEPTION 'ROLLBACK_ORIGINAL_LEDGER_DIVERGED'; END IF;
  IF EXISTS (SELECT 1 FROM orulo_audit.entries
     WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'
     AND kind IN ('NATIONAL_MANIFEST_SEALED','WRITE_AUTHORIZED','INTENT','CAS_RESULT'))
  THEN RAISE EXCEPTION 'ROLLBACK_ORIGINAL_LEDGER_TOUCHED'; END IF;
END $$;
COMMIT;
