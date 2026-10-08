/*
  Camada de anúncios. Não altera leads, events, behavior_events nem properties.

  Banco novo: aplique somente este arquivo.
  Banco que já rodou a versão com declared_intent:
  aplique depois supabase/ads_visitors_declared_split.sql.
  CREATE IF NOT EXISTS não adiciona coluna em tabela existente.

  RLS fica ligado e sem policy pública. Só a service role grava e lê.
*/

create table if not exists public.ads_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_name text not null,
  event_time timestamptz not null,
  product text not null,
  visitor_id text not null,
  session_id text not null,
  gclid text not null default '',
  gbraid text not null default '',
  wbraid text not null default '',
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  utm_term text not null default '',
  utm_content text not null default '',
  declared_neighborhood text not null default '',
  declared_development text not null default '',
  declared_bedrooms integer,
  declared_min_price numeric,
  declared_max_price numeric,
  declared_inventory_source text not null default '',
  property_id text not null default '',
  property_name text not null default '',
  property_neighborhood text not null default '',
  property_development text not null default '',
  property_bedrooms integer,
  property_price numeric,
  property_inventory_source text not null default '',
  observed_neighborhood text not null default '',
  observed_bedrooms integer,
  observed_price_min numeric,
  observed_price_max numeric,
  observed_confidence numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ads_events_visitor_session_idx
  on public.ads_events (visitor_id, session_id, event_time);

create index if not exists ads_events_dedupe_idx
  on public.ads_events (visitor_id, session_id, event_name, property_id, event_time);

create table if not exists public.ads_visitors (
  visitor_id text primary key,
  first_gclid text not null default '',
  first_gbraid text not null default '',
  first_wbraid text not null default '',
  first_utm_source text not null default '',
  first_utm_campaign text not null default '',
  first_product text not null default '',
  first_seen timestamptz not null,
  last_gclid text not null default '',
  last_gbraid text not null default '',
  last_wbraid text not null default '',
  last_utm_source text not null default '',
  last_utm_campaign text not null default '',
  last_product text not null default '',
  last_seen timestamptz not null,
  first_declared_intent jsonb,
  current_declared_intent jsonb,
  observed_intent jsonb,
  observed_confidence numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ads_events enable row level security;
alter table public.ads_visitors enable row level security;
