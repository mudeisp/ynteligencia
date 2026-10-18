# Preview-only observed session reader diagnostic

Private manual GET:

```text
https://<immutable-preview-host>/api/diagnostics/observed-session-reader?coverage_start=<UTC ISO>&as_of=<UTC ISO>
```

The deployed default invokes the unchanged
`readObservedSessionReturnProjection({ coverage_start, as_of })` once. It does not
query storage itself, copy pagination or modify the original projection. The
reader retains its receipt-time cursor, two scans, final count and limitations.
No scheduler, persistence, writer/sender/executor, env or schema change is added.

## Private perimeter and environment

Reuses the existing project Vercel Authentication required by the operator. Host
checks alone are not authentication: keep Preview protection enabled and do not
serve this through an unprotected proxy. This PR does not add a secret, weaken
protection or change settings. Management API access currently returns 403, so
the existing protection configuration must not be described as independently
reverified by that API during implementation.

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

Accept exactly `coverage_start` and `as_of`; no auth query token or arbitrary
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
Invalid input is HTTP 400; denied environment/host is HTTP 404.

No individual IDs, raw events, PII, click IDs, Supabase URLs/keys, Authorization
headers or arbitrary configuration are returned or logged. The factory export
is a unit-test dependency seam; deployed HTTP requests cannot select dependencies.

## Manual operational validation

1. Verify the PR's automatic deployment is Preview/READY and matches its head SHA.
2. Open the **immutable** Preview host using an existing authorized Vercel session.
   A login/protection response is not an application result. Do not weaken auth.
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
