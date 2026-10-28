-- Final cleanup after validating the compact one-row-per-development index.
-- The public portal now reads only public.portal_development_index for listings.

drop view if exists public.portal_inventory_listing;
drop function if exists public.portal_inventory_listing_v1(text);
drop function if exists public.portal_inventory_listing_v2(text);

notify pgrst, 'reload schema';
