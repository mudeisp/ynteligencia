-- Read-only. Run manually by an authorized operator; no Production execution by this PR.
BEGIN READ ONLY;
SELECT current_user,session_user,current_role,current_setting('role') AS role_setting,
       current_setting('server_version') AS server_version,now() AS observed_at;

SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolbypassrls
FROM pg_roles WHERE rolname IN ('postgres','supabase_admin','service_role','anon','authenticated',current_user,session_user)
ORDER BY rolname;
SELECT creator.rolname AS creator_role,d.defaclobjtype AS object_type,
       CASE WHEN d.defaclnamespace=0 THEN '<GLOBAL>' ELSE n.nspname END AS schema_name,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
       a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor) AS grantor
FROM pg_default_acl d JOIN pg_roles creator ON creator.oid=d.defaclrole
LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE creator.rolname IN ('postgres','supabase_admin')
  AND (d.defaclnamespace=0 OR n.nspname='public')
  AND d.defaclobjtype IN ('r','S','f')
ORDER BY creator_role,object_type,schema_name,grantee,privilege_type;

-- No explicit default ACL row does not imply no built-in defaults.
-- Show the effective global TABLE ACL (owner-only by default).
SELECT creator.rolname AS creator_role,'r' AS object_type,'<GLOBAL>' AS schema_name,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
       a.privilege_type,a.is_grantable,(d.oid IS NULL) AS builtin_default
FROM pg_roles creator
LEFT JOIN pg_default_acl d ON d.defaclrole=creator.oid AND d.defaclnamespace=0 AND d.defaclobjtype='r'
CROSS JOIN LATERAL aclexplode(coalesce(d.defaclacl,acldefault('r',creator.oid))) a
WHERE creator.rolname IN ('postgres','supabase_admin')
ORDER BY creator_role,grantee,privilege_type;

SELECT wanted.rolname AS creator_role,(r.oid IS NOT NULL) AS creator_exists,
       CASE WHEN r.oid IS NULL THEN false ELSE pg_has_role(current_user,r.oid,'USAGE') END AS operator_can_manage_creator,
       CASE WHEN r.oid IS NULL THEN false WHEN current_setting('server_version_num')::integer>=160000 THEN pg_has_role(current_user,r.oid,'SET') ELSE NULL END AS operator_can_set_creator,
       CASE WHEN r.oid IS NULL THEN false ELSE pg_has_role(current_user,r.oid,'MEMBER') END AS operator_is_member,
       CASE WHEN r.oid IS NULL THEN false ELSE has_schema_privilege(r.oid,'public','CREATE') END AS creator_can_create
FROM (VALUES ('postgres'),('supabase_admin')) wanted(rolname)
LEFT JOIN pg_roles r ON r.rolname=wanted.rolname;

SELECT member_role.rolname AS member_role,parent.rolname AS granted_role,
       m.inherit_option,m.set_option,m.admin_option
FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member
JOIN pg_roles parent ON parent.oid=m.roleid
WHERE member_role.rolname IN ('anon','authenticated','service_role','postgres','supabase_admin')
ORDER BY member_role,granted_role;
-- Paths are descriptive; effective USAGE/SET checks above enforce edge semantics.
WITH RECURSIVE membership_paths AS (
 SELECT r.oid AS start_oid,r.rolname AS identity,r.oid AS role_oid,
        ARRAY[r.oid] AS visited,ARRAY[r.rolname::text] AS role_path
 FROM pg_roles r WHERE r.rolname IN (current_user,session_user,'postgres','supabase_admin','service_role','anon','authenticated')
 UNION ALL
 SELECT p.start_oid,p.identity,m.roleid,p.visited||m.roleid,p.role_path||parent.rolname::text
 FROM membership_paths p JOIN pg_auth_members m ON m.member=p.role_oid
 JOIN pg_roles parent ON parent.oid=m.roleid
 WHERE NOT m.roleid=ANY(p.visited)
)
SELECT identity,role_path FROM membership_paths
WHERE cardinality(role_path)>1 ORDER BY identity,role_path;
COMMIT;
