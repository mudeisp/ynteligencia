# Órulo National V2 — immutable seal recovery design

**STATUS: DRAFT / NONDEPLOYABLE.** This change provides a read-only verifier and synthetic tests only. It does NOT install the SQL checkpoint migration, replace national_control, execute national_seal, run production SQL, or grant write authorization.

## Incident and frozen operation

- Workflow #53 (GitHub run 43003536521), November 11, 2026: PostgreSQL SQLSTATE 57014 statement timeout on national_seal. The precise internal expression is unproven.
- Run UUID: 1c8ec62a-9c38-41ac-8091-f1ceef98ca91
- Historical approved code SHA: e660a30cd78a56b1fea4beff3daa0b8c4a032a35
- Manifest SHA-256: ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288
- Current immutable head: sequence 6240, SHA-256 a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6
- 555 ordered fragments (0..554), 5,684 frozen targets and 42,893 eligible occurrences. No national seal, WRITE_AUTHORIZED, INTENT or CAS_RESULT.

## Two independent checks are mandatory

1. **Document byte identity.** SHA-256 must be computed over the actual original UTF-8 bytes, not over hashes of pages, reserialized JSON or a Merkle replacement. The privileged runner must independently read persisted NATIONAL_MANIFEST_PART entries in ordinal order and stream them into SHA-256, while also comparing each original text slice to the authenticated decrypted artifact. Reject byte, order or coverage divergence.
2. **Frozen scope equality.** The authenticated document must pass the existing production `loadNationalManifest` provenance checks. The runner separately reads persisted NATIONAL_TARGET JSON in ordered pages of up to 50 and checks every full target value against the matching document entry. Ids and totals alone are insufficient. The source document's schema/columns/hashes/counts and every plan evidence check must retain the old strict semantics.

The new read-only `scripts/orulo-national-seal-verifier.mjs` implements byte-by-byte fragment equality, two original-byte SHA calculations, full target JSON equality, ordering and coverage. Its page SHA-256 values are only checkpoint hints; they do NOT authorize or emit a seal.

## Remaining PostgreSQL implementation

Add a new private, additive SQL migration only after the design is reviewed, with a per-run cursor and page checkpoints keyed by (run UUID, frozen manifest SHA, page start). No changes or deletion to the first 6240 audit entries and no direct DML privileges for API roles.

Each page must be verified and persisted **in the same PostgreSQL transaction as cursor advancement**. Enforce run/global locks and the existing service-role guard. The stored page must include original operation identity, manifest hash, position, count and canonical payload proof. Verify every frozen target against the original ledger server-side; the runner may not forge a successful check by sending true/false claims. Exact duplicate replay returns the existing checkpoint; altered replay, gaps, duplicate IDs, changed source hash, changed schema and concurrency are rejected. Any aborted transaction preserves the old cursor.

The final seal-only action must ensure:

- A trusted, reviewed runner verified both *original* document SHA and the persisted ledger bytes, and that the source artifact is bound to the historical frozen manifest SHA.
- All 5,684 independent target equality checks and original counts/provenance are complete with no gap or duplicate.
- The original head is still 6240 and the expected predecessor hash is unchanged; no other executor is active.
- Exactly one append-only NATIONAL_MANIFEST_SEALED event is written as sequence 6241 using original event fields. No WRITE_AUTHORIZED, CAS or INTENT.
- Any new code SHA is explicitly bound to its attestation and does not rewrite the historical workflow SHA in the run metadata. STRICT_GLOBAL_V1 remains active.

**Security gap not yet solved:** the database must not accept an arbitrary privileged client's unsupported assertion that it checked a document. The final migration and runner integration need an independently auditable, reviewed authority model linking the authenticated artifact, original SHA and the successful frozen ledger reads. Until then, DO NOT implement or call a seal-writing shortcut.

## Required acceptance tests before merge/deployment

- Isolated PostgreSQL with original production-compatible functions and RLS.
- Equivalence with integral seal on valid and invalid fixtures.
- Rejection for altered byte, reordered/missing fragment, changed target content, altered provenance, extra/duplicate/omitted page and changed schema.
- Failure injection between writing page proof and updating cursor: full rollback.
- Concurrent page submissions and two independent seal-only executions: at most one seal.
- Ambiguous connection drop: readback only, never blind retry of final append.
- Memory and transaction time measured with a representative manifest; do not rebuild 73 MB JSONB aggregate in the database.
- Rollback removes only newly introduced checkpoint objects and preserves all historical functions, RLS, ledger, and CAS results.
- Separate owner approval for production migration, seal-only action, and later image-write authorization.

## Tests available now

`node --test scripts/orulo-national-seal-verifier.test.mjs` — synthetic, read-only tests passed locally. These tests do not yet verify PostgreSQL transactions, checkpoint durability or production-scale behavior.

**Do not run the old DBeaver script again. Do not invoke national_action=execute or continue.**