-- Read-only ACL verification; includes PUBLIC, direct grants, grantor-independent.
-- Effective inherited privileges should also be checked using the preflight query.
BEGIN READ ONLY;
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
       c.relname::text AS table_name,
       a.privilege_type
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
WHERE n.nspname='public'
  AND c.relname IN ('ads_events','ads_visitors','ads_handoffs','buyer_profiles',
    'buyer_profile_events','buyer_profile_properties','buyer_profile_sessions',
    'buyer_quality_scores','google_ads_conversion_exports',
    'leads','events','behavior_events','properties')
  AND (a.grantee=0 OR pg_catalog.pg_get_userbyid(a.grantee)::text IN ('anon','authenticated','service_role'))
ORDER BY grantee,table_name,privilege_type;
COMMIT;
