-- Permission-only incremental migration. Apply manually after review; never during deploy.
-- No GRANT, table/data/policy/function/default-ACL changes. Missing prerequisites fail closed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $hardening$
DECLARE
  item record;
  role_name text;
  privilege_name text;
  audited text[] := ARRAY[
    'ads_events','ads_visitors','ads_handoffs','buyer_profiles',
    'buyer_profile_events','buyer_profile_properties','buyer_profile_sessions',
    'buyer_quality_scores','google_ads_conversion_exports',
    'leads','events','behavior_events','properties'
  ];
  internal_tables text[] := audited[1:9];
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      RAISE EXCEPTION 'Missing prerequisite role: %', role_name;
    END IF;
  END LOOP;

  FOR item IN
    SELECT * FROM (VALUES
      ('ads_events', ARRAY['SELECT','INSERT']),
      ('ads_visitors', ARRAY['SELECT','INSERT','UPDATE']),
      ('ads_handoffs', ARRAY['SELECT','INSERT','UPDATE']),
      ('buyer_profiles', ARRAY['SELECT','INSERT','UPDATE']),
      ('buyer_profile_events', ARRAY['SELECT','INSERT']),
      ('buyer_profile_properties', ARRAY['SELECT','INSERT','UPDATE']),
      ('buyer_profile_sessions', ARRAY['SELECT','INSERT']),
      ('buyer_quality_scores', ARRAY['SELECT','INSERT','UPDATE']),
      ('google_ads_conversion_exports', ARRAY['SELECT','INSERT','UPDATE']),
      ('leads', ARRAY['SELECT','INSERT']),
      ('events', ARRAY['SELECT','INSERT']),
      ('behavior_events', ARRAY['SELECT','INSERT']),
      ('properties', ARRAY['SELECT','INSERT','UPDATE'])
    ) AS permissions(table_name, service_privileges)
  LOOP
    IF pg_catalog.to_regclass(format('public.%I', item.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Missing prerequisite table: public.%', item.table_name;
    END IF;

    -- Explicit administrative privileges; PUBLIC is the pseudo-role, not a named role.
    EXECUTE format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      item.table_name
    );
    IF current_setting('server_version_num')::integer >= 170000 THEN
      EXECUTE format(
        'REVOKE MAINTAIN ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        item.table_name
      );
    END IF;
    EXECUTE format(
      'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I FROM PUBLIC',
      item.table_name
    );
    EXECUTE format(
      'REVOKE GRANT OPTION FOR SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon, authenticated, service_role',
      item.table_name
    );

    IF item.table_name = ANY(internal_tables) THEN
      EXECUTE format(
        'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon, authenticated',
        item.table_name
      );
    END IF;

    -- Only remove privileges outside the runtime allowlist. Never repair with new GRANTs.
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF NOT privilege_name = ANY(item.service_privileges) THEN
        EXECUTE format('REVOKE %s ON TABLE public.%I FROM service_role',
          privilege_name, item.table_name);
      END IF;
    END LOOP;

    -- Include inherited privileges: unexpected role membership/ownership aborts atomically.
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(role_name, format('public.%I',item.table_name), privilege_name) THEN
          RAISE EXCEPTION 'Administrative privilege remains: % % %',
            role_name,item.table_name,privilege_name;
        END IF;
      END LOOP;
      IF current_setting('server_version_num')::integer >= 170000
        AND has_table_privilege(role_name,format('public.%I',item.table_name),'MAINTAIN') THEN
        RAISE EXCEPTION 'MAINTAIN remains: % %',role_name,item.table_name;
      END IF;
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
        IF role_name = 'service_role' THEN
          IF has_table_privilege(role_name,format('public.%I',item.table_name),privilege_name)
             IS DISTINCT FROM (privilege_name = ANY(item.service_privileges)) THEN
            RAISE EXCEPTION 'service_role differs from allowlist: % %',
              item.table_name,privilege_name;
          END IF;
        ELSIF item.table_name = ANY(internal_tables)
          AND has_table_privilege(role_name,format('public.%I',item.table_name),privilege_name) THEN
          RAISE EXCEPTION 'Internal access remains: % % %',
            role_name,item.table_name,privilege_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$hardening$;
COMMIT;
