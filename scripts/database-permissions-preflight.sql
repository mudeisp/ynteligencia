-- Read-only preflight. Does not execute RPCs or inspect application row values.
BEGIN READ ONLY;
-- ACL grantor and owner identify who can have granted access, not the historical statement.
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner,
       pg_get_userbyid(a.grantor) AS grantor,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
WHERE n.nspname='public' AND c.relname IN (
 'ads_events','ads_visitors','ads_handoffs','buyer_profiles','buyer_profile_events',
 'buyer_profile_properties','buyer_profile_sessions','buyer_quality_scores',
 'google_ads_conversion_exports','leads','events','behavior_events','properties')
ORDER BY table_name,grantee,privilege_type;

-- Global (schema NULL) and public-schema default ACLs for every creator role.
-- These apply to newly created objects, not retroactively to existing tables.
SELECT pg_get_userbyid(d.defaclrole) AS creator_role,n.nspname AS schema_name,
       d.defaclobjtype AS object_type,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
       a.privilege_type,a.is_grantable
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclnamespace=0 OR n.nspname='public'
ORDER BY creator_role,schema_name,object_type,grantee,privilege_type;

-- Membership can retain an effective permission after a direct REVOKE.
SELECT r.rolname AS member_role,p.rolname AS granted_role,m.admin_option,
       m.inherit_option,m.set_option
FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member JOIN pg_roles p ON p.oid=m.roleid
WHERE r.rolname IN ('anon','authenticated','service_role')
ORDER BY member_role,granted_role;

-- Effective permissions (including inherited roles and PUBLIC).
SELECT r.rolname AS grantee,c.relname AS table_name,p.privilege_type,
       has_table_privilege(r.oid,c.oid,p.privilege_type) AS allowed
FROM pg_roles r
CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL unnest(
 CASE WHEN current_setting('server_version_num')::integer>=170000
 THEN ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
 ELSE ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] END
) p(privilege_type)
WHERE r.rolname IN ('anon','authenticated','service_role')
 AND n.nspname='public' AND c.relname IN (
 'ads_events','ads_visitors','ads_handoffs','buyer_profiles','buyer_profile_events',
 'buyer_profile_properties','buyer_profile_sessions','buyer_quality_scores',
 'google_ads_conversion_exports','leads','events','behavior_events','properties')
ORDER BY grantee,table_name,privilege_type;
COMMIT;
