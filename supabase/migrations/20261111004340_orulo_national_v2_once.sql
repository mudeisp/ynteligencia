-- National V2 extension of the installed ledger. No new receipt table or property DML.
-- Installation, permissions and activation require a separate deployment approval.
begin;
do $compatibility$
declare signature text; expected text;
begin
 for signature,expected in select * from (values
('public.orulo_audit_control(text,uuid,bigint,text,jsonb)','e79102e44204c5c40ac21d4e9118e624d8dc820ddcdbfdb5195fb82db960ba67'),
('public.orulo_audited_cas(uuid,uuid)','321adef41ee6d268f9e059c1aa6a823c055021bd489f8f56133e467db5d9a4b7'),
('orulo_audit.authorize_pilot(uuid,text,text,text,text)','f0f9de0fda6fe36016e9b75d33aacb4c2773fe37e2a0484be2f7425010abba81'),
('orulo_audit.cas_core(uuid,jsonb,jsonb)','d08ba2e9c9d242148916d370bf93ecfb94aed6522fd77967740a453be8c9a8a1'),
('orulo_audit.audited_cas_core(uuid,uuid)','eb7e278cd351999f20249dcfd6e627cb52d5d9ea29228189bd6cf7c09833dda6'),
('orulo_audit.append(uuid,bigint,text,jsonb)','8dd906e953df5cb09f7cf8e234763a18c5190c65f07bcd6664d46f5ece0f55d1'),
('orulo_audit.columns_v2()','3aa4d73c7a7100a523c23507c836299bd90dee4dacfcf772f6084469b713cea3'),
('orulo_audit.compare_v2(uuid)','be8e9054de9960c25692c9304a1905da5c9323710e4875e0bb60a2146e694e83'),
('orulo_audit.control_paged(text,uuid,bigint,text,jsonb)','d93eaa6979d90ca59a49e05565c2b2a8b32517840b51e6ea8beeda45e9a69782'),
('orulo_audit.control_v1(text,uuid,bigint,text,jsonb)','5ffbf3fada5b4d39b913a24b60a09a62e1828639914ed6fe9158cd3293e11185'),
('orulo_audit.immutable()','ff535dffe62eb0ded2c2dadc92946315190f4c5fcb1f80874603efd36132a55f'),
('orulo_audit.lock_run(uuid)','4bd74b5fafc13b0ba0ae57d7cf25e229e5865a0767db95c84334f4532e85297c'),
('orulo_audit.require_service()','114a0f8c0d58c70969a7bf5f78e2dff2ab5d685e75ddca4fc9be1a3c1a081f29')
 ) as pinned(signature,expected) loop
  if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex') is distinct from expected then raise exception 'NATIONAL_PRODUCTION_CONTRACT_DRIFT: %',signature; end if;
 end loop;
end$compatibility$;

create index orulo_national_lookup on orulo_audit.entries(run_uuid,kind,(event->>'id'));
create unique index orulo_national_target_once on orulo_audit.entries(run_uuid,(event->'target'->>'id')) where kind='NATIONAL_TARGET';
create unique index orulo_national_part_once on orulo_audit.entries(run_uuid,((event->>'part')::integer)) where kind='NATIONAL_MANIFEST_PART';
create unique index orulo_national_manifest_once on orulo_audit.entries((event->>'manifestHash')) where kind='WRITE_AUTHORIZED' and event->>'mode'='national-v2-once';

create function orulo_audit.national_authorization(r uuid) returns jsonb
language plpgsql set search_path='' as $$
declare a jsonb; lease jsonb;
begin
 select event into a from orulo_audit.entries where run_uuid=r and kind='WRITE_AUTHORIZED' and event->>'mode'='national-v2-once';
 if a is null or exists(select 1 from orulo_audit.entries where run_uuid=r and kind in ('ABORTED','FINISHED')) then raise exception 'NATIONAL_AUTHORIZATION_REQUIRED'; end if;
 select event into lease from orulo_audit.entries where run_uuid=r and kind in ('WRITE_AUTHORIZED','CONTINUATION_AUTHORIZED') order by sequence desc limit 1;
 if (lease->>'expiresAt')::timestamptz<clock_timestamp() or lease->>'expiresAt' is null then raise exception 'NATIONAL_LEASE_EXPIRED'; end if;
 return a||jsonb_build_object('lease',lease);
end$$;

-- The additional RLS policy accepts only the exact old/new row of the current
-- durable INTENT, never a state/UF wildcard. Context is set only by the guarded CAS.
create function orulo_audit.national_policy(row_json jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare r uuid; op uuid; i jsonb;
begin
 if current_user<>'orulo_audit_owner' or coalesce(current_setting('orulo.national_run',true),'')='' then return false; end if;
 r:=current_setting('orulo.national_run',true)::uuid;op:=current_setting('orulo.national_operation',true)::uuid;
 select event into i from orulo_audit.entries where run_uuid=r and operation_uuid=op and kind='INTENT';
 return i is not null and row_json->>'id'=i->>'id' and
 (row_json=i->'expected' or row_json=(i->'expected'||jsonb_build_object('raw_data',jsonb_set(i->'expected'->'raw_data','{building,floor_plans}',i->'desiredPlans',false))));
end$$;
create policy orulo_audit_national_update on public.properties for update to orulo_audit_owner
 using(orulo_audit.national_policy(to_jsonb(properties))) with check(orulo_audit.national_policy(to_jsonb(properties)));

create function orulo_audit.national_merge(raw jsonb, patches jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare x jsonb; old jsonb; result jsonb; url jsonb;
begin
 if jsonb_typeof(raw#>'{building,floor_plans}') is distinct from 'array' or jsonb_typeof(patches) is distinct from 'array'
 or jsonb_array_length(patches)=0 then raise exception 'NATIONAL_PLAN_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(raw#>'{building,floor_plans}')p where jsonb_typeof(p)<>'object' or p->>'id' is null)
 or (select count(*)<>count(distinct p->>'id') from jsonb_array_elements(raw#>'{building,floor_plans}')p)
 or (select count(*)<>count(distinct p->>'id') from jsonb_array_elements(patches)p) then raise exception 'NATIONAL_DUPLICATE_PLAN_ID'; end if;
 for x in select * from jsonb_array_elements(patches) loop
  if coalesce(x->>'id','')!~'^[0-9]+$' or jsonb_typeof(x->'images') is distinct from 'array'
    or jsonb_array_length(x->'images')=0 then raise exception 'NATIONAL_PATCH_INVALID'; end if;
  select p into old from jsonb_array_elements(raw#>'{building,floor_plans}')p where p->>'id'=x->>'id';
  if old is null then raise exception 'NATIONAL_PLAN_MISSING'; end if;
  if old->'images' is not null and old->'images' not in ('null'::jsonb,'[]'::jsonb) or exists(
   select 1 from unnest(array['image_url','url','2280x1800','1024x1024','520x280'])k where coalesce(old->>k,'')<>'') then raise exception 'NATIONAL_EXISTING_IMAGE'; end if;
  for url in select * from jsonb_array_elements(x->'images') loop
   if jsonb_typeof(url)<>'string' or not(url#>>'{}'~'^https://static[.]orulo[.]com[.]br/images/properties/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]([jJ][pP][eE]?[gG]|[pP][nN][gG]|[wW][eE][bB][pP])$')
   then raise exception 'NATIONAL_URL_INVALID'; end if;
   if not exists(select 1 from jsonb_array_elements(x->'checks')c where c->>'url'=url#>>'{}'
      and c->'evidence'->>'url'=url#>>'{}' and c->'evidence'->>'status'='VALIDATED_PREFIX'
      and c->'evidence'->>'prefixSha256'~'^[a-f0-9]{64}$' and c->>'evidenceSha256'~'^[a-f0-9]{64}$')
   then raise exception 'NATIONAL_PROVENANCE_REQUIRED'; end if;
  end loop;
 end loop;
 select jsonb_agg(case when z.patch_json is null then p else p||jsonb_build_object('images',z.patch_json->'images') end order by n) into result
 from jsonb_array_elements(raw#>'{building,floor_plans}') with ordinality a(p,n)
 left join lateral(select v patch_json from jsonb_array_elements(patches)v where v->>'id'=p->>'id') z on true;
 return result;
end$$;

create function orulo_audit.national_replace(p_id uuid,p_expected jsonb,p_plans jsonb) returns jsonb
language plpgsql set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare before public.properties%rowtype; after public.properties%rowtype; expected public.properties%rowtype;
 desired jsonb; b jsonb; a jsonb;
begin
 if current_user<>'orulo_audit_owner' or not orulo_audit.national_policy(p_expected) then raise exception 'NATIONAL_CAS_CONTEXT_REQUIRED'; end if;
 select * into before from public.properties where id=p_id for update;
 if not found then return jsonb_build_object('status','NOT_FOUND','id',p_id); end if;
 if (select array_agg(k order by k) from jsonb_object_keys(to_jsonb(before))k) is distinct from
    (select array_agg(k order by k) from jsonb_object_keys(p_expected)k) then return jsonb_build_object('status','CONFLICT','id',p_id); end if;
 select * into expected from jsonb_populate_record(null::public.properties,p_expected);
 if to_jsonb(before) is distinct from to_jsonb(expected) then return jsonb_build_object('status','CONFLICT','id',p_id); end if;
 desired:=to_jsonb(before)||jsonb_build_object('raw_data',jsonb_set(before.raw_data,'{building,floor_plans}',p_plans,false));
 if not orulo_audit.national_policy(desired) then raise exception 'NATIONAL_DESIRED_ROW_DENIED'; end if;
 update public.properties p set raw_data=desired->'raw_data'
 where p.id=p_id and to_jsonb(p)=to_jsonb(expected) returning p.* into after;
 if not found then return jsonb_build_object('status','CONFLICT','id',p_id); end if;
 if to_jsonb(after) is distinct from desired then raise exception 'NATIONAL_UNAUTHORIZED_TRIGGER_CHANGE'; end if;
 b:=to_jsonb(before)||jsonb_build_object('created_at',before.created_at at time zone 'UTC','updated_at',before.updated_at at time zone 'UTC');
 a:=to_jsonb(after)||jsonb_build_object('created_at',after.created_at at time zone 'UTC','updated_at',after.updated_at at time zone 'UTC');
 return jsonb_build_object('status','UPDATED','id',p_id,'row',to_jsonb(after),'receipt',jsonb_build_object('id',p_id,'verified',true,
 'beforeFullHash',md5(b::text),'afterFullHash',md5(a::text),'expectedBeforeContentHash',md5((b-'updated_at')::text),
 'expectedAfterContentHash',md5((a-'updated_at')::text),'beforeSha256',encode(sha256(convert_to(to_jsonb(before)::text,'UTF8')),'hex'),
 'afterSha256',encode(sha256(convert_to(to_jsonb(after)::text,'UTF8')),'hex'),'allowedChangedPaths',jsonb_build_array('raw_data.building.floor_plans[].images')));
end$$;

create function orulo_audit.national_cas(r uuid,op uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set synchronous_commit='on' set lock_timeout='5s' as $$
declare auth jsonb; intent orulo_audit.entries%rowtype; target jsonb; expected public.properties%rowtype; current_row public.properties%rowtype; result jsonb;
begin
 perform orulo_audit.require_service();perform orulo_audit.lock_run(r);auth:=orulo_audit.national_authorization(r);
 select * into intent from orulo_audit.entries where run_uuid=r and kind='INTENT' and operation_uuid=op;
 if not found or intent.created_at<clock_timestamp()-interval '5 minutes' then raise exception 'NATIONAL_FRESH_INTENT_REQUIRED'; end if;
 select event->'target' into target from orulo_audit.entries where run_uuid=r and kind='NATIONAL_TARGET' and event->'target'->>'id'=intent.event->>'id';
 select * into expected from jsonb_populate_record(null::public.properties,intent.event->'expected');
 perform set_config('orulo.national_run',r::text,true);perform set_config('orulo.national_operation',op::text,true);
 select * into current_row from public.properties where id=expected.id for update;
 if target is null or expected.id::text is distinct from target->>'id' or expected.source is distinct from 'novos'
 or expected.raw_data->>'building_id' is distinct from target->>'buildingId'
 or (expected.raw_data#>>'{building,id}' is not null and expected.raw_data#>>'{building,id}' is distinct from target->>'buildingId')
 or expected.external_id not like 'orulo:'||(target->>'buildingId')||':%'
 or to_jsonb(current_row) is distinct from to_jsonb(expected)
 or encode(sha256(convert_to(to_jsonb(current_row)::text,'UTF8')),'hex') is distinct from target->>'baselineSha256'
 or intent.event->'desiredPlans' is distinct from orulo_audit.national_merge(expected.raw_data,target->'patches')
 then raise exception 'NATIONAL_FROZEN_TARGET_DIVERGENCE'; end if;
 if not exists(select 1 from orulo_audit.entries where run_uuid=r and kind='BASELINE_V2' and sequence>(auth->>'planSequence')::bigint)
 or orulo_audit.columns_v2() is distinct from (select event->'columns' from orulo_audit.entries where run_uuid=r and kind='NATIONAL_MANIFEST_SEALED')
 then raise exception 'NATIONAL_GLOBAL_BASELINE_REQUIRED'; end if;
 if exists(select 1 from orulo_audit.entries where run_uuid=r and kind='CAS_RESULT' and event->>'id'=expected.id::text) then raise exception 'NATIONAL_ALREADY_ATTEMPTED_RECONCILE'; end if;
 perform set_config('orulo.national_run',r::text,true);perform set_config('orulo.national_operation',op::text,true);
 -- Reuse the installed durable-intent and transactional CAS_RESULT mechanism.
 result:=orulo_audit.audited_cas_core(r,op);
 perform set_config('orulo.national_run','',true);perform set_config('orulo.national_operation','',true);
 return result;
end$$;

create function orulo_audit.national_authorize(r uuid,head text,github_id text,code_sha text,reason text) returns jsonb
language plpgsql security definer set search_path='' set synchronous_commit='on' as $$
declare e orulo_audit.entries%rowtype; meta jsonb;
begin
 if current_setting('role',true)='service_role' or session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 perform orulo_audit.lock_run(r);
 select metadata into meta from orulo_audit.runs where run_uuid=r and github_run_id=github_id;
 select * into e from orulo_audit.entries where run_uuid=r order by sequence desc limit 1;
 if e.kind is distinct from 'NATIONAL_MANIFEST_SEALED' or e.hash is distinct from head
 or meta->>'workflowSha' is distinct from code_sha or meta->>'manifestHash' is distinct from e.event->>'manifestHash'
 or coalesce(code_sha,'')!~'^[a-f0-9]{40}$' or length(trim(reason))<10 or reason is null
 or exists(select 1 from orulo_audit.entries where run_uuid=r and kind='WRITE_AUTHORIZED') then raise exception 'NATIONAL_ADMIN_APPROVAL_INVALID'; end if;
 return orulo_audit.append(r,e.sequence+1,e.hash,jsonb_build_object('type','WRITE_AUTHORIZED','eventUuid',gen_random_uuid(),
 'mode','national-v2-once','manifestHash',e.event->>'manifestHash','planSequence',e.sequence,'planHash',e.hash,
 'controlSha',code_sha,'githubRunId',github_id,'expiresAt',clock_timestamp()+interval '5 hours','reason',reason));
end$$;

create function orulo_audit.authorize_national_continuation(r uuid,head text,github_id text,code_sha text,reason text) returns jsonb
language plpgsql security definer set search_path='' set synchronous_commit='on' as $$
declare e orulo_audit.entries%rowtype; a jsonb;
begin
 if current_setting('role',true)='service_role' or session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 perform orulo_audit.lock_run(r);select * into e from orulo_audit.entries where run_uuid=r order by sequence desc limit 1;
 select event into a from orulo_audit.entries where run_uuid=r and kind='WRITE_AUTHORIZED' and event->>'mode'='national-v2-once';
 if a is null or a->>'controlSha' is distinct from code_sha or head is distinct from e.hash or github_id!~'^[1-9][0-9]*$'
 or length(trim(reason))<20 or reason is null or exists(select 1 from orulo_audit.entries where run_uuid=r and kind in ('FINISHED','ABORTED'))
 or exists(select 1 from orulo_audit.entries i where i.run_uuid=r and i.kind='INTENT' and not exists(
 select 1 from orulo_audit.entries c where c.operation_uuid=i.operation_uuid and c.kind='CAS_RESULT')) then raise exception 'NATIONAL_CONTINUATION_RECONCILIATION_REQUIRED'; end if;
 return orulo_audit.append(r,e.sequence+1,e.hash,jsonb_build_object('type','CONTINUATION_AUTHORIZED','eventUuid',gen_random_uuid(),
 'mode','national-v2-once','manifestHash',a->>'manifestHash','controlSha',code_sha,'githubRunId',github_id,
 'expiresAt',clock_timestamp()+interval '5 hours','reason',reason));
end$$;

-- Independent writer proof is recorded by an authenticated administrator only.
-- It is diagnostic evidence. STRICT_GLOBAL_V1 still blocks external transitions.
create function orulo_audit.national_attest_external(r uuid,p_id uuid,p_before text,p_after text,p_process text,p_event_id text,p_xid text,p_proof_sha text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set synchronous_commit='on' as $$
declare e orulo_audit.entries%rowtype;
begin
 if current_setting('role',true)='service_role' or session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 perform orulo_audit.lock_run(r);
 if not exists(select 1 from orulo_audit.runs where run_uuid=r and metadata->>'mode'='national-v2-once')
 or exists(select 1 from orulo_audit.entries where run_uuid=r and kind='NATIONAL_TARGET' and event->'target'->>'id'=p_id::text)
 or coalesce(p_proof_sha,'')!~'^[a-f0-9]{64}$' or coalesce(p_xid,'')!~'^[1-9][0-9]*$'
 or coalesce(length(p_process),0)<1 or coalesce(length(p_event_id),0)<1 or coalesce(length(p_reason),0)<20
 or exists(select 1 from orulo_audit.entries where run_uuid=r and created_xid::text=p_xid)
 or p_before is not distinct from p_after
 or not exists(select 1 from
  (select record from orulo_audit.snapshot_records where run_uuid=r and id=p_id and kind='BASELINE_V2') b
  full join (select record from orulo_audit.snapshot_records where run_uuid=r and id=p_id and kind='READBACK_V2') a on true
  where coalesce(b.record->>4,'')=coalesce(p_before,'') and coalesce(a.record->>4,'')=coalesce(p_after,''))
 then raise exception 'NATIONAL_INDEPENDENT_EXTERNAL_PROOF_REQUIRED'; end if;
 select * into e from orulo_audit.entries where run_uuid=r order by sequence desc limit 1;
 return orulo_audit.append(r,e.sequence+1,e.hash,jsonb_build_object('type','EXTERNAL_ATTESTATION','eventUuid',gen_random_uuid(),
 'id',p_id,'beforeFullHash',p_before,'afterFullHash',p_after,'process',p_process,'eventId',p_event_id,
 'writerTransaction',p_xid,'proofSha256',p_proof_sha,'reason',p_reason,'policy','STRICT_GLOBAL_V1','automaticAcceptance',false));
end$$;

create function orulo_audit.national_reconcile(r uuid) returns jsonb language sql set search_path='' as $$
 with b as(select id,record from orulo_audit.snapshot_records where run_uuid=r and kind='BASELINE_V2'),
 a as(select id,record from orulo_audit.snapshot_records where run_uuid=r and kind='READBACK_V2'),
 receipts as(select event->>'id' id,event->'result' result from orulo_audit.entries where run_uuid=r and kind='CAS_RESULT'),
 changes as(select coalesce(b.id,a.id) id,b.record before,a.record after,c.result,
 case when c.result->>'status'='UPDATED' and c.result->'receipt'->>'verified'='true'
 and b.record->>4=c.result->'receipt'->>'beforeFullHash' and a.record->>4=c.result->'receipt'->>'afterFullHash'
 and b.record->>5=c.result->'receipt'->>'expectedBeforeContentHash' and a.record->>5=c.result->'receipt'->>'expectedAfterContentHash'
 then 'AUTHORIZED_TARGET_CHANGE'
 when exists(select 1 from orulo_audit.entries t where t.run_uuid=r and t.kind='NATIONAL_TARGET' and t.event->'target'->>'id'=coalesce(b.id,a.id)::text)
 then 'UNEXPECTED_TARGET_CHANGE'
 when exists(select 1 from orulo_audit.entries proof where proof.run_uuid=r and proof.kind='EXTERNAL_ATTESTATION'
 and proof.event->>'id'=coalesce(b.id,a.id)::text and coalesce(proof.event->>'beforeFullHash','')=coalesce(b.record->>4,'')
 and coalesce(proof.event->>'afterFullHash','')=coalesce(a.record->>4,'')) then 'EXTERNAL_CHANGE_VERIFIED'
 else 'EXTERNAL_CHANGE_UNATTRIBUTED' end classification
 from b full join a using(id) left join receipts c on c.id=coalesce(b.id,a.id)::text
 where b.record is distinct from a.record)
 select jsonb_build_object('policy','STRICT_GLOBAL_V1','changes',coalesce(jsonb_agg(to_jsonb(changes)),'[]'::jsonb),
 'blocked',coalesce(bool_or(classification<>'AUTHORIZED_TARGET_CHANGE'),false),
 'authorized',count(*) filter(where classification='AUTHORIZED_TARGET_CHANGE'),
 'unattributed',count(*) filter(where classification='EXTERNAL_CHANGE_UNATTRIBUTED'),
 'externalVerified',count(*) filter(where classification='EXTERNAL_CHANGE_VERIFIED'),
 'targetDivergences',count(*) filter(where classification='UNEXPECTED_TARGET_CHANGE')) from changes;
$$;

create function orulo_audit.national_control(p_action text,p_run uuid,p_sequence bigint,p_previous_hash text,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set synchronous_commit='on' set lock_timeout='5s' as $$
declare meta jsonb; doc jsonb; payload text; target jsonb; ack jsonb; auth jsonb; entry orulo_audit.entries%rowtype;
 state jsonb; n bigint; parts bigint; expected jsonb; before public.properties%rowtype; stats jsonb;
begin
 perform orulo_audit.require_service();
 if p_action='national_health' then return orulo_audit.control_paged('health')||jsonb_build_object('nationalProtocol',1,'policy','STRICT_GLOBAL_V1'); end if;
 if p_action='start' then
  if not pg_try_advisory_xact_lock(hashtextextended('orulo-lote1-exclusive',0)) then raise exception 'AUDIT_CONCURRENT_RUN'; end if;
  if exists(select 1 from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and e.kind in ('FINISHED','ABORTED'))) then raise exception 'AUDIT_ACTIVE_RUN_REQUIRES_RECONCILIATION'; end if;
  if p_event->>'mode' is distinct from 'national-v2-once' or p_event->>'repository' is distinct from 'mudeisp/ynteligencia'
  or p_event->>'actor' is distinct from 'mudeisp' or p_event->>'actorId' is distinct from '323805541'
  or p_event->>'triggeringActor' is distinct from 'mudeisp' or p_event->>'eventName' is distinct from 'workflow_dispatch'
  or p_event->>'attempt' is distinct from '1' or coalesce(p_event->>'workflowSha','')!~'^[a-f0-9]{40}$'
  or coalesce(p_event->>'manifestHash','')!~'^[a-f0-9]{64}$' or p_event->>'ref' is distinct from 'refs/heads/main'
  then raise exception 'NATIONAL_MANUAL_OWNER_REQUIRED'; end if;
  insert into orulo_audit.runs(run_uuid,github_run_id,metadata) values(p_run,p_event->>'githubRunId',p_event);
  return orulo_audit.append(p_run,1,'',p_event||jsonb_build_object('type','START'));
 end if;
 perform orulo_audit.lock_run(p_run);select metadata into meta from orulo_audit.runs where run_uuid=p_run;
 if meta->>'mode' is distinct from 'national-v2-once' then raise exception 'NATIONAL_MODE_REQUIRED'; end if;
 if p_action in ('read','recover','snapshot_begin','snapshot_page','snapshot_seal') then
  if p_action like 'snapshot_%' then perform orulo_audit.national_authorization(p_run); end if;
  return orulo_audit.control_paged(p_action,p_run,p_sequence,p_previous_hash,p_event);
 end if;
 if p_action='national_resume' then
  auth:=orulo_audit.national_authorization(p_run);
  select * into entry from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
  if entry.kind<>'CONTINUATION_AUTHORIZED' or entry.event->>'githubRunId' is distinct from p_event->>'githubRunId'
  or entry.event->>'controlSha' is distinct from p_event->>'controlSha' then raise exception 'NATIONAL_EXPLICIT_CONTINUATION_REQUIRED'; end if;
  return jsonb_build_object('runUuid',p_run,'sequence',entry.sequence,'hash',entry.hash,'eventUuid',entry.event_uuid);
 end if;
 if p_action='national_report' then
  select * into entry from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
  return jsonb_build_object('runUuid',p_run,'head',jsonb_build_object('hash',entry.hash,'sequence',entry.sequence),
   'manifestHash',meta->>'manifestHash','rowsWritten',(select count(*) from orulo_audit.entries where run_uuid=p_run and kind='CAS_RESULT' and event->'result'->>'status'='UPDATED'),
   'pendingIntents',(select count(*) from orulo_audit.entries i where i.run_uuid=p_run and i.kind='INTENT' and not exists(select 1 from orulo_audit.entries c where c.operation_uuid=i.operation_uuid and c.kind='CAS_RESULT')),
   'reconciliation',case when (select count(*) from orulo_audit.entries where run_uuid=p_run and kind in ('BASELINE_V2','READBACK_V2'))=2 then orulo_audit.national_reconcile(p_run) else null end);
 end if;
 if p_action='national_continue_status' then
  select * into entry from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
  return to_jsonb(entry.kind='CONTINUATION_AUTHORIZED' and entry.event->>'githubRunId'=p_event->>'githubRunId');
 end if;
 if p_action='national_status' then
  select * into entry from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED';
  if not found then return 'null'::jsonb; end if;perform orulo_audit.national_authorization(p_run);
  return jsonb_build_object('runUuid',p_run,'sequence',entry.sequence,'hash',entry.hash,'eventUuid',entry.event_uuid);
 end if;
 if p_action='national_snapshot_state' then
  select * into entry from orulo_audit.entries where run_uuid=p_run and kind=p_event->>'kind';
  if found then return jsonb_build_object('sealed',true,'sequence',entry.sequence); end if;
  return (select jsonb_build_object('sealed',false,'keys',to_jsonb(s.keys),'processed',(select count(*) from orulo_audit.snapshot_records x where x.run_uuid=p_run and x.kind=s.kind))
   from orulo_audit.snapshot_sets s where s.run_uuid=p_run and s.kind=p_event->>'kind');
 end if;
 if p_action='national_row' then
  select event->'target' into target from orulo_audit.entries where run_uuid=p_run and kind='NATIONAL_TARGET' and event->'target'->>'id'=p_event->>'id';
  if target is null then raise exception 'NATIONAL_TARGET_NOT_FROZEN'; end if;
  select * into before from public.properties where id=(target->>'id')::uuid;
  return jsonb_build_object('row',to_jsonb(before),'sha256',encode(sha256(convert_to(to_jsonb(before)::text,'UTF8')),'hex'),
   'result',(select event from orulo_audit.entries where run_uuid=p_run and kind='CAS_RESULT' and event->>'id'=target->>'id'),
   'readback',(select event from orulo_audit.entries where run_uuid=p_run and kind='CLIENT_READBACK' and event->>'id'=target->>'id' order by sequence desc limit 1));
 end if;
 if p_action='national_part' or p_action='national_target' or p_action='national_seal' then
  if exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind in ('NATIONAL_MANIFEST_SEALED','WRITE_AUTHORIZED')) then raise exception 'NATIONAL_MANIFEST_IMMUTABLE'; end if;
  if p_action='national_part' then
   select count(*) into n from orulo_audit.entries where run_uuid=p_run and kind='NATIONAL_MANIFEST_PART';
   if (p_event->>'part')::bigint is distinct from n or length(p_event->>'text') not between 1 and 131072 then raise exception 'NATIONAL_PART_CURSOR_INVALID'; end if;
   return orulo_audit.append(p_run,p_sequence,p_previous_hash,p_event||jsonb_build_object('type','NATIONAL_MANIFEST_PART'));
  end if;
  if p_action='national_target' then
   target:=p_event->'target';
   if coalesce(target->>'id','')!~'^[a-f0-9-]{36}$' or coalesce(target->>'buildingId','')!~'^[0-9]+$'
   or coalesce(target->>'baselineSha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(target->'patches') is distinct from 'array'
   then raise exception 'NATIONAL_TARGET_INVALID'; end if;
   return orulo_audit.append(p_run,p_sequence,p_previous_hash,p_event||jsonb_build_object('type','NATIONAL_TARGET'));
  end if;
  select string_agg(event->>'text','' order by (event->>'part')::integer) into payload from orulo_audit.entries where run_uuid=p_run and kind='NATIONAL_MANIFEST_PART';
  if encode(sha256(convert_to(payload,'UTF8')),'hex') is distinct from meta->>'manifestHash' then raise exception 'NATIONAL_MANIFEST_HASH_MISMATCH'; end if;
  doc:=payload::jsonb;
  select jsonb_agg(event->'target' order by event->'target'->>'id') into expected from orulo_audit.entries where run_uuid=p_run and kind='NATIONAL_TARGET';
  if doc->>'id' is distinct from 'national-v2-once' or doc->>'operationUuid' is distinct from p_run::text
  or doc->>'sourceManifestSha256' is distinct from '6f6248375b5d5459496465d1c202e38e10adfade30bdef2442a7d59f00f313cc'
  or doc->>'reconciliationSha256' is distinct from '2a9e409d6db81e4d70a6ddaee942eedb9887f4302347e333dec4c122cab8e66e'
  or doc->'targets' is distinct from expected or expected is null or jsonb_array_length(expected)=0
  or doc->'columns' is distinct from orulo_audit.columns_v2()
  or doc->>'schemaVersion' is distinct from '1'
  or (doc->'stats'->>'properties')::bigint is distinct from jsonb_array_length(expected)::bigint
  or (doc->'stats'->>'eligibleOccurrences')::bigint is distinct from (select sum(jsonb_array_length(t->'patches')) from jsonb_array_elements(expected)t)
  or (doc->'stats'->>'buildings')::bigint is distinct from (select count(distinct t->>'buildingId') from jsonb_array_elements(expected)t)
  or (doc->'stats'->>'distinctUrls')::bigint is distinct from (select count(distinct u#>>'{}') from jsonb_array_elements(expected)t cross join lateral jsonb_array_elements(t->'patches')p cross join lateral jsonb_array_elements(p->'images')u)
  or exists(select 1 from jsonb_array_elements(expected)t where jsonb_array_length(t->'patches')=0)
  then raise exception 'NATIONAL_SEALED_SCOPE_MISMATCH'; end if;
  return orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type','NATIONAL_MANIFEST_SEALED','eventUuid',p_event->>'eventUuid',
  'manifestHash',meta->>'manifestHash','columns',doc->'columns','stats',doc->'stats','targetCount',jsonb_array_length(expected)));
 end if;
 if p_action='append' then
  if p_event->>'type'='CLIENT_READBACK' and p_event->>'stage'='NATIONAL_ROW_VERIFIED' then
   select event->'result' into expected from orulo_audit.entries where run_uuid=p_run and kind='CAS_RESULT' and event->>'id'=p_event->>'id';
   select * into before from public.properties where id=(p_event->>'id')::uuid;
   if expected->>'status' is distinct from 'UPDATED' or p_event->>'sha256' is distinct from expected->'receipt'->>'afterSha256'
    or p_event->>'sha256' is distinct from encode(sha256(convert_to(to_jsonb(before)::text,'UTF8')),'hex')
   then raise exception 'NATIONAL_SERVER_READBACK_DIVERGENCE'; end if;
  end if;
  if p_event->>'type' not in ('INTENT','CLIENT_READBACK','CLIENT_STOP') then raise exception 'AUDIT_RESERVED_EVENT_TYPE'; end if;
  if p_event->>'type'='INTENT' then
   auth:=orulo_audit.national_authorization(p_run);
   if exists(select 1 from orulo_audit.entries i where i.run_uuid=p_run and i.kind='INTENT' and not exists(select 1 from orulo_audit.entries c where c.kind='CAS_RESULT' and c.operation_uuid=i.operation_uuid)) then raise exception 'AUDIT_PENDING_INTENT'; end if;
   select event->'target' into target from orulo_audit.entries where run_uuid=p_run and kind='NATIONAL_TARGET' and event->'target'->>'id'=p_event->>'id';
   if target is null or p_event->>'id' is distinct from p_event->'expected'->>'id'
    or p_event->'desiredPlans' is distinct from orulo_audit.national_merge(p_event->'expected'->'raw_data',target->'patches') then raise exception 'NATIONAL_INTENT_SCOPE_INVALID'; end if;
  end if;
  return orulo_audit.append(p_run,p_sequence,p_previous_hash,p_event);
 end if;
 if p_action='national_finish' then
  auth:=orulo_audit.national_authorization(p_run);
  if (select count(*) from orulo_audit.entries where run_uuid=p_run and kind in ('BASELINE_V2','READBACK_V2'))<>2
  or exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind in ('BASELINE_V2','READBACK_V2') and event->'snapshot'->>'membershipStable' is distinct from 'true')
  or (orulo_audit.compare_v2(p_run))->>'schemaMatch' is distinct from 'true' then raise exception 'NATIONAL_SNAPSHOT_INTEGRITY_FAILED'; end if;
  if exists(select 1 from orulo_audit.entries i where i.run_uuid=p_run and i.kind='INTENT' and not exists(select 1 from orulo_audit.entries c where c.kind='CAS_RESULT' and c.operation_uuid=i.operation_uuid)) then raise exception 'AUDIT_PENDING_INTENT'; end if;
  state:=orulo_audit.national_reconcile(p_run);
  select count(*) into n from orulo_audit.entries where run_uuid=p_run and kind='CAS_RESULT' and event->'result'->>'status'='UPDATED';
  select count(*) into parts from orulo_audit.entries where run_uuid=p_run and kind='NATIONAL_TARGET';
  if state->>'blocked'='true' or n<>parts or exists(select 1 from orulo_audit.entries c where c.run_uuid=p_run and c.kind='CAS_RESULT' and c.event->'result'->>'status'='UPDATED' and not exists(
   select 1 from orulo_audit.entries rb where rb.run_uuid=p_run and rb.kind='CLIENT_READBACK' and rb.event->>'stage'='NATIONAL_ROW_VERIFIED'
   and rb.event->>'id'=c.event->>'id' and rb.event->>'sha256'=c.event->'result'->'receipt'->>'afterSha256')) then
   return orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type','NATIONAL_RECONCILIATION_REQUIRED',
    'eventUuid',p_event->>'eventUuid','rowsWritten',n,'targetCount',parts,'reconciliation',state));
  end if;
  return orulo_audit.append(p_run,p_sequence,p_previous_hash,jsonb_build_object('type','FINISHED','eventUuid',p_event->>'eventUuid',
  'mode','national-v2-once','manifestHash',auth->>'manifestHash','rowsWritten',n,'reconciliation',state,'writeEnabled',false));
 end if;
 raise exception 'NATIONAL_ACTION_DENIED';
end$$;

-- Preserve deployed historical bodies byte-for-byte after a narrow early route.
-- Fail on unknown signatures/owners or repeated application, never replace legacy
-- implementations from an older versioned file over a newer deployed body.
do $install$
declare signature text; definition text; injection text; name text;
begin
 for signature,name,injection in select * from (values
 ('public.orulo_audit_control(text,uuid,bigint,text,jsonb)','orulo_audit_control',
 $route$ if p_event->>'mode'='national-v2-once' or exists(select 1 from orulo_audit.runs where run_uuid=p_run and metadata->>'mode'='national-v2-once') then return orulo_audit.national_control(p_action,p_run,p_sequence,p_previous_hash,p_event); end if; $route$),
 ('public.orulo_audited_cas(uuid,uuid)','orulo_audited_cas',
 $route$ if exists(select 1 from orulo_audit.runs where run_uuid=p_run and metadata->>'mode'='national-v2-once') then return orulo_audit.national_cas(p_run,p_operation); end if; $route$),
 ('orulo_audit.authorize_pilot(uuid,text,text,text,text)','authorize_pilot',
 $route$ if exists(select 1 from orulo_audit.runs where run_uuid=p_run and metadata->>'mode'='national-v2-once') then return orulo_audit.national_authorize(p_run,p_expected_head,p_github_run_id,p_control_sha,p_reason); end if; $route$)
 )routes(signature,name,injection) loop
  if (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure(signature)) is distinct from 'orulo_audit_owner' then raise exception 'NATIONAL_DEPLOYED_CONTRACT_OWNER_MISMATCH'; end if;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  if definition is null or position('national_' in definition)>0 or definition!~E'\\n[ \\t]*begin[ \\t]*\\n' then raise exception 'NATIONAL_DEPLOYED_CONTRACT_REVIEW_REQUIRED: %',signature; end if;
  definition:=regexp_replace(definition,E'\\n[ \\t]*begin[ \\t]*\\n',E'\nbegin\n'||injection||E'\n');
  execute definition;
 end loop;
 signature:='orulo_audit.audited_cas_core(uuid,uuid)';
 definition:=pg_get_functiondef(to_regprocedure(signature));
 if definition is null or position('result:=orulo_audit.cas_core(' in definition)=0 then raise exception 'NATIONAL_AUDITED_CORE_CONTRACT_REVIEW_REQUIRED'; end if;
 definition:=replace(definition,'result:=orulo_audit.cas_core((intent.event->>''id'')::uuid,intent.event->''expected'',intent.event->''desiredPlans'');',
 'if exists(select 1 from orulo_audit.runs where run_uuid=p_run and metadata->>''mode''=''national-v2-once'') then result:=orulo_audit.national_replace((intent.event->>''id'')::uuid,intent.event->''expected'',intent.event->''desiredPlans''); else result:=orulo_audit.cas_core((intent.event->>''id'')::uuid,intent.event->''expected'',intent.event->''desiredPlans''); end if;');
 execute definition;
end$install$;

-- Existing API entrypoint ACLs are retained. New helpers are private owner-only.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='orulo_audit' and (p.proname like 'national_%' or p.proname='authorize_national_continuation') loop
  execute format('alter function %s owner to orulo_audit_owner',f.signature);
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end$$;
notify pgrst,'reload schema';
commit;
