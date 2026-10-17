# Internal session lifecycle and return observation

`observed-session-return.js` exports only `projectObservedSessionReturn(input)`.
This is an internal, pure, deterministic projection of existing persisted
`ads_events`, not an endpoint, database reader, job, CLI, runtime hook or authority.
It has no imports, environment access, clock, network, writes or sends. No current
caller is connected. No Production read or execution is needed for this PR.

## Evidence boundary

```js
const { projectObservedSessionReturn } = require('./observed-session-return.js');
const report = projectObservedSessionReturn({
  source: 'ads_events',
  complete: true,
  coverage_start: '2026-10-17T09:00:00.000Z',
  as_of: '2026-10-17T12:00:00.000Z',
  events: persistedRows
});
```

A future trusted internal reader must supply **all persisted rows received in
the inclusive interval `[coverage_start, as_of]`**, paginated to completion.
`complete` is a caller precondition, never a browser claim. This function cannot
prove database provenance, completeness or the absence of subsequent late writes.
Do not reuse the existing public audience transport's event-time slice as though
it were receipt-time coverage. No reader is added here.

Required row fields: `event_id`, `visitor_id`, `session_id`, `event_time`,
`created_at`. UTC timestamps support Z/+00:00 and up to six fractional digits;
microsecond precision is retained. At most 20,000 supplied rows are accepted.
Visitor IDs use the existing Ads UUID grammar and are case-normalized. Sessions
are counted as visitor/session pairs; event IDs deduplicate delivery. Conflicting
identity/timestamps for one event, malformed evidence or receipt times outside
coverage invalidate the entire projection. Missing/incomplete evidence gives null
counts, never a fabricated zero. Complete empty coverage gives zero counts.

## Temporal hypothesis, not calibration

- `created_at` is server receipt/persistence time, not client presence or departure.
- `event_time` is occurrence time accepted from callers, not a trusted server clock.
- Fixed hypothesis: 30-minute inactivity, plus a 5-minute lateness grace.
- `active_observed`: last receipt is less than 30 minutes before `as_of`.
- `unknown`: last receipt is 30 to less than 35 minutes old (settling interval).
- `ended_by_inactivity`: last receipt is at least 35 minutes old. This means no
  further activity was observed in the supplied complete window, not browser exit.
- Any synthetic marker, client time later than receipt, event-time regression in
  receipt order, receipt delay greater than five minutes or same-session gap of at
  least 30 minutes makes **all supplied sessions of that visitor ambiguous**.
  A session ID shared by different visitors also taints both identities.
- Distinct sessions are separable only when the later interval starts at least
  35 minutes after every earlier interval's last activity, in BOTH receipt and
  occurrence time. Otherwise the visitor and its sessions are ambiguous. This
  includes overlap, concurrent tabs, close adjacent IDs and stale-page activity.
- `overlapping_session_cases` counts later intervals conflicting with at least
  one earlier interval under this policy, not every possible pair combination.
- `delayed_event_cases`, `clock_inconsistent_cases`, `synthetic_event_cases`
  count unique events; `reused_session_gap_cases` counts suspicious adjacent gaps.
  An event may contribute to several diagnostic counters.

One continuous session with many events/reloads/tabs is not return. Two or more
separable sessions yield `return_observed` through
`returning_visitors_observed`. This is observed browser-identity recurrence only.
Ambiguous visitors are counted separately. A single clean session remains
`unknown`: no earlier row is not proof of identity birth.

`new_observed` is deliberately reserved: `new_visitors_observed` is zero for valid
complete input (null otherwise)
and `new_identity_evidence` is `unavailable`. Existing Ads rows do not establish
the creation of a visitor identity. Storage loss, another device/origin or identity
rotation must not manufacture new-person evidence or join separate visitors.
Multi-session counts are observations within coverage, never lifetime totals.

Known synthetic UUID motifs and explicit/textual test markers taint observations;
the conservative UUID motif policy mirrors reconciliation without importing its
operational client. These heuristics cannot certify remaining rows as real humans.
Client `is_returning`, first/current touch and arbitrary fields confer no authority.

## Aggregate report and compatibility

Output contains only the fixed internal version, validated UTC coverage bounds,
coverage status, non-authority
marker, policy constants, unavailable identity-birth marker and aggregate counters.
Session counters partition observed pairs; recurrence counters partition visitors.
No IDs, PII, URLs, click IDs, raw events or arbitrary input fields are returned.
`coverage_status=complete_window` means the input contract was satisfied, not
verified lifetime coverage or authoritative closure.

`audience-persistence/1` is untouched and still publishes UNRESOLVED/unresolved/
unknown. M.I.A., strict validation and eligibility are untouched. This module does
not emit either authoritative state or eligibility, and does not remove
`not_calibrated`. No migration, backfill, tracking/attribution change, reader,
deployment configuration or dependency is introduced.

Before publishing authority: validate receipt-time read completeness and stable
cutoff handling; approve and calibrate inactivity/lateness policy; establish
identity continuity and historical coverage; handle concurrent products/tabs and
late ingestion; review synthetic exclusions; define what identity birth can mean;
then version the aggregate contract and adapt its strict consumer separately.
Do not relabel these observations as authoritative by changing constants.

Validation: `node --test observed-session-return.test.js` and related existing
Audience Persistence, Ads, Buyer Profile, Quality Score and reconciliation tests.
The repository has no package.json, TypeScript config, lint or build script;
report these checks as unavailable. No dependencies are needed.
