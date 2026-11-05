-- Owner review only; NOT executed in production.
-- Recheck https://github.com/mudeisp/ynteligencia/actions/runs/42051049087
-- completed/failure before executing the ENTIRE file as postgres.
begin;
set local timezone='UTC';
set local lock_timeout='3s';
set local statement_timeout='30s';
set local synchronous_commit='on';
do $reconcile$
declare
 r constant uuid:='a613aae9-4a99-47bd-b7c4-d58b9f0c7c72';
 start_hash constant text:='1522892f7224bf4a9bac072a523966758ba66ffb7fc563e1864d868cd9a50012';
 plan_hash constant text:='4840e31ab7c1160acc1eac90b163d07c9024ba69bfc8ed89fc94f5b87a6cedd1';
 stop_hash constant text:='66dad2b325e74a5fd753112f2899555b239803946de81b358c48ad5e44519903';
 original jsonb;ok boolean;ack jsonb;
begin
 if session_user not in ('postgres','supabase_admin') or current_setting('role',true)='service_role' then raise insufficient_privilege;end if;
 perform orulo_audit.lock_run(r);
 if not exists(select 1 from orulo_audit.runs where run_uuid=r and github_run_id='42051049087')
 or (select count(*) from orulo_audit.entries where run_uuid=r)<>3
 or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=1 and kind='START' and hash=start_hash and event->>'workflowSha'='96490b0380bd2050d460f65b1625d2ec77afa389')
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
 ack:=orulo_audit.admin_event(r,'ABORTED','Reconciled completed/failure GitHub 42051049087: phase2-30-a authorization unavailable (database catalog/prerequisite blocked); workflow stopped with BATCH_AUTHORIZATION_WAIT_TIMEOUT. Exactly START, BATCH_PLAN and CLIENT_STOP; intact chain; confirmedRows=0; no WRITE_AUTHORIZED, INTENT, CAS_RESULT or pending operation. No property mutation or authorization is performed by this closure.',true);
 if (ack->>'sequence')::bigint is distinct from 4
 or (select count(*) from orulo_audit.entries where run_uuid=r)<>4
 or (select jsonb_agg(to_jsonb(e) order by sequence) from orulo_audit.entries e where run_uuid=r and sequence<=3) is distinct from original
 or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=4 and kind='ABORTED' and previous_hash=stop_hash and hash=ack->>'hash' and hash=encode(sha256(convert_to(canonical,'UTF8')),'hex'))
 then raise exception 'RECONCILE_POSTCONDITION_FAILED';end if;
 raise notice 'Administrative closure: %',ack;
end
$reconcile$;
commit;
select sequence,kind,hash,previous_hash from orulo_audit.entries where run_uuid='a613aae9-4a99-47bd-b7c4-d58b9f0c7c72' order by sequence desc limit 1;
