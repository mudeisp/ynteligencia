-- Service-only lightweight projection for public portal list/SEO reads.
-- Keeps properties as the source of truth and avoids pulling raw_data for the
-- entire state on every request.

create or replace view public.portal_inventory_listing
with (security_invoker = true)
as
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
  and coalesce(p.raw_data->>'building_id','') ~ '^\d+$'
  and (
    p.state <> 'SP'
    or (
      coalesce(p.raw_data->'building'->>'status','') <> 'Usado'
      and coalesce(p.raw_data->'building'->>'stage','') <> 'Usado'
    )
  );

revoke all on public.portal_inventory_listing from public;
revoke all on public.portal_inventory_listing from anon;
revoke all on public.portal_inventory_listing from authenticated;
grant select on public.portal_inventory_listing to service_role;

notify pgrst, 'reload schema';
