\set ON_ERROR_STOP on
begin;
do $test$
declare
 h text := repeat('f',64);
 rid uuid := '8d501fb7-7399-466b-8e23-27a48ec7c101';
 approved_time timestamptz := clock_timestamp();
begin
 insert into orulo_audit.v5_manifests
 (manifest_hash,protocol,state,batch_id,report_hashes,targets,github_run_id,approved_commit_sha,created_at,expires_at,approved_at,approved_by)
 values (h,'orulo-v5-cas-preflight-v1','ES','staging-auth',array[repeat('a',64)],
 '[{"buildingId":"999","missingPlanIds":["1001","1002"]}]'::jsonb,
 7001,repeat('b',40),approved_time-interval '1 minute',approved_time+interval '1 hour',approved_time,'staging-owner');
 if orulo_audit.v5_staging_authorization_check(h,rid,'999','1001') then
   raise exception 'UNAPPROVED_MANIFEST_PASSED'; end if;
 insert into orulo_audit.v5_approvals
 (manifest_hash,run_uuid,approved_by,approved_at,expires_at,github_run_id,approved_commit_sha)
 values(h,rid,'staging-owner',approved_time,approved_time+interval '1 hour',7001,repeat('b',40));
 if not orulo_audit.v5_staging_authorization_check(h,rid,'999','1001') then
   raise exception 'VALID_MANIFEST_REJECTED'; end if;
 if orulo_audit.v5_staging_authorization_check(h,rid,'999','9999') then
   raise exception 'UNKNOWN_PLAN_PASSED'; end if;
 if orulo_audit.v5_staging_authorization_check(h,rid,'888','1001') then
   raise exception 'UNKNOWN_BUILDING_PASSED'; end if;
 if orulo_audit.v5_staging_authorization_check(h,'00000000-0000-0000-0000-000000000001','999','1001') then
   raise exception 'UNKNOWN_RUN_PASSED'; end if;
 update orulo_audit.v5_approvals set approved_at=approved_time-interval '2 hours', expires_at=approved_time-interval '1 hour' where manifest_hash=h;
 if orulo_audit.v5_staging_authorization_check(h,rid,'999','1001') then
   raise exception 'EXPIRED_APPROVAL_PASSED'; end if;
 update orulo_audit.v5_approvals set approved_at=approved_time, expires_at=approved_time+interval '1 hour', approved_commit_sha=repeat('c',40) where manifest_hash=h;
 if orulo_audit.v5_staging_authorization_check(h,rid,'999','1001') then
   raise exception 'COMMIT_MISMATCH_PASSED'; end if;
 if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='orulo_audit.v5_staging_authorization_check(text,uuid,text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
   raise exception 'PUBLIC_EXECUTE_GRANTED'; end if;
end $test$;
rollback;
