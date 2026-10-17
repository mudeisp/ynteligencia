-- Future TABLE defaults only: no existing-object ACL or other object-type changes.
-- Project-controlled postgres defaults only. Platform defaults are never mutated.
-- Missing authority/prerequisites or unsafe postgres defaults abort atomically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $default_acl$
DECLARE
  creator_name text;
  creator_oid oid;
  public_oid oid := pg_catalog.to_regnamespace('public');
BEGIN
  IF public_oid IS NULL THEN
    RAISE EXCEPTION 'Required schema public does not exist';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('postgres','supabase_admin','anon','authenticated','service_role')) <> 5 THEN
    RAISE EXCEPTION 'Required creator/application role is missing';
  END IF;

  IF NOT pg_catalog.pg_has_role(current_user,'postgres','USAGE') THEN
    RAISE EXCEPTION 'postgres_not_manageable: migration identity lacks postgres authority';
  END IF;
  IF NOT pg_catalog.pg_has_role(current_user,'supabase_admin','USAGE') THEN
    RAISE WARNING 'supabase_admin_not_manageable: platform defaults unchanged; run post-validation, hardening may be partial';
  ELSE
    RAISE WARNING 'supabase_admin_external_action_required: platform defaults outside automatic scope; run post-validation';
  END IF;

  -- Schema defaults ADD to global defaults. We cannot revoke a global grant
  -- only for public; changing global defaults would exceed this migration's scope.
  FOREACH creator_name IN ARRAY ARRAY['postgres'] LOOP
    SELECT oid INTO STRICT creator_oid FROM pg_catalog.pg_roles WHERE rolname=creator_name;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles app
      WHERE app.rolname IN ('anon','authenticated','service_role')
        AND (app.rolsuper OR pg_catalog.pg_has_role(app.oid,creator_oid,'USAGE'))
    ) THEN
      RAISE EXCEPTION 'Application role inherits creator ownership: %',creator_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_default_acl d
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
      WHERE d.defaclrole=creator_oid AND d.defaclnamespace=0 AND d.defaclobjtype='r'
        AND CASE WHEN a.grantee=0 THEN true ELSE EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles app
          WHERE app.rolname IN ('anon','authenticated','service_role')
            AND pg_catalog.pg_has_role(app.oid,a.grantee,'USAGE')
        ) END
    ) THEN
      RAISE EXCEPTION 'Unsafe global TABLE defaults for %; cannot fix within public only',creator_name;
    END IF;
  END LOOP;

  FOREACH creator_name IN ARRAY ARRAY['postgres'] LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
       REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
       ON TABLES FROM PUBLIC, anon, authenticated, service_role RESTRICT',creator_name);
    IF current_setting('server_version_num')::integer >= 170000 THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
         REVOKE MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated, service_role RESTRICT',
        creator_name);
    END IF;
  END LOOP;

  -- Include inherited ACL recipients. Never silently report a partial hardening.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles creator ON creator.oid=d.defaclrole
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE creator.rolname = 'postgres'
      AND d.defaclobjtype='r' AND d.defaclnamespace IN (0,public_oid)
      AND CASE WHEN a.grantee=0 THEN true ELSE EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles app
        WHERE app.rolname IN ('anon','authenticated','service_role')
          AND pg_catalog.pg_has_role(app.oid,a.grantee,'USAGE')
      ) END
  ) THEN
    RAISE EXCEPTION 'Unsafe effective public TABLE defaults remain; review inherited grants';
  END IF;
END
$default_acl$;
COMMIT;
