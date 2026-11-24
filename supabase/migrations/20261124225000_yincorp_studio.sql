begin;

create table public.studio_clients (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  name text not null,
  profile jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.studio_presentations (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  client_id uuid not null references public.studio_clients on delete cascade,
  token text not null unique check (token ~ '^[a-f0-9]{48}$'),
  draft jsonb not null,
  revision integer not null default 1,
  published_revision integer,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.studio_presentation_versions (
  presentation_id uuid not null references public.studio_presentations on delete cascade,
  revision integer not null,
  content jsonb not null,
  published_at timestamptz not null default now(),
  primary key (presentation_id, revision)
);

create index studio_clients_owner on public.studio_clients (owner, created_at desc);
create index studio_presentations_owner on public.studio_presentations (owner, updated_at desc);

alter table public.studio_clients enable row level security;
alter table public.studio_presentations enable row level security;
alter table public.studio_presentation_versions enable row level security;

revoke all on public.studio_clients, public.studio_presentations, public.studio_presentation_versions
from public, anon, authenticated;
grant select, insert on public.studio_clients to authenticated;
grant select, insert on public.studio_presentations to authenticated;
grant update (draft, revision, updated_at, published_revision, expires_at) on public.studio_presentations to authenticated;
grant select, insert on public.studio_presentation_versions to authenticated;

create policy studio_clients_owner on public.studio_clients
for all to authenticated
using (owner = (select auth.uid()) and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb)
with check (owner = (select auth.uid()) and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb);

create policy studio_presentations_owner on public.studio_presentations
for all to authenticated
using (owner = (select auth.uid()) and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb)
with check (
  owner = (select auth.uid()) and (select auth.jwt() #> '{app_metadata,yincorp_studio}') = 'true'::jsonb
  and exists (select 1 from public.studio_clients where id = client_id and owner = (select auth.uid()))
);

create policy studio_versions_owner on public.studio_presentation_versions
for select to authenticated using (
  exists (select 1 from public.studio_presentations where id = presentation_id)
);

create policy studio_versions_insert on public.studio_presentation_versions
for insert to authenticated with check (
  exists (select 1 from public.studio_presentations
    where id = presentation_id and studio_presentations.revision = studio_presentation_versions.revision
      and draft = content)
);

create function public.studio_read_published(p_token text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select versions.content
  from public.studio_presentations presentations
  join public.studio_presentation_versions versions
    on versions.presentation_id = presentations.id and versions.revision = presentations.published_revision
  where presentations.token = p_token
    and (presentations.expires_at is null or presentations.expires_at > now())
$$;
revoke all on function public.studio_read_published(text) from public;
grant execute on function public.studio_read_published(text) to anon, authenticated;

create function public.studio_publish(p_owner uuid, p_id uuid, p_revision integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare target public.studio_presentations;
begin
  select * into target from public.studio_presentations
  where id = p_id and owner = p_owner and revision = p_revision
  for update;
  if not found then return false; end if;
  insert into public.studio_presentation_versions (presentation_id, revision, content)
  values (p_id, p_revision, target.draft)
  on conflict do nothing;
  update public.studio_presentations set published_revision = p_revision, updated_at = now()
  where id = p_id;
  return true;
end;
$$;
revoke all on function public.studio_publish(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.studio_publish(uuid, uuid, integer) to authenticated;
commit;
