\set ON_ERROR_STOP on
-- Disposable PostgreSQL fixture; never run this script against production.
DO $$BEGIN IF current_database()<>'orulo_columns_fast_test' THEN
 RAISE EXCEPTION 'ISOLATED_COLUMNS_TEST_DATABASE_REQUIRED'; END IF; END$$;

DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orulo_audit_owner') THEN
 CREATE ROLE orulo_audit_owner NOLOGIN;
END IF; END $$;
CREATE SCHEMA orulo_audit AUTHORIZATION orulo_audit_owner;
CREATE TABLE public.properties (
 id uuid PRIMARY KEY, external_id text, source text, title text,
 development_name text, neighborhood text, city text, state text,
 price numeric, bedrooms integer, bathrooms integer, parking_spaces integer,
 area numeric, has_balcony boolean, has_pool boolean, near_metro boolean,
 image_url text, property_url text, active boolean, raw_data jsonb,
 created_at timestamptz, updated_at timestamptz,
 latitude double precision, longitude double precision
);
CREATE FUNCTION orulo_audit.columns_v2()
 RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
 select jsonb_agg(jsonb_build_array(column_name,data_type) order by ordinal_position)
 from information_schema.columns where table_schema='public' and table_name='properties';
$function$;
ALTER FUNCTION orulo_audit.columns_v2() OWNER TO orulo_audit_owner;
REVOKE ALL ON FUNCTION orulo_audit.columns_v2() FROM PUBLIC;

-- Fail if the synthetic pre-migration function no longer reproduces production's guard.
DO $$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
     WHERE oid='orulo_audit.columns_v2()'::regprocedure) <>
       'df1b205cf039b06b9ed64a6a20ca8dce63cab7878fc63b020e03ae837adc3d44'
 THEN RAISE EXCEPTION 'FIXTURE_ORIGINAL_SOURCE_MISMATCH'; END IF;
END $$;

\i supabase/migrations/20261116203000_orulo_columns_v2_catalog_snapshot.sql

DO $$BEGIN
 IF orulo_audit.columns_v2() IS DISTINCT FROM
    (SELECT jsonb_agg(jsonb_build_array(column_name,data_type) ORDER BY ordinal_position)
     FROM information_schema.columns WHERE table_schema='public' AND table_name='properties')
 OR (SELECT count(*) FROM jsonb_array_elements(orulo_audit.columns_v2()))<>24
 THEN RAISE EXCEPTION 'SNAPSHOT_SCHEMA_CHANGED'; END IF;
 IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid='orulo_audit.columns_v2()'::regprocedure)
 THEN RAISE EXCEPTION 'SNAPSHOT_PRIVILEGE_CHANGED'; END IF;
END$$;

-- A later schema change must remain visible; no static cached signature.
ALTER TABLE public.properties ADD COLUMN future_column text;
DO $$BEGIN
 IF orulo_audit.columns_v2() IS DISTINCT FROM
    (SELECT jsonb_agg(jsonb_build_array(column_name,data_type) ORDER BY ordinal_position)
     FROM information_schema.columns WHERE table_schema='public' AND table_name='properties')
 OR (SELECT count(*) FROM jsonb_array_elements(orulo_audit.columns_v2()))<>25
 THEN RAISE EXCEPTION 'SNAPSHOT_SCHEMA_DRIFT_NOT_DETECTED'; END IF;
END$$;
SELECT 'ORULO_COLUMNS_V2_CATALOG_EQUIVALENCE_PASSED' AS result;
