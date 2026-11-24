begin;

grant update (token) on public.studio_presentations to authenticated;

create table public.studio_events (
  presentation_id uuid not null references public.studio_presentations on delete cascade,
  session_id uuid not null,
  visitor_id uuid not null,
  event_name text not null,
  target text not null default '',
  created_at timestamptz not null default now(),
  primary key (presentation_id, session_id, event_name, target)
);
alter table public.studio_events enable row level security;
revoke all on public.studio_events from public, anon, authenticated;
grant select on public.studio_events to authenticated;
create policy studio_events_owner on public.studio_events for select to authenticated
using (exists (select 1 from public.studio_presentations where id = presentation_id));

create function public.studio_track_event(p_token text, p_session uuid, p_visitor uuid, p_event text, p_target text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare page public.studio_presentations;
begin
  select * into page from public.studio_presentations where token = p_token and published_revision is not null
    and (expires_at is null or expires_at > now());
  if not found then return false; end if;
  if p_event not in ('superpage_view','chapter_view','property_comparison','floorplan_view',
    'pricing_view','property_favorite','superpage_share','visit_requested','whatsapp_click') then return false; end if;
  if p_target is null or length(p_target) > 160 then return false; end if;
  if p_event = 'property_favorite' and not exists (
    select 1 from public.studio_presentation_versions v
    cross join lateral jsonb_array_elements(v.content->'properties') property
    where v.presentation_id = page.id and v.revision = page.published_revision and property->>'id' = p_target
  ) then return false; end if;
  if p_event in ('chapter_view','property_comparison','floorplan_view','pricing_view') and p_target !~
    '^(cinema|inteligencia|decisao|arquitetura|natureza|lazer|plantas|engenharia|privacidade|sustentabilidade|localizacao|mobilidade|financeiro|perfil)$'
    then return false; end if;
  if p_event in ('superpage_view','superpage_share','visit_requested','whatsapp_click') and p_target <> '' then return false; end if;
  insert into public.studio_events (presentation_id,session_id,visitor_id,event_name,target)
  values (page.id,p_session,p_visitor,p_event,p_target) on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.studio_track_event(text,uuid,uuid,text,text) from public;
grant execute on function public.studio_track_event(text,uuid,uuid,text,text) to anon, authenticated;

commit;
