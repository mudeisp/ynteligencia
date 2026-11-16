#!/usr/bin/env bash
# Run only against the disposable PostgreSQL 17 CI fixture.
# Two distinct connections: an external writer holds a property row lock;
# the scoped CAS must block, then reject after the writer commits.
set -euo pipefail
export PGHOST="${PGHOST:-127.0.0.1}" PGUSER="${PGUSER:-postgres}" PGDATABASE="${PGDATABASE:-postgres}"
run='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'
op='a1c3e9b0-5121-44f2-9e13-d731e9096201'
id='000a4d50-a014-4270-bb89-26adb841f142'
tmp="$(mktemp -d)"
writer_pid='' cas_pid=''
cleanup() {
  if [[ -n "$writer_pid" ]]; then kill "$writer_pid" 2>/dev/null || :; wait "$writer_pid" 2>/dev/null || :; fi
  if [[ -n "$cas_pid" ]]; then kill "$cas_pid" 2>/dev/null || :; wait "$cas_pid" 2>/dev/null || :; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
psql -X -qAt -v ON_ERROR_STOP=1 >"$tmp/writer.log" 2>&1 <<SQL &
BEGIN;
UPDATE public.properties SET price=123451 WHERE id='$id'::uuid;
\echo EXTERNAL_ROW_LOCKED
SELECT pg_sleep(4);
COMMIT;
SQL
writer_pid=$!
ready=false
for i in $(seq 1 80); do
  if grep -q EXTERNAL_ROW_LOCKED "$tmp/writer.log"; then ready=true; break; fi
  if ! kill -0 "$writer_pid" 2>/dev/null; then break; fi
  sleep .05
done
if [[ "$ready" != true ]]; then cat "$tmp/writer.log"; echo 'SCOPED_RACE_WRITER_NOT_READY' >&2; exit 1; fi
PGAPPNAME=orulo-scoped-cas-race psql -X -qAt -v ON_ERROR_STOP=1 >"$tmp/cas.log" 2>&1 <<SQL &
SET ROLE service_role;
DO \$cas\$
BEGIN
  BEGIN
    PERFORM orulo_audit.national_cas('$run'::uuid,'$op'::uuid);
    RAISE EXCEPTION 'SCOPED_RACE_CAS_OVERWROTE_EXTERNAL_UPDATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('NATIONAL_FROZEN_TARGET_DIVERGENCE','NATIONAL_SCOPED_SNAPSHOT_ROW_MISMATCH') THEN
      RAISE;
    END IF;
  END;
END;
\$cas\$;
SQL
cas_pid=$!
blocked=false
for i in $(seq 1 65); do
  if [[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='orulo-scoped-cas-race' AND wait_event_type='Lock')")" == t ]]; then
    blocked=true
    break
  fi
  if ! kill -0 "$cas_pid" 2>/dev/null; then break; fi
  sleep .05
done
wait "$writer_pid"; writer_pid=''
wait "$cas_pid"; cas_pid=''
if [[ "$blocked" != true ]]; then cat "$tmp/writer.log" "$tmp/cas.log"; echo 'SCOPED_RACE_CAS_DID_NOT_WAIT_FOR_ROW_LOCK' >&2; exit 1; fi
result="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "
 SELECT (p.price=123451)
   AND NOT EXISTS(SELECT 1 FROM orulo_audit.entries e
     WHERE e.operation_uuid='$op'::uuid AND e.kind='CAS_RESULT')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
     p.raw_data#>'{building,floor_plans}') plan
     WHERE plan->'images'<>'[]'::jsonb)
 FROM public.properties p WHERE p.id='$id'::uuid")"
if [[ "$result" != t ]]; then echo 'SCOPED_RACE_EXTERNAL_DATA_OR_RECEIPT_CORRUPTED' >&2; exit 1; fi
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.properties SET price=123450 WHERE id='$id'::uuid" >/dev/null
psql -X -qAt -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS orulo_audit.scoped_race_fixture_passed(ok boolean NOT NULL); INSERT INTO orulo_audit.scoped_race_fixture_passed VALUES (true);" >/dev/null
echo 'SCOPED_TWO_SESSION_EXTERNAL_RACE_REJECTED'
