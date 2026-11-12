-- Órulo V5: fail-closed registry, tested on disposable PostgreSQL.
-- NOT a production migration. No function here can update public.properties.
begin;
create schema if not exists orulo_audit;
create table if not exists orulo_audit.v5_manifests (
 manifest_hash text primary key check (manifest_hash ~ '^[a-f0-9]{64}$'),
 protocol text not null check (protocol = 'orulo-v5-cas-preflight-v1'),
 state text not null check (state in ('SP','ES','SC','RS','RJ','PR','PE','PB')),
 batch_id text not null unique check (length(batch_id) between 1 and 200),
 report_hashes text[] not null check (
   cardinality(report_hashes) between 1 and 250
   and array_position(report_hashes,null) is null
 ),
 targets jsonb not null check (jsonb_typeof(targets) = 'array' and jsonb_array_length(targets) between 1 and 10),
 github_run_id bigint not null check (github_run_id > 0),
 approved_commit_sha text not null check (approved_commit_sha ~ '^[a-f0-9]{40}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 approved_at timestamptz,
 approved_by text,
 check (expires_at > created_at),
 check ((approved_at is null) = (approved_by is null)),
 check (approved_at is null or approved_at <= expires_at)
);
alter table orulo_audit.v5_manifests enable row level security;
revoke all on orulo_audit.v5_manifests from public;
do $guard$
begin
 if exists(select 1 from pg_roles where rolname='anon') then
   execute 'revoke all on orulo_audit.v5_manifests from anon';
 end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then
   execute 'revoke all on orulo_audit.v5_manifests from authenticated';
 end if;
 if exists(select 1 from pg_roles where rolname='service_role') then
   execute 'revoke all on orulo_audit.v5_manifests from service_role';
 end if;
end $guard$;
comment on table orulo_audit.v5_manifests is
 'Staging-only registry. NOT an authorization or CAS endpoint.';
commit;
