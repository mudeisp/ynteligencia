/*
  Identidade atômica de lead_created.

  ads_events continua sendo a fonte do evento.
  Este arquivo não apaga linha, não reescreve clique antigo e não roda em Production daqui.

  A janela de 15 minutos é a identidade lógica quando a YNTELIGENCIA e o Agent
  não compartilham um event_id. O mesmo visitante e o mesmo imóvel nesse
  intervalo produzem um único lead_created. Isso segura duplo submit, reload
  e os dois produtos. O custo é juntar dois pedidos legítimos nesse intervalo.
  Não existe um id de formulário compartilhado entre os produtos; aumentar a
  janela juntaria mais pedidos reais, e tirá-la deixaria a conversão duplicar.
  O mesmo event_id continua único mesmo depois da janela.
  Imóvel diferente ou visitante diferente não entra nessa identidade.

  A garantia não é o SELECT da aplicação. record_ads_lead segura um
  pg_advisory_xact_lock do par visitante+imóvel e só então lê e insere,
  na mesma transação. O trigger ads_lead_identity_guard repete essa regra
  para qualquer insert direto em ads_events.

  Toque real fica em gclid/gbraid/wbraid e nos UTMs.
  Atribuição da conversão Google fica em conversion_gclid/gbraid/wbraid
  e conversion_click_source (current_session, prior_session, prior_visitor).
  Clique de outra sessão não entra no toque real.

  Rollback sem apagar coluna:
    drop trigger if exists ads_lead_identity_guard on public.ads_events;
    drop function if exists public.ads_lead_identity_guard();
    drop function if exists public.record_ads_lead(jsonb);
*/

alter table public.ads_events
  add column if not exists conversion_gclid text not null default '',
  add column if not exists conversion_gbraid text not null default '',
  add column if not exists conversion_wbraid text not null default '',
  add column if not exists conversion_click_source text not null default '';

alter table public.ads_events
  drop constraint if exists ads_events_conversion_click_source_check;

alter table public.ads_events
  add constraint ads_events_conversion_click_source_check
  check (conversion_click_source in ('', 'current_session', 'prior_session', 'prior_visitor'));

create index if not exists ads_events_lead_identity_idx
  on public.ads_events (visitor_id, property_id, event_time)
  where event_name = 'lead_created';

create or replace function public.ads_lead_identity_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.event_name is distinct from 'lead_created' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      btrim(coalesce(new.visitor_id, '')) || chr(31) || btrim(coalesce(new.property_id, '')),
      0
    )
  );

  if exists (
    select 1
    from public.ads_events as existing
    where existing.event_name = 'lead_created'
      and existing.visitor_id = new.visitor_id
      and existing.property_id = new.property_id
      and existing.event_id is distinct from new.event_id
      and existing.event_time >= new.event_time - interval '15 minutes'
      and existing.event_time <= new.event_time + interval '1 second'
  ) then
    raise exception 'ads_lead_duplicate'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists ads_lead_identity_guard on public.ads_events;

create trigger ads_lead_identity_guard
before insert on public.ads_events
for each row
execute function public.ads_lead_identity_guard();

create or replace function public.record_ads_lead(p_row jsonb)
returns table (
  event_id text,
  duplicate boolean,
  conflict boolean
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_event_id text;
  v_visitor text;
  v_property text;
  v_time timestamptz;
  v_existing record;
  v_source text;
begin
  if p_row is null or jsonb_typeof(p_row) <> 'object' or coalesce(p_row->>'event_name', '') <> 'lead_created' then
    event_id := '';
    duplicate := false;
    conflict := true;
    return next;
    return;
  end if;

  v_visitor := btrim(coalesce(p_row->>'visitor_id', ''));
  v_property := btrim(coalesce(p_row->>'property_id', ''));
  v_event_id := btrim(coalesce(p_row->>'event_id', ''));
  if v_event_id = '' then
    v_event_id := gen_random_uuid()::text;
  end if;
  if v_visitor = '' or length(v_event_id) > 200 or length(v_visitor) > 80 or length(v_property) > 120 then
    event_id := '';
    duplicate := false;
    conflict := true;
    return next;
    return;
  end if;

  begin
    v_time := nullif(p_row->>'event_time', '')::timestamptz;
  exception when others then
    event_id := '';
    duplicate := false;
    conflict := true;
    return next;
    return;
  end;
  if v_time is null then
    event_id := '';
    duplicate := false;
    conflict := true;
    return next;
    return;
  end if;

  v_source := btrim(coalesce(p_row->>'conversion_click_source', ''));
  if v_source not in ('current_session', 'prior_session', 'prior_visitor') then
    v_source := '';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_visitor || chr(31) || v_property, 0));

  select
    existing.event_id,
    existing.event_name,
    existing.visitor_id
  into v_existing
  from public.ads_events as existing
  where existing.event_id = v_event_id
     or (
       existing.event_name = 'lead_created'
       and existing.visitor_id = v_visitor
       and existing.property_id = v_property
       and existing.event_time >= v_time - interval '15 minutes'
       and existing.event_time <= v_time + interval '1 second'
     )
  order by
    case when existing.event_id = v_event_id then 0 else 1 end,
    existing.event_time asc,
    existing.event_id asc
  limit 1;

  if found then
    event_id := v_existing.event_id;
    if v_existing.event_id = v_event_id and (
      v_existing.visitor_id is distinct from v_visitor
      or v_existing.event_name is distinct from 'lead_created'
    ) then
      duplicate := false;
      conflict := true;
    else
      duplicate := true;
      conflict := false;
    end if;
    return next;
    return;
  end if;

  begin
    insert into public.ads_events (
      event_id,
      event_name,
      event_time,
      product,
      visitor_id,
      session_id,
      gclid,
      gbraid,
      wbraid,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      declared_neighborhood,
      declared_development,
      declared_bedrooms,
      declared_min_price,
      declared_max_price,
      declared_inventory_source,
      property_id,
      property_name,
      property_neighborhood,
      property_development,
      property_bedrooms,
      property_price,
      property_inventory_source,
      observed_neighborhood,
      observed_bedrooms,
      observed_price_min,
      observed_price_max,
      observed_confidence,
      metadata,
      conversion_gclid,
      conversion_gbraid,
      conversion_wbraid,
      conversion_click_source
    ) values (
      v_event_id,
      'lead_created',
      v_time,
      left(btrim(coalesce(p_row->>'product', '')), 40),
      v_visitor,
      left(btrim(coalesce(p_row->>'session_id', '')), 120),
      left(btrim(coalesce(p_row->>'gclid', '')), 200),
      left(btrim(coalesce(p_row->>'gbraid', '')), 200),
      left(btrim(coalesce(p_row->>'wbraid', '')), 200),
      left(btrim(coalesce(p_row->>'utm_source', '')), 120),
      left(btrim(coalesce(p_row->>'utm_medium', '')), 120),
      left(btrim(coalesce(p_row->>'utm_campaign', '')), 120),
      left(btrim(coalesce(p_row->>'utm_term', '')), 120),
      left(btrim(coalesce(p_row->>'utm_content', '')), 120),
      left(btrim(coalesce(p_row->>'declared_neighborhood', '')), 80),
      left(btrim(coalesce(p_row->>'declared_development', '')), 120),
      case when coalesce(p_row->>'declared_bedrooms', '') ~ '^[0-9]+$' then (p_row->>'declared_bedrooms')::integer else null end,
      case when coalesce(p_row->>'declared_min_price', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_row->>'declared_min_price')::numeric else null end,
      case when coalesce(p_row->>'declared_max_price', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_row->>'declared_max_price')::numeric else null end,
      left(btrim(coalesce(p_row->>'declared_inventory_source', '')), 20),
      v_property,
      left(btrim(coalesce(p_row->>'property_name', '')), 180),
      left(btrim(coalesce(p_row->>'property_neighborhood', '')), 80),
      left(btrim(coalesce(p_row->>'property_development', '')), 120),
      case when coalesce(p_row->>'property_bedrooms', '') ~ '^[0-9]+$' then (p_row->>'property_bedrooms')::integer else null end,
      case when coalesce(p_row->>'property_price', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_row->>'property_price')::numeric else null end,
      left(btrim(coalesce(p_row->>'property_inventory_source', '')), 40),
      left(btrim(coalesce(p_row->>'observed_neighborhood', '')), 80),
      case when coalesce(p_row->>'observed_bedrooms', '') ~ '^[0-9]+$' then (p_row->>'observed_bedrooms')::integer else null end,
      case when coalesce(p_row->>'observed_price_min', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_row->>'observed_price_min')::numeric else null end,
      case when coalesce(p_row->>'observed_price_max', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_row->>'observed_price_max')::numeric else null end,
      case when coalesce(p_row->>'observed_confidence', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_row->>'observed_confidence')::numeric else 0 end,
      case when jsonb_typeof(p_row->'metadata') = 'object' then p_row->'metadata' else '{}'::jsonb end,
      left(btrim(coalesce(p_row->>'conversion_gclid', '')), 200),
      left(btrim(coalesce(p_row->>'conversion_gbraid', '')), 200),
      left(btrim(coalesce(p_row->>'conversion_wbraid', '')), 200),
      v_source
    );
  exception
    when unique_violation then
      select
        existing.event_id,
        existing.event_name,
        existing.visitor_id
      into v_existing
      from public.ads_events as existing
      where existing.event_id = v_event_id
         or (
           existing.event_name = 'lead_created'
           and existing.visitor_id = v_visitor
           and existing.property_id = v_property
           and existing.event_time >= v_time - interval '15 minutes'
           and existing.event_time <= v_time + interval '1 second'
         )
      order by
        case when existing.event_id = v_event_id then 0 else 1 end,
        existing.event_time asc,
        existing.event_id asc
      limit 1;

      if not found then
        raise;
      end if;
      event_id := v_existing.event_id;
      if v_existing.visitor_id is distinct from v_visitor or v_existing.event_name is distinct from 'lead_created' then
        duplicate := false;
        conflict := true;
      else
        duplicate := true;
        conflict := false;
      end if;
      return next;
      return;
  end;

  event_id := v_event_id;
  duplicate := false;
  conflict := false;
  return next;
end;
$$;

do $$
declare
  v_role text;
begin
  revoke all on function public.ads_lead_identity_guard() from public;
  revoke all on function public.record_ads_lead(jsonb) from public;
  alter function public.ads_lead_identity_guard() security invoker set search_path = pg_catalog;
  alter function public.record_ads_lead(jsonb) security invoker set search_path = pg_catalog;

  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.ads_lead_identity_guard() from %I', v_role);
      execute format('revoke all on function public.record_ads_lead(jsonb) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert on table public.ads_events to service_role';
    execute 'grant execute on function public.ads_lead_identity_guard() to service_role';
    execute 'grant execute on function public.record_ads_lead(jsonb) to service_role';
  end if;
end $$;
