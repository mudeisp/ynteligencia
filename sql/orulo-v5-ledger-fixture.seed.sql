\set ON_ERROR_STOP on
begin;
insert into orulo_audit.v5_manifests
(manifest_hash,protocol,state,batch_id,report_hashes,targets,github_run_id,approved_commit_sha,created_at,expires_at,approved_at,approved_by)
values(repeat('9',64),'orulo-v5-cas-preflight-v1','SP','ledger-fixture',array[repeat('a',64)],
'[{"buildingId":"98765","missingPlanIds":["77"]}]'::jsonb,9001,repeat('b',40),
clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',clock_timestamp(),'fixture-owner');
insert into orulo_audit.v5_approvals
(manifest_hash,run_uuid,approved_by,approved_at,expires_at,github_run_id,approved_commit_sha)
select manifest_hash,'f5f8b6c1-93de-4140-bbce-a1a1cb281a10'::uuid,'fixture-owner',approved_at,expires_at,9001,repeat('b',40)
from orulo_audit.v5_manifests where batch_id='ledger-fixture';
insert into orulo_audit.v5_fixture_properties(id,state,source,active,raw_data)
values('3f61222d-09e3-487b-9f4d-9b7771b225c9','SP','novos',true,
'{"building_id":"98765","building":{"id":"98765","floor_plans":[{"id":"77","area":65}]},"price":1000000}'::jsonb);
insert into orulo_audit.v5_fixture_intents
(operation_uuid,run_uuid,manifest_hash,property_id,expected,desired_plans)
select '8bb7f1f8-bcd5-4ca4-b08b-fb219ae4c16b',
'f5f8b6c1-93de-4140-bbce-a1a1cb281a10',repeat('9',64),id,to_jsonb(p),
'[{"id":"77","area":65,"image_url":"https://example.test/77.jpg"}]'::jsonb
from orulo_audit.v5_fixture_properties p
where id='3f61222d-09e3-487b-9f4d-9b7771b225c9';
do $$
begin
 begin
 perform orulo_audit.v5_fixture_audited_cas('f5f8b6c1-93de-4140-bbce-a1a1cb281a10','8bb7f1f8-bcd5-4ca4-b08b-fb219ae4c16b');
 raise exception 'SAME_TRANSACTION_INTENT_ACCEPTED';
 exception when raise_exception then
 if sqlerrm='SAME_TRANSACTION_INTENT_ACCEPTED' then raise; end if;
 if sqlerrm<>'V5_INTENT_MUST_BE_PREVIOUSLY_COMMITTED' then raise; end if;
 end;
end $$;
commit;
