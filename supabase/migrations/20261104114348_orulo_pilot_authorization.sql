-- Prepare a single-building pilot. No property DML, no authorization issued.
begin;
grant create on schema public to orulo_audit_owner;
alter function public.orulo_audit_control(text,uuid,bigint,text,jsonb) set schema orulo_audit;
alter function orulo_audit.orulo_audit_control(text,uuid,bigint,text,jsonb) rename to control_paged;
alter function public.orulo_audited_cas(uuid,uuid) set schema orulo_audit;
alter function orulo_audit.orulo_audited_cas(uuid,uuid) rename to audited_cas_core;

create function orulo_audit.pilot_targets() returns jsonb language sql set search_path='' as $$
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from public.properties p
 where p.state='SP' and p.source='novos' and p.active
 and coalesce(p.raw_data->>'building_id',p.raw_data->'building'->>'id')='43126';
$$;
create function orulo_audit.pilot_auth(p_run uuid) returns jsonb language plpgsql set search_path='' as $$
declare a jsonb;
begin
 if (select count(*) from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED')<>1 then raise exception 'PILOT_EXPLICIT_AUTHORIZATION_REQUIRED'; end if;
 select event into a from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED';
 if a->>'mode' is distinct from 'PILOT_ONE_BUILDING' or a->>'buildingId' is distinct from '43126' or
    a->>'manifestHash' is distinct from '1c8b002b5a3b4b6caf614e3b4e6d84383b8e306ae2773f3d7de48cc7daaa6d03' or
    (a->>'expiresAt')::timestamptz<clock_timestamp() or a->>'expiresAt' is null then raise exception 'PILOT_AUTHORIZATION_INVALID_OR_EXPIRED'; end if;
 return a;
end$$;
create function orulo_audit.authorize_pilot(p_run uuid,p_expected_head text,p_github_run_id text,p_control_sha text,p_reason text)
 returns jsonb language plpgsql security definer set search_path='' set synchronous_commit='on' as $$
declare e orulo_audit.entries%rowtype; r orulo_audit.runs%rowtype; targets jsonb;
begin
 if current_setting('role',true)='service_role' or session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 if length(trim(p_reason))<10 or p_reason is null then raise exception 'PILOT_ADMIN_REASON_REQUIRED'; end if;
 perform orulo_audit.lock_run(p_run);
 select * into r from orulo_audit.runs where run_uuid=p_run;
 select * into e from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
 if r.github_run_id is distinct from p_github_run_id or r.metadata->>'workflowSha' is distinct from p_control_sha or
    coalesce(p_control_sha,'') !~ '^[0-9a-f]{40}$' or e.hash is distinct from p_expected_head or
    e.kind<>'CLIENT_READBACK' or e.event->>'stage' is distinct from 'PILOT_PLAN' or
    e.event->>'buildingId' is distinct from '43126' or
    exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind in ('WRITE_AUTHORIZED','BASELINE_V2','ABORTED','FINISHED')) then raise exception 'PILOT_PLAN_OR_HEAD_MISMATCH'; end if;
 targets:=orulo_audit.pilot_targets();
 if jsonb_array_length(targets)<1 or jsonb_array_length(targets)>500 or targets is distinct from e.event->'targetIds' then raise exception 'PILOT_TARGETS_CHANGED'; end if;
 return orulo_audit.append(p_run,e.sequence+1,e.hash,jsonb_build_object('type','WRITE_AUTHORIZED','eventUuid',gen_random_uuid(),
  'mode','PILOT_ONE_BUILDING','buildingId','43126','targetIds',targets,'planSequence',e.sequence,'controlSha',p_control_sha,
  'manifestHash',r.metadata->>'manifestHash','expiresAt',clock_timestamp()+interval '30 minutes','reason',p_reason));
end$$;

create function public.orulo_audited_cas(p_run uuid,p_operation uuid) returns jsonb
 language plpgsql security definer set search_path='' set timezone='UTC' set synchronous_commit='on' set lock_timeout='5s' as $$
declare a jsonb; i orulo_audit.entries%rowtype; b orulo_audit.entries%rowtype; expected public.properties%rowtype; j jsonb;
begin
 perform orulo_audit.require_service();perform orulo_audit.lock_run(p_run);a:=orulo_audit.pilot_auth(p_run);
 select * into i from orulo_audit.entries where run_uuid=p_run and operation_uuid=p_operation and kind='INTENT';
 if not found then raise exception 'AUDIT_DURABLE_INTENT_REQUIRED'; end if;
 if not(a->'targetIds' ? (i.event->>'id')) or coalesce(i.event->'expected'->'raw_data'->>'building_id',i.event->'expected'->'raw_data'->'building'->>'id') is distinct from '43126' then raise exception 'PILOT_ROW_SCOPE_DENIED'; end if;
 if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='CAS_RESULT' and event->>'id'=i.event->>'id') then raise exception 'PILOT_ROW_ALREADY_ATTEMPTED_USE_RECOVERY'; end if;
 select * into b from orulo_audit.entries where run_uuid=p_run and kind='BASELINE_V2';
 if not found or b.created_at<clock_timestamp()-interval '5 minutes' or b.event->'snapshot'->>'membershipStable' is distinct from 'true' or
    (b.event->'snapshot'->>'beginSequence')::bigint <= (select sequence from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED') or
    b.event->'snapshot'->'columns' is distinct from orulo_audit.columns_v2() then raise exception 'PILOT_FRESH_BASELINE_REQUIRED'; end if;
 select * into expected from jsonb_populate_record(null::public.properties,i.event->'expected');
 j:=to_jsonb(expected)||jsonb_build_object('created_at',expected.created_at at time zone 'UTC','updated_at',expected.updated_at at time zone 'UTC');
 if not exists(select 1 from orulo_audit.snapshot_records where run_uuid=p_run and kind='BASELINE_V2' and id=expected.id and record->>2='43126' and record->>4=md5(j::text)) then raise exception 'PILOT_EXPECTED_DIFFERS_FROM_BASELINE'; end if;
 return orulo_audit.audited_cas_core(p_run,p_operation);
end$$;

create function public.orulo_audit_control(p_action text,p_run uuid default null,p_sequence bigint default null,
 p_previous_hash text default null,p_event jsonb default '{}'::jsonb) returns jsonb
 language plpgsql security definer set search_path='' set timezone='UTC' set synchronous_commit='on' set lock_timeout='5s' as $$
declare a jsonb; e orulo_audit.entries%rowtype; p public.properties%rowtype; j jsonb; bad bigint; written bigint; comparison jsonb;
begin
 perform orulo_audit.require_service();
 if p_action='health' then return orulo_audit.control_paged('health')||jsonb_build_object('pilotProtocol',1); end if;
 if p_action='pilot_status' then
  select * into e from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED' order by sequence desc limit 1;
  if not found then return 'null'::jsonb; end if;
  perform orulo_audit.pilot_auth(p_run);
  return jsonb_build_object('runUuid',p_run,'sequence',e.sequence,'hash',e.hash,'eventUuid',e.event_uuid);
 end if;
 if p_action='pilot_targets' then return orulo_audit.pilot_targets(); end if;
 if p_action='pilot_row' then
  select * into p from public.properties where id=(p_event->>'id')::uuid;
  if not found or not orulo_audit.scope_ok(to_jsonb(p)) or coalesce(p.raw_data->>'building_id',p.raw_data->'building'->>'id')<>'43126' then raise exception 'PILOT_ROW_SCOPE_DENIED'; end if;
  j:=to_jsonb(p)||jsonb_build_object('created_at',p.created_at at time zone 'UTC','updated_at',p.updated_at at time zone 'UTC');
  return jsonb_build_object('row',to_jsonb(p),'fullHash',md5(j::text),'contentHash',md5((j-'updated_at')::text));
 end if;
 if p_action='append' and p_event->>'type'='INTENT' then
  perform orulo_audit.lock_run(p_run);a:=orulo_audit.pilot_auth(p_run);
  if not(a->'targetIds' ? (p_event->>'id')) or coalesce(p_event->'expected'->'raw_data'->>'building_id',p_event->'expected'->'raw_data'->'building'->>'id') is distinct from '43126' then raise exception 'PILOT_ROW_SCOPE_DENIED'; end if;
 end if;
 if p_action<>'pilot_finish' then return orulo_audit.control_paged(p_action,p_run,p_sequence,p_previous_hash,p_event); end if;
 perform orulo_audit.lock_run(p_run);a:=orulo_audit.pilot_auth(p_run);
 if exists(select 1 from orulo_audit.entries i where i.run_uuid=p_run and i.kind='INTENT' and not exists(select 1 from orulo_audit.entries x where x.run_uuid=p_run and x.kind='CAS_RESULT' and x.operation_uuid=i.operation_uuid)) then raise exception 'AUDIT_PENDING_INTENT'; end if;
 if (select count(*) from orulo_audit.entries where run_uuid=p_run and kind in ('BASELINE_V2','READBACK_V2'))<>2 then raise exception 'AUDIT_TWO_SNAPSHOTS_REQUIRED'; end if;
 comparison:=orulo_audit.compare_v2(p_run);
 if comparison->>'schemaMatch' is distinct from 'true' or comparison->>'captureStable' is distinct from 'true' then raise exception 'PILOT_SNAPSHOT_INTEGRITY_FAILED'; end if;
 -- Only exact trusted CAS receipts justify an IN_SCOPE delta. Everything else
 -- must be unchanged or have proven stable OUT_OF_SCOPE bindings, as in PR #84.
 with b as(select id,record from orulo_audit.snapshot_records where run_uuid=p_run and kind='BASELINE_V2' and record->>4 is not null),
 d as(select id,record from orulo_audit.snapshot_records where run_uuid=p_run and kind='READBACK_V2' and record->>4 is not null),
 x as(select coalesce(b.id,d.id) id,b.record before,d.record after from b full join d using(id)),
 checked as(select x.*,c.event->'result' result from x left join orulo_audit.entries c on c.run_uuid=p_run and c.kind='CAS_RESULT' and c.event->>'id'=x.id::text)
 select count(*) filter(where not coalesce(
  case when result is not null then result->>'status'='UPDATED' and result->'receipt'->>'verified'='true'
   and before->>4=result->'receipt'->>'beforeFullHash' and after->>4=result->'receipt'->>'afterFullHash'
   and before->>5=result->'receipt'->>'expectedBeforeContentHash' and after->>5=result->'receipt'->>'expectedAfterContentHash'
  when before->>4=after->>4 then true
  else (before is null or ((before->>2)~'^[1-9][0-9]*$' and not orulo_audit.scope_ok(jsonb_build_object('state','SP','source','novos','active',true,'raw_data',jsonb_build_object('building_id',before->>2)))))
   and (after is null or ((after->>2)~'^[1-9][0-9]*$' and not orulo_audit.scope_ok(jsonb_build_object('state','SP','source','novos','active',true,'raw_data',jsonb_build_object('building_id',after->>2)))))
   and (before is null or after is null or before->>2=after->>2) end,false)),
 count(*) filter(where result->>'status'='UPDATED') into bad,written from checked;
 if bad<>0 or written<1 then raise exception 'PILOT_UNEXPLAINED_DIVERGENCE_OR_NO_UPDATES'; end if;
 return orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type','FINISHED','eventUuid',p_event->>'eventUuid',
  'mode','PILOT_ONE_BUILDING','buildingId','43126','rowsWritten',written,'comparison',comparison,'writeEnabled',false));
end$$;

alter function orulo_audit.pilot_targets() owner to orulo_audit_owner;
alter function orulo_audit.pilot_auth(uuid) owner to orulo_audit_owner;
alter function orulo_audit.authorize_pilot(uuid,text,text,text,text) owner to orulo_audit_owner;
alter function public.orulo_audit_control(text,uuid,bigint,text,jsonb) owner to orulo_audit_owner;
alter function public.orulo_audited_cas(uuid,uuid) owner to orulo_audit_owner;
revoke all on all functions in schema orulo_audit from public,anon,authenticated,service_role;
revoke all on function public.orulo_audit_control(text,uuid,bigint,text,jsonb),public.orulo_audited_cas(uuid,uuid) from public,anon,authenticated;
grant execute on function public.orulo_audit_control(text,uuid,bigint,text,jsonb),public.orulo_audited_cas(uuid,uuid) to service_role;
revoke create on schema public from orulo_audit_owner;
notify pgrst,'reload schema';
commit;
