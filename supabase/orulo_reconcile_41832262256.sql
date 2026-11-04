-- Administrative reconciliation only; GitHub run 41832262256 was independently verified completed/failure.
-- Never authorizes writes, deletes events or reuses the old execution.
begin;
set local lock_timeout='5s';
do $$
declare
 r constant uuid := '26556e29-7a3b-450e-9169-3f894f231077';
 expected_head constant text := 'bacc0b0416e26104e2b8974e070525d4de17d15fa6360bb76508e6652ffb0f71';
 expected_targets constant jsonb := '["171e312d-9ede-4a34-8c99-812fd79539a3","18521073-1032-4cd7-bd09-f830ebb88923","1c6bd669-2d6c-441f-a224-07dbeb00e6ea","202352b4-f1e6-4ad4-b4c3-0bd3a2482410","2d2d1a7c-f65b-442a-b5de-92e8798f9cea","4c60763c-d972-453f-8068-ffd63e3e29f8","4d33381a-7ac5-47ee-b00e-e51d2ba7a50c","5a83532f-e944-4273-b710-528ffdda1785","6dbb8c58-510d-44c9-a09c-d179b92028cd","72876cb6-c876-4963-80d6-53c5175f3c9b","73a3d731-1f42-4cc5-ba1d-1728bc1d117f","9892b0c5-64d0-43a3-8571-1665f910fab4","a3f5a432-d9fe-4314-9a24-4c1fb2b4ccd6","c6c1d0e0-6447-472c-a31c-01e7d05680c8","d317519c-9369-43d9-99cf-f287779ef199","f6f6fe27-7952-405d-80c5-c3f1ff8417a6","fcfb6729-dbf6-4d79-b1c4-100b795b2c40","fe4edcc9-e104-456f-bf24-2bb857e14c69"]'::jsonb;
begin
 perform orulo_audit.lock_run(r);
 if not exists(select 1 from orulo_audit.runs where run_uuid=r and github_run_id='41832262256'
  and metadata->>'workflowSha'='628b9ae4d3255871b0c5412cd815c66bf850428a'
  and metadata->>'actor'='mudeisp' and metadata->>'actorId'='323805541'
  and metadata->>'ref'='refs/heads/main' and metadata->>'attempt'='1') then raise exception 'PILOT_RECONCILIATION_RUN_MISMATCH'; end if;
 if (select count(*) from orulo_audit.entries where run_uuid=r)<>3
  or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=1 and kind='START' and previous_hash='')
  or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=2 and kind='CLIENT_READBACK'
   and event->>'stage'='PILOT_PLAN' and event->>'buildingId'='43126' and event->'targetIds'=expected_targets
   and event->'writeEnabled'='false'::jsonb)
  or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=3 and kind='CLIENT_STOP'
   and hash=expected_head and event->>'stage'='PILOT_STOP' and event->'confirmedRows'='0'::jsonb and event->'id'='null'::jsonb)
  or exists(select 1 from orulo_audit.entries where run_uuid=r and operation_uuid is not null) then
   raise exception 'PILOT_RECONCILIATION_UNEXPECTED_EVENTS'; end if;
 if exists(select 1 from orulo_audit.entries e where e.run_uuid=r and (
  e.hash<>encode(sha256(convert_to(e.canonical,'UTF8')),'hex')
  or e.canonical<>jsonb_build_object('runUuid',e.run_uuid,'sequence',e.sequence,'previousHash',e.previous_hash,'event',e.event)::text
  or e.event_uuid is distinct from (e.event->>'eventUuid')::uuid or e.kind is distinct from e.event->>'type'
  or e.previous_hash<>coalesce((select p.hash from orulo_audit.entries p where p.run_uuid=r and p.sequence=e.sequence-1),''))) then
   raise exception 'PILOT_RECONCILIATION_CHAIN_INVALID'; end if;
 perform orulo_audit.admin_event(r,'ABORTED','GitHub 41832262256 completed/failure: verified START, PILOT_PLAN and STOP only; no authorization, INTENT or CAS; owner-approved reconciliation',true);
end$$;
commit;
select sequence,kind,hash,previous_hash from orulo_audit.entries where run_uuid='26556e29-7a3b-450e-9169-3f894f231077' order by sequence;
