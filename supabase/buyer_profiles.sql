/*
  Buyer Profile V1.

  Projeção derivada de ads_events. Não altera ads_events, ads_visitors,
  ads_handoffs, leads, events, behavior_events nem properties.

  Aplicar manualmente no SQL Editor do Supabase, com a service role.
  Não rode este arquivo em produção por engano a partir do app:
  o código só lê e grava esta tabela; ele não executa a migration.

  RLS ligada e sem policy pública. A service role ignora RLS.
  anon e authenticated não recebem policy, então não leem nem gravam.

  Rollback:
    drop table if exists public.buyer_profiles;
  Isso não apaga ads_events. O próximo evento volta a tentar
  materializar o perfil e, sem a tabela, segue sem quebrar o evento.
*/

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
  total_property_views integer not null default 0,
  unique_properties_viewed integer not null default 0,
  total_ai_searches integer not null default 0,
  total_agent_opens integer not null default 0,
  total_leads integer not null default 0,
  last_property_id text not null default '',
  last_property_name text not null default '',
  last_property_neighborhood text not null default '',
  last_search_summary text not null default '',
  last_activity_type text not null default '',
  last_activity_at timestamptz,
  observed_neighborhoods jsonb not null default '[]'::jsonb,
  first_touch jsonb not null default '{}'::jsonb,
  current_touch jsonb not null default '{}'::jsonb,
  last_gclid text not null default '',
  last_utm_source text not null default '',
  last_utm_medium text not null default '',
  last_utm_campaign text not null default '',
  stage text not null default 'anonymous',
  viewed_property_ids jsonb not null default '[]'::jsonb,
  known_session_ids jsonb not null default '[]'::jsonb,
  applied_event_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_profiles_stage_check check (
    stage in ('anonymous', 'exploring', 'engaged', 'lead')
  )
);

create index if not exists buyer_profiles_last_seen_idx
  on public.buyer_profiles (last_seen_at desc);

alter table public.buyer_profiles enable row level security;
