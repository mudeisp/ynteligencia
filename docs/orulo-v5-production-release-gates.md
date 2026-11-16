# Órulo V5 — production recovery gate (2026-11-09)

## Verified evidence

- GitHub Actions run 42556865418: SUCCESS (Node and disposable PostgreSQL 17).
- Supabase project `wzaegidwtdjuhqchpdpd`: 15,632 active `novos` properties with an array at `raw_data.building.floor_plans`.
- Read-only production query identified 51,326 **plan occurrences** without a nonempty `image_url` or nonempty `images` array; 2,316 affected building IDs across 8 states. These are occurrences, **not** confirmed recoverable images or unique plan IDs.
- Production `orulo_audit.cas_core` is hard-scoped to SP and 99 IDs. It cannot perform the national V5 recovery.
- V5 staging fixtures are not the production `orulo_audit.entries` hash-chain.

## Required release gates (fail closed)

1. Introduce a production V5 CAS implementation in a **reviewed versioned migration** with full-row compare-and-swap, image-only updates, immutable plan ordering/IDs, and no widening of the legacy CAS.
2. Use a SECURITY DEFINER execution role with narrowly scoped EXECUTE privileges; do not grant direct UPDATE on `public.properties` to anon/authenticated/service_role. Independently test role spoofing and search_path attacks.
3. Link a previously committed INTENT to exactly one operation and to a signed or independently verified manifest (commit SHA, workflow result, batch scope, target IDs, plan IDs, expiry). The staging approval table alone is **not** independent proof.
4. Perform the CAS and append `CAS_RESULT` to `orulo_audit.entries` **in the same transaction**. Verify the append chain and replay protections. Reject ambiguous outcomes without blind retry.
5. Exercise tests in disposable PostgreSQL using a schema-faithful `public.properties`, `orulo_audit.entries`, `runs`, and owner roles, including concurrent CAS, trigger-induced drift, rollback, expiry, replay, forged approval, wrong state, and loss of service privileges.
6. Validate a read-only preflight in production; verify baseline snapshots and recoverable source images, not just URL patterns. Preserve old values and receipt hashes.
7. Run a small SP pilot with explicit scoped authorization, independent before/after readback, HTTP image checks and site rendering checks. Stop on any global integrity anomaly.
8. Expand ES and other states in capped batches, monitoring errors, source reliability, and rollback receipts. Close only with a verified coverage report and no unexplained mutations.

## Current status

**NOT RELEASED.** The V5 test harness passed, but no production V5 CAS migration has been deployed, no national V5 write has been executed, and no image-recovery success may be claimed. Do not merge or enable production writes until gates 1–6 pass.
