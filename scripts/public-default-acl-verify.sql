-- Read-only: successful project migration is NOT necessarily complete hardening.
BEGIN READ ONLY;
WITH creators AS (
 SELECT wanted.name,r.oid,
  CASE WHEN r.oid IS NULL THEN false ELSE pg_has_role(current_user,r.oid,'USAGE') END AS manageable
 FROM (VALUES ('postgres'),('supabase_admin')) wanted(name)
 LEFT JOIN pg_roles r ON r.rolname=wanted.name
), apps AS (
 SELECT wanted.name,r.oid,r.rolsuper FROM
 (VALUES ('PUBLIC'),('anon'),('authenticated'),('service_role')) wanted(name)
 LEFT JOIN pg_roles r ON r.rolname=wanted.name
), defaults AS (
 SELECT c.name,a.grantee FROM creators c
 LEFT JOIN pg_default_acl d ON d.defaclrole=c.oid AND d.defaclnamespace=0 AND d.defaclobjtype='r'
 CROSS JOIN LATERAL aclexplode(coalesce(d.defaclacl,acldefault('r',c.oid))) a
 UNION ALL
 SELECT c.name,a.grantee FROM creators c JOIN pg_default_acl d ON d.defaclrole=c.oid
  AND d.defaclnamespace=to_regnamespace('public') AND d.defaclobjtype='r'
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
), checks AS (
 SELECT c.name AS creator_role,app.name AS grantee,c.manageable AS operator_can_manage_creator,
  CASE WHEN c.name='postgres' THEN 'project' ELSE 'platform_external' END AS responsibility,
  CASE WHEN c.oid IS NULL OR to_regnamespace('public') IS NULL OR (app.name<>'PUBLIC' AND app.oid IS NULL)
        THEN 'MISSING_PREREQUISITE'
       WHEN (app.name<>'PUBLIC' AND (app.rolsuper OR pg_has_role(app.oid,c.oid,'USAGE')))
         OR EXISTS (SELECT 1 FROM defaults d WHERE d.name=c.name AND
          CASE WHEN d.grantee=0 THEN true WHEN app.name='PUBLIC' THEN false
               ELSE pg_has_role(app.oid,d.grantee,'USAGE') END) THEN 'FAIL'
       ELSE 'PASS' END AS acl_status
 FROM creators c CROSS JOIN apps app
)
SELECT current_user AS migration_identity,creator_role,grantee,responsibility,
 operator_can_manage_creator,acl_status,
 CASE WHEN creator_role='postgres' THEN
        CASE WHEN acl_status='PASS' THEN 'project_hardened' ELSE 'postgres_hardening_failed' END
      WHEN acl_status='PASS' THEN 'platform_hardening_verified'
      WHEN NOT operator_can_manage_creator THEN 'supabase_admin_not_manageable'
      ELSE 'supabase_admin_external_action_required' END AS status,
 CASE WHEN NOT bool_and(acl_status='PASS') FILTER (WHERE creator_role='postgres') OVER ()
       THEN 'PROJECT_HARDENING_FAILED'
      WHEN bool_and(acl_status='PASS') OVER () THEN 'COMPLETE'
      ELSE 'PARTIAL_PLATFORM_ACTION_REQUIRED' END AS overall_status
FROM checks ORDER BY creator_role,grantee;
COMMIT;
