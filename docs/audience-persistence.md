# Audience Persistence V1

Contract: `audience-persistence/1`. Producer authority: **YNTELIGENCIA / Ads
Intelligence Layer**. Consumer: M.I.A. `reengagement-eligibility/1`,
[PR #79](https://github.com/mudeisp/media-intelligence-agent/pull/79).
The producer does not decide eligibility. There is no `eligible` field.

## Audit before implementation

Audited main: `8efd1b62ed01411d498657e61137047d0ecafe29`. Repository evidence,
not a Production database inspection:

| Subject | Existing source | Authority / limit |
| --- | --- | --- |
| Visitor identity | `index.html`: `getYnteligenciaVisitorId`, `YNTELIGENCIA_VISITOR_ID`; `ads-intelligence.js`: `normalizeEvent`, `validVisitorId` | Browser UUID, validated by Ads; not a person count or cross-device identity. |
| Session identity | `index.html`: `resolveYnteligenciaSession`, `YNT_SESSION_TIMEOUT_MS`; `ads-intelligence.js`: `normalizeEvent` | Existing client session reuse/rotation after 30 minutes inactivity. Not proof of a server-authoritative session end. |
| Persisted visitors and timestamps | `supabase/ads_events.sql`: `ads_visitors`; `ads-intelligence.js`: `touchPatch` | `first_seen`, `last_seen` reflect ingested activity, not departure/return certification. |
| Persisted event identity | `supabase/ads_events.sql`: `ads_events` | Unique `event_id`, `visitor_id`, `session_id`; source used by this projection. |
| Persisted session observation | `supabase/buyer_profiles.sql`: `buyer_profile_sessions`, `apply_buyer_profile_event` | Primary key `(visitor_id, session_id)`; first event/time, no ended state. This projection uses the same pair counting unit directly from Ads events, without depending on projection reconciliation. |
| Existing behavior aggregation | `ads-intelligence.js`: `observedIntentFromViews`; `quality-scoring.js`: `scoreVisitor`; `supabase/buyer_profiles.sql`: `apply_buyer_profile_event` | Intent, recurrence/scoring and profile session totals already exist. None establishes authoritative return. No recomputation or threshold changes here. |
| Client return signal | `index.html`: `resolveYnteligenciaSession`, `scheduleYnteligenciaSessionStart`, `supabaseTrack` | `is_returning = session_number > 1`; `session_start` goes to `events`, with client metadata. Not adopted. |
| Alternate behavior ingress | `api/event.js`: `behavior_events` payload | Stores session/event data and attribution; no canonical session-ended or return validation. Not imported or used as an additional count source. |
| Existing read-model | `mia-read.js`, `ads-routes.js`: `handleAdsMiaRead` | `mia-ads-read/1` is paginated, with `has_more`/`next_cursor`. A page is not a complete audience snapshot. It also contains individual identity/attribution and must not be forwarded as this contract. |

No canonical server-side session-end, return or new-vs-returning authority was
found in these paths. Existing client timeout semantics remain unchanged.
Multiple sessions, elapsed time, first/last timestamps, repeated property views,
event volume and client flags do not promote return authority.

## Pure adapter and evidence boundary

`audience-persistence.js` exports `projectAudiencePersistence(input)` using the
existing CommonJS module style. No endpoint, database reads, persistence, clock,
environment access or wiring into tracking is added.

An internal server caller supplies a successful **complete persisted** slice:

```js
const { projectAudiencePersistence } = require('./audience-persistence.js');
const signal = projectAudiencePersistence({
  source: 'ads_events',
  complete: true,
  events: persistedRows
});
```

The caller must define one observation scope (for example an explicit time
window), finish all read pages, and supply only persisted Ads event rows.
`complete: true` is a trusted internal precondition, not an authentication claim.
Never accept it from a public request or synthesize an empty array after a failed
read. The adapter cannot independently prove provenance/completeness.
The YNT-only transport below enforces this precondition and retains the period
in its server-side request. M.I.A. runtime consumption is not wired here.

Counts are observations **inside that slice**, not lifetime registry totals or
all site traffic. Rows outside Ads ingestion, missing historical events, browser
identity resets and alternate-product sessions limit coverage. No filtering of
synthetic rows, lead requirement or new audience policy is introduced.

Only `event_id`, `visitor_id`, `session_id` are read. Visitor IDs use the existing
Ads UUID grammar; UUID case is canonicalized. Session IDs retain their exact
value and the existing 120-character limit; event IDs must be nonempty strings
up to 512 characters. Surrounding whitespace/control-character identifiers are rejected.
Legacy/out-of-contract evidence fails closed rather than being silently dropped.
Sessions count distinct **visitor/session pairs**, not global session strings.
Repeated event delivery does not inflate counts; a repeated event ID with a
different identity invalidates the entire slice. Malformed rows similarly return
no partial counts.

## Output fields

| Field | Meaning |
| --- | --- |
| `version` | Always `audience-persistence/1`. |
| `status` | `observed` for a complete valid slice; `unknown` for absent/incomplete evidence; `invalid` for inconsistent/malformed supplied rows. |
| `visitors_observed` | Distinct visitor UUIDs in the slice, or null. |
| `sessions_observed` | Distinct visitor/session pairs in the slice, or null. |
| `visitors_with_multiple_sessions` | Visitors with more than one observed pair in the slice, or null. Not authoritative return. |
| `sample_size` | Same observed visitor base as `visitors_observed`, or null; not number of events. |
| `session_end_authority` | Always `UNRESOLVED`. |
| `return_status` | `unresolved` for valid observations (including empty); `unknown` without valid evidence. |
| `new_vs_returning` | Always `unknown`. |
| `client_is_returning_adopted` | Always false. |

**Zero vs unknown:** a complete, successfully read empty array gives `observed`
and four zero counts. Missing/null data, wrong source or incomplete reads give
`unknown` and four null counts. Malformed complete data gives `invalid` and four
null counts. Null is never converted into zero.

## Privacy and execution boundary

Output is constructed from a fixed allowlist of aggregate counts and constant
states. No row, identifier, arbitrary field or nested input object is copied.
Visitor/session/event/lead IDs, raw or hashed click IDs (including fbclid), PII,
contact data, URL/referrer, conversation, property history, behavioral payloads,
fingerprint, IP and user agent remain outside the output.

Runtime imports were inspected: the module has **zero imports/requires** and no
transitive runtime graph, including no M.I.A., Google Ads, CRM, notification,
executor or mutation helper. Tests intercept actual module loading in a fresh
process and prohibit network globals while exercising observed/unknown/invalid
paths. No-send, no-write, no-execution. No schema/RLS/ACL change, SQL, cron,
worker, backfill or Production access is involved.

The consumer remains responsible for its fail-closed evaluation. This signal
does not calibrate thresholds, establish session completion, authorize return,
infer a visit from a lead, enable execution or change the Intelligence Readiness
Report. Compatibility is with the version/status/visitor-count interface in
M.I.A. PR #79, audited at `45096b90a123d748a15ddb6d92de1def976dc825`;
there is no import or circular dependency between repositories.

## Validation

`node --test audience-persistence.test.js` covers missing/incomplete/invalid data,
real zero, deduplication, pair counting, unresolved authorities, ignored client
flags/timestamps, deterministic immutable projection, output privacy allowlist
and actual isolated runtime module loading. Related Ads, Buyer Profile, Quality
Score, M.I.A. read and reconciliation tests should also be run. This repository
has no package manifest, TypeScript configuration, lint or build command; report
those as unavailable rather than claiming they passed.

## Server-to-server transport

Transport audited against main `78fdb808a4a952756560eab9e48da34a29403bf5`
(which already includes the original producer). `projectAudiencePersistence` is
unchanged, including its original source blob and contract. Existing `mia-read`
authentication and period validation are reused, **not** its individual payload
or wide event column selection. `ads-store.rest` exposes `Content-Range` only
when explicitly requested; existing callers retain their previous return shape.

`GET /api/ads?action=audience-persistence&from=<ISO>&to=<ISO>` is an internal
server-to-server action inside the existing Ads function, not an additional
Serverless Function. Both bounds are required canonical UTC ISO strings with
milliseconds (for example `2026-10-13T00:00:00.000Z`); interval is `[from, to)`,
at most seven days, with `to` no later than request start. The period has no
implicit default. Unknown parameters, public cursors/page sizes, duplicate or
contradictory bounds, malformed/future/oversized periods fail closed.

### Authentication and response

Send only `Authorization: Bearer <MIA_READ_TOKEN>` from a trusted server.
The existing `MIA_READ_TOKEN_PREVIOUS` rotation path is accepted when the primary
token is configured. No query token, cookie, browser credential, public token or
`ADS_EXPORT_TOKEN` authenticates this action. No environment variables are added
or changed by this PR. Provisioning/rotation remains a separate operator action.
Reusing the existing token does not narrow that credential's access to the
legacy `mia-read` action; store it exclusively server-side.

Any `Origin`, `Sec-Fetch-Site`, `Sec-Fetch-Dest` or `Sec-Fetch-User` header is
rejected, including same-origin browser requests. `Sec-Fetch-Mode: cors` alone
is tolerated because Node's native server fetch sends it too; it does not replace
Bearer authentication. OPTIONS is rejected; no `applyCors` or Access-Control headers are used.
The route is network-addressable for trusted servers, but has no unauthenticated
browser access. Responses are `private, no-store` JSON with `nosniff`.

**Every response body**, including HTTP failures, is only the ten-field
`audience-persistence/1` object. No wrapper, error text, source page, ID, URL,
cursor, debug metadata or upstream exception is serialized. HTTP status conveys
failure; consumers must require HTTP 200 and `status: observed` to use counts.

### Pagination and completion protocol

1. Fix the validated period once. Read only `id,event_id,visitor_id,session_id,
   event_time` from `ads_events`, ordered by its physical UUID primary key `id`.
   Physical ID and event time are internal completeness evidence only.
2. Request pages of 200 with `Prefer: count=exact` and offset. Require a valid
   numeric `Content-Range` total on **every** response, with the exact start/end
   matching the returned array. A missing/wildcard count is not completeness.
3. Continue after server-capped short pages until accumulated rows equal that
   exact total. Require stable totals, strictly increasing physical IDs, valid
   in-period event times and no gap/overlap/non-progress. Only `*/0` plus an empty
   successful response establishes zero, never a failed read or truncated page.
4. Independently read the same complete period a second time. Require identical
   totals and identical ordered selected evidence, not just matching counts.
   Inserts, changed identities, reordered/overlapping pages or a failed verification
   invalidate the observation. No partial producer call occurs on these paths.
5. Only after both scans complete, call the original producer **once** with
   `source: ads_events`, `complete: true` and its three identity fields. Its
   existing validation/deduplication remains authoritative. No side effects.

The count/range behavior follows the official
[PostgREST pagination documentation](https://docs.postgrest.org/en/stable/references/api/pagination_count.html).
Exact counts, rather than planned/estimated counts, are mandatory.

### Failure modes and limits

| HTTP | Body / reason |
| --- | --- |
| 200 | Original producer's observed signal; valid empty data has real zeros. |
| 400 | Unknown/null counts: invalid or absent explicit period/query. |
| 401 / 403 | Unknown/null counts: failed Bearer authentication / browser headers. |
| 405 / 503 | Unknown/null counts: wrong method / missing server configuration. |
| 502 | Unknown/null counts: HTTP/network/storage error, absent count, bad range, changed data, page/time/row budget exhaustion. |
| 502 | Original producer's invalid/null-count signal after complete but inconsistent identity evidence. |

Both scans share a 20-second abort deadline. Each scan permits at most 20,000
rows and 200 pages. Exhaustion returns unknown, never a truncated aggregate;
callers can request a narrower period explicitly. There are no automatic retries,
timers that redirect users, writes, sends, workers or background execution.

This is a verified complete **read observation**, not a PostgreSQL repeatable-read
snapshot across HTTP requests. Two concordant scans detect observed drift but
cannot promise serializable history against arbitrary concurrent administrative
rewrites. Existing Ads runtime appends events; this PR neither locks the table
nor changes ingestion. If an application requires a transactional snapshot under
arbitrary rewrites, that requires a separately authorized database read interface;
do not interpret these counts as such a guarantee or new return authority.

`audience-persistence-transport.test.js` covers complete single/multiple/capped
pages, real zero, intermediate/verification failures, malformed/missing evidence,
changing totals/content, identity duplicates/conflicts, privacy, auth/CORS,
budgets, producer immutability and actual allowlisted runtime module resolution.
A loopback HTTP integration simulates persisted Ads rows through the real REST
adapter and API action to the original producer and final sanitized payload.
It performs GET only and does not access Production or a database.

Only the **YNT side** of transport is implemented. Runtime fetching/authenticated
delivery in M.I.A., scheduling and any downstream decisions are outside this PR.
NO WRITE / NO SEND / NO EXECUTION. No migration, Vercel environment change or
manual deployment is needed for the tests.
