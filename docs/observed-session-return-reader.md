# Receipt-time reader for observed session projection

Internal server-side API:

```js
import { readObservedSessionReturnProjection } from './observed-session-return-reader.js';
const report = await readObservedSessionReturnProjection({
  coverage_start: '2026-10-13T00:00:00.000000Z',
  as_of: '2026-10-14T00:00:00.000000Z'
});
```

No caller, endpoint, browser access, cron, persistence or runtime hook is added.
Loading the module does not initiate reads. It reuses the existing server-side
`ads-store.rest` GET/auth adapter, without modifying it or the public transport.
No new dependency or env setting is introduced. This PR needs no Production access.

## Scope and limits

- Exactly two input keys, valid ISO UTC timestamps (Z/+00:00, 0–6 fractional
  digits), `coverage_start < as_of`, nonfuture `as_of`, maximum seven days.
- Receipt coverage is **inclusive**: `created_at >= coverage_start AND
  created_at <= as_of`. `created_at` is persistence/receipt evidence.
- Select exactly `event_id,visitor_id,session_id,event_time,created_at`.
  No raw primary ID, metadata, attribution, click fields or PII columns.
- `event_time` is only evidence for the unchanged projection. Events whose
  occurrence predates the window but whose receipt is in it remain included.
- Page size 200; maximum 20,000 rows, 200 pages per pass, shared 20-second
  timeout for reads/verification. Server-capped short pages are followed while
  the exact remaining count says more rows exist. Exhaustion fails closed.
- Browser invocation or missing server configuration fails before a storage read.
  There is no public endpoint or browser authentication feature.

## Stable pagination and verification

The existing schema makes `event_id` unique/non-null and `created_at` non-null
(`supabase/ads_events.sql`). No schema/index change is needed for the cursor.
Queries order by `created_at ASC, event_id ASC`. Subsequent pages use:

```text
created_at > last_created_at
OR (created_at = last_created_at AND event_id > last_event_id)
```

The receipt bounds remain on **every** request. Filter values are quoted and
escaped for PostgREST, then URL-encoded once. Timestamp comparisons retain six
fractional digits with integer microseconds; timestamps sharing a millisecond
are not collapsed. There is no offset or timestamp-only cursor.
See [PostgREST logical filters](https://docs.postgrest.org/en/stable/references/api/tables_views.html#logical-operators).

Every page requires `Prefer: count=exact`, successful HTTP 200/206, a valid
Content-Range, correct page start/end, and valid rows with exactly the selected
fields. Since the cursor filters each query, its count is the **remaining suffix**:
`rows_already_read + remaining_count` must equal the first exact total.
Repeated IDs, nonprogress, descending keys, invalid timestamps, out-of-scope
receipts and count/range inconsistencies fail closed.

The local equal-timestamp order check is conservative lexicographic ordering.
If database collation produces incompatible event-ID order, the reader returns
INCOMPLETE rather than accepting ambiguous traversal. Unusual legacy IDs/order
may therefore need a separately reviewed compatibility adjustment.

Before calling the projection:

1. Read all pages to the exact total.
2. Repeat the complete keyset scan; require identical selected rows and totals.
3. Recheck the **full-window** exact count (GET limit=1, no cursor), including the
   first row. This catches count changes behind the second pass's cursor.
4. Check the shared timeout, then call `projectObservedSessionReturn` **once**
   with `source: ads_events`, `complete: true`, validated bounds and selected rows.

No failed/incomplete read invokes the projection with complete=true, and no
partial row list or partial aggregate is returned.

## Consistency is observed, not a transaction snapshot

`as_of` fixes the upper receipt boundary, not a database snapshot. Two matching
scans plus a final global count are conservative consistency checks. They cannot
prevent an insert/update/delete committing after the final check, or guarantee
detection of all coordinated same-count mutations between independent requests.
An already-open transaction can commit a row with `created_at <= as_of` later.
The reader adds no lock or write and cannot eliminate that race.

Successful coverage therefore reports `consistency: two_matching_scans` and
`snapshot: not_guaranteed`. Its `complete: true` means the bounded traversal and
verification protocol succeeded, not transactional/lifetime authority. A future
authority consumer must not promote this result without a stronger reviewed
cutoff/snapshot policy. The existing public audience transport filters
`event_time`; it is deliberately not reused as receipt-time coverage.

## Output and failure modes

Only `{status, coverage, projection}` is returned. Coverage contains validated
UTC bounds, completion/consistency markers and the snapshot limitation.
Projection is the original internal aggregate, still `authority: not_authoritative`.

| Status | Meaning | Projection |
| --- | --- | --- |
| OK | Both complete scans and final total agree | Sanitized aggregate; empty window gives real zero |
| INVALID_INPUT | Invalid bounds, future/oversized window or unexpected keys | null; no read |
| READ_FAILED | Missing config, browser context, HTTP/network failure or timeout | null |
| LIMIT_EXCEEDED | Exact row count exceeds the cap | null |
| INVALID_STORAGE | Invalid data/identities/timestamps or projection rejection | null |
| INCOMPLETE | Missing counts, truncation, inconsistent traversal, changed evidence or page exhaustion | null |

No identifier, event, PII, URL, secret, authorization header, storage error/body,
stack trace or env value is returned/logged. No retries synthesize empty data.
The only network method is GET; no mutation helper is called.

The five-column allowlist excludes `metadata.test`. Known synthetic UUID/text
markers remain available to the projection, but metadata-only test labels cannot
be inspected by this reader. Neither this omission nor a clean heuristic result
certifies humans. Session end and return remain non-authoritative; no client
return claim is adopted and no new identity is inferred.

`audience-persistence/1`, its transport, M.I.A., evaluator, tracking, attribution,
Buyer Profile, schemas and existing data remain unchanged. No backfill,
deployment/configuration changes, send/write/execution or automatic run is added.

## Validation

`node --test observed-session-return-reader.test.js observed-session-return.test.js`
uses fake HTTP storage with the real GET adapter and original projection; no
real Supabase request. Cases include receipt bounds, equal timestamps, microseconds,
quoted cursors, delayed events, capped pages, mutation races, malformed/truncated
storage, timeout, privacy and no projection after failed completeness checks.
Also run existing Audience Persistence, Ads, MIA read, Quality and reconciliation
tests, syntax/diff checks and compare full-suite failures with the base.
This repository has no package.json, TypeScript config, lint or build script.
