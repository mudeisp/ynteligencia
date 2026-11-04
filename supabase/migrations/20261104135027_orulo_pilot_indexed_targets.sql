-- Preserve exact COALESCE semantics, using the existing expression index for both branches.
-- No timeout change, new index, property DML, authorization or ACL widening.
begin;
create or replace function orulo_audit.pilot_targets() returns jsonb language sql set search_path='' as $$
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from (
  select id from public.properties
  where state='SP' and source='novos' and active is true and raw_data->>'building_id'='43126'
  union all
  select id from public.properties
  where state='SP' and source='novos' and active is true and raw_data->>'building_id' is null
    and raw_data->'building'->>'id'='43126'
 ) candidates;
$$;
alter function orulo_audit.pilot_targets() owner to orulo_audit_owner;
revoke all on function orulo_audit.pilot_targets() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
