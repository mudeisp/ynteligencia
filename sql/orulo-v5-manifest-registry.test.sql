\set ON_ERROR_STOP on
begin;
do $test$
declare h text := repeat('a',64);
begin
 insert into orulo_audit.v5_manifests
 (manifest_hash,protocol,state,batch_id,report_hashes,targets,github_run_id,approved_commit_sha,expires_at)
 values (h,'orulo-v5-cas-preflight-v1','SP','staging-test',array[repeat('b',64)],
 '[{"buildingId":"5971","missingPlanIds":["251614"]}]'::jsonb,123,repeat('c',40),clock_timestamp()+interval '1 hour');
 if (select count(*) from orulo_audit.v5_manifests where manifest_hash=h) <> 1
 then raise exception 'V5_REGISTRY_INSERT_FAILED'; end if;
 begin
  insert into orulo_audit.v5_manifests
  (manifest_hash,protocol,state,batch_id,report_hashes,targets,github_run_id,approved_commit_sha,expires_at)
  values (h,'orulo-v5-cas-preflight-v1','SP','duplicate',array[repeat('b',64)],
  '[{"buildingId":"5971","missingPlanIds":["251614"]}]'::jsonb,123,repeat('c',40),clock_timestamp()+interval '1 hour');
  raise exception 'V5_DUPLICATE_NOT_REJECTED';
 exception when unique_violation then null;
 end;
 begin
  insert into orulo_audit.v5_manifests
  (manifest_hash,protocol,state,batch_id,report_hashes,targets,github_run_id,approved_commit_sha,expires_at)
  values (repeat('d',64),'orulo-v5-cas-preflight-v1','XX','invalid-state',array[repeat('b',64)],
  '[]'::jsonb,123,repeat('c',40),clock_timestamp()+interval '1 hour');
  raise exception 'V5_INVALID_STATE_NOT_REJECTED';
 exception when check_violation then null;
 end;
 begin
  insert into orulo_audit.v5_manifests
  (manifest_hash,protocol,state,batch_id,report_hashes,targets,github_run_id,approved_commit_sha,expires_at)
  values (repeat('e',64),'orulo-v5-cas-preflight-v1','ES','empty',array[repeat('b',64)],
  '[]'::jsonb,123,repeat('c',40),clock_timestamp()+interval '1 hour');
  raise exception 'V5_EMPTY_SCOPE_NOT_REJECTED';
 exception when check_violation then null;
 end;
 if exists(select 1 from pg_policies where schemaname='orulo_audit' and tablename='v5_manifests')
 then raise exception 'V5_UNEXPECTED_RLS_POLICY'; end if;
 if not (select relrowsecurity from pg_class where oid='orulo_audit.v5_manifests'::regclass)
 then raise exception 'V5_RLS_DISABLED'; end if;
 if has_table_privilege('public','orulo_audit.v5_manifests','INSERT')
 then raise exception 'V5_PUBLIC_WRITE_GRANT'; end if;
end $test$;
rollback;
