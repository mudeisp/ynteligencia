-- Reconcile only the independently verified completed/failure GitHub run 41840098939.
-- Original run 41832262256 is not referenced or changed.
begin;
set local lock_timeout='5s';
do $$
declare
 r constant uuid := 'bcc8512e-87c3-46dd-9f0c-8e6a27172f73';
 expected_head constant text := '24d1b7f19479bb09d4f363944848d26b7010cebe22682f4dd51dfb6e435a9897';
 expected_snapshot constant jsonb := '[["171e312d-9ede-4a34-8c99-812fd79539a3","c84311b81c8fb5082906f457adc76243"],["18521073-1032-4cd7-bd09-f830ebb88923","ff07f5bc5f4243b8c96bc905146a5bf2"],["1c6bd669-2d6c-441f-a224-07dbeb00e6ea","bb880dd0674082e87c32717ab152a5e6"],["202352b4-f1e6-4ad4-b4c3-0bd3a2482410","1999046afecd8ffbeb19b055a0d2491a"],["2d2d1a7c-f65b-442a-b5de-92e8798f9cea","9b48fe554102c589252e96047e26965d"],["4c60763c-d972-453f-8068-ffd63e3e29f8","c83e2488670ad6ff03ed83259754d4f0"],["4d33381a-7ac5-47ee-b00e-e51d2ba7a50c","fdd5b4305d4d9ba10cfcf25daaa76ff6"],["5a83532f-e944-4273-b710-528ffdda1785","c6a0b5f5bb8c9231d5cc2e7d352fd604"],["6dbb8c58-510d-44c9-a09c-d179b92028cd","058825a45dc68f31a9b944c77628e411"],["72876cb6-c876-4963-80d6-53c5175f3c9b","b9c2b62a7d231c5d0752fe606ca46757"],["73a3d731-1f42-4cc5-ba1d-1728bc1d117f","a148a414f40390c9820a52607faf3fff"],["9892b0c5-64d0-43a3-8571-1665f910fab4","754fd239949c546bcde48739699ecdb2"],["a3f5a432-d9fe-4314-9a24-4c1fb2b4ccd6","acf3818390d25452eab5a30ed6365c66"],["c6c1d0e0-6447-472c-a31c-01e7d05680c8","c4d01cea19744053d7a3f2c442ae2ba5"],["d317519c-9369-43d9-99cf-f287779ef199","97512faf71a496097f7899a61d664806"],["f6f6fe27-7952-405d-80c5-c3f1ff8417a6","7f4149e48851d1477e1f7fb1fc7c3877"],["fcfb6729-dbf6-4d79-b1c4-100b795b2c40","17e430466e2157dc21edf2c257ddd626"],["fe4edcc9-e104-456f-bf24-2bb857e14c69","4191ef69b63cfd1f28ff1c54f55b3be4"]]'::jsonb;
 current_snapshot jsonb;
begin
 perform orulo_audit.lock_run(r);
 if not exists(select 1 from orulo_audit.runs where run_uuid=r and github_run_id='41840098939'
  and metadata->>'workflowSha'='ee9b114535c57a020e3d73b8a37c9a4673f66c5f'
  and metadata->>'actor'='mudeisp' and metadata->>'actorId'='323805541' and metadata->>'ref'='refs/heads/main' and metadata->>'attempt'='1') then raise exception 'RPC_FAILURE_RECONCILIATION_RUN_MISMATCH'; end if;
 if (select count(*) from orulo_audit.entries where run_uuid=r)<>2
  or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=1 and kind='START' and previous_hash='')
  or not exists(select 1 from orulo_audit.entries where run_uuid=r and sequence=2 and kind='CLIENT_STOP' and hash=expected_head
   and event->>'stage'='PILOT_STOP' and event->>'code'='PILOT_HALTED_RECONCILIATION_REQUIRED' and event->'confirmedRows'='0'::jsonb and event->'id'='null'::jsonb)
  or exists(select 1 from orulo_audit.entries where run_uuid=r and operation_uuid is not null) then raise exception 'RPC_FAILURE_RECONCILIATION_UNEXPECTED_EVENTS'; end if;
 if exists(select 1 from orulo_audit.entries e where e.run_uuid=r and (
  e.hash<>encode(sha256(convert_to(e.canonical,'UTF8')),'hex')
  or e.canonical<>jsonb_build_object('runUuid',e.run_uuid,'sequence',e.sequence,'previousHash',e.previous_hash,'event',e.event)::text
  or e.event_uuid is distinct from (e.event->>'eventUuid')::uuid or e.kind is distinct from e.event->>'type'
  or e.previous_hash<>coalesce((select p.hash from orulo_audit.entries p where p.run_uuid=r and p.sequence=e.sequence-1),''))) then raise exception 'RPC_FAILURE_RECONCILIATION_CHAIN_INVALID'; end if;
 with targets as materialized(
  select id from public.properties where state='SP' and source='novos' and active is true and raw_data->>'building_id'='43126'
  union all
  select id from public.properties where state='SP' and source='novos' and active is true and raw_data->>'building_id' is null and raw_data->'building'->>'id'='43126')
 select coalesce(jsonb_agg(jsonb_build_array(p.id,md5(to_jsonb(p)::text)) order by p.id),'[]'::jsonb) into current_snapshot
 from targets join public.properties p using(id);
 if current_snapshot is distinct from expected_snapshot then raise exception 'RPC_FAILURE_RECONCILIATION_PROPERTIES_CHANGED'; end if;
 perform orulo_audit.admin_event(r,'ABORTED','Owner-approved reconciliation of completed GitHub 41840098939: verified START/STOP only, no authorization/INTENT/CAS, 18 property hashes unchanged; pilot_targets statement_timeout',true);
end$$;
commit;
select sequence,kind,hash,previous_hash from orulo_audit.entries where run_uuid='bcc8512e-87c3-46dd-9f0c-8e6a27172f73' order by sequence;
