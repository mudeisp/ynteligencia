import hashlib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

import psycopg

REPORT_HASH = "2a9e409d6db81e4d70a6ddaee942eedb9887f4302347e333dec4c122cab8e66e"
SOURCE_HASH = "6f6248375b5d5459496465d1c202e38e10adfade30bdef2442a7d59f00f313cc"
CDN_URL = re.compile(r"https://static[.]orulo[.]com[.]br/images/[A-Za-z0-9_./%-]+")
BASELINE = """
SELECT to_jsonb(p), encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')
FROM public.properties p
WHERE id = %s AND source = 'novos'
  AND external_id LIKE 'orulo:' || %s || ':%%'
  AND raw_data->>'building_id' = %s
"""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def verified_json(path, expected):
    payload = Path(path).read_bytes()
    if hashlib.sha256(payload).hexdigest() != expected:
        raise ValueError("INPUT_DIGEST_MISMATCH")
    return json.loads(payload)


def read_image(url):
    if not isinstance(url, str) or not CDN_URL.fullmatch(url):
        return False
    try:
        opener = build_opener(NoRedirect())
        with opener.open(Request(url, headers={"Range": "bytes=0-31"}), timeout=8) as response:
            header = response.read(32)
            return response.headers.get_content_type().startswith("image/") and (
                header.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a"))
                or (header.startswith(b"RIFF") and header[8:12] == b"WEBP")
            )
    except (URLError, OSError, ValueError):
        return False


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
    if any(plan.get(field) not in (None, "") for field in ("image_url", "520x280", "1024x1024", "2280x1800")):
        return "ALTERNATE_IMAGE_FIELDS_PRESENT"
    return None


def run(source_path, report_path, batch_number):
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
    image_results = {}
    for key, _ in batch:
        if key in image_results:
            continue
        source_plan = indexed[key]
        normalized = source_plan.get("normalizedPlan")
        images = normalized.get("images") if isinstance(normalized, dict) else None
        image_results[key] = (
            source_plan["status"] == "RECOVERABLE"
            and bool(source_plan.get("imageChecks"))
            and isinstance(images, list)
            and bool(images)
            and all(read_image(url) for url in images)
        )
    with psycopg.connect(os.environ["ORULO_V2_DB_URL"], connect_timeout=20,
                         options="-c default_transaction_read_only=on -c statement_timeout=30000") as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            for (building_id, plan_id), target in batch:
                cursor.execute(BASELINE, (target["propertyId"], building_id, building_id))
                row = cursor.fetchone()
                reason = classify_target(row, plan_id)
                if reason:
                    counts[reason] += 1
                elif not image_results[(building_id, plan_id)]:
                    counts["SOURCE_IMAGE_VALIDATION_FAILED"] += 1
                else:
                    counts["ELIGIBLE"] += 1
                if row is not None and row[1] != target["recordSha256"]:
                    counts["BASELINE_CHANGED_SINCE_RECONCILIATION"] += 1
    return {"batchSize": 2000, "batchNumber": batch_number, "scanned": len(batch),
            "pendingOutsideBatch": len(candidates) - len(batch),
            "counts": dict(counts), "databaseWrites": 0, "casWritesAuthorized": False}


if __name__ == "__main__":
    try:
        number = int(sys.argv[3])
        if number < 1:
            raise ValueError("INVALID_BATCH")
        print(json.dumps(run(sys.argv[1], sys.argv[2], number), sort_keys=True))
    except Exception:
        sys.exit("ORULO_V2_BATCH_VALIDATION_FAILED")
