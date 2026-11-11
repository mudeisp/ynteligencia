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
from copy import deepcopy

from psycopg import sql
from psycopg.types.json import Jsonb

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


def simulate(targets, columns):
    """Exercise real baselines on a disposable local DB, and roll back all rows.

    Copies column types only. Production triggers, RLS, and the existing audit
    authorization functions are explicitly outside this prototype simulation.
    """
    dsn = os.environ.get("TEST_DATABASE_URL")
    require(dsn == "postgresql://postgres:test@localhost:5432/postgres", "DISPOSABLE_DATABASE_REQUIRED")
    allowed = {"uuid", "text", "numeric", "integer", "boolean", "jsonb",
               "timestamp with time zone", "double precision"}
    require(all(kind in allowed for _, kind in columns), "UNSUPPORTED_PROPERTY_COLUMN_TYPE")
    items = [{"property_id": t["propertyId"], "building_id": t["buildingId"],
              "plan_id": t["planId"], "baseline": t["baseline"], "images": t["images"]}
             for t in targets]
    with psycopg.connect(dsn, autocommit=True) as conn:
        # Fail rather than drop or truncate an existing staging database.
        conn.execute(sql.SQL("CREATE TABLE public.properties ({})").format(sql.SQL(",").join(
            sql.SQL("{} {}").format(sql.Identifier(name), sql.SQL(kind)) for name, kind in columns)))
        conn.execute(Path(__file__).parents[1].joinpath(
            "sql/orulo-v2-cas-replace-existing-plan.sql").read_text())
        with conn.transaction():
            for item in items:
                conn.execute("INSERT INTO public.properties SELECT * FROM "
                             "jsonb_populate_record(NULL::public.properties,%s)", (Jsonb(item["baseline"]),))
        rows = lambda: conn.execute("SELECT id::text,to_jsonb(p),encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') "
                                    "FROM public.properties p ORDER BY id").fetchall()
        before = rows()
        require(all(next(row[2] for row in before if row[0] == t["propertyId"]) == t["baselineSha256"]
                    for t in targets), "STAGING_BASELINE_HASH_MISMATCH")
        with conn.transaction(force_rollback=True):
            require(conn.execute("SELECT orulo_recovery.cas_apply_batch(%s)", (Jsonb(items),)).fetchone()[0] == 5,
                    "STAGING_EXPECTED_FIVE_UPDATES")
            after = rows()
            for target in targets:
                desired = deepcopy(target["baseline"])
                for plan in desired["raw_data"]["building"]["floor_plans"]:
                    if str(plan.get("id")) == target["planId"]:
                        plan["images"] = target["images"]
                require(next(row[1] for row in after if row[0] == target["propertyId"]) == desired,
                        "STAGING_UNAUTHORIZED_FIELD_CHANGE")
            require(conn.execute("SELECT orulo_recovery.cas_apply_batch(%s)", (Jsonb(items),)).fetchone()[0] == 0,
                    "STAGING_REPLAY_UPDATED")
            require(rows() == after, "STAGING_REPLAY_CHANGED_ROWS")
            audit = conn.execute("SELECT property_id::text,baseline_sha256,result_sha256,previous_entry_sha256,"
                                 "entry_sha256,encode(sha256(convert_to(concat_ws('|',transaction_id::text,"
                                 "property_id::text,building_id,plan_id,baseline_sha256,result_sha256,"
                                 "previous_entry_sha256),'UTF8')),'hex') "
                                 "FROM orulo_recovery.cas_batch_audit ORDER BY property_id,building_id,plan_id").fetchall()
            require(len(audit) == 5, "STAGING_AUDIT_COUNT_MISMATCH")
            previous = "0" * 64
            for pid, old, new, prev, entry, recomputed in audit:
                require(old == next(row[2] for row in before if row[0] == pid)
                        and new == next(row[2] for row in after if row[0] == pid)
                        and prev == previous and entry == recomputed, "STAGING_AUDIT_HASH_MISMATCH")
                previous = entry
        require(rows() == before and conn.execute("SELECT count(*) FROM orulo_recovery.cas_batch_audit").fetchone()[0] == 0,
                "STAGING_ROLLBACK_FAILED")
        stale = deepcopy(items)
        stale[-1]["baseline"]["title"] = "deliberately stale baseline"
        try:
            with conn.transaction():
                conn.execute("SELECT orulo_recovery.cas_apply_batch(%s)", (Jsonb(stale),))
        except psycopg.Error as error:
            require(error.diag.message_primary == "CAS_BATCH_CONFLICT", "STAGING_UNEXPECTED_CONFLICT")
        else:
            raise ValueError("STAGING_STALE_BASELINE_ACCEPTED")
        require(rows() == before and conn.execute("SELECT count(*) FROM orulo_recovery.cas_batch_audit").fetchone()[0] == 0,
                "STAGING_CONFLICT_ROLLBACK_FAILED")
    return {"realBaselines": 5, "simulatedUpdates": 5, "replayUpdates": 0,
            "rollbackVerified": True, "staleBaselineRollbackVerified": True, "auditHashesVerified": True,
            "productionTriggersTested": False, "productionAuthorizationTested": False,
            "prototypeOnly": True, "receipts": [dict(zip(
                ("propertyId", "beforeSha256", "afterSha256", "previousHash", "entryHash", "recomputedHash"),
                row)) for row in audit]}


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
    selected, used, buildings, classifications = [], set(), set(), Counter()
    with psycopg.connect(os.environ["ORULO_V2_DB_URL"], connect_timeout=20,
                         options="-c default_transaction_read_only=on -c statement_timeout=30000") as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            cursor.execute("SHOW transaction_read_only")
            require(cursor.fetchone()[0] == "on", "READ_ONLY_REQUIRED")
            cursor.execute("SELECT attname,format_type(atttypid,atttypmod) FROM pg_attribute "
                           "WHERE attrelid='public.properties'::regclass AND attnum>0 "
                           "AND NOT attisdropped ORDER BY attnum")
            columns = cursor.fetchall()
            for (building, plan_id), target in candidates:
                if target["propertyId"] in used or building in buildings:
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
                buildings.add(building)
                if len(selected) == 5:
                    break
    require(len(selected) == 5 and len(used) == 5 and len(buildings) == 5, "FIVE_INDEPENDENT_ELIGIBLE_TARGETS_REQUIRED")
    simulation = simulate(selected, columns)
    manifest = {"simulation": simulation, "schemaVersion": 1, "purpose": "ORULO_V2_FIVE_PROPOSAL",
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
