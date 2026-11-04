-- Private PostgreSQL journal. Installation does not mutate properties.
begin;
do $$begin
 if not exists(select 1 from pg_roles where rolname='orulo_audit_owner') then
  create role orulo_audit_owner nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
 elsif exists(select 1 from pg_roles where rolname='orulo_audit_owner' and
  (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolbypassrls)) then
  raise exception 'AUDIT_OWNER_ROLE_UNSAFE';
 end if;
end$$;
-- Supabase's postgres administrator is not a superuser. Explicit membership plus
-- temporary schema CREATE is needed to transfer SECURITY DEFINER ownership.
grant orulo_audit_owner to postgres;
do $$begin
 if exists(select 1 from pg_auth_members m join pg_roles parent on parent.oid=m.roleid
 join pg_roles member on member.oid=m.member where parent.rolname='orulo_audit_owner'
 and member.rolname not in ('postgres','supabase_admin')) then raise exception 'AUDIT_OWNER_MEMBERSHIP_UNSAFE'; end if;
end$$;
create schema orulo_audit authorization orulo_audit_owner;
revoke all on schema orulo_audit from public,anon,authenticated,service_role;
grant usage,create on schema public to orulo_audit_owner;
grant select on public.properties to orulo_audit_owner;
grant update(raw_data,updated_at) on public.properties to orulo_audit_owner;

create table orulo_audit.runs(
 run_uuid uuid primary key, github_run_id text not null unique check(github_run_id ~ '^[1-9][0-9]*$'),
 metadata jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table orulo_audit.entries(
 run_uuid uuid not null references orulo_audit.runs(run_uuid),
 sequence bigint not null check(sequence>0), event_uuid uuid not null unique,
 operation_uuid uuid, kind text not null, event jsonb not null,
 previous_hash text not null, canonical text not null,
 hash text not null check(hash=encode(sha256(convert_to(canonical,'UTF8')),'hex')),
 created_xid xid8 not null default pg_current_xact_id(),
 created_at timestamptz not null default clock_timestamp(),
 primary key(run_uuid,sequence)
);
create unique index orulo_audit_operation_kind on orulo_audit.entries(operation_uuid,kind) where operation_uuid is not null;
create unique index orulo_audit_snapshot_kind on orulo_audit.entries(run_uuid,kind) where kind in ('BASELINE_V2','READBACK_V2');
alter table orulo_audit.runs owner to orulo_audit_owner;
alter table orulo_audit.entries owner to orulo_audit_owner;
alter table orulo_audit.runs enable row level security;
alter table orulo_audit.runs force row level security;
alter table orulo_audit.entries enable row level security;
alter table orulo_audit.entries force row level security;
create policy owner_only on orulo_audit.runs to orulo_audit_owner using(true) with check(true);
create policy owner_only on orulo_audit.entries to orulo_audit_owner using(true) with check(true);
revoke all on all tables in schema orulo_audit from public,anon,authenticated,service_role;

create function orulo_audit.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'AUDIT_APPEND_ONLY'; end$$;
create trigger immutable_rows before update or delete on orulo_audit.runs for each row execute function orulo_audit.immutable();
create trigger immutable_rows before update or delete on orulo_audit.entries for each row execute function orulo_audit.immutable();
create trigger immutable_table before truncate on orulo_audit.runs for each statement execute function orulo_audit.immutable();
create trigger immutable_table before truncate on orulo_audit.entries for each statement execute function orulo_audit.immutable();

create function orulo_audit.require_service() returns void language plpgsql set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise insufficient_privilege using message='AUDIT_SERVICE_ROLE_REQUIRED';
 end if;
end$$;
create function orulo_audit.scope_ok(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce((p->>'state'='SP' and p->>'source'='novos' and p->'active'='true'::jsonb
 and coalesce(p->'raw_data'->>'building_id',p->'raw_data'->'building'->>'id')=any(array['43126','4969','82124','49132','65646','70542','66664','52286','85474','44524','67183','20980','65572','46652','27313','70879','78437','25147','81726','51327','1707','74610','40580','63635','64647','85486','69302','4075','80450','2920','5303','4836','82828','67082','74738','71044','76145','3349','22027','3198','3272','49267','3207','86645','86646','83026','50575','79391','74267','78018','81308','81351','81348','20283','80202','27977','20632','24562','20333','71097','29350','59964','76053','66288','82011','36776','72335','31789','86526','80096','83366','51496','40196','74315','55630','20407','39280','21449','21605','84525','38041','38427','38740','86085','75973','41663','42122','42586','43537','51452','46609','21642','73923','21786','5422','41230','75971','66668','47279'])),false);
$$;
create policy orulo_audit_snapshot_select on public.properties for select to orulo_audit_owner using(true);
create policy orulo_audit_scoped_update on public.properties for update to orulo_audit_owner
 using(orulo_audit.scope_ok(to_jsonb(properties))) with check(orulo_audit.scope_ok(to_jsonb(properties)));

create function orulo_audit.lock_run(p_run uuid) returns void language plpgsql set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended(p_run::text,0)) then raise exception 'AUDIT_CONCURRENT_ACCESS'; end if;
 if not exists(select 1 from orulo_audit.runs where run_uuid=p_run) then raise exception 'AUDIT_RUN_NOT_FOUND'; end if;
end$$;
create function orulo_audit.append(p_run uuid,p_sequence bigint,p_previous text,p_event jsonb)
 returns jsonb language plpgsql set search_path='' as $$
declare n bigint; previous text; e orulo_audit.entries%rowtype; c text;
begin
 perform orulo_audit.lock_run(p_run);
 if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind in ('FINISHED','ABORTED')) then raise exception 'AUDIT_RUN_CLOSED'; end if;
 select sequence+1,hash into n,previous from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
 n:=coalesce(n,1);previous:=coalesce(previous,'');
 if p_sequence is distinct from n or p_previous is distinct from previous then raise exception 'AUDIT_SEQUENCE_CONFLICT'; end if;
 if jsonb_typeof(p_event) is distinct from 'object' or not(p_event ? 'eventUuid') or not(p_event ? 'type') then raise exception 'AUDIT_INVALID_EVENT'; end if;
 c:=jsonb_build_object('runUuid',p_run,'sequence',n,'previousHash',previous,'event',p_event)::text;
 insert into orulo_audit.entries(run_uuid,sequence,event_uuid,operation_uuid,kind,event,previous_hash,canonical,hash)
 values(p_run,n,(p_event->>'eventUuid')::uuid,(p_event->>'operationId')::uuid,p_event->>'type',p_event,previous,c,encode(sha256(convert_to(c,'UTF8')),'hex')) returning * into e;
 return jsonb_build_object('runUuid',p_run,'sequence',n,'hash',e.hash,'eventUuid',e.event_uuid);
end$$;
create function orulo_audit.snapshot_rows() returns jsonb language sql set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('snapshotAt',statement_timestamp(),'key','id',
 'recordFormat',jsonb_build_array('id','external_id','building_id','updated_at_utc','full_hash','content_hash'),
 'excludedContentFields',jsonb_build_array('updated_at'),
 'algorithm','MD5 PostgreSQL canonical JSONB; timestamps UTC',
 'columns',(select jsonb_agg(jsonb_build_array(column_name,data_type) order by ordinal_position)
 from information_schema.columns where table_schema='public' and table_name='properties'),
 'records',coalesce(jsonb_agg(jsonb_build_array(p.id::text,p.external_id,
 coalesce(p.raw_data->>'building_id',p.raw_data->'building'->>'id',''),p.updated_at at time zone 'UTC',
 md5(c.row::text),md5((c.row-'updated_at')::text)) order by p.id),'[]'::jsonb))
 from public.properties p cross join lateral (select to_jsonb(p)||jsonb_build_object(
 'created_at',p.created_at at time zone 'UTC','updated_at',p.updated_at at time zone 'UTC') as row) c;
$$;
create function orulo_audit.compare_v2(p_run uuid) returns jsonb language sql set search_path='' as $$
 with b as (select r->>0 id,r->>4 full_hash,r->>5 content_hash
 from orulo_audit.entries e cross join lateral jsonb_array_elements(e.event->'snapshot'->'records') r
 where run_uuid=p_run and kind='BASELINE_V2'),
 a as (select r->>0 id,r->>4 full_hash,r->>5 content_hash
 from orulo_audit.entries e cross join lateral jsonb_array_elements(e.event->'snapshot'->'records') r
 where run_uuid=p_run and kind='READBACK_V2')
 select jsonb_build_object('compared',count(*) filter(where b.id is not null and a.id is not null),
 'contentChanges',count(*) filter(where b.id is not null and a.id is not null and b.content_hash<>a.content_hash),
 'timestampOnly',count(*) filter(where b.content_hash=a.content_hash and b.full_hash<>a.full_hash),
 'insertions',count(*) filter(where b.id is null),'deletions',count(*) filter(where a.id is null),
 'schemaMatch',(select b.event->'snapshot'->'columns'=a.event->'snapshot'->'columns'
 from orulo_audit.entries b cross join orulo_audit.entries a where b.run_uuid=p_run and a.run_uuid=p_run and b.kind='BASELINE_V2' and a.kind='READBACK_V2'),
 'attribution','concurrent_or_unattributed_no_backfill_in_preflight')
 from b full join a using(id);
$$;

create or replace function orulo_audit.cas_core(
  p_id uuid, p_expected jsonb, p_floor_plans jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set timezone = 'UTC'
set lock_timeout = '5s'
as $function$
declare
  v_row public.properties%rowtype;
  v_expected public.properties%rowtype;
  v_after public.properties%rowtype;
  v_id text;
  v_raw jsonb;
  v_before_json jsonb;
  v_after_json jsonb;
  v_image_keys constant text[] := array['image_url','images','2280x1800','1024x1024','520x280','url'];
  v_allowed constant text[] := array['43126','4969','82124','49132','65646','70542','66664','52286','85474','44524','67183','20980','65572','46652','27313','70879','78437','25147','81726','51327','1707','74610','40580','63635','64647','85486','69302','4075','80450','2920','5303','4836','82828','67082','74738','71044','76145','3349','22027','3198','3272','49267','3207','86645','86646','83026','50575','79391','74267','78018','81308','81351','81348','20283','80202','27977','20632','24562','20333','71097','29350','59964','76053','66288','82011','36776','72335','31789','86526','80096','83366','51496','40196','74315','55630','20407','39280','21449','21605','84525','38041','38427','38740','86085','75973','41663','42122','42586','43537','51452','46609','21642','73923','21786','5422','41230','75971','66668','47279'];
begin
  if current_user <> 'orulo_audit_owner' then
    raise insufficient_privilege using message = 'ORULO_CAS_SERVICE_ROLE_REQUIRED';
  end if;
  if p_id is null or jsonb_typeof(p_expected) is distinct from 'object'
     or jsonb_typeof(p_floor_plans) is distinct from 'array'
     or jsonb_array_length(p_floor_plans) > 1000 then
    raise invalid_parameter_value using message = 'ORULO_CAS_INVALID_INPUT';
  end if;

  select p.* into v_row from public.properties p where p.id = p_id for update;
  if not found then return jsonb_build_object('status','NOT_FOUND','id',p_id); end if;
  v_id := coalesce(v_row.raw_data->>'building_id',v_row.raw_data->'building'->>'id');
  if v_id is null or not (v_id = any(v_allowed)) or v_row.state is distinct from 'SP'
     or v_row.source is distinct from 'novos' or v_row.active is distinct from true then
    raise insufficient_privilege using message = 'ORULO_CAS_SCOPE_DENIED';
  end if;
  if not (p_expected ?& array(select jsonb_object_keys(to_jsonb(v_row))))
     or (select count(*) from jsonb_object_keys(p_expected)) <>
        (select count(*) from jsonb_object_keys(to_jsonb(v_row))) then
    return jsonb_build_object('status','CONFLICT','id',p_id);
  end if;
  -- Cast timestamps/numerics with table types; compare the entire expected row, not just updated_at.
  select * into v_expected from jsonb_populate_record(null::public.properties,p_expected);
  if v_expected.id is distinct from p_id or jsonb_typeof(v_expected.raw_data->'building') is distinct from 'object'
     or jsonb_typeof(v_expected.raw_data->'building'->'floor_plans') is distinct from 'array' then
    return jsonb_build_object('status','CONFLICT','id',p_id);
  end if;
  -- Only image fields of existing floor plans may change. No new/reordered plans or typology edits.
  if (select coalesce(jsonb_agg(plan-v_image_keys order by n),'[]'::jsonb)
        from jsonb_array_elements(v_expected.raw_data->'building'->'floor_plans') with ordinality a(plan,n))
     is distinct from
     (select coalesce(jsonb_agg(plan-v_image_keys order by n),'[]'::jsonb)
        from jsonb_array_elements(p_floor_plans) with ordinality a(plan,n)) then
    raise invalid_parameter_value using message = 'ORULO_CAS_IMAGE_FIELDS_ONLY';
  end if;
  v_raw := jsonb_set(v_expected.raw_data,'{building,floor_plans}',p_floor_plans,false);
  if to_jsonb(v_row) is distinct from to_jsonb(v_expected) then
    -- Repeated identical operation is a no-op only if every non-authorized value still matches.
    if (to_jsonb(v_row)-'updated_at') =
       ((to_jsonb(v_expected)-'updated_at') || jsonb_build_object('raw_data',v_raw)) then
      return jsonb_build_object('status','UNCHANGED','id',p_id,'row',to_jsonb(v_row));
    end if;
    return jsonb_build_object('status','CONFLICT','id',p_id);
  end if;
  if v_row.raw_data = v_raw then
    return jsonb_build_object('status','UNCHANGED','id',p_id,'row',to_jsonb(v_row));
  end if;

  update public.properties p
     set raw_data = jsonb_set(p.raw_data,'{building,floor_plans}',p_floor_plans,false),
         updated_at = clock_timestamp()
   where p.id = p_id returning p.* into v_after;
  -- Roll back even trigger-induced changes outside the two permitted paths.
  if (to_jsonb(v_after)-'updated_at'-'raw_data') is distinct from (to_jsonb(v_row)-'updated_at'-'raw_data')
     or (v_after.raw_data #- '{building,floor_plans}') is distinct from (v_row.raw_data #- '{building,floor_plans}')
     or v_after.raw_data->'building'->'floor_plans' is distinct from p_floor_plans then
    raise check_violation using message = 'ORULO_CAS_PRESERVATION_FAILED';
  end if;
  v_before_json := to_jsonb(v_row) || jsonb_build_object(
    'created_at',v_row.created_at at time zone 'UTC','updated_at',v_row.updated_at at time zone 'UTC');
  v_after_json := to_jsonb(v_after) || jsonb_build_object(
    'created_at',v_after.created_at at time zone 'UTC','updated_at',v_after.updated_at at time zone 'UTC');
  return jsonb_build_object('status','UPDATED','id',p_id,'row',to_jsonb(v_after),
    'receipt',jsonb_build_object('id',p_id,'verified',true,
      'expectedBeforeContentHash',md5((v_before_json-'updated_at')::text),
      'expectedAfterContentHash',md5((v_after_json-'updated_at')::text),
      'beforeFullHash',md5(v_before_json::text),'afterFullHash',md5(v_after_json::text),
      'allowedChangedPaths',jsonb_build_array('raw_data.building.floor_plans','updated_at')));
end;
$function$;
alter function orulo_audit.cas_core(uuid,jsonb,jsonb) owner to orulo_audit_owner;

create function public.orulo_audit_control(
 p_action text,p_run uuid default null,p_sequence bigint default null,
 p_previous_hash text default null,p_event jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC'
 set synchronous_commit='on' set lock_timeout='5s' as $$
declare v_entry orulo_audit.entries%rowtype; result jsonb; snapshot jsonb;
begin
 perform orulo_audit.require_service();
 if p_action='health' then
  if current_setting('fsync')<>'on' or current_setting('full_page_writes')<>'on' then raise exception 'AUDIT_DURABILITY_UNVERIFIED'; end if;
  if has_table_privilege('service_role','orulo_audit.entries','INSERT,UPDATE,DELETE,TRUNCATE') or
     has_table_privilege('service_role','orulo_audit.runs','INSERT,UPDATE,DELETE,TRUNCATE') or
     has_function_privilege('service_role','public.orulo_media_cas(uuid,jsonb,jsonb)','EXECUTE') then
    raise exception 'AUDIT_PRIVILEGES_UNSAFE';
  end if;
  return jsonb_build_object('version',1,'storage','postgres','durable',true,'appendOnly',true,
   'synchronousCommit',current_setting('synchronous_commit'),'writeEnabled',false);
 end if;
 if p_action='start' then
  if not pg_try_advisory_xact_lock(hashtextextended('orulo-lote1-exclusive',0)) then raise exception 'AUDIT_CONCURRENT_RUN'; end if;
  if exists(select 1 from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and e.kind in ('FINISHED','ABORTED'))) then raise exception 'AUDIT_ACTIVE_RUN_REQUIRES_RECONCILIATION'; end if;
  if p_run is null or p_event->>'repository' is distinct from 'mudeisp/ynteligencia' or
    p_event->>'actor' is distinct from 'mudeisp' or p_event->>'actorId' is distinct from '323805541' or
    p_event->>'triggeringActor' is distinct from 'mudeisp' or p_event->>'eventName' is distinct from 'workflow_dispatch' or
    p_event->>'ref' is distinct from 'refs/heads/main' or p_event->>'attempt' is distinct from '1' or
    p_event->>'approvedSha' is distinct from '2fa6ec8b093346e1a2319e4c6833cdfb0c52825e' or
    p_event->>'manifestHash' is distinct from '1c8b002b5a3b4b6caf614e3b4e6d84383b8e306ae2773f3d7de48cc7daaa6d03' or
    coalesce(p_event->>'workflowSha','') !~ '^[0-9a-f]{40}$' then
    raise exception 'AUDIT_MANUAL_OWNER_SCOPE_REQUIRED';
  end if;
  insert into orulo_audit.runs(run_uuid,github_run_id,metadata) values(p_run,p_event->>'githubRunId',p_event);
  return orulo_audit.append(p_run,1,'',p_event||jsonb_build_object('type','START'));
 end if;
 if p_action in ('read','recover') then
  if p_action='read' then
   select * into v_entry from orulo_audit.entries where run_uuid=p_run and sequence=p_sequence;
   if not found then raise exception 'AUDIT_ENTRY_NOT_FOUND'; end if;
   return jsonb_build_object('runUuid',p_run,'sequence',v_entry.sequence,'hash',v_entry.hash,'canonical',v_entry.canonical,'event',v_entry.event);
  end if;
  return jsonb_build_object('intent',(select event from orulo_audit.entries where run_uuid=p_run and kind='INTENT' and operation_uuid=(p_event->>'operationId')::uuid),
   'result',(select event from orulo_audit.entries where run_uuid=p_run and kind='CAS_RESULT' and operation_uuid=(p_event->>'operationId')::uuid));
 end if;
 perform orulo_audit.lock_run(p_run);
 if p_action='append' then
  if p_event->>'type' not in ('READ_ONLY_PREFLIGHT','CLIENT_READBACK','CLIENT_STOP','INTENT') then raise exception 'AUDIT_RESERVED_EVENT_TYPE'; end if;
  if p_event->>'type'='INTENT' then
   if not exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED') then raise exception 'AUDIT_OPERATIONAL_WRITE_BLOCKED'; end if;
   if not exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='BASELINE_V2') or
      (p_event->>'operationId') is null or orulo_audit.scope_ok(p_event->'expected') is distinct from true or
      p_event->>'id' is distinct from p_event->'expected'->>'id' then raise exception 'AUDIT_INTENT_SCOPE_INVALID'; end if;
   if exists(select 1 from orulo_audit.entries i where i.run_uuid=p_run and i.kind='INTENT' and not exists(
    select 1 from orulo_audit.entries x where x.run_uuid=p_run and x.kind='CAS_RESULT' and x.operation_uuid=i.operation_uuid)) then raise exception 'AUDIT_PENDING_INTENT'; end if;
  end if;
  return orulo_audit.append(p_run,p_sequence,p_previous_hash,p_event);
 end if;
 if p_action='snapshot' then
  if exists(select 1 from orulo_audit.entries i where i.run_uuid=p_run and i.kind='INTENT' and not exists(
   select 1 from orulo_audit.entries x where x.run_uuid=p_run and x.kind='CAS_RESULT' and x.operation_uuid=i.operation_uuid)) then raise exception 'AUDIT_PENDING_INTENT'; end if;
  if p_event->>'kind' not in ('BASELINE_V2','READBACK_V2') then raise exception 'AUDIT_SNAPSHOT_KIND_INVALID'; end if;
  if p_event->>'kind'='READBACK_V2' and not exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='BASELINE_V2') then raise exception 'AUDIT_BASELINE_REQUIRED'; end if;
  snapshot:=orulo_audit.snapshot_rows();
  return orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type',p_event->>'kind','eventUuid',p_event->>'eventUuid','snapshot',snapshot));
 end if;
 if p_action='finish' then
  if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED') then raise exception 'AUDIT_PREFLIGHT_FINISH_ONLY'; end if;
  if (select count(*) from orulo_audit.entries where run_uuid=p_run and kind in ('BASELINE_V2','READBACK_V2'))<>2 then raise exception 'AUDIT_TWO_SNAPSHOTS_REQUIRED'; end if;
  result:=orulo_audit.compare_v2(p_run);
  return orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type','FINISHED','eventUuid',p_event->>'eventUuid','comparison',result,'writeEnabled',false))
   ||jsonb_build_object('comparison',result,'writeEnabled',false);
 end if;
 raise exception 'AUDIT_ACTION_DENIED';
end$$;
alter function public.orulo_audit_control(text,uuid,bigint,text,jsonb) owner to orulo_audit_owner;

create function public.orulo_audited_cas(p_run uuid,p_operation uuid) returns jsonb
 language plpgsql security definer set search_path='' set timezone='UTC'
 set synchronous_commit='on' set lock_timeout='5s' as $$
declare intent orulo_audit.entries%rowtype; result jsonb; receipt jsonb; seq bigint; previous text;
begin
 perform orulo_audit.require_service();perform orulo_audit.lock_run(p_run);
 if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind in ('FINISHED','ABORTED')) then raise exception 'AUDIT_RUN_CLOSED'; end if;
 if not exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED') then raise exception 'AUDIT_OPERATIONAL_WRITE_BLOCKED'; end if;
 select * into intent from orulo_audit.entries where run_uuid=p_run and operation_uuid=p_operation and kind='INTENT';
 if not found then raise exception 'AUDIT_DURABLE_INTENT_REQUIRED'; end if;
 if intent.created_xid=pg_current_xact_id() then raise exception 'AUDIT_INTENT_MUST_BE_PREVIOUSLY_COMMITTED'; end if;
 if exists(select 1 from orulo_audit.entries where operation_uuid=p_operation and kind='CAS_RESULT') then raise exception 'AUDIT_DUPLICATE_OPERATION_USE_RECOVERY'; end if;
 select sequence+1,hash into seq,previous from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
 if seq<>intent.sequence+1 then raise exception 'AUDIT_INTENT_NOT_CURRENT'; end if;
 result:=orulo_audit.cas_core((intent.event->>'id')::uuid,intent.event->'expected',intent.event->'desiredPlans');
 receipt:=orulo_audit.append(p_run,seq,previous,jsonb_build_object('type','CAS_RESULT','eventUuid',gen_random_uuid(),'operationId',p_operation,'id',intent.event->>'id','result',result));
 return result||jsonb_build_object('auditReceipt',receipt);
end$$;
alter function public.orulo_audited_cas(uuid,uuid) owner to orulo_audit_owner;

-- Database administrator only. No public RPC can authorize write or abandon an interrupted run.
create function orulo_audit.admin_event(p_run uuid,p_type text,p_reason text,p_reconciled boolean default false)
 returns jsonb language plpgsql security definer set search_path='' set synchronous_commit='on' as $$
declare seq bigint; previous text;
begin
 if current_setting('role',true)='service_role' or session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 if p_type not in ('WRITE_AUTHORIZED','ABORTED') or length(trim(p_reason))<10 then raise exception 'AUDIT_ADMIN_REASON_REQUIRED'; end if;
 if p_type='ABORTED' and not p_reconciled then raise exception 'AUDIT_RECONCILIATION_REQUIRED'; end if;
 perform orulo_audit.lock_run(p_run);
 select sequence+1,hash into seq,previous from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
 return orulo_audit.append(p_run,seq,previous,jsonb_build_object('type',p_type,'eventUuid',gen_random_uuid(),'reason',p_reason,'reconciled',p_reconciled));
end$$;
alter function orulo_audit.admin_event(uuid,text,text,boolean) owner to orulo_audit_owner;

-- Disable the unaudited entry point; never silently fall back to old PATCH/RPC.
create or replace function public.orulo_media_cas(p_id uuid,p_expected jsonb,p_floor_plans jsonb)
 returns jsonb language plpgsql security invoker set search_path='' as $$
begin raise exception 'AUDITED_CAS_REQUIRED'; end$$;
revoke all on function public.orulo_media_cas(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
alter function orulo_audit.immutable() owner to orulo_audit_owner;
alter function orulo_audit.require_service() owner to orulo_audit_owner;
alter function orulo_audit.scope_ok(jsonb) owner to orulo_audit_owner;
alter function orulo_audit.lock_run(uuid) owner to orulo_audit_owner;
alter function orulo_audit.append(uuid,bigint,text,jsonb) owner to orulo_audit_owner;
alter function orulo_audit.snapshot_rows() owner to orulo_audit_owner;
alter function orulo_audit.compare_v2(uuid) owner to orulo_audit_owner;
revoke all on all functions in schema orulo_audit from public,anon,authenticated,service_role;
revoke all on function public.orulo_audit_control(text,uuid,bigint,text,jsonb),public.orulo_audited_cas(uuid,uuid) from public,anon,authenticated;
grant execute on function public.orulo_audit_control(text,uuid,bigint,text,jsonb),public.orulo_audited_cas(uuid,uuid) to service_role;
revoke create on schema public from orulo_audit_owner;
notify pgrst,'reload schema';
commit;

