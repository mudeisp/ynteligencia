-- Only for a NEW independent staging project, after provider identity/isolation
-- and owner approval are verified. No data/ACLs are copied from production.
-- Intentionally fails if properties already exists; never truncate/reuse it.
begin;
do $$begin
 if to_regclass('public.properties') is not null or exists(select 1 from pg_namespace where nspname='orulo_audit') then
  raise exception 'V9_FRESH_ISOLATED_SCHEMA_REQUIRED';
 end if;
end$$;
create table public.properties(
 id uuid primary key default gen_random_uuid(),external_id text unique,source text,
 title text,development_name text,neighborhood text,city text,state text,
 latitude numeric,longitude numeric,price numeric,bedrooms numeric,bathrooms numeric,
 parking_spaces numeric,area numeric,image_url text,property_url text,active boolean,
 raw_data jsonb,created_at timestamptz default now(),updated_at timestamptz
);
alter table public.properties enable row level security;
revoke all on public.properties from public,anon,authenticated,service_role;
commit;
