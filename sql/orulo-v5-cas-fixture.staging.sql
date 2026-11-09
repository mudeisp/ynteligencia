-- V5 isolated CAS prototype. NEVER deploy to production without audit-ledger integration.
-- Uses a disposable fixture table, not public.properties.
begin;
create table if not exists orulo_audit.v5_fixture_properties (
 id uuid primary key,
 state text not null,
 source text not null,
 active boolean not null,
 raw_data jsonb not null,
 updated_at timestamptz not null default clock_timestamp()
);
revoke all on orulo_audit.v5_fixture_properties from public;
create or replace function orulo_audit.v5_fixture_cas(
 p_manifest_hash text, p_run_uuid uuid, p_id uuid, p_expected jsonb,
 p_desired_plans jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
 before_row orulo_audit.v5_fixture_properties%rowtype;
 after_row orulo_audit.v5_fixture_properties%rowtype;
 building_id text;
 old_plans jsonb;
 image_keys constant text[] := array['image_url','images','2280x1800','1024x1024','520x280','url'];
begin
 if jsonb_typeof(p_expected) is distinct from 'object'
    or jsonb_typeof(p_desired_plans) is distinct from 'array'
    or jsonb_array_length(p_desired_plans) > 1000 then
   raise exception 'V5_INVALID_INPUT';
 end if;
 select * into before_row from orulo_audit.v5_fixture_properties where id=p_id for update;
 if not found then return jsonb_build_object('status','NOT_FOUND'); end if;
 if before_row.source is distinct from 'novos' or before_row.active is distinct from true then
   raise exception 'V5_SCOPE_DENIED';
 end if;
 building_id := coalesce(before_row.raw_data->>'building_id',before_row.raw_data->'building'->>'id');
 if building_id is null then raise exception 'V5_MISSING_BUILDING'; end if;
 if not exists (
   select 1 from orulo_audit.v5_manifests m
   where m.manifest_hash=p_manifest_hash and m.state=before_row.state
 ) then raise exception 'V5_STATE_MISMATCH'; end if;
 old_plans:=before_row.raw_data->'building'->'floor_plans';
 if jsonb_typeof(old_plans) is distinct from 'array'
    or jsonb_array_length(old_plans) is distinct from jsonb_array_length(p_desired_plans) then
   raise exception 'V5_PLAN_STRUCTURE_CHANGED';
 end if;
 if to_jsonb(before_row) is distinct from p_expected then
   return jsonb_build_object('status','CONFLICT');
 end if;
 if exists(
   select 1 from jsonb_array_elements(old_plans) with ordinality x(plan,n)
   join jsonb_array_elements(p_desired_plans) with ordinality y(plan,n) using(n)
   where x.plan-image_keys is distinct from y.plan-image_keys
      or x.plan->>'id' is distinct from y.plan->>'id'
      or (
       x.plan is distinct from y.plan and not orulo_audit.v5_staging_authorization_check(
        p_manifest_hash,p_run_uuid,building_id,x.plan->>'id')
      )
 ) then raise exception 'V5_UNAUTHORIZED_OR_NONIMAGE_CHANGE'; end if;
 if old_plans=p_desired_plans then
   return jsonb_build_object('status','UNCHANGED','row',to_jsonb(before_row));
 end if;
 update orulo_audit.v5_fixture_properties
 set raw_data=jsonb_set(raw_data,'{building,floor_plans}',p_desired_plans,false),
     updated_at=clock_timestamp()
 where id=p_id returning * into after_row;
 if (to_jsonb(after_row)-'updated_at'-'raw_data') is distinct from
    (to_jsonb(before_row)-'updated_at'-'raw_data')
    or (after_row.raw_data #- '{building,floor_plans}') is distinct from
       (before_row.raw_data #- '{building,floor_plans}')
    or after_row.raw_data->'building'->'floor_plans' is distinct from p_desired_plans then
   raise exception 'V5_PRESERVATION_FAILED';
 end if;
 return jsonb_build_object('status','UPDATED','row',to_jsonb(after_row));
end;
$$;
revoke all on function orulo_audit.v5_fixture_cas(text,uuid,uuid,jsonb,jsonb) from public;
comment on function orulo_audit.v5_fixture_cas(text,uuid,uuid,jsonb,jsonb)
is 'Disposable fixture only; not production CAS; no durable intent or audit receipts';
commit;
