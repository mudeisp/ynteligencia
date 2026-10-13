/*
  Quality Scoring V1.

  Projeção derivada de ads_events. Não altera eventos, first_touch,
  current_touch, campanhas nem conversões. Não roda sozinho no deploy
  e não deve ser executado em Production a partir daqui.

  Aplicar depois de supabase/ads_events.sql e supabase/ads_lead_identity.sql.
  Os pesos espelham quality-scoring.js. Não há mediana ao vivo:
  volume alto usa limiar fixo para o score depender só do visitante.

  Rollback:
    drop function if exists public.get_buyer_quality_score(text);
    drop function if exists public.recompute_buyer_quality_score(text);
    drop function if exists public.buyer_quality_events(text);
    drop function if exists public.buyer_quality_text(text);
    drop table if exists public.buyer_quality_scores;
*/

create or replace function public.buyer_quality_text(p_value text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'));
$$;

create or replace function public.buyer_quality_events(p_visitor_id text)
returns table (
  event_time timestamptz,
  event_id text,
  event_name text,
  session_id text,
  property_id text,
  neighborhood text,
  bedrooms integer,
  price numeric,
  band integer,
  development text,
  property_type text,
  filter_key text,
  has_intent boolean,
  has_touch boolean,
  metadata_test boolean,
  test_identifier boolean,
  test_click boolean
)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  with source as (
    select
      event.event_time,
      public.buyer_quality_text(event.event_id) as event_id,
      public.buyer_quality_text(event.event_name) as event_name,
      public.buyer_quality_text(event.session_id) as session_id,
      public.buyer_quality_text(event.visitor_id) as visitor_id,
      public.buyer_quality_text(event.property_id) as property_id,
      lower(public.buyer_quality_text(
        case
          when public.buyer_quality_text(event.property_neighborhood) <> '' then event.property_neighborhood
          when public.buyer_quality_text(event.declared_neighborhood) <> '' then event.declared_neighborhood
          else event.observed_neighborhood
        end
      )) as neighborhood,
      case
        when event.property_bedrooms between 0 and 20 then event.property_bedrooms
        when event.declared_bedrooms between 0 and 20 then event.declared_bedrooms
        when event.observed_bedrooms between 0 and 20 then event.observed_bedrooms
        else null
      end as bedrooms,
      case
        when coalesce(event.property_price, 0) > 0 then event.property_price
        when coalesce(event.declared_min_price, 0) > 0 and coalesce(event.declared_max_price, 0) > 0
          then (event.declared_min_price + event.declared_max_price) / 2
        when coalesce(event.declared_min_price, 0) > 0 then event.declared_min_price
        when coalesce(event.declared_max_price, 0) > 0 then event.declared_max_price
        when coalesce(event.observed_price_min, 0) > 0 and coalesce(event.observed_price_max, 0) > 0
          then (event.observed_price_min + event.observed_price_max) / 2
        when coalesce(event.observed_price_min, 0) > 0 then event.observed_price_min
        when coalesce(event.observed_price_max, 0) > 0 then event.observed_price_max
        else 0
      end as price,
      lower(public.buyer_quality_text(
        case
          when public.buyer_quality_text(event.property_development) <> '' then event.property_development
          else event.declared_development
        end
      )) as development,
      lower(public.buyer_quality_text(coalesce(
        nullif(event.metadata->'canonical_preference'->>'property_type', ''),
        nullif(event.metadata->'canonical_preference'->>'propertyType', ''),
        nullif(event.metadata->>'property_type', ''),
        nullif(event.metadata->>'propertyType', ''),
        ''
      ))) as property_type,
      public.buyer_quality_text(event.declared_neighborhood) as declared_neighborhood,
      event.declared_bedrooms,
      event.declared_min_price,
      event.declared_max_price,
      public.buyer_quality_text(event.observed_neighborhood) as observed_neighborhood,
      event.observed_bedrooms,
      event.observed_price_min,
      event.observed_price_max,
      public.buyer_quality_text(event.gclid) as gclid,
      public.buyer_quality_text(event.gbraid) as gbraid,
      public.buyer_quality_text(event.wbraid) as wbraid,
      public.buyer_quality_text(event.conversion_gclid) as conversion_gclid,
      public.buyer_quality_text(event.conversion_gbraid) as conversion_gbraid,
      public.buyer_quality_text(event.conversion_wbraid) as conversion_wbraid,
      public.buyer_quality_text(event.utm_source) as utm_source,
      public.buyer_quality_text(event.utm_medium) as utm_medium,
      public.buyer_quality_text(event.utm_campaign) as utm_campaign,
      event.metadata
    from public.ads_events as event
    where event.visitor_id = p_visitor_id
  ),
  priced as (
    select
      source.*,
      case
        when source.price <= 0 then null
        when source.price < 500000 then 0
        when source.price < 1000000 then 1
        when source.price < 2000000 then 2
        when source.price < 4000000 then 3
        else 4
      end as band
    from source
  )
  select
    priced.event_time,
    priced.event_id,
    priced.event_name,
    priced.session_id,
    priced.property_id,
    priced.neighborhood,
    priced.bedrooms,
    priced.price,
    priced.band,
    priced.development,
    priced.property_type,
    case
      when priced.declared_neighborhood = ''
        and (priced.declared_bedrooms is null or priced.declared_bedrooms < 0 or priced.declared_bedrooms > 20)
        and coalesce(priced.declared_min_price, 0) <= 0
        and coalesce(priced.declared_max_price, 0) <= 0
      then ''
      else lower(priced.declared_neighborhood) || '|' ||
        case when priced.declared_bedrooms between 0 and 20 then priced.declared_bedrooms::text else '' end || '|' ||
        case
          when coalesce(priced.declared_min_price, 0) <= 0 then ''
          when priced.declared_min_price < 500000 then '0'
          when priced.declared_min_price < 1000000 then '1'
          when priced.declared_min_price < 2000000 then '2'
          when priced.declared_min_price < 4000000 then '3'
          else '4'
        end || '|' ||
        case
          when coalesce(priced.declared_max_price, 0) <= 0 then ''
          when priced.declared_max_price < 500000 then '0'
          when priced.declared_max_price < 1000000 then '1'
          when priced.declared_max_price < 2000000 then '2'
          when priced.declared_max_price < 4000000 then '3'
          else '4'
        end
    end as filter_key,
    (
      priced.declared_neighborhood <> ''
      or priced.declared_bedrooms between 0 and 20
      or coalesce(priced.declared_min_price, 0) > 0
      or coalesce(priced.declared_max_price, 0) > 0
      or priced.observed_neighborhood <> ''
      or priced.observed_bedrooms between 0 and 20
      or coalesce(priced.observed_price_min, 0) > 0
      or coalesce(priced.observed_price_max, 0) > 0
    ) as has_intent,
    (
      priced.gclid <> '' or priced.gbraid <> '' or priced.wbraid <> ''
      or priced.utm_source <> '' or priced.utm_medium <> '' or priced.utm_campaign <> ''
      or priced.conversion_gclid <> '' or priced.conversion_gbraid <> '' or priced.conversion_wbraid <> ''
    ) as has_touch,
    (
      priced.metadata->'test' = 'true'::jsonb
      or lower(coalesce(priced.metadata->>'test', '')) in ('true', '1')
    ) as metadata_test,
    (
      position('test' in lower(priced.event_id)) > 0
      or position('test' in lower(priced.visitor_id)) > 0
      or position('test' in lower(priced.session_id)) > 0
      or position('test' in lower(priced.property_id)) > 0
    ) as test_identifier,
    (
      position('test' in lower(priced.gclid)) > 0
      or position('test' in lower(priced.gbraid)) > 0
      or position('test' in lower(priced.wbraid)) > 0
      or position('test' in lower(priced.conversion_gclid)) > 0
      or position('test' in lower(priced.conversion_gbraid)) > 0
      or position('test' in lower(priced.conversion_wbraid)) > 0
    ) as test_click
  from priced;
$$;

create table if not exists public.buyer_quality_scores (
  visitor_id text primary key,
  buyer_intent_score integer not null,
  commercial_intent_score integer not null,
  recurrence_score integer not null,
  broker_tester_score integer not null,
  data_confidence_score integer not null,
  buyer_class text not null,
  traffic_quality_class text not null,
  score_breakdown jsonb not null default '{}'::jsonb,
  first_event_at timestamptz,
  last_event_at timestamptz,
  distinct_days integer not null,
  session_count integer not null,
  event_count integer not null,
  property_count integer not null,
  neighborhood_count integer not null,
  updated_at timestamptz not null default now()
);

alter table public.buyer_quality_scores enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'buyer_quality_scores_scores_check'
      and conrelid = 'public.buyer_quality_scores'::regclass
  ) then
    alter table public.buyer_quality_scores
      add constraint buyer_quality_scores_scores_check check (
        buyer_intent_score between 0 and 100
        and commercial_intent_score between 0 and 100
        and recurrence_score between 0 and 100
        and broker_tester_score between 0 and 100
        and data_confidence_score between 0 and 100
        and distinct_days >= 0
        and session_count >= 0
        and event_count >= 0
        and property_count >= 0
        and neighborhood_count >= 0
        and jsonb_typeof(score_breakdown) = 'object'
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'buyer_quality_scores_buyer_class_check'
      and conrelid = 'public.buyer_quality_scores'::regclass
  ) then
    alter table public.buyer_quality_scores
      add constraint buyer_quality_scores_buyer_class_check check (
        buyer_class in ('unknown', 'low_intent', 'exploring', 'engaged', 'high_intent', 'lead')
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'buyer_quality_scores_traffic_class_check'
      and conrelid = 'public.buyer_quality_scores'::regclass
  ) then
    alter table public.buyer_quality_scores
      add constraint buyer_quality_scores_traffic_class_check check (
        traffic_quality_class in ('unknown', 'likely_buyer', 'likely_broker_or_tester', 'mixed')
      );
  end if;
end $$;

create index if not exists buyer_quality_scores_traffic_idx
  on public.buyer_quality_scores (traffic_quality_class, buyer_intent_score desc);

create or replace function public.recompute_buyer_quality_score(p_visitor_id text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_visitor text := public.buyer_quality_text(p_visitor_id);
  v_events integer := 0;
  v_sessions integer := 0;
  v_days integer := 0;
  v_properties integer := 0;
  v_neighborhoods integer := 0;
  v_types integer := 0;
  v_first timestamptz;
  v_last timestamptz;
  v_span numeric := 0;
  v_views integer := 0;
  v_lead integer := 0;
  v_success integer := 0;
  v_submitted integer := 0;
  v_whatsapp integer := 0;
  v_phone integer := 0;
  v_specialist integer := 0;
  v_interest integer := 0;
  v_vip integer := 0;
  v_form integer := 0;
  v_agent integer := 0;
  v_message integer := 0;
  v_assistant_open integer := 0;
  v_floorplan integer := 0;
  v_floorplan_click integer := 0;
  v_table_request integer := 0;
  v_book_request integer := 0;
  v_gallery integer := 0;
  v_map integer := 0;
  v_view_multiple integer := 0;
  v_views_day integer := 0;
  v_events_day integer := 0;
  v_views_two_hours integer := 0;
  v_nbh_window integer := 0;
  v_bed_window integer := 0;
  v_band_window integer := 0;
  v_dev_window integer := 0;
  v_sessions_day integer := 0;
  v_filters_day integer := 0;
  v_same_nbh boolean := false;
  v_same_bed boolean := false;
  v_same_band boolean := false;
  v_same_property boolean := false;
  v_breadth boolean := false;
  v_segment boolean := false;
  v_qa integer := 0;
  v_metadata_test boolean := false;
  v_test_id boolean := false;
  v_test_click boolean := false;
  v_intent boolean := false;
  v_touch boolean := false;
  v_sessions_consistent boolean := false;
  v_buyer integer := 0;
  v_commercial integer := 0;
  v_recurrence integer := 0;
  v_broker integer := 0;
  v_confidence integer := 0;
  v_day_points integer := 0;
  v_session_points integer := 0;
  v_span_points integer := 0;
  v_progression integer := 0;
  v_buyer_class text := 'unknown';
  v_traffic_class text := 'unknown';
  v_buyer_signals jsonb := '[]'::jsonb;
  v_commercial_signals jsonb := '[]'::jsonb;
  v_recurrence_signals jsonb := '[]'::jsonb;
  v_broker_signals jsonb := '[]'::jsonb;
  v_confidence_signals jsonb := '[]'::jsonb;
  v_breakdown jsonb;
  v_score jsonb;
begin
  if v_visitor = '' or length(v_visitor) > 80 then
    return jsonb_build_object('status', 'rejected', 'error', 'visitor_id obrigatório', 'score', null);
  end if;

  select
    count(*)::int,
    count(distinct session_id) filter (where session_id <> '')::int,
    count(distinct (event_time at time zone 'utc')::date)::int,
    count(distinct property_id) filter (where property_id <> '')::int,
    count(distinct neighborhood) filter (where neighborhood <> '')::int,
    count(distinct property_type) filter (where property_type <> '')::int,
    min(event_time),
    max(event_time),
    count(*) filter (where event_name = 'property_view')::int,
    count(*) filter (where event_name = 'lead_created')::int,
    count(*) filter (where event_name = 'ai_lead_success')::int,
    count(*) filter (where event_name = 'ai_lead_submitted')::int,
    count(*) filter (where event_name = 'property_whatsapp_click')::int,
    count(*) filter (where event_name = 'ai_phone_detected')::int,
    count(*) filter (where event_name = 'specialist_cta_opened')::int,
    count(*) filter (where event_name = 'property_interest')::int,
    count(*) filter (where event_name = 'vip_offer_click')::int,
    count(*) filter (where event_name = 'ai_lead_form_opened')::int,
    count(*) filter (where event_name = 'agent_opened')::int,
    count(*) filter (where event_name = 'ai_assistant_message')::int,
    count(*) filter (where event_name = 'ai_assistant_open')::int,
    count(*) filter (where event_name = 'floorplan_view')::int,
    count(*) filter (where event_name = 'development_floorplan_click')::int,
    count(*) filter (where event_name = 'development_table_request')::int,
    count(*) filter (where event_name = 'development_book_request')::int,
    count(*) filter (where event_name = 'property_gallery_view')::int,
    count(*) filter (where event_name = 'map_view')::int,
    count(*) filter (where event_name = 'property_view_multiple')::int,
    coalesce(bool_or(metadata_test), false),
    coalesce(bool_or(test_identifier), false),
    coalesce(bool_or(test_click), false),
    coalesce(bool_or(has_intent), false),
    coalesce(bool_or(has_touch), false),
    coalesce(bool_and(session_id <> ''), false)
  into
    v_events, v_sessions, v_days, v_properties, v_neighborhoods, v_types, v_first, v_last,
    v_views, v_lead, v_success, v_submitted, v_whatsapp, v_phone, v_specialist, v_interest,
    v_vip, v_form, v_agent, v_message, v_assistant_open, v_floorplan, v_floorplan_click,
    v_table_request, v_book_request, v_gallery, v_map, v_view_multiple,
    v_metadata_test, v_test_id, v_test_click, v_intent, v_touch, v_sessions_consistent
  from public.buyer_quality_events(v_visitor);

  if v_events = 0 then
    return jsonb_build_object('status', 'empty', 'score', null);
  end if;

  v_span := extract(epoch from (v_last - v_first)) / 86400.0;

  select coalesce(max(cnt), 0)::int into v_views_day
  from (
    select count(*) as cnt
    from public.buyer_quality_events(v_visitor)
    where event_name = 'property_view'
    group by (event_time at time zone 'utc')::date
  ) days;

  select coalesce(max(cnt), 0)::int into v_events_day
  from (
    select count(*) as cnt
    from public.buyer_quality_events(v_visitor)
    group by (event_time at time zone 'utc')::date
  ) days;

  select coalesce(max(cnt), 0)::int into v_views_two_hours
  from (
    select (
      select count(*)
      from public.buyer_quality_events(v_visitor) later
      where later.event_name = 'property_view'
        and later.event_time >= anchor.event_time
        and later.event_time < anchor.event_time + interval '2 hours'
    ) as cnt
    from public.buyer_quality_events(v_visitor) anchor
    where anchor.event_name = 'property_view'
  ) windows;

  select coalesce(max(cnt), 0)::int into v_nbh_window
  from (
    select (
      select count(distinct later.neighborhood)
      from public.buyer_quality_events(v_visitor) later
      where later.neighborhood <> ''
        and later.event_time >= anchor.event_time
        and later.event_time < anchor.event_time + interval '2 days'
    ) as cnt
    from public.buyer_quality_events(v_visitor) anchor
  ) windows;

  select coalesce(max(cnt), 0)::int into v_bed_window
  from (
    select (
      select count(distinct later.bedrooms)
      from public.buyer_quality_events(v_visitor) later
      where later.bedrooms is not null
        and later.event_time >= anchor.event_time
        and later.event_time < anchor.event_time + interval '2 days'
    ) as cnt
    from public.buyer_quality_events(v_visitor) anchor
  ) windows;

  select coalesce(max(cnt), 0)::int into v_band_window
  from (
    select (
      select count(distinct later.band)
      from public.buyer_quality_events(v_visitor) later
      where later.band is not null
        and later.event_time >= anchor.event_time
        and later.event_time < anchor.event_time + interval '2 days'
    ) as cnt
    from public.buyer_quality_events(v_visitor) anchor
  ) windows;

  select coalesce(max(cnt), 0)::int into v_dev_window
  from (
    select (
      select count(distinct later.development)
      from public.buyer_quality_events(v_visitor) later
      where later.development <> ''
        and later.event_time >= anchor.event_time
        and later.event_time < anchor.event_time + interval '2 days'
    ) as cnt
    from public.buyer_quality_events(v_visitor) anchor
  ) windows;

  select coalesce(max(cnt), 0)::int into v_sessions_day
  from (
    select count(distinct session_id) filter (where session_id <> '') as cnt
    from public.buyer_quality_events(v_visitor)
    group by (event_time at time zone 'utc')::date
  ) days;

  select coalesce(max(cnt), 0)::int into v_filters_day
  from (
    select count(distinct filter_key) filter (where filter_key <> '') as cnt
    from public.buyer_quality_events(v_visitor)
    group by (event_time at time zone 'utc')::date
  ) days;

  select exists (
    select 1 from (
      select neighborhood
      from public.buyer_quality_events(v_visitor)
      where neighborhood <> ''
      group by neighborhood
      having count(distinct (event_time at time zone 'utc')::date) >= 2
    ) same
  ) into v_same_nbh;

  select exists (
    select 1 from (
      select bedrooms
      from public.buyer_quality_events(v_visitor)
      where bedrooms is not null
      group by bedrooms
      having count(distinct (event_time at time zone 'utc')::date) >= 2
    ) same
  ) into v_same_bed;

  select exists (
    select 1 from (
      select band
      from public.buyer_quality_events(v_visitor)
      where band is not null
      group by band
      having count(distinct (event_time at time zone 'utc')::date) >= 2
    ) same
  ) into v_same_band;

  select exists (
    select 1 from (
      select property_id
      from public.buyer_quality_events(v_visitor)
      where property_id <> ''
      group by property_id
      having count(distinct (event_time at time zone 'utc')::date) >= 2
    ) same
  ) into v_same_property;

  select exists (
    select 1
    from (
      select
        count(distinct neighborhood) filter (where neighborhood <> '') as neighborhoods,
        count(distinct property_id) filter (where property_id <> '') as properties
      from public.buyer_quality_events(v_visitor)
      group by (event_time at time zone 'utc')::date
    ) days
    where neighborhoods >= 8 and properties >= 20
  ) into v_breadth;

  select exists (
    select 1
    from public.buyer_quality_events(v_visitor) anchor
    where (
      select
        count(distinct later.neighborhood) filter (where later.neighborhood <> '') >= 5
        and min(later.price) filter (where later.price > 0) > 0
        and max(later.price) filter (where later.price > 0)
          / nullif(min(later.price) filter (where later.price > 0), 0) >= 8
      from public.buyer_quality_events(v_visitor) later
      where later.event_time >= anchor.event_time
        and later.event_time < anchor.event_time + interval '2 days'
    )
  ) into v_segment;

  select coalesce(max(cnt), 0)::int into v_qa
  from (
    select count(*) as cnt
    from public.buyer_quality_events(v_visitor)
    group by (event_time at time zone 'utc')::date, event_name, property_id
  ) repeats;

  if v_lead > 0 then
    v_buyer := v_buyer + least(70, v_lead * 55);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'lead_created', 'count', v_lead, 'weight', 55, 'cap', 70, 'points', least(70, v_lead * 55)));
  end if;
  if v_success > 0 then
    v_buyer := v_buyer + least(70, v_success * 50);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'ai_lead_success', 'count', v_success, 'weight', 50, 'cap', 70, 'points', least(70, v_success * 50)));
  end if;
  if v_submitted > 0 then
    v_buyer := v_buyer + least(50, v_submitted * 40);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'ai_lead_submitted', 'count', v_submitted, 'weight', 40, 'cap', 50, 'points', least(50, v_submitted * 40)));
  end if;
  if v_whatsapp > 0 then
    v_buyer := v_buyer + least(40, v_whatsapp * 32);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'property_whatsapp_click', 'count', v_whatsapp, 'weight', 32, 'cap', 40, 'points', least(40, v_whatsapp * 32)));
  end if;
  if v_phone > 0 then
    v_buyer := v_buyer + least(36, v_phone * 28);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'ai_phone_detected', 'count', v_phone, 'weight', 28, 'cap', 36, 'points', least(36, v_phone * 28)));
  end if;
  if v_specialist > 0 then
    v_buyer := v_buyer + least(32, v_specialist * 24);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'specialist_cta_opened', 'count', v_specialist, 'weight', 24, 'cap', 32, 'points', least(32, v_specialist * 24)));
  end if;
  if v_interest > 0 then
    v_buyer := v_buyer + least(30, v_interest * 22);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'property_interest', 'count', v_interest, 'weight', 22, 'cap', 30, 'points', least(30, v_interest * 22)));
  end if;
  if v_vip > 0 then
    v_buyer := v_buyer + least(24, v_vip * 18);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'vip_offer_click', 'count', v_vip, 'weight', 18, 'cap', 24, 'points', least(24, v_vip * 18)));
  end if;
  if v_form > 0 then
    v_buyer := v_buyer + least(22, v_form * 16);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'ai_lead_form_opened', 'count', v_form, 'weight', 16, 'cap', 22, 'points', least(22, v_form * 16)));
  end if;
  if v_agent > 0 then
    v_buyer := v_buyer + least(18, v_agent * 12);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'agent_opened', 'count', v_agent, 'weight', 12, 'cap', 18, 'points', least(18, v_agent * 12)));
  end if;
  if v_message > 0 then
    v_buyer := v_buyer + least(12, v_message * 4);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'ai_assistant_message', 'count', v_message, 'weight', 4, 'cap', 12, 'points', least(12, v_message * 4)));
  end if;
  if v_assistant_open > 0 then
    v_buyer := v_buyer + least(8, v_assistant_open * 4);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'ai_assistant_open', 'count', v_assistant_open, 'weight', 4, 'cap', 8, 'points', least(8, v_assistant_open * 4)));
  end if;
  if v_floorplan > 0 then
    v_buyer := v_buyer + least(12, v_floorplan * 6);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'floorplan_view', 'count', v_floorplan, 'weight', 6, 'cap', 12, 'points', least(12, v_floorplan * 6)));
  end if;
  if v_floorplan_click > 0 then
    v_buyer := v_buyer + least(8, v_floorplan_click * 4);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'development_floorplan_click', 'count', v_floorplan_click, 'weight', 4, 'cap', 8, 'points', least(8, v_floorplan_click * 4)));
  end if;
  if v_table_request > 0 then
    v_buyer := v_buyer + least(12, v_table_request * 8);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'development_table_request', 'count', v_table_request, 'weight', 8, 'cap', 12, 'points', least(12, v_table_request * 8)));
  end if;
  if v_book_request > 0 then
    v_buyer := v_buyer + least(12, v_book_request * 8);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'development_book_request', 'count', v_book_request, 'weight', 8, 'cap', 12, 'points', least(12, v_book_request * 8)));
  end if;
  if v_gallery > 0 then
    v_buyer := v_buyer + least(8, v_gallery * 3);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'property_gallery_view', 'count', v_gallery, 'weight', 3, 'cap', 8, 'points', least(8, v_gallery * 3)));
  end if;
  if v_map > 0 then
    v_buyer := v_buyer + least(6, v_map * 2);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'map_view', 'count', v_map, 'weight', 2, 'cap', 6, 'points', least(6, v_map * 2)));
  end if;
  if v_views > 0 then
    v_buyer := v_buyer + least(12, v_views * 2);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'property_view', 'count', v_views, 'weight', 2, 'cap', 12, 'points', least(12, v_views * 2)));
  end if;
  if v_view_multiple > 0 then
    v_buyer := v_buyer + least(8, v_view_multiple * 4);
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'property_view_multiple', 'count', v_view_multiple, 'weight', 4, 'cap', 8, 'points', least(8, v_view_multiple * 4)));
  end if;
  if v_days >= 2 then
    v_buyer := v_buyer + 8;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'return_days', 'count', 1, 'weight', 8, 'cap', 8, 'points', 8));
  end if;
  if v_days >= 4 then
    v_buyer := v_buyer + 8;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'return_days_sustained', 'count', 1, 'weight', 8, 'cap', 8, 'points', 8));
  end if;
  if v_same_nbh then
    v_buyer := v_buyer + 8;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'same_neighborhood_across_days', 'count', 1, 'weight', 8, 'cap', 8, 'points', 8));
  end if;
  if v_same_bed then
    v_buyer := v_buyer + 6;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'same_bedrooms_across_days', 'count', 1, 'weight', 6, 'cap', 6, 'points', 6));
  end if;
  if v_same_band then
    v_buyer := v_buyer + 6;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'same_price_band_across_days', 'count', 1, 'weight', 6, 'cap', 6, 'points', 6));
  end if;
  if v_properties >= 3 and v_neighborhoods >= 1 and v_neighborhoods <= 2 then
    v_buyer := v_buyer + 8;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'few_neighborhoods', 'count', 1, 'weight', 8, 'cap', 8, 'points', 8));
  end if;
  if v_views >= 3 and v_types >= 1 and v_types <= 2 then
    v_buyer := v_buyer + 6;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'few_property_types', 'count', 1, 'weight', 6, 'cap', 6, 'points', 6));
  end if;
  if v_same_property then
    v_buyer := v_buyer + 6;
    v_buyer_signals := v_buyer_signals || jsonb_build_array(jsonb_build_object('name', 'same_property_across_days', 'count', 1, 'weight', 6, 'cap', 6, 'points', 6));
  end if;
  v_buyer := least(100, greatest(0, v_buyer));

  if v_lead > 0 then
    v_commercial := v_commercial + least(80, v_lead * 70);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'lead_created', 'count', v_lead, 'weight', 70, 'cap', 80, 'points', least(80, v_lead * 70)));
  end if;
  if v_success > 0 then
    v_commercial := v_commercial + least(80, v_success * 65);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'ai_lead_success', 'count', v_success, 'weight', 65, 'cap', 80, 'points', least(80, v_success * 65)));
  end if;
  if v_submitted > 0 then
    v_commercial := v_commercial + least(60, v_submitted * 50);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'ai_lead_submitted', 'count', v_submitted, 'weight', 50, 'cap', 60, 'points', least(60, v_submitted * 50)));
  end if;
  if v_whatsapp > 0 then
    v_commercial := v_commercial + least(50, v_whatsapp * 40);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'property_whatsapp_click', 'count', v_whatsapp, 'weight', 40, 'cap', 50, 'points', least(50, v_whatsapp * 40)));
  end if;
  if v_phone > 0 then
    v_commercial := v_commercial + least(42, v_phone * 35);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'ai_phone_detected', 'count', v_phone, 'weight', 35, 'cap', 42, 'points', least(42, v_phone * 35)));
  end if;
  if v_specialist > 0 then
    v_commercial := v_commercial + least(36, v_specialist * 28);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'specialist_cta_opened', 'count', v_specialist, 'weight', 28, 'cap', 36, 'points', least(36, v_specialist * 28)));
  end if;
  if v_interest > 0 then
    v_commercial := v_commercial + least(34, v_interest * 26);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'property_interest', 'count', v_interest, 'weight', 26, 'cap', 34, 'points', least(34, v_interest * 26)));
  end if;
  if v_vip > 0 then
    v_commercial := v_commercial + least(28, v_vip * 20);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'vip_offer_click', 'count', v_vip, 'weight', 20, 'cap', 28, 'points', least(28, v_vip * 20)));
  end if;
  if v_form > 0 then
    v_commercial := v_commercial + least(24, v_form * 18);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'ai_lead_form_opened', 'count', v_form, 'weight', 18, 'cap', 24, 'points', least(24, v_form * 18)));
  end if;
  if v_agent > 0 then
    v_commercial := v_commercial + least(18, v_agent * 12);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'agent_opened', 'count', v_agent, 'weight', 12, 'cap', 18, 'points', least(18, v_agent * 12)));
  end if;
  if v_message > 0 then
    v_commercial := v_commercial + least(12, v_message * 4);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'ai_assistant_message', 'count', v_message, 'weight', 4, 'cap', 12, 'points', least(12, v_message * 4)));
  end if;
  if v_floorplan > 0 then
    v_commercial := v_commercial + least(12, v_floorplan * 6);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'floorplan_view', 'count', v_floorplan, 'weight', 6, 'cap', 12, 'points', least(12, v_floorplan * 6)));
  end if;
  if v_table_request > 0 then
    v_commercial := v_commercial + least(16, v_table_request * 10);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'development_table_request', 'count', v_table_request, 'weight', 10, 'cap', 16, 'points', least(16, v_table_request * 10)));
  end if;
  if v_book_request > 0 then
    v_commercial := v_commercial + least(16, v_book_request * 10);
    v_commercial_signals := v_commercial_signals || jsonb_build_array(jsonb_build_object('name', 'development_book_request', 'count', v_book_request, 'weight', 10, 'cap', 16, 'points', least(16, v_book_request * 10)));
  end if;
  v_commercial := least(100, greatest(0, v_commercial));

  v_day_points := case
    when v_days >= 7 then 84
    when v_days = 6 then 76
    when v_days = 5 then 68
    when v_days = 4 then 58
    when v_days = 3 then 42
    when v_days = 2 then 28
    when v_days = 1 then 8
    else 0
  end;
  if v_day_points > 0 then
    v_recurrence := v_recurrence + v_day_points;
    v_recurrence_signals := v_recurrence_signals || jsonb_build_array(jsonb_build_object('name', 'distinct_days', 'points', v_day_points));
  end if;
  v_session_points := least(case when v_days <= 1 then 6 else 15 end, greatest(0, v_sessions - 1) * 3);
  if v_session_points > 0 then
    v_recurrence := v_recurrence + v_session_points;
    v_recurrence_signals := v_recurrence_signals || jsonb_build_array(jsonb_build_object('name', 'extra_sessions', 'points', v_session_points));
  end if;
  if v_same_nbh then
    v_recurrence := v_recurrence + 8;
    v_recurrence_signals := v_recurrence_signals || jsonb_build_array(jsonb_build_object('name', 'same_neighborhood_across_days', 'points', 8));
  end if;
  if v_same_bed then
    v_recurrence := v_recurrence + 6;
    v_recurrence_signals := v_recurrence_signals || jsonb_build_array(jsonb_build_object('name', 'same_bedrooms_across_days', 'points', 6));
  end if;
  if v_same_property then
    v_recurrence := v_recurrence + 8;
    v_recurrence_signals := v_recurrence_signals || jsonb_build_array(jsonb_build_object('name', 'same_property_across_days', 'points', 8));
  end if;
  if v_span >= 1 then v_span_points := v_span_points + 6; end if;
  if v_span >= 3 then v_span_points := v_span_points + 8; end if;
  if v_span >= 7 then v_span_points := v_span_points + 6; end if;
  if v_span_points > 0 then
    v_recurrence := v_recurrence + v_span_points;
    v_recurrence_signals := v_recurrence_signals || jsonb_build_array(jsonb_build_object('name', 'activity_span', 'points', v_span_points));
  end if;
  v_recurrence := least(100, greatest(0, v_recurrence));

  if v_views_day >= 40 or v_events_day >= 80 then
    v_broker := v_broker + 28;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'volume_spike', 'points', 28));
  end if;
  if v_views_two_hours >= 25 or v_views_day >= 40 then
    v_broker := v_broker + 22;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'view_burst', 'points', 22));
  end if;
  if v_nbh_window >= 8 then
    v_broker := v_broker + 24;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'neighborhood_scatter', 'points', 24));
  end if;
  if v_bed_window >= 3 then
    v_broker := v_broker + 18;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'bedroom_flip', 'points', 18));
  end if;
  if v_band_window >= 3 then
    v_broker := v_broker + 16;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'price_swing', 'points', 16));
  end if;
  if v_dev_window >= 6 then
    v_broker := v_broker + 14;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'developer_scatter', 'points', 14));
  end if;
  if v_sessions_day >= 8 then
    v_broker := v_broker + 12;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'session_burst', 'points', 12));
  end if;
  if v_filters_day >= 8 then
    v_broker := v_broker + 14;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'filter_churn', 'points', 14));
  end if;
  v_progression := v_lead + v_success + v_submitted + v_whatsapp + v_phone + v_specialist + v_interest + v_vip + v_form;
  if v_views >= 25 and v_progression = 0 and v_neighborhoods >= 6 then
    v_broker := v_broker + 20;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'browse_without_commerce', 'points', 20));
  end if;
  if v_breadth then
    v_broker := v_broker + 18;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'breadth_same_day', 'points', 18));
  end if;
  if v_qa >= 20 then
    v_broker := v_broker + 16;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'qa_repetition', 'points', 16));
  end if;
  if v_segment then
    v_broker := v_broker + 16;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'segment_cross', 'points', 16));
  end if;
  if v_metadata_test then
    v_broker := v_broker + 55;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'metadata_test', 'points', 55));
  end if;
  if v_test_id then
    v_broker := v_broker + 40;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'test_identifier', 'points', 40));
  end if;
  if v_test_click then
    v_broker := v_broker + 28;
    v_broker_signals := v_broker_signals || jsonb_build_array(jsonb_build_object('name', 'test_click_id', 'points', 28));
  end if;
  v_broker := least(100, greatest(0, v_broker));

  v_confidence :=
    case
      when v_events >= 20 then 42
      when v_events >= 10 then 36
      when v_events >= 5 then 28
      when v_events >= 2 then 16
      when v_events >= 1 then 8
      else 0
    end
    + case when v_sessions >= 4 then 22 when v_sessions >= 2 then 14 when v_sessions >= 1 then 6 else 0 end
    + case when v_days >= 4 then 20 when v_days >= 2 then 12 when v_days >= 1 then 4 else 0 end
    + case when v_visitor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then 8 else 0 end
    + case when v_sessions_consistent then 6 else 0 end
    + case when v_properties > 0 then 6 else 0 end
    + case when v_intent then 6 else 0 end
    + case when v_touch then 6 else 0 end;
  if v_events >= 1 then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object(
      'name', 'events',
      'count', v_events,
      'points', case when v_events >= 20 then 42 when v_events >= 10 then 36 when v_events >= 5 then 28 when v_events >= 2 then 16 else 8 end
    ));
  end if;
  if v_sessions >= 1 then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object(
      'name', 'sessions',
      'count', v_sessions,
      'points', case when v_sessions >= 4 then 22 when v_sessions >= 2 then 14 else 6 end
    ));
  end if;
  if v_days >= 1 then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object(
      'name', 'days',
      'count', v_days,
      'points', case when v_days >= 4 then 20 when v_days >= 2 then 12 else 4 end
    ));
  end if;
  if v_visitor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object('name', 'valid_visitor', 'count', 1, 'points', 8));
  end if;
  if v_sessions_consistent then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object('name', 'session_consistency', 'count', v_events, 'points', 6));
  end if;
  if v_properties > 0 then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object('name', 'property_presence', 'count', v_properties, 'points', 6));
  end if;
  if v_intent then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object('name', 'intent_presence', 'count', 1, 'points', 6));
  end if;
  if v_touch then
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object('name', 'touch_presence', 'count', 1, 'points', 6));
  end if;
  if v_metadata_test or v_test_id or v_test_click then
    v_confidence := v_confidence - 30;
    v_confidence_signals := v_confidence_signals || jsonb_build_array(jsonb_build_object('name', 'synthetic_penalty', 'count', 1, 'points', -30));
  end if;
  v_confidence := least(100, greatest(0, v_confidence));

  if v_lead > 0 or v_success > 0 then
    v_buyer_class := 'lead';
  elsif v_buyer >= 70 and v_commercial >= 45 then
    v_buyer_class := 'high_intent';
  elsif v_buyer >= 50 then
    v_buyer_class := 'engaged';
  elsif v_buyer >= 25 then
    v_buyer_class := 'exploring';
  elsif v_buyer > 0 then
    v_buyer_class := 'low_intent';
  end if;

  if v_buyer >= 50 and v_broker >= 50 then
    v_traffic_class := 'mixed';
  elsif v_broker >= 70 and v_confidence >= 40 then
    v_traffic_class := 'likely_broker_or_tester';
  elsif v_buyer >= 50 and v_broker < 50 and v_confidence >= 40 then
    v_traffic_class := 'likely_buyer';
  end if;

  v_breakdown := jsonb_build_object(
    'version', 'v1',
    'buyer_intent', jsonb_build_object('score', v_buyer, 'signals', v_buyer_signals),
    'commercial_intent', jsonb_build_object('score', v_commercial, 'signals', v_commercial_signals),
    'recurrence', jsonb_build_object('score', v_recurrence, 'signals', v_recurrence_signals),
    'broker_tester', jsonb_build_object('score', v_broker, 'signals', v_broker_signals),
    'data_confidence', jsonb_build_object('score', v_confidence, 'signals', v_confidence_signals),
    'classes', jsonb_build_object(
      'buyer_class', v_buyer_class,
      'traffic_quality_class', v_traffic_class,
      'thresholds', jsonb_build_object(
        'high_intent_buyer', 70,
        'high_intent_commercial', 45,
        'engaged_buyer', 50,
        'exploring_buyer', 25,
        'broker_class', 70,
        'confidence_floor', 40,
        'mixed_buyer', 50,
        'mixed_broker', 50,
        'likely_buyer_floor', 50,
        'likely_buyer_broker_ceiling', 50
      )
    ),
    'ignored', jsonb_build_array('income', 'renda', 'income_percentile', 'household_income', 'google_income')
  );

  insert into public.buyer_quality_scores (
    visitor_id,
    buyer_intent_score,
    commercial_intent_score,
    recurrence_score,
    broker_tester_score,
    data_confidence_score,
    buyer_class,
    traffic_quality_class,
    score_breakdown,
    first_event_at,
    last_event_at,
    distinct_days,
    session_count,
    event_count,
    property_count,
    neighborhood_count,
    updated_at
  ) values (
    v_visitor,
    v_buyer,
    v_commercial,
    v_recurrence,
    v_broker,
    v_confidence,
    v_buyer_class,
    v_traffic_class,
    v_breakdown,
    v_first,
    v_last,
    v_days,
    v_sessions,
    v_events,
    v_properties,
    v_neighborhoods,
    now()
  )
  on conflict (visitor_id) do update set
    buyer_intent_score = excluded.buyer_intent_score,
    commercial_intent_score = excluded.commercial_intent_score,
    recurrence_score = excluded.recurrence_score,
    broker_tester_score = excluded.broker_tester_score,
    data_confidence_score = excluded.data_confidence_score,
    buyer_class = excluded.buyer_class,
    traffic_quality_class = excluded.traffic_quality_class,
    score_breakdown = excluded.score_breakdown,
    first_event_at = excluded.first_event_at,
    last_event_at = excluded.last_event_at,
    distinct_days = excluded.distinct_days,
    session_count = excluded.session_count,
    event_count = excluded.event_count,
    property_count = excluded.property_count,
    neighborhood_count = excluded.neighborhood_count,
    updated_at = now();

  select to_jsonb(score) into v_score
  from public.buyer_quality_scores as score
  where score.visitor_id = v_visitor;

  return jsonb_build_object('status', 'ok', 'score', v_score);
end;
$$;

create or replace function public.get_buyer_quality_score(p_visitor_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_visitor text := public.buyer_quality_text(p_visitor_id);
  v_score jsonb;
begin
  if v_visitor = '' or length(v_visitor) > 80 then
    return jsonb_build_object('status', 'rejected', 'error', 'visitor_id obrigatório', 'score', null);
  end if;
  select to_jsonb(score) into v_score
  from public.buyer_quality_scores as score
  where score.visitor_id = v_visitor;
  return jsonb_build_object('status', 'ok', 'score', v_score);
end;
$$;

revoke all on table public.buyer_quality_scores from public;

do $$
declare
  v_signature text;
  v_role text;
  v_functions text[] := array[
    'public.buyer_quality_text(text)',
    'public.buyer_quality_events(text)',
    'public.recompute_buyer_quality_score(text)',
    'public.get_buyer_quality_score(text)'
  ];
begin
  foreach v_signature in array v_functions loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('alter function %s security invoker set search_path = pg_catalog', v_signature);
  end loop;

  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.buyer_quality_scores from %I', v_role);
      foreach v_signature in array v_functions loop
        execute format('revoke all on function %s from %I', v_signature, v_role);
      end loop;
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select on table public.ads_events to service_role';
    execute 'grant select, insert, update, delete on table public.buyer_quality_scores to service_role';
    foreach v_signature in array v_functions loop
      execute format('grant execute on function %s to service_role', v_signature);
    end loop;
  end if;
end $$;
