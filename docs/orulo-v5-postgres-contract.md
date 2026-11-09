# Órulo V5 — PostgreSQL contract verified against production (read-only inspection)

Status: DESIGN ONLY; no production migration or write permission.

## Confirmed server-side blockers
- `orulo_audit.cas_core` hardcodes a 99-building allowlist and `state='SP'`.
- `orulo_audit.batch_auth` validates `WRITE_AUTHORIZED` against `orulo_audit.batch_catalog()`, with `mode='BATCH_IMAGES'`, released batch, exact master/manifest hashes, and expiry.
- `orulo_audit.audited_cas_core` requires a previously committed `INTENT`, checks single-use operation, executes CAS and appends `CAS_RESULT` in the same transaction.
- `orulo_audit.pilot_cas_guard` is specifically scoped to building 43126; it cannot authorize a general V5 batch.

## Required versioned migration (not yet implemented)
1. Register immutable V5 manifest with signed provenance (trusted GitHub run/commit), exact per-building property UUID and plan IDs, state, report SHA256, expiry, and owner-approved scope. Reject duplicate/replaced manifest and protected/pending targets.
2. Introduce V5-specific authorization event and validator. Preserve old `batch_auth` semantics; never interpret an old `WRITE_AUTHORIZED` as V5 approval. Verify the trusted control SHA, workflow run and owner independently, not only caller-supplied JSON.
3. Introduce V5-specific audited CAS entry point. Require prior committed intent, fresh full-row baseline, per-target membership and allowed image-key-only diff. Require serial transaction lock, global integrity verification and unique operation ledger. Fail closed on unknown outcome.
4. Refactor allowlist into a scoped, immutable manifest check **only within the new V5 path**; do not globally remove the legacy allowlist or SP restriction.
5. Verify transactional receipt, full-row readback and no non-image mutation before marking success. Preserve global integrity fail-stop; isolate only proven PREWRITE source failures.
6. Validate in isolated staging with concurrent updates, wrong state, missing plan, expired approval, replay, partial writes, malicious role, lost response, trigger-induced drift and rollback. Production deployment requires separate reviewed approval.

## Acceptance
- Existing V1/V2 and pilot paths behave identically.
- V5 writes are impossible without a signed, server-registered, unexpired, scope-bound approval.
- Every V5 update has a durable CAS receipt and independent readback.
- Zero unauthorized writes and zero silent reconciliation.
