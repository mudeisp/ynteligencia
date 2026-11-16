BEGIN;

-- The expired lease from 2026-11-16's lot-2 attempt was revoked.
-- This migration only replaces the schema-signature reader used by
-- scoped snapshot_begin/page/seal. No property, ledger, CAS, authorization,
-- snapshot membership, or image-recovery mutation is performed.
DO $contract$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_proc p
   WHERE p.oid='orulo_audit.columns_v2()'::regprocedure
     AND pg_get_userbyid(p.proowner)='orulo_audit_owner'
     AND p.prosecdef=false
     AND p.proacl::text='{orulo_audit_owner=X/orulo_audit_owner}'
     AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
        'df1b205cf039b06b9ed64a6a20ca8dce63cab7878fc63b020e03ae837adc3d44'
 ) THEN
   RAISE EXCEPTION 'ORULO_COLUMNS_V2_CONTRACT_DRIFT';
 END IF;
END $contract$;

DO $equivalence$
DECLARE actual jsonb; native jsonb;
BEGIN
 SELECT orulo_audit.columns_v2() INTO actual;
 SELECT jsonb_agg(jsonb_build_array(a.attname,pg_catalog.format_type(a.atttypid,NULL))
    ORDER BY a.attnum) INTO native
 FROM pg_catalog.pg_attribute a
 WHERE a.attrelid='public.properties'::regclass AND a.attnum>0 AND NOT a.attisdropped;
 IF actual IS DISTINCT FROM native OR jsonb_array_length(native)<>24 THEN
   RAISE EXCEPTION 'ORULO_COLUMNS_V2_SCHEMA_EQUIVALENCE_FAILED';
 END IF;
END $equivalence$;

CREATE OR REPLACE FUNCTION orulo_audit.columns_v2()
RETURNS jsonb
LANGUAGE sql
SET search_path TO ''
AS $function$
 SELECT jsonb_agg(jsonb_build_array(a.attname,pg_catalog.format_type(a.atttypid,NULL))
                  ORDER BY a.attnum)
 FROM pg_catalog.pg_attribute a
 WHERE a.attrelid='public.properties'::regclass
   AND a.attnum>0 AND NOT a.attisdropped;
$function$;

DO $verify$
DECLARE actual jsonb; expected jsonb;
BEGIN
 SELECT orulo_audit.columns_v2() INTO actual;
 SELECT jsonb_agg(jsonb_build_array(column_name,data_type)
        ORDER BY ordinal_position) INTO expected
 FROM information_schema.columns
 WHERE table_schema='public' AND table_name='properties';
 IF actual IS DISTINCT FROM expected OR jsonb_array_length(actual)<>24 THEN
   RAISE EXCEPTION 'ORULO_COLUMNS_V2_POST_MIGRATION_MISMATCH';
 END IF;
END $verify$;

COMMIT;
