CREATE OR REPLACE FUNCTION orulo_audit.audited_cas_core(p_run uuid, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET synchronous_commit TO 'on'
 SET lock_timeout TO '5s'
AS $function$
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
 if exists(select 1 from orulo_audit.runs where run_uuid=p_run and metadata->>'mode'='national-v2-once') then result:=orulo_audit.national_replace((intent.event->>'id')::uuid,intent.event->'expected',intent.event->'desiredPlans'); else result:=orulo_audit.cas_core((intent.event->>'id')::uuid,intent.event->'expected',intent.event->'desiredPlans'); end if;
 receipt:=orulo_audit.append(p_run,seq,previous,jsonb_build_object('type','CAS_RESULT','eventUuid',gen_random_uuid(),'operationId',p_operation,'id',intent.event->>'id','result',result));
 return result||jsonb_build_object('auditReceipt',receipt);
end$function$;
