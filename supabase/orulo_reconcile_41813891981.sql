-- ADMINISTRATIVE PROCEDURE ONLY. NOT A MIGRATION. DO NOT AUTOMATICALLY EXECUTE.
-- Preconditions outside SQL: owner confirmed Actions run 41813891981 is completed,
-- disabled readiness, exported/reviewed the two events and anchored head below.
-- This narrowly handles the known read-only failure; any other state must stop.
begin;
set local lock_timeout='5s';
do $$
declare r constant uuid:='6e5290ce-971a-404c-ae18-881a01e30f7c';
 expected constant text:='ba1dc5ecd0cfe0bdf0c9d048369926bf3d9154a6bf500beee4d580141ee292f4';
begin
 perform orulo_audit.lock_run(r);
 if not exists(select 1 from orulo_audit.runs where run_uuid=r and github_run_id='41813891981') then raise exception 'RECONCILIATION_RUN_MISMATCH'; end if;
 if (select count(*) from orulo_audit.entries where run_uuid=r)<>2 or
    not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=1 and kind='START' and previous_hash='') or
    not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=2 and kind='READ_ONLY_PREFLIGHT' and hash=expected and event->'writeEnabled'='false'::jsonb) then
  raise exception 'RECONCILIATION_UNEXPECTED_EVENTS';
 end if;
 if exists(select 1 from orulo_audit.entries e where run_uuid=r and (
  e.hash<>encode(sha256(convert_to(e.canonical,'UTF8')),'hex') or
  e.canonical<>jsonb_build_object('runUuid',e.run_uuid,'sequence',e.sequence,'previousHash',e.previous_hash,'event',e.event)::text or
  e.event_uuid is distinct from (e.event->>'eventUuid')::uuid or e.kind is distinct from e.event->>'type' or
  e.previous_hash<>coalesce((select p.hash from orulo_audit.entries p where p.run_uuid=r and p.sequence=e.sequence-1),''))) then
  raise exception 'RECONCILIATION_HASH_CHAIN_INVALID';
 end if;
 -- The original preflight had no write authorization/INTENT/CAS_RESULT/baseline.
 -- Existing admin_event checks the administrator identity and appends, never deletes.
 perform orulo_audit.admin_event(r,'ABORTED','Reconciled completed Actions 41813891981: baseline statement_timeout; two verified read-only events; no CAS intent/result',true);
end$$;
commit;
select sequence,kind,hash,previous_hash from orulo_audit.entries
 where run_uuid='6e5290ce-971a-404c-ae18-881a01e30f7c' order by sequence;
