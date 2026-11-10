# Órulo audit archive and disk recovery — guarded plan

## Current situation
Supabase Free database size shown as ~562 MB against 500 MB. Read-only inspection found `orulo_audit.entries` ~200 MB and `orulo_audit.snapshot_records` ~124 MB, inclusive of relation storage. Multiple large runs contain hash-chain events and snapshots. **No row is currently approved for deletion.**

## Phase 1: read-only evidence inventory
Run `preflight-readonly.sql` in an authorized environment. Inventory all run UUIDs, snapshot-set kinds, event sequence ranges, hash-chain dependencies, references from other schemas and foreign keys, current run statuses, and any active workflows. Avoid reading or exposing credentials and visitor data. Check whether disk IO budget is healthy before any expensive scan.

## Phase 2: immutable archive implementation (not yet implemented)
Implement streaming per-run exports (not a single huge in-memory JSON), covering all columns of entries, snapshot_records, snapshot_sets and any dependent audit tables. Preserve typed canonical representations, ordering, SHA-256 per chunk, row counts, min/max sequences, run UUID, schema version, and a top-level manifest. Store outside Supabase in a durable, access-controlled repository with lifecycle/retention controls, **not merely an expiring GitHub Actions artifact**. Upload first, then independently re-download and verify hashes, row counts and reconstructability. No secrets or PII in public artifacts. Validate complete hash chains and references, and perform restore test in isolated database.

## Phase 3: dry-run deletion eligibility
Never delete an active run, a run needed for CAS, pending reconciliation, or audit integrity. Generate a per-run allowlist with evidence of archive verification, immutable archive URL/identifier, dependency graph and expected byte savings. Default DENY. Require explicit human approval of run UUIDs and limits before production writes. Do not infer safe deletion solely from age or large size.

## Phase 4: carefully approved space reclamation
Run short transactions and bounded batches with concurrency locks and audit records, recheck live run state and archive checksums before each batch. Monitor DB size, disk IO and error rate. Ordinary DELETE/VACUUM may not reduce on-disk relation size or billing metric immediately; separately plan safe physical reclamation, considering available disk headroom and PostgreSQL maintenance risks. Stop on any integrity deviation.

## Acceptance criteria
- Archived and restored records compare exactly, including hash chains.
- All live operations retain necessary audit evidence.
- Database measured below 400 MB (target only; not guaranteed).
- No writes until separate explicit authorization and verified backup.
- National image recovery remains blocked until CAS and manifest reconciliation controls pass.

This PR only adds read-only inspection SQL and this plan. It **does not implement archive, deletion, or VACUUM**.
