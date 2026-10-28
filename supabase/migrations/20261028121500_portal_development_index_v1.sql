-- Compact public development index for state/city/neighborhood pages.
-- One row per building; exact unit-level filters remain available through the
-- small unit_facets JSON array. Full raw_data is never exposed here.

create or replace view public.portal_development_index
with (security_invoker = true)
as
select
  min(p.id::text)::uuid as id,
  min(p.external_id) as external_id,
  'novos'::text as source,
  max(p.title) as title,
  max(p.development_name) as development_name,
  max(p.city) as city,
  max(p.state) as state,
  max(p.neighborhood) as neighborhood,
  min(coalesce(p.price, nullif(p.raw_data->'typology'->>'discount_price','')::numeric, nullif(p.raw_data->'typology'->>'original_price','')::numeric)) as price,
  min(coalesce(p.area, nullif(p.raw_data->'typology'->>'private_area','')::numeric)) as area,
  min(p.bedrooms) as bedrooms,
  min(p.parking_spaces) as parking_spaces,
  (array_agg(p.image_url order by p.updated_at desc nulls last, p.id) filter (where coalesce(p.image_url,'') <> ''))[1] as image_url,
  true as active,
  max(p.updated_at) as updated_at,
  p.raw_data->>'building_id' as building_id,
  max(p.raw_data->'building'->>'developer') as developer,
  max(p.raw_data->'building'->>'status') as status,
  max(p.raw_data->'building'->>'type') as building_type,
  max(p.raw_data->'building'->>'finality') as finality,
  max(p.raw_data->'building'->>'stage') as stage,
  max(p.raw_data->'building'->>'stock') as building_stock,
  max(p.raw_data->'building'->>'total_units') as total_units,
  max(p.raw_data->'building'->>'opening_date') as opening_date,
  jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'external_id', p.external_id,
      'price', coalesce(p.price, nullif(p.raw_data->'typology'->>'discount_price','')::numeric, nullif(p.raw_data->'typology'->>'original_price','')::numeric),
      'area', coalesce(p.area, nullif(p.raw_data->'typology'->>'private_area','')::numeric),
      'bedrooms', p.bedrooms,
      'parking_spaces', coalesce(p.parking_spaces, nullif(p.raw_data->'typology'->>'parking','')::integer),
      'suites', nullif(p.raw_data->'typology'->>'suites','')::integer,
      'bathrooms', nullif(p.raw_data->'typology'->>'bathrooms','')::integer,
      'typology_type', p.raw_data->'typology'->>'type',
      'typology_stock', nullif(p.raw_data->'typology'->>'stock','')::integer
    )
    order by p.id
  ) as unit_facets
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
  )
group by p.raw_data->>'building_id';

revoke all on public.portal_development_index from public;
revoke all on public.portal_development_index from authenticated;
grant select on public.portal_development_index to anon;
grant select on public.portal_development_index to service_role;

notify pgrst, 'reload schema';
