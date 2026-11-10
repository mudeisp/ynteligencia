#!/usr/bin/env python3
"""Prepare five real occurrences, using verified checkpoints and read-only SQL.

This command has deliberately no apply mode. Complete rows stay in the encrypted
payload. The separate summary identifies the exact proposed image-only changes.
"""
import importlib.util
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from orulo_v2_image_validation import VALID, sha, validate_plan

spec = importlib.util.spec_from_file_location(
    "national", Path(__file__).with_name("orulo-v2-national-dry-run.py"))
national = importlib.util.module_from_spec(spec)
spec.loader.exec_module(national)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def images_for(plan):
    normalized = plan["normalizedPlan"]
    images = normalized.get("images", [])
    require(isinstance(images, list), "INVALID_SOURCE_IMAGES")
    urls = [*images, *(normalized[field] for field in
            ("image_url", "url", "2280x1800", "1024x1024", "520x280")
            if normalized.get(field) not in (None, ""))]
    require(bool(urls), "EMPTY_SOURCE_IMAGES")
    return list(dict.fromkeys(urls))


def prepare(source_path, report_path, directory):
    source = national.verified_json(source_path, national.SOURCE_HASH)
    report = national.verified_json(report_path, national.REPORT_HASH)
    require(source.get("writesAuthorized") is False
            and report.get("casWritesAuthorized") is False
            and report.get("databaseWrites") == 0
            and report.get("sourceManifestSha256") == national.SOURCE_HASH,
            "INPUT_METADATA_MISMATCH")
    indexed = {}
    for plan in source["plans"]:
        key = (plan["buildingId"], plan["planId"])
        require(key not in indexed, "DUPLICATE_SOURCE_PLAN")
        indexed[key] = plan
    # Only the first protected batch, previously validated. Do not repeat the
    # national dry runs or silently substitute candidates from other batches.
    candidates = [( (group["buildingId"], group["planId"]), target)
                  for group in report["matchedTargets"] for target in group["targets"]
                  if target["status"] == "RECONCILED_PENDING_IMAGE_VALIDATION"][:2000]
    require(bool(candidates), "NO_RECONCILED_CANDIDATES")
    # The workflow verifies the six archive hashes before this command. Rebuild
    # the manifest from their indexed building payloads to bind provenance again.
    build_spec = importlib.util.spec_from_file_location(
        "source_builder", Path(__file__).with_name("orulo-v2-build-recovery-manifest.py"))
    builder = importlib.util.module_from_spec(build_spec)
    build_spec.loader.exec_module(builder)
    rebuilt = builder.build([directory / str(n) / "source.tgz" for n in range(6)])
    require(sha(builder.canonical(rebuilt)) == national.SOURCE_HASH, "CHECKPOINT_MANIFEST_MISMATCH")
    evidence = national.load_evidence(directory, indexed, list(dict.fromkeys(k for k, _ in candidates)))
    selected, used, classifications = [], set(), Counter()
    with psycopg.connect(os.environ["ORULO_V2_DB_URL"], connect_timeout=20,
                         options="-c default_transaction_read_only=on -c statement_timeout=30000") as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            cursor.execute("SHOW transaction_read_only")
            require(cursor.fetchone()[0] == "on", "READ_ONLY_REQUIRED")
            for (building, plan_id), target in candidates:
                if target["propertyId"] in used:
                    continue
                cursor.execute(national.BASELINE, (target["propertyId"], building, building))
                row = cursor.fetchone()
                status = national.occurrence_status(row, plan_id, target["recordSha256"], VALID)
                if status != "ELIGIBLE":
                    classifications[status] += 1
                    continue
                plan = indexed[(building, plan_id)]
                status = validate_plan(plan, plan_id, evidence[plan["sourceChunk"]])
                if status != VALID:
                    classifications[status] += 1
                    continue
                original = next(p for p in row[0]["raw_data"]["building"]["floor_plans"]
                                if str(p.get("id")) == plan_id)
                selected.append({"propertyId": target["propertyId"], "buildingId": building,
                                 "planId": plan_id, "baseline": row[0],
                                 "baselineSha256": row[1], "originalPlan": original,
                                 "images": images_for(plan), "sourceChunk": plan["sourceChunk"],
                                 "sourceResultSha256": plan["sourceResultSha256"],
                                 "imageChecks": plan["imageChecks"], "provenance": VALID})
                used.add(target["propertyId"])
                if len(selected) == 5:
                    break
    require(len(selected) == 5 and len(used) == 5, "FIVE_INDEPENDENT_ELIGIBLE_TARGETS_REQUIRED")
    manifest = {"schemaVersion": 1, "purpose": "ORULO_V2_FIVE_PROPOSAL",
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "sourceManifestSha256": national.SOURCE_HASH,
                "reconciliationSha256": national.REPORT_HASH,
                "codeSha": os.environ.get("GITHUB_SHA"), "databaseWrites": 0,
                "writesAuthorized": False, "targets": selected}
    payload = canonical(manifest)
    digest = sha(payload)
    (directory / "pilot-manifest.json").write_bytes(payload)
    summary = {k: v for k, v in manifest.items() if k != "targets"}
    summary.update({"manifestSha256": digest, "status": "PROPOSAL_ONLY_CAS_INTEGRATION_REQUIRED",
                    "skipped": dict(classifications),
                    "targets": [{k: v for k, v in item.items() if k != "baseline"} for item in selected]})
    (directory / "pilot-summary.json").write_bytes(canonical(summary))
    print(json.dumps({"status": summary["status"], "selected": 5, "manifestSha256": digest,
                      "databaseWrites": 0, "writesAuthorized": False}, sort_keys=True))


if __name__ == "__main__":
    try:
        prepare(sys.argv[1], sys.argv[2], Path(sys.argv[3]))
    except Exception as error:
        # Never render connection exceptions, row contents or secret-bearing URLs.
        print("PILOT_PREPARATION_FAILED:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
