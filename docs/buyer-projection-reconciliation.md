# Recovering Buyer Profile and Buyer Quality Score projections

`ads_events` is the source of truth. Buyer Profile and Quality Score are derived projections. The online synchronizers are best-effort: a persisted fact can outlive the shared request deadline without reaching its projection. These operational tools recover missing work without changing the online path, event eligibility, scoring weights, or attribution.

Nothing runs at deploy, on a schedule, or automatically. No migration is required. The existing historical backfill script remains separate and unchanged.

## Selection and writes

- **Profile:** import `PROFILE_EVENTS` from `buyer-profile.js`; select eligible facts missing from `buyer_profile_events`; order by `event_time ASC, event_id ASC` (including PostgreSQL microseconds). Re-read each fact and ledger before calling the existing `apply_buyer_profile_event` RPC with `toApplyPayload()`. Preserve the original event ID. A conflicting ledger identity or an ID the canonical payload cannot represent stops the run.
- **Quality:** import `QUALITY_RECOMPUTE_EVENTS` from `quality-scoring.js`. A visitor needs an eligible fact **and** a missing score, a null `last_event_at`, or a `last_event_at` older than the latest eligible fact. Order by latest eligible time, then visitor ID. Recheck freshness before calling the existing `recompute_buyer_quality_score` RPC once per selected visitor.
- `ad_entry`, `property_view_multiple`, and `agent_handoff_created` alone do not justify score recovery under the current central event set. A visitor with only `ad_entry` and no score is not necessarily a gap. Profile and scoring gaps are independent.
- The three confirmed missing `property_view_multiple` IDs are reproduced using synthetic local fixtures with already-existing profiles and scores. Tests never fetch or repair those Production records.

No source facts are inserted, changed, or deleted. Only the existing projection RPCs can write. No ACL, RLS, role, schema, trigger, or function definition is changed by these scripts.

## Configuration and four execution commands

Use Node with native `fetch` and `AbortSignal.timeout` (Node 18+). Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) securely in the operator's environment. Check the intended project/environment before running. Never put credentials in command arguments or commit them. No new permissions are granted by these tools.

The following are PowerShell commands. A write requires both the projection-specific environment flag equal to `1` and `--apply`. Flags alone never write. Review a dry-run in the intended environment before each apply; the following commands are instructions, not an automatic Production procedure.

Buyer Profile dry-run:

```powershell
node scripts/reconcile-buyer-profiles.js --batch-size=100 --max-items=100
```

Buyer Profile apply:

```powershell
$env:BUYER_PROFILE_RECONCILE='1'; node scripts/reconcile-buyer-profiles.js --batch-size=100 --max-items=100 --apply
```

Quality dry-run:

```powershell
node scripts/reconcile-buyer-quality-scores.js --batch-size=100 --max-items=100
```

Quality apply:

```powershell
$env:BUYER_QUALITY_RECONCILE='1'; node scripts/reconcile-buyer-quality-scores.js --batch-size=100 --max-items=100 --apply
```

Remove the write flags from the operator's environment after use. Apply is intentionally manual. Do not overlap runs for the same projection; online updates can still run concurrently.

## Read-only audit before and after

```powershell
node scripts/report-buyer-projection-gaps.js --batch-size=100 --max-items=100
```

This reports both projections, rejects `--apply`, and makes no mutation calls. Each report is a JSON line. Profile reports candidate count, event-name counts, earliest/latest times, age of the oldest gap, affected visitors, and counts per hashed visitor reference. Quality reports missing/stale counts, latest eligible event time, stored score time, eligible-event count, and test classification for each candidate visitor. `planned`, `first_batch_count`, and `deferred_by_limit` distinguish discovered gaps from the bounded work planned for this invocation.

Identifiers in logs are SHA-256 prefixes, not raw IDs. These references are pseudonymous operational correlation values, not proof of anonymity. Logs contain no names, emails, phones, transcripts, summaries, raw rows, attribution values, response bodies, URLs, credentials, or upstream exception messages. Errors use static codes, optional HTTP status, and hashed item references. Restrict access to operational reports.

Quality classifies suspected test cohorts from `metadata.test` and test/fixture/automation markers in identifiers or campaign fields, including older non-triggering events. It reports these separately and skips them by default. This heuristic can have false positives and cannot prove that an unmarked visitor is real. `--include-test-data` explicitly includes that cohort; use it only for deliberate fixture validation. No test rows are created by the operational scripts. Marker values are never printed or used to alter scoring.

UUID classification also checks `visitor_id`, `session_id`, and `event_id` when they are complete UUIDs accepted by the existing validator (versions 1–5, RFC variant). Ignore the fixed version/variant nibbles and require at least **28 of the remaining 30 hex digits** to be one repeated character or alternate between the same two characters. The alternating phase may restart at each UUID group, as in the observed `4a1a`/`8a1a` fixtures. This detects `abababab-abab-4bab-8bab-abababababab`, repeated `a1`/`d4`, nearly uniform IDs and short counter suffixes. It does not classify a UUID merely for containing a repeated substring, and does not apply this numeric heuristic to property IDs, click IDs or arbitrary text. Existing metadata/text markers remain unchanged. This remains a suspicion heuristic: even an extremely repetitive valid UUID could theoretically be genuine, and other synthetic patterns can remain undetected. The helper is private and tested through reconciliation reports and skip/include behavior. Buyer Profile selection/apply semantics remain unchanged; this extends only the existing synthetic classifier used by Quality reports and its default exclusion policy.

Run the same report after an apply. New online facts may change counts between reports. A score can legitimately remain absent for visitors without an eligible fact; do not expand the event set to make counts disappear.

## Bounds, failures, and recovery

- `--batch-size=N`: read page size, default 100, maximum 200. Writes are sequential RPC calls, not a bulk transaction. `first_batch_count` describes the first page-sized work group; `--max-items` limits total selected items.
- `--max-items=N`: maximum projection items attempted, default 100, maximum 1000. Quality items are visitors, not events.
- `--scan-limit=N`: global returned-row read budget per projection run, default 10000, maximum 100000, including ledger lookups, history classification, and live rechecks. Discovery reads existing eligible history to find missing work; incremental **writes** do not imply an indexed incremental read cursor. Memory and read cost are bounded by this budget. Reaching it during discovery fails before writes. Reaching it during apply can follow earlier successful items and stops the run.
- `--timeout-ms=N`: per-request timeout, default 10000, maximum 60000. HTTPS is required except localhost. Redirects are rejected. Pagination continues until an empty page, including when the server caps responses below the requested size.
- The first item error stops processing, reports `ok:false`, and exits nonzero. Discovery errors also exit nonzero. There is no automatic retry of ambiguous timeouts and no misleading successful run on rejected RPC responses.
- For a timeout/error, save the safe report and run dry-run again. Resume rescans facts and consults the durable ledger/score, rather than relying on a local cursor. A timed-out RPC may have committed: ledger idempotency and freshness checks prevent replaying completed work. Investigate a repeatedly failing item; do not edit source facts or silently skip it.

`source_cutoff` uses the operator's current UTC clock and limits discovery to facts created before that time. Reads are separate REST requests, not a database snapshot. Deterministic paging assumes append-only facts and an accurate operator clock; concurrent/backdated inserts can shift a page. Repeated runs recover eventual gaps. There is no cross-process lock. RPC idempotency handles profile races; duplicate concurrent scoring recomputes are possible, so avoid overlapping operational runs.

Freshness uses the required timestamp criterion. A late-arriving fact with an event time no newer than the stored `last_event_at` may not be detected as a scoring gap. This PR does not change that score contract, introduce a watermark, or claim a full consistency proof.

## Rollback and validation

Stopping operation means stopping the command and removing write flags. A rollback does not mean deleting `ads_events`, resetting Buyer Profile, or rebuilding all history. Completed calls are ordinary existing projection operations; any disputed derived result needs separate investigation using its source facts and established business rules.

Run new tests with `node --test projection-reconciliation.test.js projection-reconciliation-postgres.test.js`. PostgreSQL tests require a disposable local cluster; set `RECONCILE_TEST_PSQL` if `psql` is not on PATH. Defaults are localhost port 55433, user `postgres` with local test database creation permission. Tests create/drop their own local database and run the repository's actual apply/recompute RPC SQL. A test-only query adapter maps the script's REST reads to SQL; this verifies actual RPC/idempotency behavior, not a deployed PostgREST integration. No Production connection or historical backfill is required.

Before any eventual operational use, validate read-only reports against independently inspected gaps in the chosen environment, approve the bounded count, then explicitly authorize the corresponding apply. Production recovery is outside this PR's execution.
