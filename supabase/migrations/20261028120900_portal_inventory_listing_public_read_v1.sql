-- The public website uses the existing publishable/anon Supabase key.
-- Expose only the sanitized listing projection; raw_data and private fields are
-- not part of this view. Underlying properties RLS still applies because the
-- view is security_invoker.

revoke all on public.portal_inventory_listing from public;
revoke all on public.portal_inventory_listing from authenticated;
grant select on public.portal_inventory_listing to anon;
grant select on public.portal_inventory_listing to service_role;

notify pgrst, 'reload schema';
