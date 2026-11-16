\set ON_ERROR_STOP on
begin;
do $test$
declare
 h text := repeat('e',64);
 run_id uuid := 'd4a88f32-77a5-4f58-9db6-9c8ef21451c3';
 property_id uuid := 'e2b3b606-f2df-45c8-91e8-1e6e901c991a';
 ts timestamptz := clock_timestamp();
 expected jsonb;
 desired jsonb;
 result jsonb;
begin
 insert into orulo_audit.v5_manifests
 (manifest_hash,protocol,state,batch_id,report_hashes,targets,github_run_id,approved_commit_sha,created_at,expires_at,approved_at,approved_by)
 values(h,'orulo-v5-cas-preflight-v1','ES','fixture-cas',array[repeat('a',64)],
 '[{"buildingId":"9001","missingPlanIds":["11"]}]'::jsonb,7001,repeat('b',40),
 ts-interval '1 minute',ts+interval '1 hour',ts,'staging-owner');
 insert into orulo_audit.v5_approvals
 (manifest_hash,run_uuid,approved_by,approved_at,expires_at,github_run_id,approved_commit_sha)
 values(h,run_id,'staging-owner',ts,ts+interval '1 hour',7001,repeat('b',40));
 insert into orulo_audit.v5_fixture_properties(id,state,source,active,raw_data)
 values(property_id,'ES','novos',true,
 '{"building_id":"9001","building":{"id":"9001","floor_plans":[{"id":"11","area":55},{"id":"12","area":70}]},"price":900000}'::jsonb);
 select to_jsonb(p) into expected from orulo_audit.v5_fixture_properties p where id=property_id;
 desired := '[{"id":"11","area":55,"image_url":"https://example.test/11.jpg"},{"id":"12","area":70}]'::jsonb;
 result:=orulo_audit.v5_fixture_cas(h,run_id,property_id,expected,desired);
 if result->>'status'<>'UPDATED' then raise exception 'V5_VALID_CAS_FAILED'; end if;
 if (select raw_data->>'price' from orulo_audit.v5_fixture_properties where id=property_id)<>'900000'
 then raise exception 'V5_NONIMAGE_DRIFT'; end if;
 result:=orulo_audit.v5_fixture_cas(h,run_id,property_id,expected,desired);
 if result->>'status'<>'CONFLICT' then raise exception 'V5_STALE_CAS_NOT_BLOCKED'; end if;
 select to_jsonb(p) into expected from orulo_audit.v5_fixture_properties p where id=property_id;
 begin
   perform orulo_audit.v5_fixture_cas(h,run_id,property_id,expected,
   '[{"id":"11","area":56,"image_url":"https://example.test/11.jpg"},{"id":"12","area":70}]'::jsonb);
   raise exception 'V5_TYPOLOGY_MUTATION_NOT_BLOCKED';
 exception when raise_exception then
   if sqlerrm='V5_TYPOLOGY_MUTATION_NOT_BLOCKED' then raise; end if;
 end;
 begin
   perform orulo_audit.v5_fixture_cas(h,run_id,property_id,expected,
   '[{"id":"11","area":55,"image_url":"https://example.test/11.jpg"},{"id":"12","area":70,"image_url":"https://example.test/12.jpg"}]'::jsonb);
   raise exception 'V5_UNAUTHORIZED_PLAN_NOT_BLOCKED';
 exception when raise_exception then
   if sqlerrm='V5_UNAUTHORIZED_PLAN_NOT_BLOCKED' then raise; end if;
 end;
 if (select raw_data->'building'->'floor_plans'->1 ? 'image_url' from orulo_audit.v5_fixture_properties where id=property_id)
 then raise exception 'V5_UNAUTHORIZED_WRITE_PERSISTED'; end if;
end $test$;
rollback;
