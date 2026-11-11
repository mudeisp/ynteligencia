-- Read-only production catalog capture. Synthetic rows are inserted only by tests.
create schema private;
create table public.portal_development_index ("id" uuid,"external_id" text,"source" text,"title" text,"development_name" text,"city" text,"state" text,"neighborhood" text,"price" numeric,"area" numeric,"bedrooms" integer,"parking_spaces" integer,"image_url" text,"active" boolean,"updated_at" timestamp with time zone,"building_id" text,"developer" text,"status" text,"building_type" text,"finality" text,"stage" text,"building_stock" text,"total_units" text,"opening_date" text,"unit_facets" jsonb);
CREATE OR REPLACE FUNCTION private.portal_development_index_row_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  old_building_id text;
  new_building_id text;
begin
  if tg_op <> 'INSERT' then
    old_building_id := old.raw_data->>'building_id';
  end if;
  if tg_op <> 'DELETE' then
    new_building_id := new.raw_data->>'building_id';
  end if;

  if old_building_id is not null then
    perform private.refresh_portal_development(old_building_id);
  end if;
  if new_building_id is not null and new_building_id is distinct from old_building_id then
    perform private.refresh_portal_development(new_building_id);
  elsif tg_op = 'INSERT' and new_building_id is not null then
    perform private.refresh_portal_development(new_building_id);
  end if;

  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.refresh_portal_development(p_building_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(p_building_id, '') !~ '^\d+$' then
    return;
  end if;

  delete from public.portal_development_index
  where building_id = p_building_id;

  insert into public.portal_development_index (
    id, external_id, source, title, development_name, city, state, neighborhood,
    price, area, bedrooms, parking_spaces, image_url, active, updated_at,
    building_id, developer, status, building_type, finality, stage,
    building_stock, total_units, opening_date, unit_facets
  )
  select
    min(id::text)::uuid,
    min(external_id),
    'novos'::text,
    max(title),
    max(development_name),
    max(city),
    max(state),
    max(neighborhood),
    min(coalesce(price, nullif(raw_data->'typology'->>'discount_price','')::numeric, nullif(raw_data->'typology'->>'original_price','')::numeric)),
    min(coalesce(area, nullif(raw_data->'typology'->>'private_area','')::numeric)),
    min(bedrooms),
    min(parking_spaces),
    (array_agg(image_url order by updated_at desc nulls last, id) filter (where coalesce(image_url,'') <> ''))[1],
    true,
    max(updated_at),
    raw_data->>'building_id',
    max(raw_data->'building'->>'developer'),
    max(raw_data->'building'->>'status'),
    max(raw_data->'building'->>'type'),
    max(raw_data->'building'->>'finality'),
    max(raw_data->'building'->>'stage'),
    max(raw_data->'building'->>'stock'),
    max(raw_data->'building'->>'total_units'),
    max(raw_data->'building'->>'opening_date'),
    jsonb_agg(jsonb_build_object(
      'id', id,
      'external_id', external_id,
      'price', coalesce(price, nullif(raw_data->'typology'->>'discount_price','')::numeric, nullif(raw_data->'typology'->>'original_price','')::numeric),
      'area', coalesce(area, nullif(raw_data->'typology'->>'private_area','')::numeric),
      'bedrooms', bedrooms,
      'parking_spaces', coalesce(parking_spaces, nullif(raw_data->'typology'->>'parking','')::integer),
      'suites', nullif(raw_data->'typology'->>'suites','')::integer,
      'bathrooms', nullif(raw_data->'typology'->>'bathrooms','')::integer,
      'typology_type', raw_data->'typology'->>'type',
      'typology_stock', nullif(raw_data->'typology'->>'stock','')::integer
    ) order by id)
  from public.properties
  where active is true
    and source = 'novos'
    and raw_data->>'building_id' = p_building_id
    and (state <> 'SP' or (
      coalesce(raw_data->'building'->>'status','') <> 'Usado'
      and coalesce(raw_data->'building'->>'stage','') <> 'Usado'
    ))
  group by raw_data->>'building_id';
end;
$function$
;
CREATE TRIGGER properties_refresh_portal_development_index AFTER INSERT OR DELETE OR UPDATE OF active, source, title, development_name, city, state, neighborhood, price, area, bedrooms, parking_spaces, image_url, raw_data ON public.properties FOR EACH ROW EXECUTE FUNCTION private.portal_development_index_row_trigger();

