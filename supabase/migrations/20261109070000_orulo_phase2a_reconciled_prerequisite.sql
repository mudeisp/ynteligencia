-- Versioned copy of the currently deployed Supabase function (2026-11-09).
-- phase2-30-a: 65 verified CAS writes, terminal ABORTED reconciled=true,
-- 6 documented out-of-scope content changes; never re-label as FINISHED.
-- Validate the audit chain and evidence before recognizing this prerequisite.
-- No batch execution, image writes, or historical audit mutations.
BEGIN;
CREATE OR REPLACE FUNCTION orulo_audit.batch_prerequisite_result(p_batch text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
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

 if p_batch='phase2-30-a' then
  select * into e from orulo_audit.entries
   where run_uuid='28c6cb35-06da-4eb1-ab56-cf5b27dfaa5a'::uuid
   order by sequence desc limit 1;
  if not found or e.sequence<>1077 or e.kind<>'ABORTED'
     or e.event->'reconciled' is distinct from 'true'::jsonb then return null; end if;
  select count(*),bool_and(sequence=rn and previous_hash=prev
    and hash=encode(sha256(convert_to(canonical,'UTF8')),'hex')
    and canonical=jsonb_build_object('runUuid',run_uuid,'sequence',sequence,'previousHash',previous_hash,'event',event)::text
    and kind=event->>'type' and event_uuid::text=event->>'eventUuid')
  into n,ok from (select *,row_number() over(order by sequence) rn,
   coalesce(lag(hash) over(order by sequence),'') prev
   from orulo_audit.entries where run_uuid=e.run_uuid)x;
  if n<>1077 or ok is distinct from true then raise exception 'PHASE2A_CHAIN_INVALID'; end if;
  if (select count(*) from orulo_audit.entries where run_uuid=e.run_uuid and kind='WRITE_AUTHORIZED')<>1
   or (select count(*) from orulo_audit.entries where run_uuid=e.run_uuid and kind='INTENT')<>65
   or (select count(*) from orulo_audit.entries where run_uuid=e.run_uuid and kind='CAS_RESULT')<>65
   or (select count(distinct event->>'id') from orulo_audit.entries where run_uuid=e.run_uuid and kind='CAS_RESULT')<>65
   or (select count(*) from orulo_audit.entries where run_uuid=e.run_uuid and event->>'stage'='BATCH_ROW_VERIFIED')<>65
   or (select count(*) from orulo_audit.entries where run_uuid=e.run_uuid and kind='CAS_RESULT'
       and event->'result'->>'status'='UPDATED' and event->'result'->'receipt'->'verified'='true'::jsonb)<>65
   or (select count(*) from orulo_audit.entries where run_uuid=e.run_uuid and event->>'stage'='BATCH_PLAN'
       and event->>'batchId'='phase2-30-a' and event->>'masterHash'=orulo_audit.batch_catalog()->>'masterHash'
       and event->>'batchManifestHash'=orulo_audit.batch_catalog()#>>'{batches,phase2-30-a,hash}')<>1
   or (select count(*) from orulo_audit.entries where run_uuid=e.run_uuid and event->>'stage'='BATCH_INTEGRITY'
       and event#>>'{review,counts,IN_SCOPE,contentChanges}'='65'
       and event#>>'{review,counts,OUT_OF_SCOPE,contentChanges}'='6'
       and event#>>'{review,counts,UNKNOWN,contentChanges}'='0')<>1
   then raise exception 'PHASE2A_RECONCILED_EVIDENCE_INVALID'; end if;
  return jsonb_build_object('terminalType','ABORTED','recognition','REVIEWED_CONFIRMED_WRITES_WITH_EXTERNAL_CHANGES',
    'runUuid',e.run_uuid,'sequence',e.sequence,'hash',e.hash,'batchId','phase2-30-a',
    'confirmedRows',65,'verifiedRows',65,'externalContentChanges',6);
 end if;
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
$function$
;
DO $verify$
DECLARE v jsonb;
BEGIN
  v := orulo_audit.batch_prerequisite_result('phase2-30-a');
  IF v->>'recognition' IS DISTINCT FROM 'REVIEWED_CONFIRMED_WRITES_WITH_EXTERNAL_CHANGES'
    OR v->>'terminalType' IS DISTINCT FROM 'ABORTED'
    OR (v->>'confirmedRows')::int <> 65
    OR (v->>'externalContentChanges')::int <> 6 THEN
    RAISE EXCEPTION 'PHASE2A_RECONCILIATION_MIGRATION_CHECK_FAILED';
  END IF;
END
$verify$;
COMMIT;
