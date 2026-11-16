#!/usr/bin/env bash
set -euo pipefail
# ONLY against ephemeral PostgreSQL service provisioned by CI.
: "${PGHOST:?PGHOST required}"
: "${PGDATABASE:?PGDATABASE required}"
if [[ "${PGDATABASE}" != "postgres" || "${PGHOST}" != "127.0.0.1" ]]; then
  echo "Refusing concurrency test outside local ephemeral CI fixture" >&2
  exit 1
fi
SQL="WITH page AS (
  SELECT jsonb_agg(target ORDER BY id) AS targets FROM (
    SELECT event->'target' AS target, event->'target'->>'id' AS id
    FROM orulo_audit.entries
    WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'
      AND kind='NATIONAL_TARGET'
    ORDER BY event->'target'->>'id' LIMIT 50 OFFSET 100
  ) s
)
SELECT orulo_audit.national_seal_checkpoint_page(
  '1c8ec62a-9c38-41ac-8091-f1ceef98ca91',
  'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288',
  100,(SELECT targets FROM page));"
psql -X -v ON_ERROR_STOP=1 -At -c "$SQL" > /tmp/orulo-checkpoint-a.out &
a=$!
psql -X -v ON_ERROR_STOP=1 -At -c "$SQL" > /tmp/orulo-checkpoint-b.out &
b=$!
wait "$a"
wait "$b"
cat /tmp/orulo-checkpoint-a.out /tmp/orulo-checkpoint-b.out
psql -X -v ON_ERROR_STOP=1 -At -c "
DO \$\$
BEGIN
  IF (SELECT next_offset FROM orulo_audit.national_seal_page_progress
      WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91') <> 150
    OR (SELECT count(*) FROM orulo_audit.national_seal_page_proofs) <> 3
  THEN RAISE EXCEPTION 'CONCURRENT_CHECKPOINT_DUPLICATION'; END IF;
  IF (SELECT count(*) FROM orulo_audit.entries) <> 6240
  THEN RAISE EXCEPTION 'ORIGINAL_LEDGER_MUTATED'; END IF;
END\$\$;"
echo 'PASS: concurrent duplicate checkpoint requests serialized and deduplicated.'
