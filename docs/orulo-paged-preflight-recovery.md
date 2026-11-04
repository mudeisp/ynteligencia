# PostgreSQL Órulo: timeout, paginated V2 and safe manual retry

## Confirmed incident

Actions [41813891981](https://github.com/mudeisp/ynteligencia/actions/runs/41813891981)
completed with a failed storage preflight. The PostgreSQL log records `canceling
statement due to statement timeout` at 2026-11-04 10:24:14.367 UTC. Authentication
and the Environment gates succeeded. Run UUID
`6e5290ce-971a-404c-ae18-881a01e30f7c` has exactly:

| Sequence | Event | SHA-256 |
| --- | --- | --- |
| 1 | START | b512ac40357e57a96a9d1740df456e00b15348d5d81eef1e01c366e3682e2798 |
| 2 | READ_ONLY_PREFLIGHT | ba1dc5ecd0cfe0bdf0c9d048369926bf3d9154a6bf500beee4d580141ee292f4 |

Both stored canonical hashes were verified by a read-only database query. There
is no BASELINE_V2, WRITE_AUTHORIZED, INTENT or CAS_RESULT. The failed snapshot
transaction rolled back, while the earlier two committed events remain. The run
is open and blocks another execution. It was **not closed by this PR**.

The previous `snapshot_rows()` aggregated the full inventory into one JSONB value,
serialized whole rows (including large raw_data) for two hashes, then serialized
the resulting audit envelope. Its cost scaled with all ~21,646 properties in one
RPC. The original tests contained tiny fixtures and missed that workload. A
read-only EXPLAIN confirms the existing properties_pkey supports bounded UUID
lookups; the fix does not add indexes to or modify property data.

## Bounded capture protocol

Health version 2 requires `snapshotProtocol=paged-v2`. Old clients fail closed;
the old unbounded `snapshot` RPC action is rejected. The original migration and
committed audit events are untouched. Apply the additive
`supabase/migrations/20261104102956_orulo_paged_snapshots.sql` after review.

1. SNAPSHOT_BEGIN captures only sorted UUIDs and column names/types, not full rows.
   The fixed membership and begin sequence are stored privately and in the hash
   chain. READBACK cannot start before the baseline is sealed. One capture at a time.
2. SNAPSHOT_PAGE reads the next fixed UUID slice using primary-key probes. The
   executor uses 50 rows; the server rejects sizes outside 1..100, wrong offsets,
   duplicates, schema drift and concurrent/closed runs. Full row canonicalization
   is materialized once per row. Each UUID retains the V2 UTC full/content MD5
   hashes; only updated_at is excluded from the content hash. Missing UUIDs have
   tombstones rather than silently disappearing. Each page's records and SHA-256
   ledger event commit in the same transaction. Client reads/validates every ACK
   and hash-chain link before requesting the next page.
3. The seal verifies complete coverage, rechecks membership by UUID, records the
   exact inserted/deleted UUIDs (including insertions behind an earlier cursor),
   and only then appends BASELINE_V2 or READBACK_V2. There is no giant record array
   rebuilt at the end. Private append-only per-UUID rows reference their page
   sequence. Comparison joins those rows by stable UUID with supporting primary
   keys, distinguishing content/timestamp changes, insertions and deletions.

No statement_timeout setting is increased at database, role, session or function
level in the migration or production executor. Only the Actions job budget changes
from 10 to 30 minutes to accommodate multiple network round trips. Each individual
RPC remains subject to the existing database timeout. No automatic retry, shrinking
page retry or resume is implemented: uncertainty freezes the journal. Committed
pages remain available for administrative reconciliation after runner failure.

### Consistency boundary

Pages use separate READ COMMITTED transactions and represent a bounded capture
**window**, not one MVCC point-in-time snapshot. Changes in observed membership
within that window are recorded; mutations entirely between observations cannot
be inferred without CDC. A row changing after its page can only be detected in a
later readback. Preflight does not attribute any change to the backfill (there is
no property write). Unstable membership, schema mismatch, any content/timestamp
change or insertion/deletion makes the client report REVIEW_REQUIRED, not PASS.
Completed evidence is still retained, including FINISHED, for review. This is not
permission to rerun or to write automatically. Operational CAS still compares the
full expected row under lock, regardless of snapshot hashes.

Private tables have forced RLS, owner-only policies, immutable-row/truncate
triggers, and no PUBLIC/anon/authenticated/service_role schema/table access. The
legacy unaudited CAS remains revoked; the 99-ID manifest, owner/manual/main gates,
Environment secrets and first-attempt restriction remain unchanged.

## Reconcile the failed run (administrator only, explicit separate action)

1. Leave readiness disabled/unset while reviewing. Confirm GitHub run 41813891981
   is completed and no owner-triggered preflight is still running. Export the two
   private ledger events for the owner's records; compare their UUID, sequence,
   event fields, canonical SHA-256 and previous-hash links with the table above.
   Do not paste secrets or full property data in Actions/chat. A read-only check:

   ```sql
   select sequence,kind,event_uuid,previous_hash,hash,canonical,event
   from orulo_audit.entries
   where run_uuid='6e5290ce-971a-404c-ae18-881a01e30f7c'
   order by sequence;
   ```

2. After confirming this exact state, a database administrator may execute
   `supabase/orulo_reconcile_41813891981.sql`. It locks the run; verifies the exact
   GitHub run/UUID, two expected event types, read-only flag, anchored head,
   sequence, canonical/event bindings and hash chain; then appends ABORTED via
   the existing private administrative function. No event is edited/deleted.
   Any extra event, changed head, write evidence or repeat execution raises an
   exception and rolls back. This script is **not a migration**, is not called
   by the workflow, and was not executed on production as part of this PR.
3. Verify sequence 3 is ABORTED and sequences 1/2 are unchanged. Retain the new
   receipt. Do not reuse the original GitHub run ID/UUID or click Re-run jobs.

If new evidence appears, stop: this narrow procedure is intentionally unsuitable
for write-authorized runs, pending CAS operations or other failure modes.

## One new manual preflight, after review

Review CI and merge explicitly; install the additive migration using the normal
administrator process. Reconcile the original run as above before dispatching
anything. Confirm health version 2/protocol and restore repository variable
ORULO_POSTGRES_AUDIT_READY only after configuration is valid. The owner `mudeisp`
may then start a **new** workflow_dispatch on main, attempt 1, with existing private
Environment secrets. No automatic dispatch is performed here. Save its run UUID,
final hash and V2 comparison. REVIEW_REQUIRED requires reconciliation of concurrent
inventory changes; failures require ledger review before another manual run.

Rollback: unset readiness and revoke the public audit RPCs using the existing
rollback script, retaining all old/new ledger entries, sets and page records.
Do not restore the unbounded RPC or the unaudited CAS. No --write, backfill, property
mutation, API Órulo requests, merge or deployment is part of this change.

## Verification

Local SQL/client regressions cover page coverage, duplicates/gaps, missing UUIDs,
insertions behind the cursor, schema drift, transaction cancellation rollback,
immutable/private capture storage, lost page ACK freeze, active-run blocking and
the anchored administrative reconciliation procedure (including repeat rejection).
Native PostgreSQL CI adds an actual 100ms statement_timeout during page insertion,
fresh-connection recovery, and 21,646 synthetic 16KiB rows with two complete
captures, per-statement 8s limits, UUID/hash/chain verification and timing metrics.
Synthetic timing is evidence of bounded implementation, not a production SLA;
the next production preflight remains a separately authorized manual operation.

Reference: [Supabase database timeout behavior](https://supabase.com/docs/guides/database/postgres/timeouts).
