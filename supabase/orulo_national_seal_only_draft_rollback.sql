-- Removes only draft seal-only function; neither historical ledger nor
-- checkpoint records are changed. Run only in disposable PostgreSQL.
BEGIN;
DROP FUNCTION IF EXISTS orulo_audit.national_seal_only_frozen_v1();
COMMIT;
