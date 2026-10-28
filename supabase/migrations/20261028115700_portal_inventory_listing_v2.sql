-- Versioned service-only read contract for portal listings.
-- v2 preserves ES as approved and excludes SP records marked Usado from the
-- editorial development tree. v1 is intentionally left available for rollback.

create or replace function public.portal_inventory_listing_v2(p_state text)
returns table (
  id uuid,
  external_id text,
  source text,
  title text,
  development_name text,
  city text,
  state text,
  neighborhood text,
  price numeric,
  area numeric,
  bedrooms integer,
  parking_spaces integer,
  image_url text,
  active boolean,
  updated_at timestamptz,
  building_id text,
  developer text,
  status text,
  building_type text,
  finality text,
  stage text,
  building_stock text,
  total_units text,
  opening_date text,
  typology_type text,
  typology_stock text,
  typology_parking text,
  suites text,
  bathrooms text,
  private_area text,
  discount_price text,
  original_price text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.external_id,
    p.source,
    p.title,
    p.development_name,
    p.city,
    p.state,
    p.neighborhood,
    p.price,
    p.area,
    p.bedrooms,
    p.parking_spaces,
    p.image_url,
    p.active,
    p.updated_at,
    p.raw_data->>'building_id' as building_id,
    p.raw_data->'building'->>'developer' as developer,
    p.raw_data->'building'->>'status' as status,
    p.raw_data->'building'->>'type' as building_type,
    p.raw_data->'building'->>'finality' as finality,
    p.raw_data->'building'->>'stage' as stage,
    p.raw_data->'building'->>'stock' as building_stock,
    p.raw_data->'building'->>'total_units' as total_units,
    p.raw_data->'building'->>'opening_date' as opening_date,
    p.raw_data->'typology'->>'type' as typology_type,
    p.raw_data->'typology'->>'stock' as typology_stock,
    p.raw_data->'typology'->>'parking' as typology_parking,
    p.raw_data->'typology'->>'suites' as suites,
    p.raw_data->'typology'->>'bathrooms' as bathrooms,
    p.raw_data->'typology'->>'private_area' as private_area,
    p.raw_data->'typology'->>'discount_price' as discount_price,
    p.raw_data->'typology'->>'original_price' as original_price
  from public.properties p
  where p.active is true
    and p.source = 'novos'
    and p.state = upper(trim(p_state))
    and coalesce(p.raw_data->>'building_id','') ~ '^\d+$'
    and (
      upper(trim(p_state)) <> 'SP'
      or (
        coalesce(p.raw_data->'building'->>'status','') <> 'Usado'
        and coalesce(p.raw_data->'building'->>'stage','') <> 'Usado'
      )
    )
  order by p.id;
$$;

revoke all on function public.portal_inventory_listing_v2(text) from public;
revoke all on function public.portal_inventory_listing_v2(text) from anon;
revoke all on function public.portal_inventory_listing_v2(text) from authenticated;
grant execute on function public.portal_inventory_listing_v2(text) to service_role;

notify pgrst, 'reload schema';
