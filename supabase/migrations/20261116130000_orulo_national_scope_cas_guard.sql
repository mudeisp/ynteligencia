BEGIN;

CREATE FUNCTION orulo_audit.national_scope_context(p_run uuid,p_target uuid,p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_auth jsonb; v_sequence bigint;
BEGIN
  IF jsonb_typeof(p_context) IS DISTINCT FROM 'object'
    OR coalesce(p_context->>'lot','') !~ '^(10|[1-9])$'
    OR coalesce(p_context->>'authorizationId','') !~ '^[0-9a-f-]{36}$'
  THEN RAISE EXCEPTION 'NATIONAL_SCOPE_CONTEXT_REQUIRED'; END IF;
  v_auth := orulo_audit.require_national_scope(
    p_run,(p_context->>'authorizationId')::uuid,(p_context->>'lot')::integer,
    p_target,p_context->>'githubRunId',p_context->>'controlSha',p_context->>'planSha256'
  );
  IF NOT EXISTS (
    SELECT 1 FROM orulo_audit.entries s
    WHERE s.run_uuid=p_run AND s.kind='NATIONAL_MANIFEST_SEALED'
      AND s.sequence=(v_auth->>'sealSequence')::bigint AND s.hash=v_auth->>'sealHash'
      AND s.event->>'manifestHash'=v_auth->>'manifestHash'
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPE_ORIGINAL_SEAL_REQUIRED'; END IF;
  IF EXISTS (
    SELECT 1 FROM orulo_audit.entries WHERE run_uuid=p_run
      AND kind='NATIONAL_SCOPE_FINISHED' AND event->>'authorizationId'=v_auth->>'authorizationId'
  ) THEN RAISE EXCEPTION 'NATIONAL_SCOPE_ALREADY_FINISHED'; END IF;
  SELECT sequence INTO STRICT v_sequence FROM orulo_audit.entries
    WHERE run_uuid=p_run AND event_uuid=(v_auth->>'authorizationId')::uuid;
  RETURN v_auth || jsonb_build_object('planSequence',v_sequence);
END;
$$;

ALTER FUNCTION orulo_audit.national_scope_context(uuid,uuid,jsonb) OWNER TO orulo_audit_owner;
REVOKE ALL ON FUNCTION orulo_audit.national_scope_context(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Patch the reviewed installed definitions in place. The EXECUTE grants, owners,
-- signatures, settings and all unrelated branches remain those of the installation.
DO $install$
DECLARE
  v record;
  v_oid oid;
  v_definition text;
  v_original text;
  v_count integer;
  v_run constant text := '''1c8ec62a-9c38-41ac-8091-f1ceef98ca91''::uuid';
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('orulo_audit.national_control(text,uuid,bigint,text,jsonb)',
     'ec8bc9c967c4f330d07f15ba8c900e81a14c539a6ee2880dca6dcb62815b291d', true),
    ('orulo_audit.national_cas(uuid,uuid)',
     '9f365121ef2a471560b00721359a1ebb2cebe0d8bbca8112d65914e6deeb4d34', true),
    ('orulo_audit.audited_cas_core(uuid,uuid)',
     '3cbb387177c6c8c25d9d5b9958a8c3287d04995c7cda9d589b0b433450cd4faa', true),
    ('orulo_audit.national_authorize(uuid,text,text,text,text)',
     '9a6f623688c68c1f670ebb124d1077be78658e8950070644bc82e32ea14e4589', true),
    ('orulo_audit.national_replace(uuid,jsonb,jsonb)',
     '2101cdc6fbedc6e1cddc6560478ee4fcdd7d20c2be06f92cf1ce5a896b57f27d', false)
  ) AS contracts(signature, body_sha, security_definer)
  LOOP
    v_oid := to_regprocedure(v.signature);
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid=v_oid
        AND pg_get_userbyid(p.proowner)='orulo_audit_owner'
        AND p.prosecdef=v.security_definer
        AND p.prorettype='jsonb'::regtype
        AND p.proacl::text='{orulo_audit_owner=X/orulo_audit_owner}'
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=v.body_sha
    ) THEN RAISE EXCEPTION 'NATIONAL_SCOPE_CONTRACT_DRIFT: %',v.signature; END IF;
  END LOOP;

  FOR v IN SELECT * FROM (VALUES
    ('orulo_audit.national_control(text,uuid,bigint,text,jsonb)',
     $old$   auth:=orulo_audit.national_authorization(p_run);
   if exists(select 1 from orulo_audit.entries i$old$,
     format($new$   if p_run=%s then
    auth:=orulo_audit.national_scope_context(p_run,(p_event->>'id')::uuid,p_event->'scope');
    if not exists(select 1 from orulo_audit.entries b where b.run_uuid=p_run and b.kind='BASELINE_V2:'||(auth->>'authorizationId')
      and b.sequence>(auth->>'planSequence')::bigint and b.event->'snapshot'->>'membershipStable'='true')
    then raise exception 'NATIONAL_GLOBAL_BASELINE_REQUIRED'; end if;
    if exists(select 1 from orulo_audit.snapshot_sets where run_uuid=p_run
      and kind='READBACK_V2:'||(auth->>'authorizationId'))
    then raise exception 'NATIONAL_SCOPE_READBACK_ALREADY_STARTED'; end if;
   else auth:=orulo_audit.national_authorization(p_run); end if;
   if exists(select 1 from orulo_audit.entries i$new$,v_run)),
    ('orulo_audit.national_control(text,uuid,bigint,text,jsonb)',
     $old$ if p_action in ('read','recover','snapshot_begin','snapshot_page','snapshot_seal') then$old$,
     format($new$ if p_run=%1$s and p_action='national_scope_finish' then
  return orulo_audit.national_scope_finish(p_run,p_sequence,p_previous_hash,p_event);
 end if;
 if p_run=%1$s and p_action='national_scope_lookup' then
  select * into entry from orulo_audit.entries where run_uuid=p_run and kind='NATIONAL_SCOPE_AUTHORIZED'
    and event->>'githubRunId'=p_event->>'githubRunId'
    and event->>'controlSha'=p_event->>'controlSha' and event->>'lot'=p_event->>'lot';
  if not found then return null; end if;
  return jsonb_build_object('id',entry.event->'targetIds'->>0,'scope',jsonb_build_object(
    'authorizationId',entry.event_uuid,'lot',entry.event->'lot','githubRunId',entry.event->>'githubRunId',
    'controlSha',entry.event->>'controlSha','planSha256',entry.event->>'planSha256'));
 end if;
 if p_run=%1$s and p_action='national_scope_open' then
  auth:=orulo_audit.national_scope_context(p_run,(p_event->>'id')::uuid,p_event->'scope');
  select * into entry from orulo_audit.entries where run_uuid=p_run order by sequence desc limit 1;
  return jsonb_build_object('scope',auth,'head',jsonb_build_object('runUuid',p_run,
    'sequence',entry.sequence,'hash',entry.hash,'eventUuid',entry.event_uuid));
 end if;
 if p_run=%1$s and p_action in ('snapshot_begin','snapshot_page','snapshot_seal','national_scope_snapshot_state') then
  return orulo_audit.national_scope_snapshot(
    case when p_action='national_scope_snapshot_state' then 'state' else p_action end,
    p_run,p_sequence,p_previous_hash,p_event);
 end if;
 if p_action in ('read','recover','snapshot_begin','snapshot_page','snapshot_seal') then$new$,v_run)),
    ('orulo_audit.national_cas(uuid,uuid)',
     $old$kind='BASELINE_V2' and sequence>(auth->>'planSequence')::bigint$old$,
     format($new$kind=case when r=%s then 'BASELINE_V2:'||(auth->>'authorizationId') else 'BASELINE_V2' end
  and sequence>(auth->>'planSequence')::bigint$new$,v_run)),
    ('orulo_audit.national_cas(uuid,uuid)',
     $old$perform orulo_audit.lock_run(r);auth:=orulo_audit.national_authorization(r);$old$,
     format($new$perform orulo_audit.lock_run(r);
 if r<>%s then auth:=orulo_audit.national_authorization(r); end if;$new$,v_run)),
    ('orulo_audit.national_cas(uuid,uuid)',
     $old$ select event->'target' into target from orulo_audit.entries where run_uuid=r and kind='NATIONAL_TARGET'$old$,
     format($new$ if r=%s then
  auth:=orulo_audit.national_scope_context(r,(intent.event->>'id')::uuid,intent.event->'scope');
 end if;
 select event->'target' into target from orulo_audit.entries where run_uuid=r and kind='NATIONAL_TARGET'$new$,v_run)),
    ('orulo_audit.national_cas(uuid,uuid)',
     $old$ if exists(select 1 from orulo_audit.entries where run_uuid=r and kind='CAS_RESULT'$old$,
     format($new$ if r=%s and (
  exists(select 1 from orulo_audit.snapshot_sets where run_uuid=r and kind='READBACK_V2:'||(auth->>'authorizationId'))
  or not exists(select 1 from orulo_audit.snapshot_records where run_uuid=r
    and kind='BASELINE_V2:'||(auth->>'authorizationId') and id=expected.id
    and record->>4=md5((to_jsonb(current_row)||jsonb_build_object(
       'created_at',current_row.created_at at time zone 'UTC',
       'updated_at',current_row.updated_at at time zone 'UTC'))::text))
 ) then raise exception 'NATIONAL_SCOPED_SNAPSHOT_ROW_MISMATCH'; end if;
 if exists(select 1 from orulo_audit.entries where run_uuid=r and kind='CAS_RESULT'$new$,v_run)),
    ('orulo_audit.audited_cas_core(uuid,uuid)',
     $old$ if not exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED') then raise exception 'AUDIT_OPERATIONAL_WRITE_BLOCKED'; end if;$old$,
     format($new$ if p_run<>%s and not exists(select 1 from orulo_audit.entries where run_uuid=p_run and kind='WRITE_AUTHORIZED') then raise exception 'AUDIT_OPERATIONAL_WRITE_BLOCKED'; end if;$new$,v_run)),
    ('orulo_audit.audited_cas_core(uuid,uuid)',
     $old$ if exists(select 1 from orulo_audit.runs where run_uuid=p_run and metadata->>'mode'='national-v2-once') then result:=$old$,
     format($new$ if p_run=%s then
  perform orulo_audit.national_scope_context(p_run,(intent.event->>'id')::uuid,intent.event->'scope');
 end if;
 if exists(select 1 from orulo_audit.runs where run_uuid=p_run and metadata->>'mode'='national-v2-once') then result:=$new$,v_run)),
    ('orulo_audit.national_authorize(uuid,text,text,text,text)',
     $old$ perform orulo_audit.lock_run(r);$old$,
     format($new$ if r=%s then raise exception 'NATIONAL_SCOPED_AUTHORIZATION_REQUIRED'; end if;
 perform orulo_audit.lock_run(r);$new$,v_run))
  ) AS edits(signature, original, replacement)
  LOOP
    v_definition:=pg_get_functiondef(to_regprocedure(v.signature));
    v_original:=v.original;
    v_count:=(length(v_definition)-length(replace(v_definition,v_original,'')))/length(v_original);
    IF v_count<>1 THEN RAISE EXCEPTION 'NATIONAL_SCOPE_PATCH_ANCHOR_MISMATCH: %',v.signature; END IF;
    EXECUTE replace(v_definition,v_original,v.replacement);
  END LOOP;
END;
$install$;

COMMIT;
