# Órulo V2 — CAS release gates (2026-11-10)

## Confirmed live read-only inventory
- 17,996 Órulo property rows; 8,402 distinct building IDs.
- 109,284 plan occurrences in raw_data.building.floor_plans.
- 51,905 plan occurrences have no images key; 57,379 have populated images arrays.
- 28,276 distinct (building_id,plan_id) pairs in prior audit, of which 23,629 occur across multiple property rows. Counts may shift as live data changes.
- Existing plans often have no explicit typology association. A plan can be building-scoped and legitimately shared by multiple property rows.

## Non-negotiable release gates
1. Decrypt and verify all six pinned source checkpoints, per-building hashes and recoverable image evidence.
2. Construct per-(building_id,plan_id) source manifest, deduplicate and reject conflicts.
3. For each target property, prove the exact plan ID is present exactly once in its building.floor_plans; do not infer typology from plan ID.
4. Capture complete current record baseline and expected image-only patch. Refuse any record with existing nonempty images.
5. Review image URL allowlist, content-type and verified source evidence; never trust only an arbitrary URL string.
6. Write in an audited transaction with full before/after, operation UUID, CAS conflict handling and chain verification.
7. Read back the persisted record; compare expected fields and confirm unrelated metadata is unchanged.
8. Exercise staging tests for concurrency, malformed JSON, missing plans, duplicate plans, idempotence, rollback and readback mismatch.
9. For `national-v2-once`, follow the unified legacy-ledger integration and complete-manifest authorization procedure in `orulo-national-v2-once-operation.md`. No five-property pilot or independent record-count batches are required. Stop on unexpected audit or integrity changes.

## Current PR scope
The SQL function is a guarded prototype, **not an authorized production executor**.
No deployment, no data writes, no successful staging test or live CAS execution is claimed.
Do not merge until the source-manifest, audit-chain and staging requirements are implemented and tested.
