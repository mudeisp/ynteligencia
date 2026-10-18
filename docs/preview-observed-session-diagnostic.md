# Preview-only observed session reader diagnostic

Private manual GET:

```text
https://<immutable-preview-host>/api/ads?action=observed-session-reader-diagnostic&coverage_start=<UTC ISO>&as_of=<UTC ISO>
```

The deployed default invokes the unchanged
`readObservedSessionReturnProjection({ coverage_start, as_of })` once. It does not
query storage itself, copy pagination or modify the original projection. The
reader retains its receipt-time cursor, two scans, final count and limitations.
No scheduler, persistence, writer/sender/executor, env or schema change is added.
The fixed action selects this handler in the existing dispatcher; it is removed
before input validation/reader invocation. No new Vercel Function is introduced.

## Private perimeter and environment

Preserves existing Vercel protection settings and adds mandatory server-side
Bearer authorization through the unchanged `authorizedMiaRead` helper. This
reuses `MIA_READ_TOKEN` and its existing previous-token compatibility; no secret
or env is created or changed. Never put tokens in URLs, logs, browser source or
reports. Missing/wrong credentials (including missing configured tokens) return
HTTP 401/AUTH_REQUIRED before input handling or reader execution.

An unauthenticated negative probe of the first Preview reached INVALID_INPUT;
therefore Vercel Authentication alone was not an effective perimeter for this
path. The operator explicitly authorized reuse of MIA_READ_TOKEN as an additional
barrier. Host checks are not authentication. Do not use the superseded Preview;
verify the final PR head denies unauthenticated requests before attempting a
real read. Management API access returned 403; protection settings were not
changed or independently reverified.

The handler independently requires all of:

- `VERCEL_ENV === preview` and `VERCEL === 1`;
- if present, `VERCEL_TARGET_ENV === preview`;
- `VERCEL_URL` is a single HTTPS deployment hostname under `vercel.app`;
- actual Host header exactly equals that immutable deployment hostname;
- the request URL, when absolute, has the same HTTPS host and no userinfo.

Production, local/dev, custom domains, branch aliases, mismatched/missing hosts,
ports and forwarded-host substitution return 404 **before reader invocation**.
Do not use a branch alias or Production/custom domain for operational testing.
No CORS is enabled, and browser/CDN caching is disabled for all responses.

## Input and response

Accept exactly `coverage_start` and `as_of` as diagnostic data, in addition to the
fixed routing action above; no auth query token or arbitrary
keys. Reject duplicates, arrays, conflicting URL/query values, invalid UTC dates,
future as_of, reversed/empty windows and windows over **24 hours**, before reader
execution. Supports UTC Z/+00:00 and up to six fractional digits, preserving the
reader's microsecond semantics. GET only; other methods return 405 in Preview.

Only `{status, coverage, projection}` is returned. Successful projection output
has a strict scalar allowlist of the existing aggregate fields and constants.
The caller verifies both partitions, zero new visitors and non-authority:

```text
sessions_observed = sessions_ended_by_inactivity + sessions_active
                  + sessions_unknown + sessions_ambiguous
visitors_observed = returning_visitors_observed + new_visitors_observed
                  + visitors_unknown + visitors_ambiguous
new_visitors_observed = 0
authority = not_authoritative
```

Unexpected projection fields, inconsistent counters or changed authority fail
closed. Coverage is reconstructed from validated dates and fixed safe markers;
arbitrary fields from reader responses are never forwarded.

HTTP 200/status OK returns the sanitized original aggregate. READ_FAILED,
INCOMPLETE and other known reader failures return HTTP 502 with preserved safe
status, unverified/incomplete coverage and projection:null. Exceptions or malformed
successes become READ_FAILED; no raw error, stack, env or storage body is returned.
Invalid input is HTTP 400; denied environment/host is HTTP 404. Authorization
is checked after the environment/host guard, before method/input handling.

No individual IDs, raw events, PII, click IDs, Supabase URLs/keys, Authorization
headers or arbitrary configuration are returned or logged. The factory export
is a unit-test dependency seam; deployed HTTP requests cannot select dependencies.

## Manual operational validation

1. Verify the PR's automatic deployment is Preview/READY and matches its head SHA.
2. Open the **immutable** Preview host using an existing authorized Vercel session.
   A login/protection response is not an application result. Do not weaken auth.
   Use a trusted server-side client with the existing MIA_READ_TOKEN supplied as
   a Bearer header in memory; do not paste secrets into the browser or query.
   First confirm an unauthenticated request returns 401 without invoking the reader.
   If a safe authenticated caller is unavailable, stop and report BLOCKED — AUTH.
3. Choose as_of at least ten minutes in the past (prefer fifteen); request one
   hour of receipt coverage ending at that cutoff.
4. Only after status OK, request six hours, then 24 hours ending at the same as_of.
5. Capture only the returned sanitized aggregates. Check every lifecycle and
   recurrence counter, both partitions above, zero new visitors and non-authority.
6. If access/read fails, report the stage and safe failure status. Do not label
   unknown evidence as zero or substitute a SQL aggregate for the real reader.

Do not persist the operational result or add a caller elsewhere. No manual deploy
or Production request is needed. `snapshot: not_guaranteed` remains explicit:
independent reads cannot prevent commits after the final check. The five-column
reader also cannot inspect metadata-only test flags; it does not certify humans.

`observed-session-return.js`, `observed-session-return-reader.js`, public
audience-persistence/1 and transport, tracking/attribution, Buyer Profile,
M.I.A./evaluator, schema and envs remain unchanged.
