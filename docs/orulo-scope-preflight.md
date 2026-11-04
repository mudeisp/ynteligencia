# Scope-aware read-only preflight

The immutable `scripts/orulo-media-recovery-lote1.ids.json` is the sole scope
authority (99 unique buildings, existing pinned SHA-256). No caller-supplied ID
list, current property lookup, state/source assumption or unit ID determines scope.
The classifier loads that file directly and rejects a hash mismatch. The manifest,
snapshot SQL, migrations, ACL/RLS, CAS RPC, sync and manual/main/owner gates are
unchanged. This patch requires no database migration and enables no recovery/write.

## Approval rules

All pages still cover the entire inventory and every ACK/canonical SHA-256/link is
verified. The client retains the existing six-field V2 evidence per UUID while
capturing baseline/readback. Coverage, UUID uniqueness/order, complete seals,
column metadata, membership and hash consistency are checked before classification.
The final server comparison must exactly match the independently counted client
comparison. A missing/invalid hash, broken chain, incomplete page/capture or timeout
stops processing. A schema or unstable-membership change cannot be waived by scope.

| Observation | Classification / result |
| --- | --- |
| Either BEFORE or AFTER building ID is in the immutable manifest | IN_SCOPE; every divergence requires review, including price/stock/timestamp changes |
| Both observed bindings are valid, equal and outside the manifest | OUT_OF_SCOPE; content/timestamp changes pass with an explicit warning |
| Insertion has a valid observed outside binding | OUT_OF_SCOPE insertion, retained as a warning |
| Deletion has a valid audited BEFORE outside binding | OUT_OF_SCOPE deletion, retained as a warning; never infer from current inventory |
| Missing/invalid binding, or external building reassociation | UNKNOWN; block for review |
| Hash/schema/coverage/membership/chain inconsistency | Block, regardless of scope |

Unchanged rows without an Órulo building ID are still compared globally; they do
not fabricate a divergence. Any change to such a row requires review because its
scope is unknown. Moving a record into or out of an authorized building never
escapes protection: either-side membership makes it IN_SCOPE. There is no override
to justify internal changes automatically. A successful global comparison with
only provably external changes returns
`READ_ONLY_PREFLIGHT_PASSED_WITH_OUT_OF_SCOPE_CHANGES`; an entirely clean run
returns `READ_ONLY_PREFLIGHT_PASSED`. Unknown/internal changes retain REVIEW_REQUIRED.

## Existing ledger, no new audit system

Before FINISHED, the existing allowed CLIENT_READBACK event stores `scopeReview`:
manifest hash, global/per-scope counts, decision candidate/reasons and each changed
UUID, divergence type, BEFORE/AFTER building IDs, external IDs, timestamps and
full/content hashes. `validation=PENDING_SERVER_FINISH` makes clear this candidate
is not final approval. After verifying the appended event and FINISHED aggregate
comparison, the client returns the final result. A server/client mismatch blocks.
No old event is rewritten; a previously FINISHED run is never reopened/reclassified
in place. FINISHED permits a new independent UUID/GitHub run ID, as before.

Externally changed rows are concurrent or unattributed: scope classification does
not prove which synchronizer/user caused them or authorize changing them. The
existing CAS full-row lock/compare, image-only preservation, readback and immediate
stop rules remain necessary for any separately reviewed operational release.

## Run 41816561127 (read-only historical evidence)

The existing FINISHED event reports 21,647 compared UUIDs, two content changes,
zero timestamp-only changes, zero insertions/deletions, schemaMatch=true and
captureStable=true. A bounded query of the saved snapshots confirms:

| UUID | External ID | BEFORE / AFTER building | Classification |
| --- | --- | --- | --- |
| 0921d8a6-98ef-433f-b44f-6da096531e1e | orulo:47422:73063 | 47422 / 47422 | OUT_OF_SCOPE content |
| 5c22c706-2fb6-41b8-a96b-82a4fb0a0a60 | orulo:47422:73066 | 47422 / 47422 | OUT_OF_SCOPE content |

These are the two YN Petrópolis units in Porto Alegre/RS identified by the owner.
Neither building binding belongs to the 99-building manifest; no internal change
was reported by the complete comparison. Under the new criteria this evidence
qualifies for a read-only pass with warning. The historic failure/result is not
edited, no operational workflow is dispatched, and no backfill or image recovery
is executed. UUID/hash evidence is preserved in the owner's local report and the
original private ledger; no additional public copy of property contents is needed.

## Validation and operational status

Unit tests cover all 99 protected IDs, two external changes, reassociation, unknown
insertions/deletions, timestamp-only changes, schema/coverage and hash mismatches.
Existing real-SQL tests cover timeout, partial capture persistence, immutable history,
SHA-256 chain rejection and an independent new run after FINISHED. Native PostgreSQL
integration runs the actual client/RPC pipeline with external price changes (pass
with warning), internal price/stock changes (review), unknown insertion/deletion
(review), durable CLIENT_READBACK evidence and zero CAS calls. All use isolated
synthetic databases; regression and existing 21,646-row paginated tests remain.

**Operational recovery remains BLOCKED.** A green read-only preflight cannot append
WRITE_AUTHORIZED or enable the operational executor. No --write, property mutation,
credential change, operational rerun, sync change, merge or deploy is part of this PR.
