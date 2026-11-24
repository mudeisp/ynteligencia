begin;

create function public.studio_mirror_behavior_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare is_return boolean;
begin
  if to_regclass('public.behavior_events') is null then return new; end if;
  is_return := new.event_name = 'superpage_view' and exists (
    select 1 from public.studio_events
    where presentation_id = new.presentation_id and visitor_id = new.visitor_id
      and session_id <> new.session_id and event_name = 'superpage_view'
  );
  insert into public.behavior_events (event_name,session_id,event_time,page_path,event_data)
  values (case when is_return then 'superpage_return' else new.event_name end,
    new.session_id::text,new.created_at,'/experiencia',jsonb_build_object(
      'source','yincorp_studio','presentation_id',new.presentation_id,'target',new.target,
      'audience','anonymous_link','consented',true));
  return new;
end;
$$;
revoke all on function public.studio_mirror_behavior_event() from public, anon, authenticated;

create trigger studio_event_mia_mirror
after insert on public.studio_events
for each row execute function public.studio_mirror_behavior_event();

create function public.studio_mirror_publication_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare label text;
begin
  if to_regclass('public.behavior_events') is null then return new; end if;
  if tg_op = 'INSERT' then
    label := 'superpage_created';
  elsif new.published_revision is not null and new.published_revision is distinct from old.published_revision then
    label := 'superpage_published';
  else
    return new;
  end if;
  insert into public.behavior_events (event_name,session_id,event_time,page_path,event_data)
  values (label,new.id::text,now(),'/studio',jsonb_build_object(
    'source','yincorp_studio','presentation_id',new.id,'revision',new.published_revision,
    'audience','operator'));
  return new;
end;
$$;
revoke all on function public.studio_mirror_publication_event() from public, anon, authenticated;

create trigger studio_publication_mia_mirror
after insert or update of published_revision on public.studio_presentations
for each row execute function public.studio_mirror_publication_event();

commit;
