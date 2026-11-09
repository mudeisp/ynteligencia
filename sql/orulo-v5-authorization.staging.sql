-- V5 staging-only authorization contract. This script cannot write public.properties.
-- Registry and approval remain distinct. Production requires verified GitHub
-- provenance, real audit-chain integration and a separately reviewed CAS RPC.
begin;
create table if not exists orulo_audit.v5_approvals (
  manifest_hash text primary key references orulo_audit.v5_manifests(manifest_hash),
  run_uuid uuid not null unique,
  approved_by text not null check (length(approved_by) between 3 and 200),
  approved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  github_run_id bigint not null check (github_run_id > 0),
  approved_commit_sha text not null check (approved_commit_sha ~ '^[a-f0-9]{40}$'),
  check (expires_at > approved_at)
);
alter table orulo_audit.v5_approvals enable row level security;
revoke all on orulo_audit.v5_approvals from public;
do $guard$
begin
 if exists(select 1 from pg_roles where rolname='anon') then
   execute 'revoke all on orulo_audit.v5_approvals from anon';
 end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then
   execute 'revoke all on orulo_audit.v5_approvals from authenticated';
 end if;
 if exists(select 1 from pg_roles where rolname='service_role') then
   execute 'revoke all on orulo_audit.v5_approvals from service_role';
 end if;
end $guard$;

-- Read-only eligibility check. No SECURITY DEFINER, no implicit privileges.
-- Callers with no table SELECT privilege fail closed.
create or replace function orulo_audit.v5_staging_authorization_check(
 p_manifest_hash text, p_run_uuid uuid, p_building_id text, p_plan_id text
) returns boolean
language sql stable security invoker set search_path = ''
as $$
 select exists (
  select 1
  from orulo_audit.v5_manifests m
  join orulo_audit.v5_approvals a on a.manifest_hash=m.manifest_hash
  where m.manifest_hash=p_manifest_hash
    and a.run_uuid=p_run_uuid
    and m.expires_at>clock_timestamp()
    and a.expires_at>clock_timestamp()
    and a.github_run_id=m.github_run_id
    and a.approved_commit_sha=m.approved_commit_sha
    and a.approved_at>=m.created_at
    and m.approved_at is not null
    and m.approved_by=a.approved_by
    and m.approved_at=a.approved_at
    and exists (
      select 1 from jsonb_array_elements(m.targets) t
      where t->>'buildingId'=p_building_id
        and jsonb_typeof(t->'missingPlanIds')='array'
        and (t->'missingPlanIds') ? p_plan_id
    )
 );
$$;
revoke all on function orulo_audit.v5_staging_authorization_check(text,uuid,text,text) from public;
comment on function orulo_audit.v5_staging_authorization_check(text,uuid,text,text)
 is 'Read-only staging gate; not proof of external provenance or CAS permission';
commit;
