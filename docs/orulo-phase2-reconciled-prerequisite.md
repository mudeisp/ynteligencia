# phase2-30-a — database release and reconciled prerequisite

## Confirmed diagnosis (read-only production inspection)

Main was 96490b0380bd2050d460f65b1625d2ec77afa389. GitHub catalog.json releases phase2-30-a, while the installed database batch_catalog() from migration 20261104151850_orulo_manifest_batches.sql still returns released=false. Master hash and all four batch hashes/prerequisite IDs agree. phase2-30-b and phase3-rest are false in both catalogs.

The owner-only authorize_pilot(uuid,text,text,text,text) first checks released, causing the reported BATCH_PHASE_NOT_RELEASED. After that flag is corrected, the old FINISHED-only prerequisite would independently cause BATCH_PREVIOUS_RESULT_REQUIRED. These are two different controls; changing the GitHub catalog alone cannot correct them.

The accepted predecessor is phase1-20, run 8c3b6881-69fa-4737-a29f-6aeebe1b94b9, GitHub 42020285807. Its 957-event SHA-256 chain is intact, with 26 CAS_RESULT, 26 INTENT and 26 BATCH_ROW_VERIFIED. Existing audits confirmed 110 recovered occurrences. It ended with an owner-issued, reconciled ABORTED, sequence 957, hash:

4e9b652387480e73eb6c0058b8ec456bd0874ca345e4f3be1cdaf26ce40246a6

This terminal event records the confirmed writes and legitimate subsequent webhooks. It must remain ABORTED; no historical event is replaced or appended by the migration.

## Minimal, narrowly bounded correction

New migration 20261105151448_orulo_manifest_batches.sql:

1. Replaces only the database catalog phase2-30-a released flag, preserving the function OID/owner/ACL, manifests, hashes and all other catalog data. Guards require expected master/batch hash/prerequisite and the later phases still locked.
2. Adds a private SECURITY INVOKER evidence helper, batch_prerequisite_result(text). The normal FINISHED path remains available. A reconciled ABORTED can qualify only for phase1-20 and only for the exact already-reviewed run UUID, terminal sequence/hash and counts 26/110 frozen in this migration. No generic acceptance of ABORTED and no new audit system/table is introduced.
3. Before recognizing that exception, revalidates the entire canonical SHA-256 chain, manifest/plan identity, one historical authorization, all durable INTENT/receipt/individual verification counts, baseline hashes, full/content receipt hashes with UTC normalization, protected fields and exact desired floor_plans, and 110 missing-before/present-after occurrences. Unknown head/run, absent receipts, conflicts or invalid chain cannot qualify. Readback differences remain historical and are accepted only through the exact previously reconciled terminal hash, not through a new bypass.
4. authorize_pilot still requires the explicit owner call, current run/head/SHA, a fresh plan under ten minutes, matching live inventory/coverage and unique authorization. It writes the predecessor evidence reference into the new WRITE_AUTHORIZED event as prerequisiteResult. It does not issue authorization during installation. CAS, baseline, readback, stop-on-conflict, RLS and existing ACL are unchanged. No extra execution privilege is granted to service_role, anon, authenticated or PUBLIC.

The exception recognizes historical confirmed work; it does not claim that the interrupted workflow finished normally. Normal concurrent inventory updates are not blocked or reverted. No production property is read for mutation or updated by this migration/helper.

The receipt validation SELECT used by the helper was independently executed read-only against production: zero invalid receipts. The recorded post-CAS plans contain 110 occurrences and zero absent image references. No function or migration was installed to perform these checks.

## Current stopped run

[GitHub 42051049087](https://github.com/mudeisp/ynteligencia/actions/runs/42051049087), UUID a613aae9-4a99-47bd-b7c4-d58b9f0c7c72, was initially waiting and subsequently completed/failure. Its ledger is intact with START, CLIENT_READBACK/BATCH_PLAN and CLIENT_STOP by BATCH_AUTHORIZATION_WAIT_TIMEOUT; zero WRITE_AUTHORIZED, INTENT and CAS_RESULT. The reported SQL authorization failure did not persist an authorization; the workflow then timed out waiting.

Current head (sequence 3):

66dad2b325e74a5fd753112f2899555b239803946de81b358c48ad5e44519903

The expired plan covered 71 properties, 23 buildings and 375 occurrences; those are historical plan counts and must not be forced onto the next inventory.

The separate owner-review script supabase/orulo_reconcile_42051049087.sql pins all three hashes/events, revalidates the chain and zero operations, takes the existing per-run lock and appends only ABORTED as sequence 4. It refuses changes, concurrency or repetition and checks complete preservation of the three original events. It does not run as part of the migration. Production reconciliation has NOT been executed.

## Tests

Existing PostgreSQL WAL/concurrency tests plus new native PostgreSQL coverage use only disposable localhost databases. The predecessor fixture performs actual audited CAS, produces a real concurrent readback divergence, and is then administratively reconciled as ABORTED. The migration is applied unchanged to verify catalog-only changes and rejection of an arbitrary ABORTED. For the successful frozen-exception test only the synthetic run/head/count constants in the helper are rebound; its verification logic remains identical, and the exact production helper is restored afterward.

An independent fixture database prevents earlier successful FINISHED test runs from accidentally satisfying the prerequisite. Tests cover API-role denial, wrong/absent prerequisite, chain corruption, exact acceptance evidence in a new explicit authorization, duplicate authorization, real concurrent run lock, preserved property data and original events, zero subsequent CAS, and isolated reconciliation exclusivity/preservation/repetition. Existing CI path filters and test command already include this migration name and test file, so no workflow changes are required.

## Safe deployment sequence (owner actions; none executed here)

1. Review PR and green regression/native PostgreSQL CI; merge only after approval. Record the exact resulting main SHA.
2. Independently recheck that GitHub 42051049087 remains completed/failure. Review and execute only the complete reconciliation script as postgres in the correct production project, wzaegidwtdjuhqchpdpd. Verify event 4 ABORTED and preservation of events 1–3. Never reuse that run or its expired plan.
3. Save current batch_catalog/authorize_pilot function definitions, owners and ACL. Apply only the new reviewed migration with the existing administrative migration process. No credentials or property changes are needed.
4. Read-only postchecks as administrator: compare catalog master/batch hashes with main; only phase2-30-a changes released=false to true; phase2-30-b and phase3-rest stay false. Call select orulo_audit.batch_prerequisite_result('phase1-20'); require the exact ABORTED run/head and 26/110 evidence. Recheck deny privileges for API roles and unchanged prior ledger. If any check fails, stop without authorizing a plan.
5. Review the new main SHA and set ORULO_BATCH_APPROVED_SHA through the existing private owner procedure. Only then manually start a new independent phase2-30-a run. Require fresh source validation, a newly persisted plan and a separate owner authorization within the existing window. No old authorization/plan is reused.

Rollback before any new authorization: restore the previously saved authorize_pilot body and database catalog flag=false; the unused private helper can be removed afterward. Do not rerun old migrations, modify ledger events, change ABORTED to FINISHED, or revert confirmed property writes. After any new authorization, stop and reconcile its state before rollback.

## Scope

No production migration, authorization, property mutation, reconciliation or workflow dispatch has been performed by this change. No new phase beyond phase2-30-a is enabled. No automatic merge.
