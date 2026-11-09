-- Órulo V5: isolated, fail-closed manifest registry (DRAFT, staging only).
-- Does not change the legacy CAS path or grant any production write capability.
-- A separate reviewed migration must implement V5 authorization and CAS.
begin;
create table if not exists orulo_audit.v5_manifests (
 manifest_hash text primary key check (manifest_hash ~ '^[a-f0-9]{64}$'),
 protocol text not null check (protocol = 'orulo-v5-cas-preflight-v1'),
 state text not null check (state in ('SP','ES','SC','RS','RJ','PR','PE','PB')),
 batch_id text not null unique,
 report_hashes text[] not null check (cardinality(report_hashes) between 1 and 250),
 targets jsonb not null check (jsonb_typeof(targets) = 'array' and jsonb_array_length(targets) between 1 and 10),
 github_run_id bigint not null check (github_run_id > 0),
 approved_commit_sha text not null check (approved_commit_sha ~ '^[a-f0-9]{40}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 approved_at timestamptz,
 approved_by text,
 check (expires_at > created_at),
 check ((approved_at is null) = (approved_by is null))
);
-- Defense in depth: schema is private, tables are not accessible from Data API roles.
alter table orulo_audit.v5_manifests enable row level security;
revoke all on orulo_audit.v5_manifests from public, anon, authenticated, service_role;
-- No INSERT/UPDATE/DELETE policies or GRANTs; a separately audited owner-only
-- registration function must be reviewed before records can be registered.
comment on table orulo_audit.v5_manifests is
 'V5 manifest staging registry only; this table does not authorize CAS or writes';
commit;
