\set ON_ERROR_STOP on
\ir orulo-national-scoped-plan.sql

-- Upgrade the synthetic fixture to the columns used by the existing journal.
CREATE ROLE orulo_audit_owner NOLOGIN;
ALTER SCHEMA orulo_audit OWNER TO orulo_audit_owner;
ALTER TABLE orulo_audit.entries OWNER TO orulo_audit_owner;
ALTER TABLE orulo_audit.entries
  ADD COLUMN event_uuid uuid UNIQUE,
  ADD COLUMN operation_uuid uuid,
  ADD COLUMN previous_hash text,
  ADD COLUMN canonical text;
CREATE TABLE orulo_audit.runs(run_uuid uuid PRIMARY KEY);
ALTER TABLE orulo_audit.runs OWNER TO orulo_audit_owner;
INSERT INTO orulo_audit.runs VALUES ('1c8ec62a-9c38-41ac-8091-f1ceef98ca91');
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

ALTER FUNCTION orulo_audit.lock_run(uuid) OWNER TO orulo_audit_owner;
ALTER FUNCTION orulo_audit.append(uuid,bigint,text,jsonb) OWNER TO orulo_audit_owner;
UPDATE orulo_audit.entries SET hash='80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f'
WHERE sequence=6241;
UPDATE orulo_audit.entries SET event=jsonb_set(event,'{target,id}',to_jsonb(
  CASE WHEN sequence=1 THEN '000a4d50-a014-4270-bb89-26adb841f142'
       ELSE '10000000-0000-0000-0000-'||lpad(sequence::text,12,'0') END
)) WHERE kind='NATIONAL_TARGET';

\ir ../supabase/migrations/20261116123000_orulo_national_scope_lease.sql

DO $test$
DECLARE
  r constant uuid := '1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
  pilot constant uuid := '000a4d50-a014-4270-bb89-26adb841f142';
  outsider constant uuid := '10000000-0000-0000-0000-000000000002';
  sha constant text := repeat('a',40);
  head constant text := '80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f';
  plan text;
  a jsonb;
  id uuid;
  item record;
BEGIN
  plan := orulo_audit.national_scoped_plan(r,1,ARRAY[pilot],'123',sha)->>'planSha256';
  a := orulo_audit.authorize_national_scope(r,1,ARRAY[pilot],'123',sha,plan,head,10);
  id := (a->>'eventUuid')::uuid;
  IF (orulo_audit.require_national_scope(r,id,1,pilot,'123',sha,plan)->>'administrator')
     IS DISTINCT FROM session_user THEN RAISE EXCEPTION 'AUTHORIZATION_IDENTITY_WRONG'; END IF;
  IF NOT EXISTS (SELECT 1 FROM orulo_audit.entries WHERE run_uuid=r AND event_uuid=id
    AND sequence=6242 AND previous_hash=head
    AND hash=encode(sha256(convert_to(canonical,'UTF8')),'hex'))
  THEN RAISE EXCEPTION 'LEASE_NOT_LINKED_TO_LEDGER'; END IF;
  FOR item IN SELECT * FROM (VALUES
    (id,1,outsider,'123',sha,plan),
    (id,2,pilot,'123',sha,plan),
    (id,1,pilot,'124',sha,plan),
    (id,1,pilot,'123',repeat('b',40),plan),
    (id,1,pilot,'123',sha,repeat('b',64)),
    (gen_random_uuid(),1,pilot,'123',sha,plan)
  ) v(lease_id,lot,target,github_run,code_sha,plan_sha)
  LOOP
    BEGIN
      PERFORM orulo_audit.require_national_scope(r,item.lease_id,item.lot,item.target,
        item.github_run,item.code_sha,item.plan_sha);
      RAISE EXCEPTION 'BAD_SCOPE_ACCEPTED';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'NATIONAL_SCOPE_DENIED' THEN RAISE; END IF;
    END;
  END LOOP;
  IF has_function_privilege('service_role','orulo_audit.authorize_national_scope(uuid,integer,uuid[],text,text,text,text,integer)','EXECUTE')
    OR has_function_privilege('service_role','orulo_audit.revoke_national_scope(uuid,uuid,text)','EXECUTE')
  THEN RAISE EXCEPTION 'API_CAN_MANAGE_LEASE'; END IF;
  BEGIN
    UPDATE orulo_audit.entries SET event=jsonb_set(event,'{expiresAt}',to_jsonb(clock_timestamp()-interval '1 second'))
      WHERE event_uuid=id;
    PERFORM orulo_audit.require_national_scope(r,id,1,pilot,'123',sha,plan);
    RAISE EXCEPTION 'EXPIRED_SCOPE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_SCOPE_DENIED' THEN RAISE; END IF;
  END;
  PERFORM orulo_audit.revoke_national_scope(r,id,a->>'hash');
  BEGIN
    PERFORM orulo_audit.require_national_scope(r,id,1,pilot,'123',sha,plan);
    RAISE EXCEPTION 'REVOKED_SCOPE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_SCOPE_DENIED' THEN RAISE; END IF;
  END;
END;
$test$;
