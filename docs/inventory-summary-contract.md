# Inventory Summary Contract for M.I.A

## Audit and scope

Producer: `mudeisp/ynteligencia`, based on main
`808728b2c58ceb10eaa51a9d09099d34b64935a9`.
Consumer audited at `mudeisp/media-intelligence-agent` main
`71ac7f2` (Inventory Opportunity Intelligence already merged).
Contract matches its `domain.ts`, `inventory-source.ts`, `neighborhoods.ts` and
`destination.ts` exactly: **UP_TO_500K / UP_TO_1M / UP_TO_2M**, not the conceptual
`500k` spelling. There are 63 approved canonical neighborhoods, minimum bedrooms
1–5, and cumulative price ceilings 500000 / 1000000 / 2000000 BRL.

Supabase schema was inspected read-only using table metadata on 2026-10-15.
`public.properties` has RLS enabled and these actual columns used by the query:

| Column | Actual type / constraint | Use |
| --- | --- | --- |
| id | uuid PRIMARY KEY, default gen_random_uuid() | one catalog record per row |
| external_id | text UNIQUE, nullable | source-of-truth upsert identity; not returned |
| source | text, nullable | exactly novos or usados |
| neighborhood | text, nullable | canonical matching |
| city / state | text, nullable | exactly São Paulo / SP |
| price | numeric, nullable | positive finite price within each cap |
| bedrooms | integer, nullable | >= requested minimum |
| active | boolean, nullable | IS TRUE only |

No type, purpose, unit stock or other nonexistent field is inferred. `title`,
`raw_data`, listing URLs, photos, coordinates and behavioral tables are not read.
New records are stored by the existing Órulo sync with `source=novos`; the Nonstop
webhook stores `source=usados`. No inference from title, external_id prefix or
vendor name. The existing app reads this table for both sources; its CSV branch
remains disabled. MATCH, filters, inventory sync, UX and leads are unchanged.

## Endpoint and authentication

**GET https://app.yincorp.com.br/api/search-properties?action=inventory-summary**

This is a dedicated authenticated operation on the existing deployed search
function. There are already 12 files in `/api`; this PR adds none. It deliberately
does not add `/api/inventory-summary`, a rewrite, a new Serverless Function or a
new deployment configuration. All existing POST search behavior remains intact
except that the newly reserved `action=inventory-summary` always routes to the
summary handler and rejects non-GET methods instead of falling through to search.

Authorization: `Authorization: Bearer <MIA_READ_TOKEN>`, server-to-server only.
Reuses `authorizedMiaRead` unchanged, including `MIA_READ_TOKEN_PREVIOUS` rotation
and constant-time comparison. A current MIA_READ_TOKEN must be configured, as with
the existing mia-read route. Query-string tokens and ADS_EXPORT_TOKEN do not grant
access. No new token, identity, Supabase credential or browser secret is created.

The existing Supabase service key configuration is used server-side:
`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`, plus `SUPABASE_URL`.
There is no anon/publishable-key fallback. The function is not callable by anon or
authenticated roles. No CORS permission for browsers is added. Every response uses
`Cache-Control: private, no-store`, `Vary: Authorization`, and `nosniff`.

Example for a trusted server (do not place the token in frontend code or a URL):

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $MIA_READ_TOKEN" \
  'https://app.yincorp.com.br/api/search-properties?action=inventory-summary'
```

The M.I.A InventorySource implementation can GET this URL with its existing server
MIA read token, validate the JSON using its existing validator, and propagate
failure as source unavailable. **M.I.A is not changed or connected by this PR.**

## Database aggregation and completeness

`supabase/inventory_summary.sql` defines only
`public.mia_inventory_summary_v1() RETURNS jsonb`. It is a parameterless **STABLE,
SECURITY INVOKER** SQL function with an explicit `pg_catalog` search_path and a
fully qualified `public.properties` reference. EXECUTE is revoked from PUBLIC,
anon and authenticated, and granted only to service_role when present. Existing
properties SELECT rights and RLS are not changed. No table, view, index, policy,
extension, inventory update, queue or cache is created.

The server makes one read-only GET to Supabase's existing RPC mechanism:
`/rest/v1/rpc/mia_inventory_summary_v1`. No row pagination or raw catalog crosses
into the app/M.I.A. The aggregation executes in one SQL statement/snapshot; a
statement error cannot return a successful partial result. The HTTP wait has a
15-second abort limit; a database error, missing RPC, permission error, malformed
JSON or timeout never falls back to partial totals or sample stock.

Within the contract scope, eligibility is `active IS TRUE`, positive price <=2m,
city São Paulo/state SP, source exactly novos/usados, a recognized neighborhood
and bedrooms >=1. Null/zero/negative/NaN/infinite prices, unknown source/place,
missing bedrooms and out-of-scope locations are not counted. This is completeness
for the explicit contract scope, not a claim to represent all cities or all price
levels in properties. Neighborhood matching uses lower/trim/whitespace and Unicode
NFD accent normalization against the fixed canonical catalog, without fuzzy or
Brooklin-family expansion. Free-form source labels are never returned.

Each eligible record participates in every matching minimum-bedroom/price-ceiling
segment. Counts mean **catalog entries, not physical units**. The groups overlap:
never sum them as a global inventory total. New/used counts use source directly;
`available_properties = new_count + used_count` for every group. Group count is
bounded by 63 × 5 × 3 = 945 (within the M.I.A validator's 1000 limit). Only nonempty
groups are emitted. Empty complete inventory returns `groups: []`.

The real table's PRIMARY KEY/UNIQUE constraints define duplication. A repeated id
or non-null external_id is rejected by PostgreSQL, not counted twice. Two different
legitimate records with different IDs remain two entries, even if other attributes
match; the summary does not invent cross-provider entity deduplication.

The Node boundary validates the entire envelope and every count/label/group,
rejecting duplicate/inconsistent groups or `complete != true`. It projects an
explicit field allowlist, strips all extra fields, and generates approved URLs;
it never spreads raw RPC objects. No response pagination exposes partial groups.
No raw error body is logged or returned.

## Contract and destinations

Success body is the summary itself (no success/data wrapper):

```json
{
  "schema_version": "ynt-inventory-summary/1",
  "generated_at": "2026-10-15T10:25:23.735Z",
  "city": "São Paulo",
  "state": "SP",
  "counting_unit": "active_priced_catalog_entries",
  "complete": true,
  "groups": []
}
```

This illustrates the empty shape; it is not a claim that the real inventory was
empty. `generated_at` is the SQL statement timestamp, UTC with milliseconds.
Ordering of groups is deterministic for unchanged inventory; the timestamp changes.

**Real sanitized aggregate evidence:** a read-only SELECT of the new aggregation
against the existing source on **2026-10-15T10:25:23.735Z** produced **532 groups**.
This was not an RPC installation, deployment or authenticated live endpoint test.
One actual group, shown as an excerpt only (not a complete response), was:

```json
{
  "neighborhood": "Pinheiros",
  "bedrooms_min": 1,
  "price_band": "UP_TO_500K",
  "available_properties": 59,
  "new_count": 49,
  "used_count": 10,
  "destination_url": "https://app.yincorp.com.br/?modo=explorar&cidade=S%C3%A3o+Paulo&estado=SP&bairro=Pinheiros&dormitorios=1&valor_max=500000&source=todos"
}
```

The destination is generated server-side, not read from a listing or user input.
Only `https://app.yincorp.com.br/` and the exact audited catalog keys are used:
modo=explorar, cidade=São Paulo, estado=SP, bairro=canonical label,
dormitorios=minimum, valor_max=cap, source=todos. No arbitrary URL/host/query is
accepted. This follows the consumer's existing deterministic destination function.

## Status codes and installation dependency

| Status | Meaning |
| --- | --- |
| 200 | complete validated aggregate; empty groups is valid |
| 401 | missing/invalid Bearer token |
| 405 | non-GET summary request; Allow: GET |
| 502 | database replied successfully but summary is incomplete/malformed |
| 503 | missing configuration, RPC absent, database/permission/network/timeout failure |

Errors are `{ "success": false, "error": "<fixed_code>" }`, without `complete`,
groups, raw database responses, credentials, individual IDs or PII. Fixed codes:
unauthorized, method_not_allowed, invalid_inventory_summary,
inventory_summary_unavailable. No partial success response exists.

**The SQL installation script is provided for review and was NOT applied to
Production.** After approval, a database owner must apply it manually, confirm
service_role has its existing SELECT on properties and the RPC is exposed in the
Data API/schema cache, then verify the authenticated endpoint. If the RPC is not
installed, the route safely returns 503. The script is repeatable and changes no
inventory data. Do not merge/deploy/apply automatically as part of this PR.

## Verification

All root `*.test.js` tests run with Node's test runner and real local PostgreSQL.
New tests cover scope/eligibility, normalization, bedrooms/caps, source counts,
duplicate constraints, empty inventory, safe projection/URLs, full failure,
authentication/rotation, ACL/RLS, repeat installation and actual local HTTP 200/401
with the real local SQL aggregate. The endpoint's database transport is bridged to
the local fixture only in that test; no production credentials are used.

This repository has no package.json, lint script, build script, dependency manifest
or framework compilation step. `npm run lint`/`npm run build` therefore return
ENOENT. Additional checks use Node syntax validation for all JavaScript and ESLint
(no-undef/no-unused-vars) for new modules/tests with temporary tooling outside the
repository. No package/lockfile/tooling config or runtime dependency is added.
