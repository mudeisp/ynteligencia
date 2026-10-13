/*
  Incremental. Rode este arquivo se supabase/ads_events.sql
  já foi aplicado antes da tabela ads_handoffs.

  Não altera leads, events, behavior_events, properties,
  ads_events nem ads_visitors.

  RLS fica ligado e sem policy pública.
  Só a service role grava e lê.
*/

create table if not exists public.ads_handoffs (
  handoff_id text primary key,
  visitor_id text not null,
  session_id text not null,
  source_product text not null,
  target_product text not null,
  context jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists ads_handoffs_expires_idx
  on public.ads_handoffs (expires_at);

alter table public.ads_handoffs enable row level security;
