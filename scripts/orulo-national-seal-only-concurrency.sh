#!/usr/bin/env bash
# Disposable PG fixture only: two concurrent idempotent calls to the exact draft seal function.
set -euo pipefail
[[ "${PGDATABASE:-}" == "postgres" && "${PGHOST:-}" == "127.0.0.1" ]] || {
  echo 'DISPOSABLE_POSTGRES_ONLY' >&2; exit 1;
}
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
for i in 1 2; do
  (
    psql -X -qAt -v ON_ERROR_STOP=1 -c \
      "SELECT orulo_audit.national_seal_only_frozen_v1()->>'status';" > "$temp/$i"
  ) &
done
wait
for i in 1 2; do
  grep -x 'ALREADY_SEALED' "$temp/$i"
done
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM orulo_audit.entries WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91';")" = '6241'
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM orulo_audit.entries WHERE kind='NATIONAL_MANIFEST_SEALED';")" = '1'
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM orulo_audit.entries WHERE kind IN ('WRITE_AUTHORIZED','INTENT','CAS_RESULT');")" = '0'
echo 'PASS: concurrent replay did not duplicate seal or create CAS authorization'

# Only the DISPOSABLE PostgreSQL fixture is reset for existing rollback assertions.
psql -X -qAt -v ON_ERROR_STOP=1 -c \
  "DELETE FROM orulo_audit.entries WHERE sequence=6241
   AND run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91';"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM orulo_audit.entries;")" = '6240'
echo 'PASS: disposable fixture reset to original 6240 records'
