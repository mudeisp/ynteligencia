begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.studio_presentations
  add column draft_expires_at timestamptz,
  add column draft_password_hash text,
  add column password_hash text;
grant update (draft_expires_at, draft_password_hash, password_hash) on public.studio_presentations to authenticated;

create function public.studio_hash_link_password(p_password text)
returns text
language sql
set search_path = ''
as $$
  select case when octet_length(p_password) between 8 and 72
    then extensions.crypt(p_password, extensions.gen_salt('bf', 9)) else null end
$$;
revoke all on function public.studio_hash_link_password(text) from public, anon;
grant execute on function public.studio_hash_link_password(text) to authenticated;

create or replace function public.studio_publish(p_owner uuid, p_id uuid, p_revision integer)
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
  update public.studio_presentations
  set published_revision = p_revision, updated_at = now(),
      expires_at = target.draft_expires_at, password_hash = target.draft_password_hash
  where id = p_id;
  return true;
end;
$$;

drop function public.studio_read_published(text);
create function public.studio_read_published(p_token text, p_password text default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select
    case
      when presentations.password_hash is null then jsonb_build_object('content',versions.content)
      when octet_length(p_password) between 8 and 72
         and extensions.crypt(p_password, presentations.password_hash) = presentations.password_hash
        then jsonb_build_object('content',versions.content)
      else '{"locked":true}'::jsonb
    end
  from public.studio_presentations presentations
  join public.studio_presentation_versions versions
    on versions.presentation_id = presentations.id and versions.revision = presentations.published_revision
  where presentations.token = p_token
    and (presentations.expires_at is null or presentations.expires_at > now())
$$;
revoke all on function public.studio_read_published(text,text) from public;
grant execute on function public.studio_read_published(text,text) to anon, authenticated;

commit;
