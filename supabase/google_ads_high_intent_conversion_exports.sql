/*
  Export incremental de high_intent_buyer para a Conversion Action
  "High Intent Buyer". Reutiliza o ledger google_ads_conversion_exports,
  mas mantém claim/confirm/fail separados do fluxo Lead Created.

  Não executar em Production automaticamente.
  Aplicar manualmente no SQL editor, como service role, depois da revisão.

  Rollback:
    drop function if exists public.fail_google_high_intent_conversions(text[], text);
    drop function if exists public.confirm_google_high_intent_conversions(text[]);
    drop function if exists public.claim_google_high_intent_conversions(integer, interval);
*/

create or replace function public.claim_google_high_intent_conversions(
  p_limit integer,
  p_stale_after interval default interval '15 minutes'
)
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
  v_stale interval := coalesce(p_stale_after, interval '15 minutes');
begin
  if v_stale <= interval '0' then
    v_stale := interval '15 minutes';
  end if;

  return query
  with clicks as (
    select
      event.event_id,
      event.event_time,
      event.product,
      case
        when btrim(coalesce(event.conversion_gclid, '')) <> ''
          or btrim(coalesce(event.conversion_gbraid, '')) <> ''
          or btrim(coalesce(event.conversion_wbraid, '')) <> ''
        then btrim(coalesce(event.conversion_gclid, ''))
        when btrim(coalesce(event.conversion_click_source, '')) in ('', 'current_session')
        then btrim(coalesce(event.gclid, ''))
        else ''
      end as gclid,
      case
        when btrim(coalesce(event.conversion_gclid, '')) <> ''
          or btrim(coalesce(event.conversion_gbraid, '')) <> ''
          or btrim(coalesce(event.conversion_wbraid, '')) <> ''
        then btrim(coalesce(event.conversion_gbraid, ''))
        when btrim(coalesce(event.conversion_click_source, '')) in ('', 'current_session')
        then btrim(coalesce(event.gbraid, ''))
        else ''
      end as gbraid,
      case
        when btrim(coalesce(event.conversion_gclid, '')) <> ''
          or btrim(coalesce(event.conversion_gbraid, '')) <> ''
          or btrim(coalesce(event.conversion_wbraid, '')) <> ''
        then btrim(coalesce(event.conversion_wbraid, ''))
        when btrim(coalesce(event.conversion_click_source, '')) in ('', 'current_session')
        then btrim(coalesce(event.wbraid, ''))
        else ''
      end as wbraid
    from public.ads_events as event
    where event.event_name = 'high_intent_buyer'
  ),
  candidates as (
    select clicks.*
    from clicks
    where (clicks.gclid <> '' or clicks.gbraid <> '' or clicks.wbraid <> '')
      and not exists (
        select 1
        from public.google_ads_conversion_exports as prior
        where prior.event_id = clicks.event_id
          and prior.conversion_name = 'High Intent Buyer'
          and (
            prior.status = 'exported'
            or (
              prior.status = 'pending'
              and prior.claimed_at >= now() - v_stale
            )
          )
      )
    order by clicks.event_time asc, clicks.event_id asc
    limit v_limit
  ),
  upserted as (
    insert into public.google_ads_conversion_exports (
      event_id,
      conversion_name,
      status,
      claimed_at,
      exported_at,
      attempts,
      last_error
    )
    select
      candidates.event_id,
      'High Intent Buyer',
      'pending',
      now(),
      null,
      1,
      ''
    from candidates
    order by candidates.event_time asc, candidates.event_id asc
    on conflict (event_id, conversion_name) do update
      set status = 'pending',
          claimed_at = now(),
          exported_at = null,
          attempts = public.google_ads_conversion_exports.attempts + 1,
          last_error = ''
      where public.google_ads_conversion_exports.status = 'failed'
         or (
           public.google_ads_conversion_exports.status = 'pending'
           and public.google_ads_conversion_exports.claimed_at < now() - v_stale
         )
    returning public.google_ads_conversion_exports.event_id
  )
  select
    candidates.event_id,
    candidates.event_time,
    candidates.product,
    candidates.gclid,
    candidates.gbraid,
    candidates.wbraid
  from candidates
  join upserted on upserted.event_id = candidates.event_id
  order by candidates.event_time asc, candidates.event_id asc;
end;
$$;

create or replace function public.confirm_google_high_intent_conversions(p_event_ids text[])
returns table (event_id text, status text)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
#variable_conflict use_column
begin
  return query
  with requested as (
    select distinct btrim(item) as event_id
    from unnest(coalesce(p_event_ids, array[]::text[])) as item
    where btrim(coalesce(item, '')) <> ''
    limit 500
  ),
  updated as (
    update public.google_ads_conversion_exports as ledger
    set status = 'exported',
        exported_at = now(),
        last_error = ''
    from requested
    where ledger.event_id = requested.event_id
      and ledger.conversion_name = 'High Intent Buyer'
      and ledger.status = 'pending'
    returning ledger.event_id, ledger.status
  )
  select updated.event_id, updated.status
  from updated
  union all
  select ledger.event_id, ledger.status
  from public.google_ads_conversion_exports as ledger
  join requested on requested.event_id = ledger.event_id
  where ledger.conversion_name = 'High Intent Buyer'
    and ledger.status = 'exported'
  order by 1 asc;
end;
$$;

create or replace function public.fail_google_high_intent_conversions(
  p_event_ids text[],
  p_error text
)
returns table (event_id text, status text)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
#variable_conflict use_column
declare
  v_error text := lower(btrim(coalesce(p_error, '')));
begin
  if v_error not in ('download_failed', 'google_rejected', 'timeout', 'manual_retry', 'unknown') then
    v_error := 'unknown';
  end if;

  return query
  with requested as (
    select distinct btrim(item) as event_id
    from unnest(coalesce(p_event_ids, array[]::text[])) as item
    where btrim(coalesce(item, '')) <> ''
    limit 500
  ),
  updated as (
    update public.google_ads_conversion_exports as ledger
    set status = 'failed',
        last_error = v_error
    from requested
    where ledger.event_id = requested.event_id
      and ledger.conversion_name = 'High Intent Buyer'
      and ledger.status = 'pending'
    returning ledger.event_id, ledger.status
  )
  select updated.event_id, updated.status
  from updated
  order by updated.event_id asc;
end;
$$;

do $$
declare
  v_role text;
  v_signature text;
begin
  foreach v_signature in array array[
    'public.claim_google_high_intent_conversions(integer, interval)',
    'public.confirm_google_high_intent_conversions(text[])',
    'public.fail_google_high_intent_conversions(text[], text)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('alter function %s security invoker set search_path = pg_catalog', v_signature);
  end loop;

  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      foreach v_signature in array array[
        'public.claim_google_high_intent_conversions(integer, interval)',
        'public.confirm_google_high_intent_conversions(text[])',
        'public.fail_google_high_intent_conversions(text[], text)'
      ] loop
        execute format('revoke all on function %s from %I', v_signature, v_role);
      end loop;
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update on table public.google_ads_conversion_exports to service_role';
    execute 'grant select on table public.ads_events to service_role';
    execute 'grant execute on function public.claim_google_high_intent_conversions(integer, interval) to service_role';
    execute 'grant execute on function public.confirm_google_high_intent_conversions(text[]) to service_role';
    execute 'grant execute on function public.fail_google_high_intent_conversions(text[], text) to service_role';
  end if;
end $$;
