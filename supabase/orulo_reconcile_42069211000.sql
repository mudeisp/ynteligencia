-- Owner review only; NOT executed in production.
-- Recheck https://github.com/mudeisp/ynteligencia/actions/runs/42069211000
-- completed/failure before executing the ENTIRE file as postgres.
begin;
set local timezone='UTC';
set local lock_timeout='3s';
set local statement_timeout='30s';
set local synchronous_commit='on';
do $reconcile$
declare
 r constant uuid:='2e30e874-5eb9-40dc-9532-832f47cd01de';
 start_hash constant text:='68d2f4bd16d9985f5ca57ea4814ed23f3248b8ac40227c2b8acda52c76602f31';
 plan_hash constant text:='f84636025c8df43550f2f63ccf743b3cfa803d84d8888a738d5442d595ad3758';
 stop_hash constant text:='71e76dc150031c4bf3262e1ce1beeee9104f8c6cad6e3021dad0a786ca051343';
 original jsonb;ok boolean;ack jsonb;
begin
 if session_user not in ('postgres','supabase_admin') or current_setting('role',true)='service_role' then raise insufficient_privilege;end if;
 perform orulo_audit.lock_run(r);
 if not exists(select 1 from orulo_audit.runs where run_uuid=r and github_run_id='42069211000')
 or (select count(*) from orulo_audit.entries where run_uuid=r)<>3
 or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=1 and kind='START' and hash=start_hash and event->>'workflowSha'='06d1dab82b02eb5fd8a55217e1d508ba22de892c')
 or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=2 and kind='CLIENT_READBACK' and event->>'stage'='BATCH_PLAN' and event->>'batchId'='phase2-30-a' and event->'writeEnabled'='false'::jsonb and hash=plan_hash)
 or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=3 and kind='CLIENT_STOP' and hash=stop_hash
 and event->'confirmedRows'='0'::jsonb and event->'verifiedRows'='0'::jsonb
 and event->'diagnostic'->>'code'='BATCH_AUTHORIZATION_WAIT_TIMEOUT'
 and event->'diagnostic'->>'batchStage'='AUTHORIZATION_WAIT'
 and event->'diagnostic'->>'runUuid'=r::text)
 then raise exception 'RECONCILE_HEAD_OR_EXPECTED_EVENTS_CHANGED';end if;
 if exists(select 1 from orulo_audit.entries where run_uuid=r and (kind in ('WRITE_AUTHORIZED','INTENT','CAS_RESULT','ABORTED','FINISHED') or operation_uuid is not null))
 then raise exception 'RECONCILE_OPERATION_OR_TERMINAL_PRESENT';end if;
 select bool_and(sequence=n and previous_hash=prev
 and hash=encode(sha256(convert_to(canonical,'UTF8')),'hex')
 and canonical=jsonb_build_object('runUuid',run_uuid,'sequence',sequence,'previousHash',previous_hash,'event',event)::text
 and kind=event->>'type' and event_uuid::text=event->>'eventUuid') into ok
 from(select *,row_number() over(order by sequence)n,coalesce(lag(hash) over(order by sequence),'')prev from orulo_audit.entries where run_uuid=r)e;
 if ok is distinct from true then raise exception 'RECONCILE_CHAIN_INVALID';end if;
 select jsonb_agg(to_jsonb(e) order by sequence) into original from orulo_audit.entries e where run_uuid=r;
 ack:=orulo_audit.admin_event(r,'ABORTED','Reconciled completed/failure GitHub 42069211000: phase2-30-a authorization unavailable (SQL image extension validation rejected .JPG); workflow stopped with BATCH_AUTHORIZATION_WAIT_TIMEOUT. Exactly START, BATCH_PLAN and CLIENT_STOP; intact chain; confirmedRows=0; no WRITE_AUTHORIZED, INTENT, CAS_RESULT or pending operation. No property mutation or authorization is performed by this closure. This zero-write run is separate from the 26 committed phase1 operations, which must remain preserved.',true);
 if (ack->>'sequence')::bigint is distinct from 4
 or (select count(*) from orulo_audit.entries where run_uuid=r)<>4
 or (select jsonb_agg(to_jsonb(e) order by sequence) from orulo_audit.entries e where run_uuid=r and sequence<=3) is distinct from original
 or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=4 and kind='ABORTED' and previous_hash=stop_hash and hash=ack->>'hash' and hash=encode(sha256(convert_to(canonical,'UTF8')),'hex'))
 then raise exception 'RECONCILE_POSTCONDITION_FAILED';end if;
 raise notice 'Administrative closure: %',ack;
end
$reconcile$;
commit;
select sequence,kind,hash,previous_hash from orulo_audit.entries where run_uuid='2e30e874-5eb9-40dc-9532-832f47cd01de' order by sequence desc limit 1;
