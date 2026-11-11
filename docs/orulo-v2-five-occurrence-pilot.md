# Órulo V2 — five-occurrence CAS pilot: release checklist

Historical prototype evidence. Superseded as an operational requirement by `orulo-national-v2-once-operation.md`. National execution requires the unified audited path and one complete-manifest authorization, with no mandatory pilot.

Status: PREPARATION ONLY. No production writes authorized. PR #117 remains Draft.

## Verified prerequisite
Protected batch-1 dry run 42912325420: 2,000 scanned, 2,000 ELIGIBLE, zero baseline conflicts, zero database writes. This is **not** authorization to mutate production.

## Disposable PostgreSQL proof
The existing `tests/orulo-v2-cas-batch.test.py` now exercises a five-occurrence batch with readback, audit count, exact preservation of unrelated metadata, idempotent replay, stale-baseline atomic rollback, and duplicate plan-ID refusal. CI must pass on the updated PR commit before further steps.

## Staging release gates (must all pass before a production proposal)
1. Re-run the exact protected source-manifest and checkpoint evidence validation for the five selected occurrences. Select five **distinct property IDs** deterministically from the 2,000 approved occurrences; retain the exact (building_id, plan_id, property_id) tuples in encrypted evidence only. Avoid logging raw URLs, property data, secrets, or full baselines.
2. Obtain a fresh complete baseline for each selected row, including its SHA-256; re-check unique plan identity, missing/empty `images`, absence of alternate image fields, and verified provenance.
3. Stage the exact same PostgreSQL schema, function, privileges and audit table as the intended target. The function is a prototype and **must not be installed in production as part of this preparation**.
4. Execute the five-occurrence transaction in staging. Verify 5 updates, 5 matching audit rows, expected before/after hashes, no unrelated field changes, no existing image overwritten, and no orphaned audit entries.
5. Replay the identical batch: 0 additional updates and 0 additional audit rows. Inject one stale baseline and prove the whole transaction rolls back, including all audit rows.
6. Verify least-privilege execution identity, audit-chain integrity and readback consistency. The current audit table stores before/after hashes but does **not** by itself prove a tamper-evident audit chain; this remains a blocking release gate.
7. Produce a redacted signed evidence summary with test run IDs, pinned commit, five selected tuple hashes, baseline timestamps, staging results, and exact remaining risks.

## Hard stops
- No merge of PR #117.
- No production migrations, writes, grants, or image replacement.
- No automatic pilot on production. A separate explicit approval is required after staging proof and audit-chain review.
- On any conflict, stale source evidence, identity mismatch, image change, audit mismatch, or failed CI: stop without promoting.
- National batches remain disabled.
