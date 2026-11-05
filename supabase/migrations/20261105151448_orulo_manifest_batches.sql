-- Review-only preparation: no property DML, authorization or ledger rewrite.
begin;

-- Preserve the catalog function OID/owner/ACL and every manifest byte; change one flag.
do $release$
declare c jsonb; next_catalog jsonb;
begin
 c:=orulo_audit.batch_catalog();
 if c->>'masterHash' is distinct from 'd670eb2cc7ab60cfc76e0ef08b466e9c9b503df64047d57519a34e7ed57f63b2'
 or c->'batches'->'phase2-30-a'->>'hash' is distinct from '399cefa01b8fc029a4de2393eb0cf124ea736ca16e1837c7cedf2260f505a62d'
 or c->'batches'->'phase2-30-a'->>'prerequisite' is distinct from 'phase1-20'
 or c->'batches'->'phase2-30-b'->'released' is distinct from 'false'::jsonb
 or c->'batches'->'phase3-rest'->'released' is distinct from 'false'::jsonb
 then raise exception 'BATCH_CATALOG_REVIEW_REQUIRED'; end if;
 next_catalog:=jsonb_set(c,'{batches,phase2-30-a,released}','true'::jsonb,false);
 execute format($ddl$create or replace function orulo_audit.batch_catalog() returns jsonb language sql immutable set search_path='' as $catalog$ select %L::jsonb $catalog$$ddl$,next_catalog::text);
 if orulo_audit.batch_catalog() is distinct from next_catalog then raise exception 'BATCH_CATALOG_UPDATE_FAILED'; end if;
end
$release$;

-- A narrow, immutable evidence recognition, NOT a generic acceptance of ABORTED.
-- The existing owner-issued reconciliation event is the administrative attestation.
-- Only the already reviewed run/head can satisfy this exceptional prerequisite.
create function orulo_audit.batch_prerequisite_result(p_batch text) returns jsonb
language plpgsql set search_path='' set timezone='UTC' as $proof$
declare
 r constant uuid := '8c3b6881-69fa-4737-a29f-6aeebe1b94b9';
 terminal_hash constant text := '4e9b652387480e73eb6c0058b8ec456bd0874ca345e4f3be1cdaf26ce40246a6';
 expected_events constant integer := 957;
 expected_rows constant integer := 26;
 expected_occurrences constant integer := 110;
 e orulo_audit.entries%rowtype; p orulo_audit.entries%rowtype;
 ok boolean; n bigint; missing_before bigint; missing_after bigint;
begin
 select * into e from orulo_audit.entries where kind='FINISHED'
 and event->>'batchId'=p_batch and event->>'masterHash'=orulo_audit.batch_catalog()->>'masterHash'
 order by created_at desc,run_uuid limit 1;
 if found then return jsonb_build_object('terminalType','FINISHED','runUuid',e.run_uuid,'sequence',e.sequence,'hash',e.hash); end if;
 if p_batch is distinct from 'phase1-20' then return null; end if;
 select * into e from orulo_audit.entries where run_uuid=r order by sequence desc limit 1;
 if not found or e.sequence<>expected_events or e.kind<>'ABORTED' or e.hash<>terminal_hash or e.event->'reconciled' is distinct from 'true'::jsonb then return null; end if;
 select count(*),bool_and(sequence=rn and previous_hash=prev
 and hash=encode(sha256(convert_to(canonical,'UTF8')),'hex')
 and canonical=jsonb_build_object('runUuid',run_uuid,'sequence',sequence,'previousHash',previous_hash,'event',event)::text
 and kind=event->>'type' and event_uuid::text=event->>'eventUuid')
 into n,ok from(select *,row_number() over(order by sequence)rn,coalesce(lag(hash) over(order by sequence),'')prev from orulo_audit.entries where run_uuid=r)x;
 if n<>expected_events or ok is distinct from true then raise exception 'BATCH_RECONCILED_CHAIN_INVALID'; end if;
 select * into p from orulo_audit.entries where run_uuid=r and event->>'stage'='BATCH_PLAN';
 if not found or p.event->>'batchId'<>'phase1-20'
 or p.event->>'masterHash' is distinct from orulo_audit.batch_catalog()->>'masterHash'
 or p.event->>'batchManifestHash' is distinct from orulo_audit.batch_catalog()->'batches'->'phase1-20'->>'hash'
 or jsonb_array_length(p.event->'targets')<>expected_rows
 or (select count(*) from orulo_audit.entries where run_uuid=r and kind='WRITE_AUTHORIZED')<>1
 or (select count(*) from orulo_audit.entries where run_uuid=r and kind='INTENT')<>expected_rows
 or (select count(*) from orulo_audit.entries where run_uuid=r and kind='CAS_RESULT')<>expected_rows
 or (select count(distinct event->>'id') from orulo_audit.entries where run_uuid=r and kind='CAS_RESULT')<>expected_rows
 or (select count(*) from orulo_audit.entries where run_uuid=r and event->>'stage'='BATCH_ROW_VERIFIED')<>expected_rows
 then raise exception 'BATCH_RECONCILED_COUNTS_INVALID'; end if;
 if exists(
 select 1 from orulo_audit.entries c
 left join orulo_audit.entries i on i.run_uuid=c.run_uuid and i.operation_uuid=c.operation_uuid and i.kind='INTENT'
 left join orulo_audit.entries v on v.run_uuid=c.run_uuid and v.operation_uuid=c.operation_uuid and v.event->>'stage'='BATCH_ROW_VERIFIED'
 left join orulo_audit.snapshot_records b on b.run_uuid=c.run_uuid and b.kind='BASELINE_V2' and b.id=(c.event->>'id')::uuid
 cross join lateral(select (i.event->'expected')||jsonb_build_object('created_at',(i.event->'expected'->>'created_at')::timestamptz at time zone 'UTC','updated_at',(i.event->'expected'->>'updated_at')::timestamptz at time zone 'UTC') before_row,
 (c.event->'result'->'row')||jsonb_build_object('created_at',(c.event->'result'->'row'->>'created_at')::timestamptz at time zone 'UTC','updated_at',(c.event->'result'->'row'->>'updated_at')::timestamptz at time zone 'UTC') after_row) j
 where c.run_uuid=r and c.kind='CAS_RESULT' and(
 i.sequence is null or v.sequence is null or b.id is null or i.sequence>=c.sequence or v.sequence<=c.sequence or i.created_xid=c.created_xid
 or c.event->'result'->>'status' is distinct from 'UPDATED'
 or c.event->'result'->'receipt'->'verified' is distinct from 'true'::jsonb
 or md5(j.before_row::text) is distinct from c.event->'result'->'receipt'->>'beforeFullHash'
 or md5(j.after_row::text) is distinct from c.event->'result'->'receipt'->>'afterFullHash'
 or md5((j.after_row-'updated_at')::text) is distinct from c.event->'result'->'receipt'->>'expectedAfterContentHash'
 or b.record->>4 is distinct from c.event->'result'->'receipt'->>'beforeFullHash'
 or v.event->>'fullHash' is distinct from c.event->'result'->'receipt'->>'afterFullHash'
 or v.event->>'contentHash' is distinct from c.event->'result'->'receipt'->>'expectedAfterContentHash'
 or (j.before_row-'raw_data'-'updated_at') is distinct from (j.after_row-'raw_data'-'updated_at')
 or ((j.before_row->'raw_data')-'building') is distinct from ((j.after_row->'raw_data')-'building')
 or ((j.before_row->'raw_data'->'building')-'floor_plans') is distinct from ((j.after_row->'raw_data'->'building')-'floor_plans')
 or i.event->'desiredPlans' is distinct from j.after_row->'raw_data'->'building'->'floor_plans'
 )) then raise exception 'BATCH_RECONCILED_RECEIPT_INVALID'; end if;
 select count(*) filter(where not orulo_audit.batch_has_image(plan)) into missing_before
 from orulo_audit.entries i cross join lateral jsonb_array_elements(i.event->'expected'->'raw_data'->'building'->'floor_plans')plan where i.run_uuid=r and i.kind='INTENT';
 select count(*),count(*) filter(where not orulo_audit.batch_has_image(plan)) into n,missing_after
 from orulo_audit.entries c cross join lateral jsonb_array_elements(c.event->'result'->'row'->'raw_data'->'building'->'floor_plans')plan where c.run_uuid=r and c.kind='CAS_RESULT';
 if missing_before<>expected_occurrences or n<>expected_occurrences or missing_after<>0 then raise exception 'BATCH_RECONCILED_IMAGES_INVALID'; end if;
 return jsonb_build_object('terminalType','ABORTED','recognition','REVIEWED_CONFIRMED_WRITES','runUuid',r,'sequence',e.sequence,'hash',e.hash,
 'batchId','phase1-20','confirmedRows',expected_rows,'verifiedRows',expected_rows,'recoveredPlanOccurrences',expected_occurrences);
end
$proof$;
alter function orulo_audit.batch_prerequisite_result(text) owner to orulo_audit_owner;
revoke all on function orulo_audit.batch_prerequisite_result(text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION orulo_audit.authorize_pilot(p_run uuid, p_expected_head text, p_github_run_id text, p_control_sha text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET synchronous_commit TO 'on'
AS $function$
declare e orulo_audit.entries%rowtype;r orulo_audit.runs%rowtype;c jsonb;inventory jsonb;x jsonb;expected jsonb;ids jsonb;patch_ids jsonb;prerequisite jsonb;
begin
 if current_setting('role',true)='service_role' or session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 perform orulo_audit.lock_run(p_run);select * into e from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
 if e.event->>'stage' is distinct from 'BATCH_PLAN' then return orulo_audit.authorize_single_pilot(p_run,p_expected_head,p_github_run_id,p_control_sha,p_reason); end if;
 select * into r from orulo_audit.runs where run_uuid=p_run;c:=orulo_audit.batch_catalog()->'batches'->(e.event->>'batchId');
 if c is null or c->>'released' is distinct from 'true' then raise exception 'BATCH_PHASE_NOT_RELEASED'; end if;
 prerequisite:=orulo_audit.batch_prerequisite_result(c->>'prerequisite');
 if c->>'prerequisite' is not null and prerequisite is null then raise exception 'BATCH_PREVIOUS_RESULT_REQUIRED'; end if;
 if r.github_run_id is distinct from p_github_run_id or r.metadata->>'workflowSha' is distinct from p_control_sha or coalesce(p_control_sha,'')!~'^[a-f0-9]{40}$' or e.hash is distinct from p_expected_head or e.kind<>'CLIENT_READBACK' or e.created_at<clock_timestamp()-interval '10 minutes' or length(trim(p_reason))<10 or p_reason is null or exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind in ('WRITE_AUTHORIZED','BASELINE_V2','ABORTED','FINISHED')) then raise exception 'BATCH_PLAN_OR_HEAD_INVALID'; end if;
 inventory:=orulo_audit.batch_inventory(e.event->>'batchId');
 if e.event->>'masterHash' is distinct from inventory->>'masterHash' or e.event->>'batchManifestHash' is distinct from inventory->>'batchManifestHash' or jsonb_array_length(inventory->'targets')=0 or jsonb_array_length(inventory->'targets')>500 then raise exception 'BATCH_TARGETS_INVALID'; end if;
 select jsonb_agg(z->>'id' order by z->>'id') into ids from jsonb_array_elements(inventory->'targets')z;
 if ids is distinct from e.event->'targetIds' or jsonb_array_length(e.event->'targets')<>jsonb_array_length(ids) then raise exception 'BATCH_TARGETS_CHANGED'; end if;
 if jsonb_typeof(e.event->'targets') is distinct from 'array' or (select count(*)<>count(distinct t->>'id') from jsonb_array_elements(e.event->'targets')t) then raise exception 'BATCH_DUPLICATE_TARGET'; end if;
 for x in select * from jsonb_array_elements(e.event->'targets') loop
  select v into expected from jsonb_array_elements(inventory->'targets')v where v->>'id'=x->>'id' and v->>'buildingId'=x->>'buildingId';
  select jsonb_agg(p->>'id' order by p->>'id') into patch_ids from jsonb_array_elements(x->'patches')p;
  if expected is null or patch_ids is distinct from expected->'missingPlanIds' then raise exception 'BATCH_PLAN_COVERAGE_INVALID'; end if;
  perform orulo_audit.batch_merge(raw_data,x->'patches') from public.properties where id=(x->>'id')::uuid;
 end loop;
 return orulo_audit.append(p_run,e.sequence+1,e.hash,jsonb_build_object('type','WRITE_AUTHORIZED','eventUuid',gen_random_uuid(),'mode','BATCH_IMAGES',
  'prerequisiteResult',prerequisite,'batchId',e.event->>'batchId','masterHash',inventory->>'masterHash','batchManifestHash',inventory->>'batchManifestHash','targetIds',ids,'planSequence',e.sequence,'planHash',e.hash,'controlSha',p_control_sha,'expiresAt',clock_timestamp()+interval '30 minutes','reason',p_reason));
end$function$;

-- CREATE OR REPLACE preserves authorize_pilot's existing owner and ACL.
commit;
