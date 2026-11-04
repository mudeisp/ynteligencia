# Órulo Lote 1: PostgreSQL audit, no AWS

This change prepares a **read-only preflight**, not an operational release. No
property write, batch, migration application, credential creation, merge or deploy
is part of this PR. The exact existing manifest remains 99 buildings, excluding
86644. The approved source stays pinned to
`2fa6ec8b093346e1a2319e4c6833cdfb0c52825e`.

## Guarantees and trust boundary

`orulo_audit.runs` and `entries` live in the existing Supabase PostgreSQL database.
They have forced RLS, no PUBLIC/anon/authenticated/service_role schema/table
access, and UPDATE/DELETE/TRUNCATE rejection triggers. A dedicated NOLOGIN role
owns narrowly privileged SECURITY DEFINER RPCs with an empty search path. Only
service_role can execute the two public RPCs. The database administrator retains
the access required for installation/reconciliation. No public RPC exposes SQL,
authorizes writes or lets a client forge a server CAS_RESULT.

Every event has a run UUID, globally unique event UUID, monotonic per-run sequence,
previous SHA-256 and a SHA-256 of the exact stored canonical JSONB envelope. Read
the canonical bytes through the RPC, recompute SHA-256, compare UUID/sequence/event,
and follow previousHash from START to the externally retained head. Each operation
UUID can have exactly one INTENT and one CAS_RESULT. Client ACKs are verified by
reading the persisted entry; uncertainty freezes the client, without retries.
PostgreSQL returns the RPC response after COMMIT; `synchronous_commit=on`, fsync
and full_page_writes are required. An in-memory/non-durable database fails health.

An INTENT must be committed in an **earlier transaction**, contain the entire
expected row, and be the latest run event. The audited CAS takes no replacement
row from its caller: it consumes only that persisted intent. Row locking and
full-row comparison preserve the original CAS protections. The property change
and trusted CAS_RESULT/receipt commit atomically. If journaling fails, the property
change rolls back. Only existing plan image fields and updated_at may change;
triggers that change forbidden fields cause rollback. The server validates the
99-building/SP/novos/active scope and the stable property UUID. The legacy CAS
entry point is revoked and raises AUDITED_CAS_REQUIRED: no fallback PATCH exists.

The client serializes appends; PostgreSQL rejects concurrent access with advisory
transaction locks and validates expected sequence/head. Only one active run may
exist globally. Run UUID and GitHub run ID cannot be reused, even after finish.
Interrupted runs remain active and block new runs until an administrator reconciles
the evidence and appends ABORTED. No automatic resume or ambiguous replay.

## Comparison with S3

| Guarantee | PostgreSQL journal |
| --- | --- |
| Private durable history after runner termination | Committed database rows, independent of Actions artifacts |
| Immutable application history | RLS/privileges/triggers; no application UPDATE/DELETE/TRUNCATE |
| Integrity verification | SHA-256 chain plus verified canonical readback; retain run UUID/head externally |
| Mutation without audit result | Prevented transactionally, stronger coupling than separate S3/object and DB commits |
| Crash before response | Read persisted INTENT and server CAS_RESULT; never automatically replay |
| Independent storage copy/version recovery | **Not equivalent to S3 versioning**; requires tested Supabase backups/PITR and restore policy |

Database owners/superadministrators can disable triggers, replace functions or
rewrite history/recompute hashes. An unanchored hash chain cannot prove integrity
against that administrator. S3 account administrators also had privileged control,
but this solution removes storage independence. Backups/PITR and retention must be
verified by the owner before operational release; this PR does not claim to have
verified the contracted plan or performed a production restore test.

Existing service_role privileges used by the inventory application are not globally
revoked: a compromised service_role could bypass this executor using generic table
APIs. The no-unaudited-mutation guarantee covers the Órulo CAS entry points, not all
possible uses of an administrative Supabase key. Do not expose it to untrusted jobs.

## Baseline V2 and readback

Snapshots are generated server-side using bounded UUID pages and durably stored
as hash-chained page events, with BASELINE_V2/READBACK_V2 seals after complete coverage.
See [paged capture and incident recovery](orulo-paged-preflight-recovery.md) before
any new manual attempt. Captures represent read windows, not an atomic inventory
snapshot. All properties are included (targets and outside rows), sorted by UUID.
Each record contains id, external_id, building_id, UTC
updated_at, full hash and content hash. V2 retains the existing PostgreSQL canonical
JSONB MD5 content checksums for compatibility; the enclosing audit envelope uses
SHA-256. Only updated_at is excluded from the content hash. Column names/types are
stored to detect schema drift. There are no raw secret values in snapshots/events.

Comparisons full-join by UUID and separately report content changes, timestamp-only
changes, insertions/deletions and schema mismatch. These two preflight snapshots
perform no Órulo requests and no property writes. Any differences are concurrent
or unattributed. Future operational reconciliation must use the server CAS receipt
expectedBeforeContentHash/expectedAfterContentHash per UUID, and retain unexplained
changes as a stop condition. A global checksum alone is never attribution proof.

## Configure the new preflight

1. Review CI and migration. Apply
   `supabase/migrations/20261104093722_orulo_postgres_audit.sql` through the normal
   administrative migration process only after explicit approval. Installation is
   transactional, creates audit infrastructure, and does not UPDATE properties.
   It disables the unaudited CAS, so old executors must remain stopped. Keep the
   existing manifest unchanged. Do not authorize a write run.
2. Keep Environment `orulo-lote1`: no admin bypass; exactly one custom branch policy
   `main` (branch, not tag). A single owner needs no required reviewer/self-review
   setting. Bind the existing private Environment secrets `ORULO_CLIENT_ID`,
   `ORULO_CLIENT_SECRET`, `SUPABASE_SECRET_KEY`. No AWS account, OIDC role, bucket,
   access keys or new credentials are needed. Secrets must never be pasted in chat.
3. Optional nonsecret repository variable `ORULO_AUDIT_SUPABASE_URL` must equal
   `https://wzaegidwtdjuhqchpdpd.supabase.co`; omission uses that fixed project.
   After administrative validation set **repository** variable
   `ORULO_POSTGRES_AUDIT_READY=true`. The old ORULO_STORAGE_READY flag is ignored.
   Leave readiness unset until the migration is installed.
4. Manually dispatch on main, as `mudeisp` (account ID 323805541). Automatic events,
   other actors/triggering actors, other refs and reruns are rejected before secret
   access. Control code checks out github.workflow_sha; approved source is fixed.
   Actions concurrency remains `orulo-lote1-production`, cancel-in-progress false.
5. The workflow only checks configuration, stores START, preflight metadata, two
   V2 snapshots and FINISHED. It prints counts/run UUID/head hash and secret
   **presence**, never values or the full snapshots. No backfill or --write step.
   Keep UUID/head hash with the owner for later verification. A green result does
   **not** authorize the Lote 1 write.

## Recovery and rollback

Read-only recovery uses `orulo_audit_control('recover', run, null, null,
'{"operationId":"..."}')` and `read` by sequence. CAS_RESULT is authoritative for
the atomic transaction outcome, unlike a client log. Validate its hash chain,
read the current property, and compare the trusted receipt with the baseline and
readback. If only INTENT exists, do not infer a failed write from timeout: wait for
the transaction to settle and reconcile administratively. If the database cannot
be reached, stay blocked. Reopening the same execution or retrying CAS is forbidden.

Only a database administrator can use private `admin_event` after reconciliation;
ABORTED requires an explicit reconciled flag and reason. This workflow never calls
WRITE_AUTHORIZED. Future operational authorization/wiring requires a separate
reviewed release; the preflight cannot self-enable it or close an authorized run.

Rollback: first unset `ORULO_POSTGRES_AUDIT_READY`; then use
`supabase/orulo_postgres_audit_rollback.sql` to revoke RPC access. Preserve all runs,
entries, snapshots and receipts. Do not drop/truncate audit tables or restore the
old unaudited CAS. This PR performs none of these administrative actions.

## Tests and release decision

The existing locked PGlite test dependency exercises real SQL semantics: permissions,
append-only constraints, UUID/sequence duplication, active-run rejection, scoped
CAS, timestamp-independent conflicts, preservation, previously committed INTENT,
audit failure rolling back property mutation, snapshots and read-only recovery.
Client tests cover lost ACK after persistence, tampered hashes, freeze/no retry,
and concurrent local callers. Legacy S3 tests are retained as historical regression
coverage; the runtime no longer imports or invokes the S3 module.

CI additionally starts a disposable local PostgreSQL 17.6 database to test fsync/WAL
health and true simultaneous sessions: advisory-lock exclusion, duplicate sequence
race and a row update held concurrently with CAS. No production secrets are used.

**APTO to configure the new read-only preflight after migration review/installation
and green CI. Operational writing remains BLOQUEADO**, pending private backup/restore
validation, reconciliation design and a separately reviewed execution release.
