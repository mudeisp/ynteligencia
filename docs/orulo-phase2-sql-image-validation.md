# phase2-30-a — SQL IMAGE_VALIDATION parity

## Confirmed production diagnosis (read-only)

GitHub run [42069211000](https://github.com/mudeisp/ynteligencia/actions/runs/42069211000), UUID 2e30e874-5eb9-40dc-9532-832f47cd01de, control SHA 06d1dab82b02eb5fd8a55217e1d508ba22de892c. The owner authorization failed inside batch_merge(raw_data, patches), called by authorize_pilot. This is a second image URL validator, independent of the JavaScript verifyBatchImage fixed in PR #93.

The first failing target is 2f689148-44ac-40a9-a9d7-4952e7b12f5d, building 20333, plan 632499 (Implantação):

https://static.orulo.com.br/images/properties/xlarge/632499.JPG

The SQL predicate accepts only lowercase jpg/jpeg/png/webp. A read-only comparison of all proposed patches with current rows found 16 rejected occurrences: all eight .JPG plans 632499–632506 across the two building 20333 properties (2f689148-44ac-40a9-a9d7-4952e7b12f5d and 968eee71-0be7-49c1-b542-f66890bbe195). All their IDs exist in the corresponding current floor_plans; no missing ID caused this error. The URLs are on the existing exact trusted host/path and are present in the authenticated-source BATCH_PLAN, which was persisted after client image validation.

At inspection, the ledger had START and BATCH_PLAN (head f84636025c8df43550f2f63ccf743b3cfa803d84d8888a738d5442d595ad3758), without WRITE_AUTHORIZED, INTENT or CAS_RESULT. The failed authorization rolled back; no property operation was attempted. A later timeout must be audited and reconciled separately; this PR does not close, reuse or authorize that run.

Final recheck: GitHub completed/failure; the ledger now has a third CLIENT_STOP with BATCH_AUTHORIZATION_WAIT_TIMEOUT and head 71e76dc150031c4bf3262e1ce1beeee9104f8c6cad6e3021dad0a786ca051343. No authorization/CAS or administrative closure was performed during this investigation.

## Minimal correction

New migration 20261105170248_orulo_manifest_batches.sql replaces only the extension alternatives inside the existing batch_merge function. Character classes accept casing variations only for the same jpg/jpeg/png/webp extensions. The exact HTTPS host, path structure, filename grammar, absence of credentials/ports/query/fragment, plan membership, duplicate-ID checks and image-only patch fields remain unchanged. Every image field, including images arrays, uses the same strict pattern. URLs are not lowercased or otherwise rewritten.

CREATE OR REPLACE preserves function owner, ACL and IMMUTABLE behavior, verified by tests. No changes to catalog, manifests, gate, authorize_pilot, CAS, RLS or workflows. Redirect rejection, timeout and binary JPEG/PNG/WebP validation remain in the unchanged JavaScript validator; SQL does not fetch remote URLs or weaken that check.

## Tests and deployment

Batch tests reproduce the actual raw plan/URL, mixed-case permitted extensions, malicious/external URLs, query/fragment/path traversal, unsupported extensions, missing/duplicate IDs and non-image patch fields; verify owner/ACL/volatility preservation; and run private authorization plus audited CAS/readback in isolated fixtures. A malicious URL never generates WRITE_AUTHORIZED or CAS.

Native PostgreSQL tests apply the actual migration, assert the catalog and function privileges remain unchanged, and exercise explicit authorization, durable INTENT, audited CAS, readback, global integrity and FINISHED for a synthetic two-property batch using uppercase image URLs. Price, stock and other fields remain preserved. All fixture writes are localhost-only; there is no production test write.

Review/merge after green CI, then have the owner review and apply ONLY this new migration using the normal administrative process. Read-only check the function body/ACL and verify batch_merge against the reviewed source plan without updating properties. Audit/reconcile the expired prior run separately. Update ORULO_BATCH_APPROVED_SHA to the reviewed post-merge main SHA and use a new independent run/plan/authorization. Do not retry the old SQL or change URL casing to bypass validation. No migration, authorization, property mutation, reconciliation or workflow dispatch was performed by this PR.

Rollback before a new authorization: restore the saved prior batch_merge definition (no ledger or property changes). Stop/reconcile any later operational run before a rollback. Do not reapply older migrations or bypass authorization.
