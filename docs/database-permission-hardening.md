# Database permission hardening

## Scope and evidence

Permission-only PR based on main `df3ccbf87025f5cf78295274d22dd4fdc1278eeb`. No application code, business RPC, data, columns, indexes, RLS, policies or default privileges are changed. Nothing in this PR applies SQL automatically. Do not use `supabase db push` to apply this repository's historical SQL scripts.

No Production SQL was executed for this task. The exact observed client-role grants below come from the preceding read-only audit of project `wzaegidwtdjuhqchpdpd`, 2026-10-17 around 09:42 UTC (06:42 America/Sao_Paulo). They are a dated baseline, not a fresh certification. That snapshot did not capture creator default ACLs, grant provenance, all service_role ACLs or MAINTAIN. Run the supplied read-only preflight manually before any eventual application to verify them.

There is no evidence of an incident or demonstrated exploit through a public endpoint. PostgreSQL privileges and HTTP endpoint reachability are different questions.

## Probable origin

The entire reachable Git history was searched for GRANT ALL / ALTER DEFAULT PRIVILEGES in SQL. Neither appears in the historical installation scripts.
- `c023731` created ads_events/ads_visitors with RLS but without explicit REVOKEs.
- `8ecd3bc` created ads_handoffs with RLS but without explicit REVOKEs.
- Buyer Profile, quality scores and conversion export scripts subsequently revoke PUBLIC/client-role access explicitly.

The observed broad privileges on old tables are consistent with Supabase/project provisioning default ACLs or a historical manual GRANT ALL. **This is the probable source, not a confirmed actor or statement.** PostgreSQL table ACLs do not retain whether a grant came from defaults or a manual SQL statement. Current default ACLs plus grantor/owner are useful evidence but cannot reconstruct deleted historical SQL. PostgreSQL does not intrinsically grant PUBLIC access to every new table.

`scripts/database-permissions-preflight.sql` inspects current table ACLs (grantor, grantability, owner), global/public creator default ACLs, role memberships and effective privileges. This script was tested locally; it was not run in Production in this task. Default privileges are intentionally outside this bounded migration: changing them project-wide without confirming creator roles could affect unrelated future tables.

## Before: dated audit baseline

S=SELECT, I=INSERT, U=UPDATE, D=DELETE, T=TRUNCATE, R=REFERENCES, G=TRIGGER.

| Tables | anon | authenticated | PUBLIC |
|---|---|---|---|
| ads_events, ads_visitors, ads_handoffs | S I U D T R G | S I U D T R G | none observed |
| buyer_profiles, buyer_profile_events, buyer_profile_properties, buyer_profile_sessions | none | none | none observed |
| buyer_quality_scores, google_ads_conversion_exports | none | none | none observed |
| leads, events, behavior_events, properties | S I U D T R G | S I U D T R G | none observed |

RLS is enabled on all thirteen. No client policy exists on the nine internal tables. Existing legacy INSERT policies and active-property SELECT policy are preserved verbatim. Broad DML grants on the four legacy tables do not themselves override RLS.

The critical eight RPCs in the audit were SECURITY INVOKER with search_path=pg_catalog and execution ACLs for postgres/service_role. No function ACL or definition changes are required by this PR.

## Desired permissions after the migration

| Table | service_role runtime allowlist |
|---|---|
| ads_events | SELECT, INSERT |
| ads_visitors | SELECT, INSERT, UPDATE |
| ads_handoffs | SELECT, INSERT, UPDATE |
| buyer_profiles | SELECT, INSERT, UPDATE |
| buyer_profile_events | SELECT, INSERT |
| buyer_profile_properties | SELECT, INSERT, UPDATE |
| buyer_profile_sessions | SELECT, INSERT |
| buyer_quality_scores | SELECT, INSERT, UPDATE |
| google_ads_conversion_exports | SELECT, INSERT, UPDATE |
| leads | SELECT, INSERT |
| events | SELECT, INSERT |
| behavior_events | SELECT, INSERT |
| properties | SELECT, INSERT, UPDATE |

Rationale: Ads writes facts and reads them for attribution/RPCs; visitors are upserted; handoffs are inserted/read/marked consumed; profile RPCs insert ledgers, update property-view markers and upsert profiles; scoring and export RPCs upsert their own tables; lead lookup needs SELECT and lead creation INSERT; legacy events/behavior use read/append permissions; inventory sync uses upsert and deactivation UPDATE, not DELETE.

anon/authenticated:
- Nine internal tables: no SELECT/INSERT/UPDATE/DELETE or administrative privileges.
- Four legacy tables: existing direct DML is retained, with grant options removed. No new DML is granted. This avoids changing frontend events, lead ingestion, inventory or existing policies in this PR.
- All thirteen tables: no TRUNCATE/REFERENCES/TRIGGER, nor MAINTAIN on PostgreSQL 17+.

PUBLIC:
- No table privileges on the thirteen audited tables. No PUBLIC function access is added.

service_role:
- Only existing allowlisted DML is retained; unnecessary DELETE/UPDATE and administrative privileges/grant options are revoked.
- **No GRANT statement exists in the migration.** If a required permission is absent, it aborts rather than granting it.
- Role attributes (including BYPASSRLS), memberships and privileges on other objects remain untouched.
- Retention/cleanup or maintenance workflows outside this repository that depended on service_role DELETE/TRUNCATE must be reviewed before application. Use an approved administrative role for maintenance; this PR does not invent one.

The owner postgres retains ownership powers. This PR is about application roles, not removing the database administrator's powers.

## Migration behavior

File: `supabase/migrations/20261017101030_database_permission_hardening.sql`.
Generated with `supabase migration new database_permission_hardening` using CLI 2.81.3, installed outside repository dependencies.

Single transaction; lock_timeout=5s, statement_timeout=30s. Explicit REVOKE TRUNCATE/REFERENCES/TRIGGER and version-gated MAINTAIN. Role/table names are fixed allowlists, identifiers quoted. There is no CASCADE, GRANT, DML or business-function alteration.

All thirteen tables and all three application roles must already exist. Unexpected inherited administrative/client access, ownership, or missing service-role DML causes a complete rollback. Resolve unexpected ACL provenance separately; do not compensate by granting more access. Missing prerequisites also abort. Reapplication is idempotent.

No default ACL changes are made. A future newly created table can still inherit the project's defaults; future migrations must set an explicit ACL. Re-running older installation scripts can restore old service-role grants, so apply this migration after the reviewed baseline installation scripts.

RLS is not a substitute for this revocation: [PostgreSQL states TRUNCATE and REFERENCES are not subject to row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

## Local verification

PostgreSQL 17.11, genuine local server on 127.0.0.1:55432. No Docker/service/global PostgreSQL installation, no application dependency or lockfile changes.

```powershell
$env:PERMISSION_TEST_PSQL = 'C:\path\to\PostgreSQL\bin\psql.exe'
$env:PERMISSION_TEST_PORT = '55432'
node --test database-permission-hardening.test.js
```

Unix:
```sh
PERMISSION_TEST_PSQL=/path/to/psql PERMISSION_TEST_PORT=55432 node --test database-permission-hardening.test.js
```

Local postgres must permit login as postgres (trust or PGPASSWORD). The test pins host/port/user/database and strips inherited PG connection settings; remote hosts are rejected. It creates a disposable database and local fixture roles; never point it at a shared developer/production server. It drops the fixture database on completion. Roles are fixture-only and may remain in that local cluster until it is destroyed.

Results:
- 11/11 permission tests pass, including actual failed TRUNCATE by anon and authenticated for each table.
- Unrelated role demonstrates no access inherited from PUBLIC.
- Exact service-role allowlists; real RPCs record_ads_lead, apply_buyer_profile_event, get_buyer_profile, recompute_buyer_quality_score, claim/confirm/fail_google_lead_conversions and mia_inventory_summary_v1 all execute as service_role.
- RPC smoke writes occur only inside a rollback-only LOCAL transaction. The migration itself changes no rows.
- Snapshots compare every fixture row plus columns, indexes, constraints, policies, RLS, function definitions/ACLs/configs, triggers and default ACLs before/after.
- Repeat migration, inherited unsafe grant and missing required permission cases are covered, including atomic rollback of earlier REVOKEs.
- Preflight and post-migration queries execute locally.
- Existing suite excluding PostgreSQL-dependent cases: 203/206 pass. The identical three failures reproduce on clean main at the same SHA: “a YNTELIGENCIA reutiliza visitor e sessão e aceita property_id na URL”; “o formulário reutiliza /api/lead, sessão e visitante existentes”; “telemetria de lead não leva PII e o fluxo para se a API não confirma”. They are pre-existing source-assertion failures. No attempt to repair unrelated tests or UX in this PR.

Existing suite command (PowerShell):
```powershell
$files = @(Get-ChildItem *.test.js | Where-Object Name -NotIn @('buyer-profile.test.js','inventory-summary-postgres.test.js','database-permission-hardening.test.js') | ForEach-Object Name)
node --test --test-skip-pattern '^(o claim reserva|a identidade do lead é atômica|o Postgres repete)' @files
```

No claim that the full existing PostgreSQL suite was executed: the new local tests invoke all eight real RPC implementations under the restricted role. Legacy leads/events/behavior schemas are represented by minimal fixtures for ACL/data-preservation checks; this is not a full Supabase platform emulator.

## Exact manual validation before applying to Production

1. Review the PR and pin its commit SHA. Confirm main schema/RPC prerequisites and the runtime allowlists above, including any external maintenance job. This PR remains unapplied.
2. An authorized database administrator should run, **read-only**, `scripts/database-permissions-preflight.sql` and `scripts/database-permissions-report.sql` against the intended project. Save the outputs securely. Confirm project ref and inspect PUBLIC, inherited roles, grant options, owner and creator default ACLs. These manual queries are a future step, not queries executed by this agent.
3. Restore the reviewed schema in a disposable local PostgreSQL 17 environment, using synthetic data. Run the new test command above. Do not copy customer data into this test harness.
4. On a separate disposable staging copy with the actual ACLs, apply **only this file**, twice:
```sh
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f supabase/migrations/20261017101030_database_permission_hardening.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f supabase/migrations/20261017101030_database_permission_hardening.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f scripts/database-permissions-preflight.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f scripts/database-permissions-report.sql
```
5. Verify no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for application roles; no PUBLIC privileges; no client access on the internal nine; preserved legacy DML/policies; exact service-role allowlist. Re-run the eight RPC smoke tests using synthetic fixtures on staging, verify unchanged table data/schema and RLS around the migration.
6. If any requirement differs or application consumer needs an omitted permission, stop and review. Do not add broad GRANTs or SECURITY DEFINER. Do not test destructive operations on real Production tables.
7. Only after separate approval, schedule a DBA-controlled Production application of this one reviewed file with the same verification. No Production execution, deployment or merge is authorized/performed by this PR task.

The post-migration report outputs exactly `grantee, table_name, privilege_type`, including PUBLIC pseudo-role grants. It lists direct ACLs; preflight adds effective inherited privileges. Owner ACLs are excluded from the report to focus on application roles. A rollback is not “restore GRANT ALL”: use captured ACLs and a separately reviewed, narrowly scoped change if needed.
