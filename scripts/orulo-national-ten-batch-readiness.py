#!/usr/bin/env python3
"""Fail-closed, READ ONLY report for the already sealed Órulo national manifest.

Reads immutable ledger and live properties in bounded pages of 50; zero CAS,
zero updates, zero administrative authorization. Ten lot assignments preserve
whole properties, based on their original patch occurrences.
"""
import csv
import io
import json
import os
import subprocess
import sys
from collections import defaultdict

RUN = "1c8ec62a-9c38-41ac-8091-f1ceef98ca91"
MANIFEST = "ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288"
HEAD = "80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f"
TOTAL_TARGETS = 5684
TOTAL_PATCHES = 42893

def psql(query):
    url = os.environ.get("ORULO_READ_ONLY_DATABASE_URL", "")
    if not url:
        raise RuntimeError("READ_ONLY_DATABASE_URL_MISSING")
    proc = subprocess.run(
        ["psql", url, "-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1",
         "-c", "BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout='20s'; "
         "SET LOCAL work_mem='4MB'; " + query + "; COMMIT;"],
        text=True, capture_output=True, timeout=30, check=False,
    )
    if proc.returncode:
        # Never surface raw psql stderr (it might include connection information).
        raise RuntimeError("READ_ONLY_QUERY_FAILED")
    # psql emits BEGIN, SET, SET, rows, COMMIT when -t is enabled; filter command tags.
    return [x for x in proc.stdout.splitlines() if x and x not in ("BEGIN", "SET", "COMMIT")]

GUARD_SQL = """
SELECT COALESCE(MAX(sequence),0)::text,
       COALESCE(MAX(hash) FILTER(WHERE sequence=6241), '')::text,
       COUNT(*) FILTER(WHERE kind='NATIONAL_MANIFEST_SEALED')::text,
       COUNT(*) FILTER(WHERE kind IN ('WRITE_AUTHORIZED','INTENT','CAS_RESULT'))::text,
       COUNT(*) FILTER(WHERE kind='NATIONAL_TARGET')::text
FROM orulo_audit.entries WHERE run_uuid='%s'::uuid
""" % RUN

def guard():
    rows = psql(GUARD_SQL)
    if len(rows) != 1:
        raise RuntimeError("FROZEN_LEDGER_GATE_INVALID")
    value = rows[0].split("\t")
    if value != ["6241", HEAD, "1", "0", str(TOTAL_TARGETS)]:
        raise RuntimeError("FROZEN_LEDGER_GATE_INVALID")

PAGE_QUERY = """
WITH targets AS MATERIALIZED (
 SELECT e.event->'target' AS t
 FROM orulo_audit.entries e
 WHERE e.run_uuid='%s'::uuid AND e.kind='NATIONAL_TARGET'
 ORDER BY e.event->'target'->>'id'
 LIMIT 50 OFFSET %%d
), per_property AS (
 SELECT t->>'id' AS id, 
        jsonb_array_length(t->'patches') AS patches,
        (encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')
          IS DISTINCT FROM t->>'baselineSha256') AS changed,
        p.raw_data AS raw,
        t
 FROM targets JOIN public.properties p ON p.id=(t->>'id')::uuid
), stats AS (
 SELECT x.id, x.patches, x.changed,
   COUNT(*) FILTER(WHERE y.plan->'images'=d.patch->'images') AS exact,
   COUNT(*) FILTER(WHERE y.plan IS NULL) AS missing,
   COUNT(*) FILTER(WHERE y.plan IS NOT NULL AND
       (y.plan->'images' IS NULL OR y.plan->'images'='null'::jsonb
        OR y.plan->'images'='[]'::jsonb)) AS empty,
   COUNT(*) FILTER(WHERE y.plan IS NOT NULL AND
       y.plan->'images' IS DISTINCT FROM d.patch->'images' AND
       y.plan->'images' IS NOT NULL AND
       y.plan->'images'<>'null'::jsonb AND y.plan->'images'<>'[]'::jsonb)
       AS conflicting
 FROM per_property x
 CROSS JOIN LATERAL jsonb_array_elements(x.t->'patches') d(patch)
 LEFT JOIN LATERAL (
   SELECT f.plan FROM jsonb_array_elements(
      COALESCE(x.raw#>'{building,floor_plans}','[]'::jsonb)) f(plan)
   WHERE f.plan->>'id'=d.patch->>'id' LIMIT 1
 ) y ON true
 GROUP BY x.id,x.patches,x.changed
)
SELECT id,patches,changed,exact,missing,empty,conflicting FROM stats ORDER BY id
""" % RUN

def classify_lot(prior, count):
    # Midpoint assignment matches scripts/orulo-national-ten-batch-plan-readonly.sql.
    # 2*prefix+count avoids floating point inconsistencies.
    return min(10, ((2 * prior + count) * 10) // (2 * TOTAL_PATCHES) + 1)

def main():
    guard()
    lots = defaultdict(lambda: defaultdict(int))
    previous = ""
    prefix = 0
    targets = 0
    for offset in range(0, TOTAL_TARGETS, 50):
        rows = psql(PAGE_QUERY % offset)
        if len(rows) != min(50, TOTAL_TARGETS - offset):
            raise RuntimeError("TARGET_PAGE_INCOMPLETE")
        for line in rows:
            parts = line.split("\t")
            if len(parts) != 7:
                raise RuntimeError("TARGET_ROW_INVALID")
            id_, n, changed, exact, missing, empty, conflicting = parts
            if id_ <= previous or changed not in ("t", "f"):
                raise RuntimeError("TARGET_ORDER_OR_FLAG_INVALID")
            previous = id_
            n, exact, missing, empty, conflicting = map(int, (n, exact, missing, empty, conflicting))
            if n < 1 or exact + missing + empty + conflicting != n:
                raise RuntimeError("PATCH_COVERAGE_INCOMPLETE")
            batch = classify_lot(prefix, n)
            d = lots[batch]
            d["properties"] += 1
            d["occurrences"] += n
            d["exact"] += exact
            d["empty"] += empty
            d["missing"] += missing
            d["conflicting"] += conflicting
            if changed == "t":
                d["divergent_baseline"] += 1
                d["divergent_complete" if exact == n else "divergent_incomplete"] += 1
            else:
                d["original_baseline"] += 1
            prefix += n
            targets += 1
    guard()
    if targets != TOTAL_TARGETS or prefix != TOTAL_PATCHES or sorted(lots) != list(range(1, 11)):
        raise RuntimeError("NATIONAL_COVERAGE_INVALID")
    result = {
      "status": "READ_ONLY_READY_FOR_ENGINEERING_REVIEW",
      "executionPermitted": False,
      "casWrites": 0,
      "runUuid": RUN,
      "manifestSha256": MANIFEST,
      "sealSequence": 6241,
      "sealHash": HEAD,
      "lots": [{"lot": i, **lots[i]} for i in range(1, 11)]
    }
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Órulo nacional — 10 lotes / modo SOMENTE LEITURA\n\n")
            f.write("Nenhuma autorização, INTENT, CAS ou modificação de imóvel é executada aqui.\n\n")
            f.write("| Lote | Imóveis | Ocorrências | Imagens exatas | Vazias | Plantas ausentes | Baselines divergentes |\n")
            f.write("|---:|---:|---:|---:|---:|---:|---:|\n")
            for d in result["lots"]:
                f.write(f'| {d["lot"]} | {d["properties"]} | {d["occurrences"]} | {d["exact"]} | {d["empty"]} | {d["missing"]} | {d["divergent_baseline"]} |\n')
            f.write("\n**BLOQUEIO:** isto não é um executor de recuperação. Autorizar ou fazer CAS neste workflow é proibido.\n")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ORULO_TEN_LOTS_BLOCKED=" + str(e), file=sys.stderr)
        sys.exit(1)
