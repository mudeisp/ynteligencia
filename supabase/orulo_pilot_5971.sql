-- REVIEW/APPLY SEPARATELY. Preparation only: no property DML or authorization.
-- Extends the existing BATCH_IMAGES path; historical catalog entries are unchanged.
begin;
alter function orulo_audit.batch_catalog() rename to batch_catalog_before5971;
create function orulo_audit.batch_catalog() returns jsonb language sql immutable set search_path='' as $$
 select jsonb_set(orulo_audit.batch_catalog_before5971(),'{batches,pilot-5971-images}',
 '{"hash":"7b05ead9d4583ae07682ffda7d52fe490ca7450710879d2066b1cea467e7f188","released":true,"phase":0,"prerequisite":null,"buildingIds":["5971"],"targets":[{"id":"55701ebd-747e-4968-92f1-647d2e6a79d9","buildingId":"5971","missingPlanIds":["251614","251615"]}]}'::jsonb,true);
$$;
alter function orulo_audit.batch_catalog() owner to orulo_audit_owner;

-- Modify the reviewed existing bodies, retaining their owner, ACL, row lock,
-- whole-row CAS, jsonb_set of current data, trigger guards and receipt generation.
-- Exact single anchors deliberately abort this transaction on code drift.
do $adapt$
declare f text; old text; replacement text;
begin
 f:=pg_get_functiondef('orulo_audit.scope_ok(jsonb)'::regprocedure);
 old:='select coalesce((p->>''state''';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_SCOPE_CODE_DRIFT'; end if;
 f:=replace(f,old,'select (p->>''id''=''55701ebd-747e-4968-92f1-647d2e6a79d9'' and p->>''state''=''SP'' and p->>''source''=''novos'' and p->''active''=''true''::jsonb and p->''raw_data''->>''building_id''=''5971'') or coalesce((p->>''state''');
 execute f;
 f:=pg_get_functiondef('orulo_audit.cas_core(uuid,jsonb,jsonb)'::regprocedure);
 old:='v_allowed constant text[] := array[';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_CAS_CODE_DRIFT'; end if;
 f:=replace(f,old,old||'''5971'',');
 old:='  if v_id is null or not (v_id = any(v_allowed))';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_CAS_SCOPE_CODE_DRIFT'; end if;
 replacement:=$guard$
  if v_id='5971' then
   if p_id<>'55701ebd-747e-4968-92f1-647d2e6a79d9'::uuid
    or p_expected->'raw_data'->>'building_id' is distinct from '5971' or p_expected->'raw_data'->'building'->>'id' is distinct from '5971'
    or (select jsonb_agg(p->>'id' order by n) from jsonb_array_elements(p_expected->'raw_data'->'building'->'floor_plans') with ordinality a(p,n)) is distinct from '["251614","251615"]'::jsonb
    or p_floor_plans is distinct from (select jsonb_agg(p||jsonb_build_object('image_url','https://static.orulo.com.br/images/properties/large/'||(p->>'id')||'.JPG') order by n) from jsonb_array_elements(p_expected->'raw_data'->'building'->'floor_plans') with ordinality a(p,n))
   then raise exception 'PILOT5971_IMAGE_URL_ONLY'; end if;
  end if;
$guard$;
 f:=replace(f,old,replacement||old);
 old:='updated_at = clock_timestamp()';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_TIMESTAMP_CODE_DRIFT'; end if;
 f:=replace(f,old,'updated_at = case when v_id=''5971'' then p.updated_at else clock_timestamp() end');
 old:='  if (to_jsonb(v_after)-''updated_at''-''raw_data'')';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_PRESERVATION_CODE_DRIFT'; end if;
 f:=replace(f,old,'  if v_id=''5971'' and v_after.updated_at is distinct from v_row.updated_at then raise exception ''PILOT5971_NON_IMAGE_CHANGE''; end if;'||chr(10)||old);
 old:='''allowedChangedPaths'',jsonb_build_array(''raw_data.building.floor_plans'',''updated_at'')';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_RECEIPT_CODE_DRIFT'; end if;
 f:=replace(f,old,'''allowedChangedPaths'',case when v_id=''5971'' then jsonb_build_array(''raw_data.building.floor_plans[0].image_url'',''raw_data.building.floor_plans[1].image_url'') else jsonb_build_array(''raw_data.building.floor_plans'',''updated_at'') end');
 execute f;
 f:=pg_get_functiondef('public.orulo_audited_cas(uuid,uuid)'::regprocedure);
 old:=' select x into target from jsonb_array_elements(plan->''targets'')x';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_AUTH_GUARD_CODE_DRIFT'; end if;
 replacement:=$guard$
 if a->>'batchId'='pilot-5971-images' then
  if plan->>'proposalHash' is distinct from '4c6a3576d91fcca4f7c526daf7f62981df756dd9bab9bbb7f3b96a4d3c242eae'
   or encode(sha256(convert_to(coalesce(plan->>'proposalText',''),'UTF8')),'hex') is distinct from plan->>'proposalHash'
   or plan->'targets' is distinct from '[{"id":"55701ebd-747e-4968-92f1-647d2e6a79d9","buildingId":"5971","patches":[{"id":"251614","image_url":"https://static.orulo.com.br/images/properties/large/251614.JPG"},{"id":"251615","image_url":"https://static.orulo.com.br/images/properties/large/251615.JPG"}]}]'::jsonb
  then raise exception 'PILOT5971_AUTHORIZED_PROPOSAL_INVALID'; end if;
  if exists(select 1 from orulo_audit.entries where kind='CAS_RESULT' and event->>'id'='55701ebd-747e-4968-92f1-647d2e6a79d9') then raise exception 'PILOT5971_OPERATION_CONSUMED'; end if;
 end if;
$guard$;
 f:=replace(f,old,replacement||old);
 old:=' if not exists(select 1 from orulo_audit.snapshot_records where run_uuid=p_run and kind=''BASELINE_V2''';
 if (length(f)-length(replace(f,old,'')))/length(old)<>1 then raise exception 'PILOT5971_BASELINE_CODE_DRIFT'; end if;
 f:=replace(f,old,' if a->>''batchId''=''pilot-5971-images'' and plan->>''expectedFullHash'' is distinct from md5(j::text) then raise exception ''PILOT5971_APPROVED_STATE_CHANGED''; end if;'||chr(10)||old);
 execute f;
end $adapt$;

alter function orulo_audit.authorize_pilot(uuid,text,text,text,text) rename to authorize_before5971;
create function orulo_audit.authorize_pilot(p_run uuid,p_expected_head text,p_github_run_id text,p_control_sha text,p_reason text)
 returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' set synchronous_commit='on' as $$
declare e orulo_audit.entries%rowtype; p public.properties%rowtype; j jsonb; proposal jsonb;
begin
 if current_setting('role',true)='service_role' or session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 perform orulo_audit.lock_run(p_run);
 select * into e from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
 if e.event->>'batchId'='pilot-5971-images' then
  -- Serialize competing new authorizations; never consume/rewrite old receipts.
  perform pg_advisory_xact_lock(hashtextextended('orulo-pilot-5971-images',0));
  if e.event->>'proposalHash' is distinct from '4c6a3576d91fcca4f7c526daf7f62981df756dd9bab9bbb7f3b96a4d3c242eae'
   or encode(sha256(convert_to(coalesce(e.event->>'proposalText',''),'UTF8')),'hex') is distinct from e.event->>'proposalHash'
  then raise exception 'PILOT5971_PROPOSAL_HASH_MISMATCH'; end if;
  proposal:=(e.event->>'proposalText')::jsonb;
  if proposal->>'buildingId' is distinct from '5971' or proposal->'targetIds' is distinct from '["55701ebd-747e-4968-92f1-647d2e6a79d9"]'::jsonb
   or proposal->'planIds' is distinct from '["251614","251615"]'::jsonb
   or e.event->'targets' is distinct from proposal->'targets'
  then raise exception 'PILOT5971_PROPOSAL_SCOPE_INVALID'; end if;
  if exists(select 1 from orulo_audit.entries where kind in ('INTENT','CAS_RESULT') and event->>'id'='55701ebd-747e-4968-92f1-647d2e6a79d9')
   or exists(select 1 from orulo_audit.entries a where a.kind='WRITE_AUTHORIZED' and a.event->>'batchId'='pilot-5971-images' and a.run_uuid<>p_run and not exists(select 1 from orulo_audit.entries z where z.run_uuid=a.run_uuid and z.kind in ('ABORTED','FINISHED')))
  then raise exception 'PILOT5971_PREVIOUS_OPERATION_REQUIRES_REVIEW'; end if;
  select * into p from public.properties where id='55701ebd-747e-4968-92f1-647d2e6a79d9'::uuid for update;
  if not found then raise exception 'PILOT5971_ROW_MISSING'; end if;
  j:=to_jsonb(p)||jsonb_build_object('created_at',p.created_at at time zone 'UTC','updated_at',p.updated_at at time zone 'UTC');
  if e.event->>'expectedFullHash' is distinct from md5(j::text) then raise exception 'PILOT5971_APPROVED_STATE_CHANGED'; end if;
 end if;
 -- Existing owner/run/SHA/head/expiry/target/plan checks append the same
 -- WRITE_AUTHORIZED event; no authorization is granted by installing this file.
 return orulo_audit.authorize_before5971(p_run,p_expected_head,p_github_run_id,p_control_sha,p_reason);
end$$;
alter function orulo_audit.authorize_pilot(uuid,text,text,text,text) owner to orulo_audit_owner;
revoke all on function orulo_audit.batch_catalog(),orulo_audit.batch_catalog_before5971(),orulo_audit.authorize_pilot(uuid,text,text,text,text),orulo_audit.authorize_before5971(uuid,text,text,text,text) from public,anon,authenticated,service_role;
commit;
