# Órulo: prepare one-building operational pilot

This PR prepares code only. No production migration, authorization, property write,
media request, operational dispatch or merge is performed. Preflight 41820620102
is FINISHED (21,648 compared, two external changes, zero internal changes); its
baseline is historical and is never used for a write.

## Fixed scope and gates

Pilot building **43126** is the first member of the existing immutable 99-ID
manifest. 86644 stays excluded. The new SQL subset and client constant are tested
against that file. No building/list workflow input exists. This release cannot
iterate over the other 98 buildings. At most 500 currently active SP/novos UUIDs
belonging to this one building may be planned; a larger/changed set fails closed.

The separate manual workflow shares `orulo-lote1-production` concurrency with the
read-only workflow, never cancels an active run, uses the same private Environment,
and rejects other actors, refs, automatic events and reruns. `mudeisp`/323805541,
main and attempt 1 are required. Existing Environment protections and secrets are
reused; no credentials are created or changed. Control code checks out
github.workflow_sha, which must exactly match the owner's nonsecret
ORULO_PILOT_APPROVED_SHA variable. Approved source/manifest checkout stays fixed
to 2fa6ec8b093346e1a2319e4c6833cdfb0c52825e. New ORULO_PILOT_READY must explicitly
be true; this task does not set it or the approved SHA variable.

## Future execution protocol (not dispatched here)

1. START creates a new UUID/GitHub run. The executor reads only the pilot's UUIDs,
   obtains floor plans once from Órulo, and only fills missing image fields of
   existing plan IDs. Existing images, typology/order and all other fields remain.
   It checks public HTTPS image URLs with unauthenticated HEAD requests (no
   redirects); unavailable/non-image responses stop before authorization/write.
   No new floor plan or untrusted description is merged. A no-recovery plan stops.
2. A durable CLIENT_READBACK/PILOT_PLAN contains the exact UUID list, candidate
   count and live image payload hash. Private Actions logs show run UUID, GitHub
   run ID, head hash, target list and control SHA, without credentials/property
   contents. The process waits up to ten minutes using **read-only** status polls.
   Errors/timeouts stop; polls never issue authorization or retry a mutation.
3. The owner/database administrator reviews that exact plan and independently
   confirms the workflow revision and run. The private administrative function
   binds authorization to run UUID, GitHub run ID, control SHA, plan head, fixed
   building, exact current UUIDs and manifest hash. Use the filled, age-checked
   SQL block printed in the **live pilot step logs**, as described in
   [owner approval and timeout recovery](orulo-owner-pilot-approval.md).
   It invokes exactly the existing private authorize_pilot function. Do not reuse
   templates from old runs. The Step Summary is a later receipt and may not be
   available until the job ends; do not wait for it during the ten-minute window.

   PUBLIC/anon/authenticated/service_role cannot call this function. A general
   legacy admin_event WRITE_AUTHORIZED lacks the required pilot binding and is
   rejected. Authorization expires after 30 minutes, cannot silently be renewed,
   and is adopted only after canonical SHA-256/sequence/previous-head verification.
4. After authorization, capture a **new paginated baseline V2 of the full
   inventory**, verify completeness/schema/membership, and recheck the exact pilot
   UUID list. No human wait/media discovery follows this baseline. Each row is
   reread immediately before INTENT; its full hash must match the fresh baseline.
   This catches even timestamp-only concurrency before a CAS request. The SQL CAS
   also requires a baseline begun after authorization, sealed within five minutes,
   with matching column metadata, membership and expected full-row hash.
5. For each changed UUID, append and verify a committed INTENT with the entire
   expected row and image-only desired plans. The **only property mutation API is
   public.orulo_audited_cas**. It consumes that persisted INTENT, requires an earlier
   transaction, enforces the one-building/UUID authorization, locks and compares
   the complete row, and atomically commits the property change and CAS_RESULT.
   Audit failure rolls back the property update. Reusing an operation or attempting
   the same row again is rejected. Old unaudited CAS/PATCH paths are never used.
6. Verify the server's CAS_RESULT canonical digest/body, require UPDATED plus the
   trusted preservation receipt, then read the row again through a service-only
   read RPC. Validate image values, unchanged prices/stock/photos/videos/tours and
   every other non-permitted field, plus full/content hashes. Append ROW_VERIFIED.
   A no-change row is skipped before INTENT; unexpected UNCHANGED/CONFLICT/NOT_FOUND
   after INTENT stops for reconciliation.
7. After all planned rows, capture a fresh full-inventory READBACK_V2. Only UUID
   deltas exactly matching trusted before/after CAS receipts can be attributed to
   this pilot. Remaining differences use the PR #84 scope rules: proven external
   concurrency is retained with warning; internal/unknown divergence stops. The
   server independently validates all snapshot deltas/receipts before FINISHED.
   At least one verified update is required to call the experiment APROVADO.
   The final report has counts, image coverage, run/head and remainingBatchEnabled=false.

## Failure, recovery and rollback

Any conflict, ambiguity, timeout, image/row/hash/schema divergence or audit failure
stops before another UUID. A lost CAS response triggers **read-only** recovery of
the trusted CAS_RESULT and current row; even confirmed commit does not resume the
loop or retry CAS. A partial pilot is not automatically rolled back or repeated.
INTENT and committed results remain durable. CLIENT_STOP is best effort; an
unavailable/frozen journal can prevent it, but cannot undo committed server evidence.

Reconcile operation UUIDs and rows administratively before ABORTED/new execution.
Do not use the old two-event preflight abort script for a write-authorized run.
The existing admin_event ABORTED requires a documented reconciliation reason and
explicit reconciled flag. Keep all baseline/page/result/readback evidence. History
must never be edited/deleted. A successful pilot closes its run and provides no
authorization for the remaining buildings.

To stop rollout, unset ORULO_PILOT_READY. The existing
supabase/orulo_postgres_audit_rollback.sql revokes the public audit/CAS RPCs while
preserving history. Never restore the unaudited CAS or automatically reverse image
updates: a corrective operation needs fresh expected state and separate review.

## Pending before the first real test

- Review passing regression/concurrency CI and explicitly approve/merge this PR.
- Review and install only the additive migration
  20261104114348_orulo_pilot_authorization.sql through the administrator process;
  it creates functions/restricts RPC entry points and does not update properties.
- Confirm existing private Environment bindings, no active unreconciled run,
  Supabase backup/PITR/restore arrangements and capacity. These are not verified
  or changed by this code-only task; the ledger remains in the database trust
  boundary documented by the earlier audit PR.
- Approve pilot candidate 43126, set the reviewed merged control SHA and pilot
  readiness privately. Existing readiness for PostgreSQL alone is insufficient.
- Start one new manual run on main as the owner. Review its fresh plan, then use
  the private command above **during that same run**. Do not preauthorize by GitHub
  secret, reuse a previous run, rerun jobs or authorize the full 99-building batch.
- After that separately authorized test, review the report and public floor-plan
  interface before considering any later release for the other 98 buildings.

Until these steps and the explicit per-run database authorization are complete,
**the first real pilot is BLOCKED**. No remaining-building execution is implemented.

## Tests

Isolated SQL/client tests exercise successful image-only recovery, private admin
permissions/head/SHA/run binding, missing/expired authorization, wrong-building
UUIDs, absent/fresh baseline, full-row concurrency, lost acknowledgement after
commit, stop-before-next-row, hash attribution and durable FINISHED. Native
PostgreSQL tests run the actual executor/RPC pipeline and overlap a second session
holding a row update lock. Existing global snapshot, scope, ACL/RLS, integrity and
large-inventory regressions remain. Media is synthetic/injected; no production
Supabase or Órulo write/recovery is invoked by CI.
