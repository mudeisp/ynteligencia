/*
  Buyer Profile V1.

  Substitui o rascunho anterior, que não deve ser aplicado.
  Este arquivo não roda sozinho no deploy. Aplique no SQL Editor
  do Supabase, com a role de serviço, depois do review.

  ads_events continua sendo o fato. Estas tabelas são projeção.
  A única regra de negócio da projeção é public.apply_buyer_profile_event.
  Online e backfill chamam essa função.

  RLS ligada e sem policy pública. Não há grant para anon nem
  authenticated. A service role escreve e lê.

  Rollback, nesta ordem:
    drop function if exists public.get_buyer_profile(text);
    drop function if exists public.apply_buyer_profile_event(jsonb);
    drop function if exists public.buyer_profile_public(public.buyer_profiles);
    drop function if exists public.buyer_profile_sorted(jsonb);
    drop function if exists public.buyer_profile_merge_touch(jsonb, jsonb, jsonb, timestamptz, text);
    drop function if exists public.buyer_profile_set_field_time(jsonb, text, timestamptz, text);
    drop function if exists public.buyer_profile_field_is_newer(jsonb, text, timestamptz, text);
    drop function if exists public.buyer_profile_is_earlier(timestamptz, text, timestamptz, text);
    drop function if exists public.buyer_profile_is_newer(timestamptz, text, timestamptz, text);
    drop function if exists public.buyer_profile_stage_max(text, text);
    drop function if exists public.buyer_profile_event_stage(text, integer, integer, integer, integer, integer);
    drop function if exists public.buyer_profile_stage_name(integer);
    drop function if exists public.buyer_profile_stage_rank(text);
    drop function if exists public.buyer_profile_append_unique(jsonb, text);
    drop function if exists public.buyer_profile_attribution(text);
    drop function if exists public.buyer_profile_positive(text);
    drop function if exists public.buyer_profile_clip(text, integer);
    drop table if exists public.buyer_profile_sessions;
    drop table if exists public.buyer_profile_properties;
    drop table if exists public.buyer_profile_events;
    drop table if exists public.buyer_profiles;
*/

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'buyer_profiles'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'buyer_profiles'
      and column_name = 'last_activity_event_time'
  ) then
    raise exception
      'buyer_profiles do rascunho anterior existe. Remova essa tabela antes. Ela não deve estar em produção.';
  end if;
end $$;

create table if not exists public.buyer_profiles (
  visitor_id text primary key,
  buyer_id text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  total_sessions integer not null default 0,
  city text not null default '',
  state text not null default '',
  regions jsonb not null default '[]'::jsonb,
  neighborhoods jsonb not null default '[]'::jsonb,
  property_types jsonb not null default '[]'::jsonb,
  bedrooms_min integer,
  bedrooms_max integer,
  min_price numeric,
  max_price numeric,
  inventory_sources jsonb not null default '[]'::jsonb,
  purpose text not null default '',
  preference_field_times jsonb not null default '{}'::jsonb,
  total_property_views integer not null default 0,
  unique_properties_viewed integer not null default 0,
  total_ai_searches integer not null default 0,
  total_agent_opens integer not null default 0,
  total_leads integer not null default 0,
  last_property_id text not null default '',
  last_property_name text not null default '',
  last_property_neighborhood text not null default '',
  last_property_event_time timestamptz,
  last_property_event_id text not null default '',
  last_search_summary text not null default '',
  last_search_event_time timestamptz,
  last_search_event_id text not null default '',
  last_activity_type text not null default '',
  last_activity_at timestamptz,
  last_activity_event_time timestamptz,
  last_activity_event_id text not null default '',
  observed_neighborhoods jsonb not null default '[]'::jsonb,
  first_touch jsonb not null default '{}'::jsonb,
  first_touch_event_time timestamptz,
  first_touch_event_id text not null default '',
  current_touch jsonb not null default '{}'::jsonb,
  current_touch_event_time timestamptz,
  current_touch_event_id text not null default '',
  attribution_field_times jsonb not null default '{}'::jsonb,
  last_gclid text not null default '',
  last_utm_source text not null default '',
  last_utm_medium text not null default '',
  last_utm_campaign text not null default '',
  stage text not null default 'anonymous',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_profiles_stage_check check (
    stage in ('anonymous', 'exploring', 'engaged', 'lead')
  ),
  constraint buyer_profiles_counts_check check (
    total_sessions >= 0
    and total_property_views >= 0
    and unique_properties_viewed >= 0
    and total_ai_searches >= 0
    and total_agent_opens >= 0
    and total_leads >= 0
  )
);

create table if not exists public.buyer_profile_events (
  event_id text primary key,
  visitor_id text not null,
  event_name text not null,
  event_time timestamptz not null,
  applied_at timestamptz not null default now()
);

create index if not exists buyer_profile_events_visitor_idx
  on public.buyer_profile_events (visitor_id, event_time, event_id);

create table if not exists public.buyer_profile_properties (
  visitor_id text not null,
  property_id text not null,
  first_event_id text not null,
  first_event_time timestamptz not null,
  primary key (visitor_id, property_id)
);

create table if not exists public.buyer_profile_sessions (
  visitor_id text not null,
  session_id text not null,
  first_event_id text not null,
  first_event_time timestamptz not null,
  primary key (visitor_id, session_id)
);

create index if not exists buyer_profiles_last_seen_idx
  on public.buyer_profiles (last_seen_at desc);

create or replace function public.buyer_profile_clip(p_value text, p_max integer)
returns text
language sql
immutable
as $$
  select left(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), greatest(p_max, 0));
$$;

create or replace function public.buyer_profile_positive(p_value text)
returns numeric
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_value, '')) ~ '^[0-9]+(\.[0-9]+)?$'
      and btrim(p_value)::numeric > 0
    then btrim(p_value)::numeric
    else null
  end;
$$;

create or replace function public.buyer_profile_attribution(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
  digits text;
begin
  v := public.buyer_profile_clip(p_value, 200);
  if v = '' then
    return '';
  end if;
  if v ~* '[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}' then
    return '';
  end if;
  if v ~* 'whatsapp' or v ~* 'wa\.me' then
    return '';
  end if;
  digits := regexp_replace(v, '\D', '', 'g');
  if v ~ '[0-9]{8,}' or (v ~ '[0-9][0-9\s().+\-]{6,}[0-9]' and length(digits) >= 8) then
    return '';
  end if;
  return v;
end;
$$;

create or replace function public.buyer_profile_append_unique(p_list jsonb, p_value text)
returns jsonb
language sql
immutable
as $$
  select case
    when btrim(coalesce(p_value, '')) = '' then coalesce(p_list, '[]'::jsonb)
    when exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_list, '[]'::jsonb)) as item(value)
      where lower(item.value) = lower(btrim(p_value))
    ) then coalesce(p_list, '[]'::jsonb)
    else coalesce(p_list, '[]'::jsonb) || jsonb_build_array(btrim(p_value))
  end;
$$;

create or replace function public.buyer_profile_stage_rank(p_stage text)
returns integer
language sql
immutable
as $$
  select case p_stage
    when 'lead' then 3
    when 'engaged' then 2
    when 'exploring' then 1
    else 0
  end;
$$;

create or replace function public.buyer_profile_stage_name(p_rank integer)
returns text
language sql
immutable
as $$
  select case
    when p_rank >= 3 then 'lead'
    when p_rank = 2 then 'engaged'
    when p_rank = 1 then 'exploring'
    else 'anonymous'
  end;
$$;

create or replace function public.buyer_profile_event_stage(
  p_event_name text,
  p_views integer,
  p_unique integer,
  p_searches integer,
  p_opens integer,
  p_leads integer
) returns text
language sql
immutable
as $$
  select case
    when p_event_name = 'lead_created' or p_leads > 0 then 'lead'
    when p_event_name in ('agent_opened', 'agent_handoff_created', 'property_view_multiple')
      or p_opens > 0
      or p_unique >= 2
      or p_searches >= 2
      or (p_searches >= 1 and p_views >= 1)
      then 'engaged'
    else 'exploring'
  end;
$$;

create or replace function public.buyer_profile_stage_max(p_current text, p_next text)
returns text
language sql
immutable
as $$
  select public.buyer_profile_stage_name(
    greatest(
      public.buyer_profile_stage_rank(p_current),
      public.buyer_profile_stage_rank(p_next)
    )
  );
$$;

create or replace function public.buyer_profile_is_newer(
  p_time timestamptz,
  p_id text,
  p_stored_time timestamptz,
  p_stored_id text
) returns boolean
language sql
immutable
as $$
  select p_stored_time is null
    or p_time > p_stored_time
    or (p_time = p_stored_time and p_id > coalesce(p_stored_id, ''));
$$;

create or replace function public.buyer_profile_is_earlier(
  p_time timestamptz,
  p_id text,
  p_stored_time timestamptz,
  p_stored_id text
) returns boolean
language sql
immutable
as $$
  select p_stored_time is null
    or p_time < p_stored_time
    or (p_time = p_stored_time and p_id < coalesce(p_stored_id, ''));
$$;

create or replace function public.buyer_profile_field_is_newer(
  p_times jsonb,
  p_key text,
  p_time timestamptz,
  p_id text
) returns boolean
language sql
immutable
as $$
  select public.buyer_profile_is_newer(
    p_time,
    p_id,
    nullif(coalesce(p_times, '{}'::jsonb)->p_key->>'time', '')::timestamptz,
    coalesce(coalesce(p_times, '{}'::jsonb)->p_key->>'id', '')
  );
$$;

create or replace function public.buyer_profile_set_field_time(
  p_times jsonb,
  p_key text,
  p_time timestamptz,
  p_id text
) returns jsonb
language sql
immutable
as $$
  select jsonb_set(
    coalesce(p_times, '{}'::jsonb),
    array[p_key],
    jsonb_build_object('time', p_time, 'id', p_id),
    true
  );
$$;

create or replace function public.buyer_profile_merge_touch(
  p_current jsonb,
  p_times jsonb,
  p_incoming jsonb,
  p_time timestamptz,
  p_id text
) returns jsonb
language plpgsql
immutable
as $$
declare
  v_touch jsonb := coalesce(p_current, '{}'::jsonb);
  v_times jsonb := coalesce(p_times, '{}'::jsonb);
  v_key text;
  v_value text;
  v_keys text[] := array[
    'gclid', 'gbraid', 'wbraid',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
  ];
begin
  foreach v_key in array v_keys loop
    v_value := coalesce(p_incoming->>v_key, '');
    if v_value = '' then
      continue;
    end if;
    if public.buyer_profile_field_is_newer(v_times, v_key, p_time, p_id) then
      v_touch := jsonb_set(v_touch, array[v_key], to_jsonb(v_value), true);
      v_times := public.buyer_profile_set_field_time(v_times, v_key, p_time, p_id);
    end if;
  end loop;
  return jsonb_build_object('touch', v_touch, 'times', v_times);
end;
$$;

create or replace function public.buyer_profile_sorted(p_list jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (
      select jsonb_agg(item.value order by lower(item.value))
      from jsonb_array_elements_text(coalesce(p_list, '[]'::jsonb)) as item(value)
    ),
    '[]'::jsonb
  );
$$;

create or replace function public.buyer_profile_public(p public.buyer_profiles)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'visitor_id', p.visitor_id,
    'buyer_id', p.buyer_id,
    'stage', p.stage,
    'preferences', jsonb_build_object(
      'city', p.city,
      'state', p.state,
      'regions', public.buyer_profile_sorted(p.regions),
      'neighborhoods', public.buyer_profile_sorted(p.neighborhoods),
      'property_types', public.buyer_profile_sorted(p.property_types),
      'bedrooms_min', p.bedrooms_min,
      'bedrooms_max', p.bedrooms_max,
      'min_price', p.min_price,
      'max_price', p.max_price,
      'inventory_sources', public.buyer_profile_sorted(p.inventory_sources),
      'purpose', p.purpose
    ),
    'behavior', jsonb_build_object(
      'total_sessions', p.total_sessions,
      'total_property_views', p.total_property_views,
      'unique_properties_viewed', p.unique_properties_viewed,
      'total_ai_searches', p.total_ai_searches,
      'total_agent_opens', p.total_agent_opens,
      'total_leads', p.total_leads,
      'last_property', case
        when p.last_property_id = '' then null
        else jsonb_build_object(
          'property_id', p.last_property_id,
          'name', p.last_property_name,
          'neighborhood', p.last_property_neighborhood
        )
      end,
      'last_search_summary', p.last_search_summary,
      'last_activity_type', p.last_activity_type,
      'observed_neighborhoods', public.buyer_profile_sorted(p.observed_neighborhoods)
    ),
    'attribution', jsonb_build_object(
      'first_touch', p.first_touch,
      'current_touch', p.current_touch,
      'last_gclid', p.last_gclid,
      'last_utm_source', p.last_utm_source,
      'last_utm_medium', p.last_utm_medium,
      'last_utm_campaign', p.last_utm_campaign
    ),
    'first_seen_at', p.first_seen_at,
    'last_seen_at', p.last_seen_at,
    'last_activity_at', p.last_activity_at
  );
$$;

create or replace function public.apply_buyer_profile_event(p_event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_event_id text;
  v_event_name text;
  v_visitor text;
  v_session text;
  v_time timestamptz;
  v_inserted text;
  v_session_inc integer := 0;
  v_unique_inc integer := 0;
  v_view_inc integer := 0;
  v_search_inc integer := 0;
  v_open_inc integer := 0;
  v_lead_inc integer := 0;
  v_declared boolean := false;
  v_property_event boolean := false;
  v_neighborhood text;
  v_development text;
  v_bedrooms integer;
  v_min_price numeric;
  v_max_price numeric;
  v_inventory text;
  v_city text;
  v_state text;
  v_region text;
  v_property_type text;
  v_purpose text;
  v_property_id text;
  v_property_name text;
  v_property_neighborhood text;
  v_gclid text;
  v_gbraid text;
  v_wbraid text;
  v_utm_source text;
  v_utm_medium text;
  v_utm_campaign text;
  v_utm_term text;
  v_utm_content text;
  v_touch jsonb := '{}'::jsonb;
  v_touch_valid boolean := false;
  v_summary text := '';
  v_row public.buyer_profiles;
  v_found boolean := false;
  v_attempt integer;
  v_merged jsonb;
  v_neighborhoods jsonb;
  v_regions jsonb;
  v_property_types jsonb;
  v_sources jsonb;
  v_observed jsonb;
  v_pref_times jsonb;
  v_current jsonb;
  v_field_times jsonb;
  v_first jsonb;
  v_first_time timestamptz;
  v_first_id text;
  v_current_time timestamptz;
  v_current_id text;
  v_views integer;
  v_unique integer;
  v_searches integer;
  v_opens integer;
  v_leads integer;
  v_sessions integer;
  v_bedrooms_min integer;
  v_bedrooms_max integer;
  v_min numeric;
  v_max numeric;
  v_city_value text;
  v_state_value text;
  v_purpose_value text;
  v_search text;
  v_search_time timestamptz;
  v_search_id text;
  v_property_value text;
  v_property_name_value text;
  v_property_neighborhood_value text;
  v_property_time timestamptz;
  v_property_event_id text;
  v_activity text;
  v_activity_at timestamptz;
  v_activity_time timestamptz;
  v_activity_id text;
  v_stage text;
  v_first_seen timestamptz;
  v_last_seen timestamptz;
  v_created timestamptz;
  v_high integer;
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    return jsonb_build_object('status', 'rejected', 'error', 'visitor_id obrigatório');
  end if;

  v_visitor := public.buyer_profile_clip(p_event->>'visitor_id', 80);
  v_event_id := public.buyer_profile_clip(p_event->>'event_id', 80);
  v_event_name := public.buyer_profile_clip(p_event->>'event_name', 40);
  v_session := public.buyer_profile_clip(p_event->>'session_id', 120);

  if v_visitor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('status', 'rejected', 'error', 'visitor_id obrigatório');
  end if;
  if v_event_id = '' then
    return jsonb_build_object('status', 'rejected', 'error', 'event_id obrigatório');
  end if;
  if v_event_name not in (
    'ad_entry', 'ai_search', 'property_view', 'property_view_multiple',
    'agent_handoff_created', 'agent_opened', 'lead_created'
  ) then
    return jsonb_build_object('status', 'rejected', 'error', 'event_name ignorado');
  end if;

  begin
    v_time := nullif(p_event->>'event_time', '')::timestamptz;
  exception when others then
    return jsonb_build_object('status', 'rejected', 'error', 'event_time inválido');
  end;
  if v_time is null then
    return jsonb_build_object('status', 'rejected', 'error', 'event_time inválido');
  end if;

  insert into public.buyer_profile_events (event_id, visitor_id, event_name, event_time)
  values (v_event_id, v_visitor, v_event_name, v_time)
  on conflict (event_id) do nothing
  returning event_id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object(
      'status', 'already_applied',
      'profile', (
        select public.buyer_profile_public(profile)
        from public.buyer_profiles as profile
        where profile.visitor_id = v_visitor
      )
    );
  end if;

  if v_session <> '' then
    with inserted as (
      insert into public.buyer_profile_sessions (visitor_id, session_id, first_event_id, first_event_time)
      values (v_visitor, v_session, v_event_id, v_time)
      on conflict (visitor_id, session_id) do nothing
      returning 1 as ok
    )
    select coalesce(sum(ok), 0) into v_session_inc from inserted;
  end if;

  v_property_id := public.buyer_profile_clip(p_event->>'property_id', 120);
  v_property_event := v_event_name in (
    'property_view', 'property_view_multiple', 'agent_handoff_created', 'agent_opened', 'lead_created'
  );
  if v_event_name = 'property_view' and v_property_id <> '' then
    with inserted as (
      insert into public.buyer_profile_properties (visitor_id, property_id, first_event_id, first_event_time)
      values (v_visitor, v_property_id, v_event_id, v_time)
      on conflict (visitor_id, property_id) do nothing
      returning 1 as ok
    )
    select coalesce(sum(ok), 0) into v_unique_inc from inserted;
  end if;

  v_view_inc := case when v_event_name = 'property_view' then 1 else 0 end;
  v_search_inc := case when v_event_name = 'ai_search' then 1 else 0 end;
  v_open_inc := case when v_event_name = 'agent_opened' then 1 else 0 end;
  v_lead_inc := case when v_event_name = 'lead_created' then 1 else 0 end;
  v_declared := v_event_name in ('ai_search', 'ad_entry');

  v_gclid := public.buyer_profile_attribution(p_event->>'gclid');
  v_gbraid := public.buyer_profile_attribution(p_event->>'gbraid');
  v_wbraid := public.buyer_profile_attribution(p_event->>'wbraid');
  v_utm_source := public.buyer_profile_attribution(p_event->>'utm_source');
  v_utm_medium := public.buyer_profile_attribution(p_event->>'utm_medium');
  v_utm_campaign := public.buyer_profile_attribution(p_event->>'utm_campaign');
  v_utm_term := public.buyer_profile_attribution(p_event->>'utm_term');
  v_utm_content := public.buyer_profile_attribution(p_event->>'utm_content');
  if v_gclid <> '' then v_touch := v_touch || jsonb_build_object('gclid', v_gclid); end if;
  if v_gbraid <> '' then v_touch := v_touch || jsonb_build_object('gbraid', v_gbraid); end if;
  if v_wbraid <> '' then v_touch := v_touch || jsonb_build_object('wbraid', v_wbraid); end if;
  if v_utm_source <> '' then v_touch := v_touch || jsonb_build_object('utm_source', v_utm_source); end if;
  if v_utm_medium <> '' then v_touch := v_touch || jsonb_build_object('utm_medium', v_utm_medium); end if;
  if v_utm_campaign <> '' then v_touch := v_touch || jsonb_build_object('utm_campaign', v_utm_campaign); end if;
  if v_utm_term <> '' then v_touch := v_touch || jsonb_build_object('utm_term', v_utm_term); end if;
  if v_utm_content <> '' then v_touch := v_touch || jsonb_build_object('utm_content', v_utm_content); end if;
  v_touch_valid := v_touch <> '{}'::jsonb;

  v_neighborhood := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'neighborhood', 80));
  v_development := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'development', 120));
  v_bedrooms := nullif(least(coalesce(public.buyer_profile_positive(p_event->>'bedrooms'), 0), 20), 0)::integer;
  v_min_price := public.buyer_profile_positive(p_event->>'min_price');
  v_max_price := public.buyer_profile_positive(p_event->>'max_price');
  v_inventory := lower(public.buyer_profile_clip(p_event->>'inventory_source', 20));
  if v_inventory not in ('novos', 'usados', 'todos') then
    v_inventory := '';
  end if;
  v_city := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'city', 80));
  v_state := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'state', 40));
  v_region := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'region', 80));
  v_property_type := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'property_type', 80));
  v_purpose := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'purpose', 80));
  v_property_name := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'property_name', 180));
  v_property_neighborhood := public.buyer_profile_attribution(public.buyer_profile_clip(p_event->>'property_neighborhood', 80));

  if v_event_name = 'ai_search' then
    v_summary := array_to_string(array_remove(array[
      nullif(v_neighborhood, ''),
      nullif(v_development, ''),
      case when v_bedrooms is not null then v_bedrooms::text || ' dorms' end,
      case when v_min_price is not null then 'desde ' || trim(to_char(v_min_price, 'FM999999999999')) end,
      case when v_max_price is not null then 'até ' || trim(to_char(v_max_price, 'FM999999999999')) end,
      nullif(v_inventory, '')
    ], null), ' · ');
  end if;

  for v_attempt in 1..2 loop
    select * into v_row
    from public.buyer_profiles
    where visitor_id = v_visitor
    for update;
    v_found := found;

    v_neighborhoods := case when v_found then v_row.neighborhoods else '[]'::jsonb end;
    v_regions := case when v_found then v_row.regions else '[]'::jsonb end;
    v_property_types := case when v_found then v_row.property_types else '[]'::jsonb end;
    v_sources := case when v_found then v_row.inventory_sources else '[]'::jsonb end;
    v_observed := case when v_found then v_row.observed_neighborhoods else '[]'::jsonb end;
    v_pref_times := case when v_found then v_row.preference_field_times else '{}'::jsonb end;
    v_field_times := case when v_found then v_row.attribution_field_times else '{}'::jsonb end;
    v_bedrooms_min := case when v_found then v_row.bedrooms_min else null end;
    v_bedrooms_max := case when v_found then v_row.bedrooms_max else null end;
    v_min := case when v_found then v_row.min_price else null end;
    v_max := case when v_found then v_row.max_price else null end;
    v_city_value := case when v_found then v_row.city else '' end;
    v_state_value := case when v_found then v_row.state else '' end;
    v_purpose_value := case when v_found then v_row.purpose else '' end;
    v_search := case when v_found then v_row.last_search_summary else '' end;
    v_search_time := case when v_found then v_row.last_search_event_time else null end;
    v_search_id := case when v_found then v_row.last_search_event_id else '' end;
    v_property_value := case when v_found then v_row.last_property_id else '' end;
    v_property_name_value := case when v_found then v_row.last_property_name else '' end;
    v_property_neighborhood_value := case when v_found then v_row.last_property_neighborhood else '' end;
    v_property_time := case when v_found then v_row.last_property_event_time else null end;
    v_property_event_id := case when v_found then v_row.last_property_event_id else '' end;
    v_activity := case when v_found then v_row.last_activity_type else '' end;
    v_activity_at := case when v_found then v_row.last_activity_at else null end;
    v_activity_time := case when v_found then v_row.last_activity_event_time else null end;
    v_activity_id := case when v_found then v_row.last_activity_event_id else '' end;
    v_first := case when v_found then v_row.first_touch else '{}'::jsonb end;
    v_first_time := case when v_found then v_row.first_touch_event_time else null end;
    v_first_id := case when v_found then v_row.first_touch_event_id else '' end;
    v_current_time := case when v_found then v_row.current_touch_event_time else null end;
    v_current_id := case when v_found then v_row.current_touch_event_id else '' end;
    v_sessions := coalesce(case when v_found then v_row.total_sessions else 0 end, 0) + v_session_inc;
    v_views := coalesce(case when v_found then v_row.total_property_views else 0 end, 0) + v_view_inc;
    v_unique := coalesce(case when v_found then v_row.unique_properties_viewed else 0 end, 0) + v_unique_inc;
    v_searches := coalesce(case when v_found then v_row.total_ai_searches else 0 end, 0) + v_search_inc;
    v_opens := coalesce(case when v_found then v_row.total_agent_opens else 0 end, 0) + v_open_inc;
    v_leads := coalesce(case when v_found then v_row.total_leads else 0 end, 0) + v_lead_inc;
    v_first_seen := least(coalesce(case when v_found then v_row.first_seen_at else null end, v_time), v_time);
    v_last_seen := greatest(coalesce(case when v_found then v_row.last_seen_at else null end, v_time), v_time);
    v_created := coalesce(case when v_found then v_row.created_at else null end, v_time);

    if v_declared then
      v_neighborhoods := public.buyer_profile_append_unique(v_neighborhoods, v_neighborhood);
      v_regions := public.buyer_profile_append_unique(v_regions, v_region);
      v_property_types := public.buyer_profile_append_unique(v_property_types, v_property_type);
      v_sources := public.buyer_profile_append_unique(v_sources, v_inventory);
      if v_bedrooms is not null then
        if v_bedrooms_min is null then
          v_bedrooms_min := v_bedrooms;
        elsif v_bedrooms <> v_bedrooms_min then
          v_high := greatest(coalesce(v_bedrooms_max, v_bedrooms_min), v_bedrooms);
          v_bedrooms_min := least(v_bedrooms_min, v_bedrooms);
          v_bedrooms_max := case when v_high = v_bedrooms_min then null else v_high end;
        end if;
      end if;
      if v_min_price is not null and public.buyer_profile_field_is_newer(v_pref_times, 'min_price', v_time, v_event_id) then
        v_min := v_min_price;
        v_pref_times := public.buyer_profile_set_field_time(v_pref_times, 'min_price', v_time, v_event_id);
      end if;
      if v_max_price is not null and public.buyer_profile_field_is_newer(v_pref_times, 'max_price', v_time, v_event_id) then
        v_max := v_max_price;
        v_pref_times := public.buyer_profile_set_field_time(v_pref_times, 'max_price', v_time, v_event_id);
      end if;
      if v_city <> '' and public.buyer_profile_field_is_newer(v_pref_times, 'city', v_time, v_event_id) then
        v_city_value := v_city;
        v_pref_times := public.buyer_profile_set_field_time(v_pref_times, 'city', v_time, v_event_id);
      end if;
      if v_state <> '' and public.buyer_profile_field_is_newer(v_pref_times, 'state', v_time, v_event_id) then
        v_state_value := v_state;
        v_pref_times := public.buyer_profile_set_field_time(v_pref_times, 'state', v_time, v_event_id);
      end if;
      if v_purpose <> '' and public.buyer_profile_field_is_newer(v_pref_times, 'purpose', v_time, v_event_id) then
        v_purpose_value := v_purpose;
        v_pref_times := public.buyer_profile_set_field_time(v_pref_times, 'purpose', v_time, v_event_id);
      end if;
    end if;

    if v_event_name = 'ai_search' and v_summary <> '' and public.buyer_profile_is_newer(v_time, v_event_id, v_search_time, v_search_id) then
      v_search := v_summary;
      v_search_time := v_time;
      v_search_id := v_event_id;
    end if;

    if v_property_event and v_property_neighborhood <> '' then
      v_observed := public.buyer_profile_append_unique(v_observed, v_property_neighborhood);
    end if;
    if v_property_event and v_property_id <> '' and public.buyer_profile_is_newer(v_time, v_event_id, v_property_time, v_property_event_id) then
      v_property_value := v_property_id;
      if v_property_name <> '' then
        v_property_name_value := v_property_name;
      end if;
      if v_property_neighborhood <> '' then
        v_property_neighborhood_value := v_property_neighborhood;
      end if;
      v_property_time := v_time;
      v_property_event_id := v_event_id;
    end if;

    if public.buyer_profile_is_newer(v_time, v_event_id, v_activity_time, v_activity_id) then
      v_activity := v_event_name;
      v_activity_at := v_time;
      v_activity_time := v_time;
      v_activity_id := v_event_id;
    end if;

    v_merged := public.buyer_profile_merge_touch(
      case when v_found then v_row.current_touch else '{}'::jsonb end,
      v_field_times,
      v_touch,
      v_time,
      v_event_id
    );
    v_current := v_merged->'touch';
    v_field_times := v_merged->'times';
    if v_touch_valid and public.buyer_profile_is_newer(v_time, v_event_id, v_current_time, v_current_id) then
      v_current_time := v_time;
      v_current_id := v_event_id;
    end if;
    if v_touch_valid and public.buyer_profile_is_earlier(v_time, v_event_id, v_first_time, v_first_id) then
      v_first := v_touch;
      v_first_time := v_time;
      v_first_id := v_event_id;
    end if;

    v_stage := public.buyer_profile_stage_max(
      case when v_found then v_row.stage else 'anonymous' end,
      public.buyer_profile_event_stage(v_event_name, v_views, v_unique, v_searches, v_opens, v_leads)
    );

    if not v_found then
      begin
        insert into public.buyer_profiles (
          visitor_id, buyer_id, first_seen_at, last_seen_at, total_sessions,
          city, state, regions, neighborhoods, property_types,
          bedrooms_min, bedrooms_max, min_price, max_price, inventory_sources, purpose,
          preference_field_times, total_property_views, unique_properties_viewed,
          total_ai_searches, total_agent_opens, total_leads,
          last_property_id, last_property_name, last_property_neighborhood,
          last_property_event_time, last_property_event_id,
          last_search_summary, last_search_event_time, last_search_event_id,
          last_activity_type, last_activity_at, last_activity_event_time, last_activity_event_id,
          observed_neighborhoods, first_touch, first_touch_event_time, first_touch_event_id,
          current_touch, current_touch_event_time, current_touch_event_id, attribution_field_times,
          last_gclid, last_utm_source, last_utm_medium, last_utm_campaign,
          stage, created_at, updated_at
        ) values (
          v_visitor, null, v_first_seen, v_last_seen, v_sessions,
          v_city_value, v_state_value, v_regions, v_neighborhoods, v_property_types,
          v_bedrooms_min, v_bedrooms_max, v_min, v_max, v_sources, v_purpose_value,
          v_pref_times, v_views, v_unique, v_searches, v_opens, v_leads,
          v_property_value, v_property_name_value, v_property_neighborhood_value,
          v_property_time, v_property_event_id,
          v_search, v_search_time, v_search_id,
          v_activity, v_activity_at, v_activity_time, v_activity_id,
          v_observed, v_first, v_first_time, v_first_id,
          v_current, v_current_time, v_current_id, v_field_times,
          coalesce(v_current->>'gclid', ''),
          coalesce(v_current->>'utm_source', ''),
          coalesce(v_current->>'utm_medium', ''),
          coalesce(v_current->>'utm_campaign', ''),
          v_stage, v_created, now()
        );
        exit;
      exception when unique_violation then
        continue;
      end;
    end if;

    update public.buyer_profiles set
      first_seen_at = v_first_seen,
      last_seen_at = v_last_seen,
      total_sessions = v_sessions,
      city = v_city_value,
      state = v_state_value,
      regions = v_regions,
      neighborhoods = v_neighborhoods,
      property_types = v_property_types,
      bedrooms_min = v_bedrooms_min,
      bedrooms_max = v_bedrooms_max,
      min_price = v_min,
      max_price = v_max,
      inventory_sources = v_sources,
      purpose = v_purpose_value,
      preference_field_times = v_pref_times,
      total_property_views = v_views,
      unique_properties_viewed = v_unique,
      total_ai_searches = v_searches,
      total_agent_opens = v_opens,
      total_leads = v_leads,
      last_property_id = v_property_value,
      last_property_name = v_property_name_value,
      last_property_neighborhood = v_property_neighborhood_value,
      last_property_event_time = v_property_time,
      last_property_event_id = v_property_event_id,
      last_search_summary = v_search,
      last_search_event_time = v_search_time,
      last_search_event_id = v_search_id,
      last_activity_type = v_activity,
      last_activity_at = v_activity_at,
      last_activity_event_time = v_activity_time,
      last_activity_event_id = v_activity_id,
      observed_neighborhoods = v_observed,
      first_touch = v_first,
      first_touch_event_time = v_first_time,
      first_touch_event_id = v_first_id,
      current_touch = v_current,
      current_touch_event_time = v_current_time,
      current_touch_event_id = v_current_id,
      attribution_field_times = v_field_times,
      last_gclid = coalesce(v_current->>'gclid', ''),
      last_utm_source = coalesce(v_current->>'utm_source', ''),
      last_utm_medium = coalesce(v_current->>'utm_medium', ''),
      last_utm_campaign = coalesce(v_current->>'utm_campaign', ''),
      stage = v_stage,
      updated_at = now()
    where visitor_id = v_visitor;
    exit;
  end loop;

  return jsonb_build_object(
    'status', 'applied',
    'profile', (
      select public.buyer_profile_public(profile)
      from public.buyer_profiles as profile
      where profile.visitor_id = v_visitor
    )
  );
end;
$$;

create or replace function public.get_buyer_profile(p_visitor_id text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_visitor text;
  v_profile jsonb;
begin
  v_visitor := public.buyer_profile_clip(p_visitor_id, 80);
  if v_visitor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('status', 'rejected', 'error', 'visitor_id obrigatório', 'profile', null);
  end if;
  select public.buyer_profile_public(profile) into v_profile
  from public.buyer_profiles as profile
  where profile.visitor_id = v_visitor;
  return jsonb_build_object('status', 'ok', 'profile', v_profile);
end;
$$;

alter table public.buyer_profiles enable row level security;
alter table public.buyer_profile_events enable row level security;
alter table public.buyer_profile_properties enable row level security;
alter table public.buyer_profile_sessions enable row level security;

revoke all on table public.buyer_profiles from public;
revoke all on table public.buyer_profile_events from public;
revoke all on table public.buyer_profile_properties from public;
revoke all on table public.buyer_profile_sessions from public;
revoke all on function public.apply_buyer_profile_event(jsonb) from public;
revoke all on function public.get_buyer_profile(text) from public;
revoke all on function public.buyer_profile_public(public.buyer_profiles) from public;
revoke all on function public.buyer_profile_sorted(jsonb) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.buyer_profiles from %I', v_role);
      execute format('revoke all on table public.buyer_profile_events from %I', v_role);
      execute format('revoke all on table public.buyer_profile_properties from %I', v_role);
      execute format('revoke all on table public.buyer_profile_sessions from %I', v_role);
      execute format('revoke all on function public.apply_buyer_profile_event(jsonb) from %I', v_role);
      execute format('revoke all on function public.get_buyer_profile(text) from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.buyer_profiles to service_role';
    execute 'grant select, insert, update, delete on table public.buyer_profile_events to service_role';
    execute 'grant select, insert, update, delete on table public.buyer_profile_properties to service_role';
    execute 'grant select, insert, update, delete on table public.buyer_profile_sessions to service_role';
    execute 'grant execute on function public.apply_buyer_profile_event(jsonb) to service_role';
    execute 'grant execute on function public.get_buyer_profile(text) to service_role';
  end if;
end $$;
