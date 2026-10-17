-- Read-only effective future TABLE access. All 8 rows must have status PASS.
-- Check global fallback + schema ACL + inherited ownership, not just direct public ACL rows.
BEGIN READ ONLY;
WITH creators AS (
 SELECT wanted.name,r.oid FROM (VALUES ('postgres'),('supabase_admin')) wanted(name)
 LEFT JOIN pg_roles r ON r.rolname=wanted.name
), applications AS (
 SELECT wanted.name,r.oid,r.rolsuper FROM
 (VALUES ('PUBLIC'),('anon'),('authenticated'),('service_role')) wanted(name)
 LEFT JOIN pg_roles r ON r.rolname=wanted.name
), effective_defaults AS (
 SELECT c.name,c.oid,a.grantee,a.privilege_type,a.is_grantable
 FROM creators c
 LEFT JOIN pg_default_acl d ON d.defaclrole=c.oid AND d.defaclnamespace=0 AND d.defaclobjtype='r'
 CROSS JOIN LATERAL aclexplode(coalesce(d.defaclacl,acldefault('r',c.oid))) a
 UNION ALL
 SELECT c.name,c.oid,a.grantee,a.privilege_type,a.is_grantable
 FROM creators c JOIN pg_default_acl d ON d.defaclrole=c.oid
  AND d.defaclnamespace=to_regnamespace('public') AND d.defaclobjtype='r'
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
)
SELECT c.name AS creator_role,'public' AS schema_name,'r' AS object_type,app.name AS grantee,
 CASE WHEN c.oid IS NULL OR to_regnamespace('public') IS NULL
       OR (app.name<>'PUBLIC' AND app.oid IS NULL) THEN 'MISSING_PREREQUISITE'
      WHEN (app.name<>'PUBLIC' AND (app.rolsuper OR pg_has_role(app.oid,c.oid,'USAGE')))
       OR EXISTS (
         SELECT 1 FROM effective_defaults e WHERE e.name=c.name
           AND CASE WHEN e.grantee=0 THEN true WHEN app.name='PUBLIC' THEN false
                    ELSE pg_has_role(app.oid,e.grantee,'USAGE') END
       ) THEN 'FAIL'
      ELSE 'PASS' END AS status
FROM creators c CROSS JOIN applications app
ORDER BY creator_role,grantee;
COMMIT;
