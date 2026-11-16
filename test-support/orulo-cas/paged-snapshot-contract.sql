CREATE OR REPLACE FUNCTION orulo_audit.columns_v2()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_agg(jsonb_build_array(column_name,data_type) order by ordinal_position)
 from information_schema.columns where table_schema='public' and table_name='properties';
$function$;
CREATE OR REPLACE FUNCTION orulo_audit.control_paged(p_action text, p_run uuid DEFAULT NULL::uuid, p_sequence bigint DEFAULT NULL::bigint, p_previous_hash text DEFAULT NULL::text, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET synchronous_commit TO 'on'
 SET lock_timeout TO '5s'
AS $function$
declare s orulo_audit.snapshot_sets%rowtype; k text; keys_now uuid[]; wanted uuid[]; n integer; size integer;
 rows_json jsonb; ack jsonb; event jsonb; inserted jsonb; deleted jsonb;
begin
 perform orulo_audit.require_service();
 if p_action='health' then
  return orulo_audit.control_v1('health')||jsonb_build_object('version',2,'snapshotProtocol','paged-v2');
 end if;
 if p_action='snapshot' then raise exception 'AUDIT_PAGED_SNAPSHOT_REQUIRED'; end if;
 if p_action='append' and p_event->>'type'='INTENT' then
  perform orulo_audit.lock_run(p_run);
  if exists(select 1 from orulo_audit.snapshot_sets t where t.run_uuid=p_run and not exists(select 1 from orulo_audit.entries e where e.run_uuid=p_run and e.kind=t.kind)) then raise exception 'AUDIT_CAPTURE_ALREADY_OPEN'; end if;
 end if;
 if p_action not in ('snapshot_begin','snapshot_page','snapshot_seal') then
  return orulo_audit.control_v1(p_action,p_run,p_sequence,p_previous_hash,p_event);
 end if;
 perform orulo_audit.lock_run(p_run);
 if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind in ('FINISHED','ABORTED')) then raise exception 'AUDIT_RUN_CLOSED'; end if;
 -- Only one capture at a time; no snapshots interleaved with an operational INTENT.
 if exists(select 1 from orulo_audit.entries i where i.run_uuid=p_run and i.kind='INTENT' and not exists(select 1 from orulo_audit.entries x where x.run_uuid=p_run and x.kind='CAS_RESULT' and x.operation_uuid=i.operation_uuid)) then raise exception 'AUDIT_PENDING_INTENT'; end if;
 k:=p_event->>'kind';
 if k is null or k not in ('BASELINE_V2','READBACK_V2') then raise exception 'AUDIT_SNAPSHOT_KIND_INVALID'; end if;
 if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind=k) then raise exception 'AUDIT_SNAPSHOT_SEALED'; end if;
 if p_action='snapshot_begin' then
  if exists(select 1 from orulo_audit.snapshot_sets t where t.run_uuid=p_run and not exists(select 1 from orulo_audit.entries e where e.run_uuid=p_run and e.kind=t.kind)) then raise exception 'AUDIT_CAPTURE_ALREADY_OPEN'; end if;
  if k='READBACK_V2' and not exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='BASELINE_V2') then raise exception 'AUDIT_BASELINE_REQUIRED'; end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into keys_now from public.properties;
  ack:=orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type','SNAPSHOT_BEGIN','kind',k,'eventUuid',p_event->>'eventUuid',
   'keys',to_jsonb(keys_now),'columns',orulo_audit.columns_v2(),'consistency','bounded-read-committed-window','snapshotProtocol','paged-v2'));
  insert into orulo_audit.snapshot_sets values(p_run,k,keys_now,orulo_audit.columns_v2(),p_sequence);
  return ack;
 end if;
 select * into s from orulo_audit.snapshot_sets where run_uuid=p_run and kind=k;
 if not found then raise exception 'AUDIT_SNAPSHOT_BEGIN_REQUIRED'; end if;
 if s.columns is distinct from orulo_audit.columns_v2() then raise exception 'AUDIT_SNAPSHOT_SCHEMA_CHANGED'; end if;
 select count(*) into n from orulo_audit.snapshot_records where run_uuid=p_run and kind=k;
 if p_action='snapshot_page' then
  size:=coalesce((p_event->>'size')::integer,50);
  if size<1 or size>100 then raise exception 'AUDIT_PAGE_SIZE_INVALID'; end if;
  if n>=cardinality(s.keys) then raise exception 'AUDIT_NO_MORE_PAGES'; end if;
  if (p_event->>'offset')::integer is distinct from n then raise exception 'AUDIT_PAGE_CURSOR_CONFLICT'; end if;
  wanted:=s.keys[n+1:n+size];
  -- PK probes for only this fixed UUID slice. Materialize the canonical full row
  -- once: the old inlined expression serialized each large raw_data twice.
  with selected as materialized(
   select u.id,p.external_id,p.raw_data,p.updated_at,
   case when p.id is not null then to_jsonb(p)||jsonb_build_object('created_at',p.created_at at time zone 'UTC','updated_at',p.updated_at at time zone 'UTC') end canonical
   from unnest(wanted) u(id) left join lateral(select * from public.properties p where p.id=u.id limit 1) p on true
  ) select jsonb_agg(jsonb_build_array(id,external_id,coalesce(raw_data->>'building_id',raw_data->'building'->>'id',''),updated_at at time zone 'UTC',md5(canonical::text),md5((canonical-'updated_at')::text)) order by id) into rows_json from selected;
  ack:=orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type','SNAPSHOT_PAGE','kind',k,'eventUuid',p_event->>'eventUuid',
   'offset',n,'count',cardinality(wanted),'records',rows_json));
  insert into orulo_audit.snapshot_records select p_run,k,(r->>0)::uuid,r,p_sequence from jsonb_array_elements(rows_json) r;
  return ack;
 end if;
 if n<>cardinality(s.keys) then raise exception 'AUDIT_SNAPSHOT_INCOMPLETE'; end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into keys_now from public.properties;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into inserted from (select unnest(keys_now) id except select unnest(s.keys)) x;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into deleted from (select unnest(s.keys) id except select unnest(keys_now)) x;
 event:=jsonb_build_object('type',k,'eventUuid',p_event->>'eventUuid','snapshot',jsonb_build_object(
  'format','paged-v2','key','id','beginSequence',s.begin_sequence,'processed',n,
  'algorithm','MD5 PostgreSQL canonical JSONB; timestamps UTC','excludedContentFields',jsonb_build_array('updated_at'),
  'columns',s.columns,'membershipStable',keys_now=s.keys and not exists(select 1 from orulo_audit.snapshot_records where run_uuid=p_run and kind=k and record->>4 is null),
  'insertedDuringCapture',inserted,'deletedDuringCapture',deleted,'keysAtSeal',to_jsonb(keys_now)));
 return orulo_audit.append(p_run,p_sequence,p_previous_hash,event);
end$function$;
