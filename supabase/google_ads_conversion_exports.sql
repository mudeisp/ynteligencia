/*
  Ledger de exportação do CSV de lead_created.
  ads_events continua sendo a fonte do evento.
  Esta tabela só registra se aquele event_id já entrou num CSV.

  Não executar em Production a partir daqui.
  Aplicar manualmente no SQL editor, como service role, depois da revisão.

  Rollback:
    drop function if exists public.claim_google_lead_conversions(integer);
    drop table if exists public.google_ads_conversion_exports;
*/

create table if not exists public.google_ads_conversion_exports (
  event_id text not null,
  conversion_name text not null,
  exported_at timestamptz,
  status text not null default 'exported',
  attempts integer not null default 1,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  primary key (event_id, conversion_name),
  constraint google_ads_conversion_exports_status_check
    check (status in ('exported', 'failed')),
  constraint google_ads_conversion_exports_attempts_check
    check (attempts >= 1)
);

create index if not exists google_ads_conversion_exports_status_idx
  on public.google_ads_conversion_exports (conversion_name, status, exported_at);

alter table public.google_ads_conversion_exports enable row level security;

revoke all on table public.google_ads_conversion_exports from public;

create or replace function public.claim_google_lead_conversions(p_limit integer)
returns table (
  event_id text,
  event_time timestamptz,
  product text,
  gclid text,
  gbraid text,
  wbraid text
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_row record;
  v_claimed text;
begin
  for v_row in
    select
      event.event_id,
      event.event_time,
      event.product,
      event.gclid,
      event.gbraid,
      event.wbraid
    from public.ads_events as event
    where event.event_name = 'lead_created'
      and (
        btrim(coalesce(event.gclid, '')) <> ''
        or btrim(coalesce(event.gbraid, '')) <> ''
        or btrim(coalesce(event.wbraid, '')) <> ''
      )
      and not exists (
        select 1
        from public.google_ads_conversion_exports as prior
        where prior.event_id = event.event_id
          and prior.conversion_name = 'Lead Created'
          and prior.status = 'exported'
      )
    order by event.event_time asc, event.event_id asc
    limit v_limit
    for update of event skip locked
  loop
    v_claimed := null;
    insert into public.google_ads_conversion_exports (
      event_id,
      conversion_name,
      exported_at,
      status,
      attempts,
      last_error
    ) values (
      v_row.event_id,
      'Lead Created',
      now(),
      'exported',
      1,
      ''
    )
    on conflict (event_id, conversion_name) do update
      set exported_at = now(),
          status = 'exported',
          attempts = public.google_ads_conversion_exports.attempts + 1,
          last_error = ''
      where public.google_ads_conversion_exports.status = 'failed'
    returning public.google_ads_conversion_exports.event_id into v_claimed;

    if v_claimed is not null then
      event_id := v_row.event_id;
      event_time := v_row.event_time;
      product := v_row.product;
      gclid := v_row.gclid;
      gbraid := v_row.gbraid;
      wbraid := v_row.wbraid;
      return next;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_role text;
begin
  revoke all on function public.claim_google_lead_conversions(integer) from public;
  alter function public.claim_google_lead_conversions(integer)
    security invoker
    set search_path = pg_catalog;

  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format(
        'revoke all on table public.google_ads_conversion_exports from %I',
        v_role
      );
      execute format(
        'revoke all on function public.claim_google_lead_conversions(integer) from %I',
        v_role
      );
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.google_ads_conversion_exports to service_role';
    execute 'grant select, update on table public.ads_events to service_role';
    execute 'grant execute on function public.claim_google_lead_conversions(integer) to service_role';
  end if;
end $$;
