#!/usr/bin/env python3
"""National Órulo source-to-target reconciliation; zero database writes.

Run only within the protected GitHub Actions environment, after verifying and
decrypting the pinned source manifest. Output is PRIVATE and MUST be encrypted.
Requires psycopg 3 and ORULO_V2_DB_URL (read-only DB role recommended).
"""
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import psycopg

PINNED_MANIFEST_SHA256 = "6f6248375b5d5459496465d1c202e38e10adfade30bdef2442a7d59f00f313cc"
QUERY = """
WITH plan_rows AS (
 SELECT p.id::text AS property_id, p.external_id,
        p.raw_data->>'building_id' AS building_id,
        pl.value->>'id' AS plan_id, pl.value AS plan,
        count(*) OVER (PARTITION BY p.id, pl.value->>'id') AS plan_occurrences,
        encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS record_sha256
 FROM public.properties p
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(p.raw_data#>'{building,floor_plans}')='array'
        THEN p.raw_data#>'{building,floor_plans}' ELSE '[]'::jsonb END
 ) pl(value)
 WHERE p.source='novos' AND p.external_id LIKE 'orulo:%%'
   AND p.raw_data->>'building_id' = ANY(%s)
)
SELECT property_id, external_id, building_id, plan_id,
       plan_occurrences, record_sha256,
       (NOT (plan ? 'images') OR plan->'images' IN ('null'::jsonb,'[]'::jsonb)) AS images_missing,
       (COALESCE(NULLIF(plan->>'image_url',''),'') <> ''
        OR COALESCE(NULLIF(plan->>'520x280',''),'') <> ''
        OR COALESCE(NULLIF(plan->>'1024x1024',''),'') <> ''
        OR COALESCE(NULLIF(plan->>'2280x1800',''),'') <> '') AS alternate_image_fields_present
FROM plan_rows
WHERE building_id ~ '^[0-9]+$' AND plan_id ~ '^[0-9]+$'
ORDER BY building_id,plan_id,property_id
"""

def run(manifest_path: Path, output_path: Path) -> dict:
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != PINNED_MANIFEST_SHA256:
        raise RuntimeError("PINNED_SOURCE_MANIFEST_SHA256_MISMATCH")
    source = json.loads(raw)
    if (source.get("schemaVersion") != 1 or source.get("writesAuthorized") is not False
            or source.get("sourceBuildings") != 2667 or len(source.get("plans", [])) != 17011):
        raise RuntimeError("SOURCE_MANIFEST_METADATA_MISMATCH")
    indexed = {}
    for plan in source["plans"]:
        key = (plan["buildingId"],plan["planId"])
        if key in indexed or not all(str(x).isdecimal() for x in key):
            raise RuntimeError("INVALID_OR_DUPLICATE_SOURCE_KEY")
        indexed[key] = plan
    buildings = sorted({key[0] for key in indexed},key=int)
    db_url = os.environ.get("ORULO_V2_DB_URL")
    if not db_url:
        raise RuntimeError("ORULO_V2_DB_URL_MISSING")
    counts = Counter()
    target_keys = defaultdict(list)
    with psycopg.connect(db_url, connect_timeout=20, options="-c statement_timeout=1800000") as conn:
        with conn.cursor() as control:
            control.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        with conn.cursor(name="orulo_v2_reconcile_stream") as cursor:
            cursor.itersize = 2000
            cursor.execute(QUERY,(buildings,))
            for pid,external_id,bid,plan_id,dup,sha,missing,alternate in cursor:
                key = (bid,plan_id)
                if key not in indexed:
                    counts["TARGET_KEY_ABSENT_FROM_SOURCE"] += 1
                    continue
                src = indexed[key]
                counts["SOURCE_MATCHED_OCCURRENCES"] += 1
                reasons = []
                if src["status"] != "RECOVERABLE":
                    reasons.append("SOURCE_NOT_RECOVERABLE")
                if int(dup) != 1:
                    reasons.append("DUPLICATE_PLAN_WITHIN_PROPERTY")
                if not external_id.startswith("orulo:"+bid+":"):
                    reasons.append("EXTERNAL_BUILDING_MISMATCH")
                if not missing:
                    reasons.append("TARGET_IMAGES_PRESENT")
                if alternate:
                    reasons.append("ALTERNATE_IMAGE_FIELDS_NEED_REVIEW")
                if not isinstance(src.get("normalizedPlan"),dict) or not src.get("imageChecks"):
                    reasons.append("SOURCE_EVIDENCE_INCOMPLETE")
                # Reconciliation candidate only. Image provenance, URL validation,
                # per-record CAS baseline recheck and audit are NOT yet authorized.
                status = "RECONCILED_PENDING_IMAGE_VALIDATION" if not reasons else "BLOCKED"
                counts[status] += 1
                for reason in reasons:
                    counts["REASON_"+reason] += 1
                target_keys[key].append({
                    "propertyId":pid, "recordSha256":sha, "status":status,
                    "blockedReasons":reasons,
                })
    for key,src in indexed.items():
        if key not in target_keys:
            counts["SOURCE_KEYS_WITHOUT_MATCHED_TARGET"] += 1
        elif src["status"] == "RECOVERABLE":
            counts["RECOVERABLE_SOURCE_KEYS_WITH_TARGET"] += 1
    out = {
        "schemaVersion":1, "sourceManifestSha256":PINNED_MANIFEST_SHA256,
        "databaseWrites":0, "casWritesAuthorized":False,
        "counts":dict(sorted(counts.items())),
        "matchedTargets":[{
          "buildingId":key[0],"planId":key[1],
          "sourceStatus":indexed[key]["status"],
          "targets":targets,
        } for key,targets in sorted(target_keys.items(), key=lambda kv:(int(kv[0][0]),int(kv[0][1])))],
    }
    # No private data on stdout: output must be encrypted by workflow.
    payload=json.dumps(out,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
    output_path.write_bytes(payload)
    return {"status":"NATIONAL_READONLY_RECONCILIATION_COMPLETE",
            "sourcePlans":len(indexed),"sourceBuildings":len(buildings),
            "counts":dict(sorted(counts.items())),
            "reportSha256":hashlib.sha256(payload).hexdigest(),
            "databaseWrites":0, "casWritesAuthorized":False}

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: reconcile.py DECRYPTED_MANIFEST_JSON PRIVATE_REPORT_JSON")
    print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2])),sort_keys=True))
