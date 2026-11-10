import hashlib
import json
import os
import tarfile
import sys
from collections import Counter
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from orulo_v2_image_validation import VALID, validate_plan

import psycopg

REPORT_HASH = "2a9e409d6db81e4d70a6ddaee942eedb9887f4302347e333dec4c122cab8e66e"
SOURCE_HASH = "6f6248375b5d5459496465d1c202e38e10adfade30bdef2442a7d59f00f313cc"
BASELINE = """
SELECT to_jsonb(p), encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')
FROM public.properties p
WHERE id = %s AND source = 'novos'
  AND external_id LIKE 'orulo:' || %s || ':%%'
  AND raw_data->>'building_id' = %s
"""


def verified_json(path, expected):
    payload = Path(path).read_bytes()
    if hashlib.sha256(payload).hexdigest() != expected:
        raise ValueError("INPUT_DIGEST_MISMATCH")
    return json.loads(payload)


def classify_target(row, plan_id):
    if row is None:
        return "TARGET_IDENTITY_CONFLICT"
    record, _ = row
    plans = record["raw_data"].get("building", {}).get("floor_plans")
    if not isinstance(plans, list):
        return "TARGET_PLAN_CONFLICT"
    matches = [plan for plan in plans if isinstance(plan, dict) and str(plan.get("id")) == plan_id]
    if len(matches) != 1:
        return "TARGET_PLAN_CONFLICT"
    plan = matches[0]
    if plan.get("images") not in (None, []):
        return "TARGET_IMAGES_PRESENT"
    if any(plan.get(field) not in (None, "") for field in ("image_url", "520x280", "1024x1024", "2280x1800", "url")):
        return "ALTERNATE_IMAGE_FIELDS_PRESENT"
    return None


def load_evidence(directory, indexed, keys):
    requested = {}
    for key in keys:
        plan = indexed[key]
        paths = requested.setdefault(plan["sourceChunk"], set())
        paths.update(check["evidence"] for check in plan["imageChecks"])
    evidence = {}
    for chunk, paths in requested.items():
        evidence[chunk] = {}
        with tarfile.open(directory / str(chunk) / "source.tgz", "r|gz") as archive:
            for member in archive:
                path = member.name.removeprefix("v2-source-chunk/")
                if path in paths and member.isfile() and member.size <= 16384:
                    if path in evidence[chunk]:
                        raise ValueError("DUPLICATE_CHECKPOINT_EVIDENCE")
                    evidence[chunk][path] = archive.extractfile(member).read()
    return evidence


def occurrence_status(row, plan_id, expected_hash, source_status):
    reason = classify_target(row, plan_id)
    if reason:
        return reason
    if row[1] != expected_hash:
        return "BASELINE_CHANGED_SINCE_RECONCILIATION"
    return "ELIGIBLE" if source_status == VALID else source_status


def run(source_path, report_path, batch_number, evidence_dir):
    source = verified_json(source_path, SOURCE_HASH)
    report = verified_json(report_path, REPORT_HASH)
    if (source["writesAuthorized"] is not False or report["casWritesAuthorized"] is not False
            or report["databaseWrites"] != 0 or report["sourceManifestSha256"] != SOURCE_HASH):
        raise ValueError("INPUT_METADATA_MISMATCH")
    indexed = {(plan["buildingId"], plan["planId"]): plan for plan in source["plans"]}
    candidates = [
        ((group["buildingId"], group["planId"]), target)
        for group in report["matchedTargets"]
        for target in group["targets"]
        if target["status"] == "RECONCILED_PENDING_IMAGE_VALIDATION"
    ]
    start = (batch_number - 1) * 2000
    batch = candidates[start:start + 2000]
    if not batch:
        raise ValueError("EMPTY_BATCH")
    counts = Counter()
    keys = list(dict.fromkeys(key for key, _ in batch))
    evidence = load_evidence(evidence_dir, indexed, keys)

    def validate(key):
        plan = indexed[key]
        return validate_plan(plan, key[1], evidence[plan["sourceChunk"]])

    with ThreadPoolExecutor(max_workers=4) as pool:
        image_results = dict(zip(keys, pool.map(validate, keys)))
    source_counts = Counter()
    legacy_empty_images = 0
    baseline_conflicts = 0
    with psycopg.connect(os.environ["ORULO_V2_DB_URL"], connect_timeout=20,
                         options="-c default_transaction_read_only=on -c statement_timeout=30000") as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            for (building_id, plan_id), target in batch:
                cursor.execute(BASELINE, (target["propertyId"], building_id, building_id))
                row = cursor.fetchone()
                key = (building_id, plan_id)
                source_status = image_results[key]
                source_counts[source_status] += 1
                normalized = indexed[key].get("normalizedPlan") or {}
                if not isinstance(normalized.get("images"), list) or not normalized["images"]:
                    legacy_empty_images += 1
                counts[occurrence_status(row, plan_id, target["recordSha256"], source_status)] += 1
                if row is not None and row[1] != target["recordSha256"]:
                    baseline_conflicts += 1
    if sum(counts.values()) != len(batch):
        raise ValueError("CLASSIFICATION_COUNT_MISMATCH")
    return {"batchSize": 2000, "batchNumber": batch_number, "scanned": len(batch),
            "pendingOutsideBatch": len(candidates) - len(batch),
            "counts": dict(counts), "sourceCounts": dict(source_counts),
            "baselineConflicts": baseline_conflicts, "legacyEmptyImages": legacy_empty_images, "databaseWrites": 0, "casWritesAuthorized": False}


if __name__ == "__main__":
    try:
        number = int(sys.argv[3])
        if number < 1:
            raise ValueError("INVALID_BATCH")
        print(json.dumps(run(sys.argv[1], sys.argv[2], number, Path(sys.argv[4])), sort_keys=True))
    except Exception:
        sys.exit("ORULO_V2_BATCH_VALIDATION_FAILED")
