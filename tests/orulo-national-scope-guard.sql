\set ON_ERROR_STOP on
CREATE TABLE public.properties(id uuid PRIMARY KEY, raw_data jsonb, source text, external_id text);
ALTER TABLE orulo_audit.runs ADD COLUMN metadata jsonb;
ALTER TABLE orulo_audit.runs ADD COLUMN github_run_id text;
UPDATE orulo_audit.runs SET metadata='{"mode":"national-v2-once"}';
CREATE FUNCTION orulo_audit.require_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('role',true) <> 'service_role' THEN RAISE insufficient_privilege; END IF;
END;
$$;
GRANT USAGE ON SCHEMA orulo_audit TO service_role;
GRANT EXECUTE ON FUNCTION orulo_audit.national_control(text,uuid,bigint,text,jsonb),
  orulo_audit.national_cas(uuid,uuid) TO service_role;
SET ROLE service_role;
DO $test$
DECLARE
  r constant uuid := '1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
  pilot constant uuid := '000a4d50-a014-4270-bb89-26adb841f142';
BEGIN
  BEGIN
    PERFORM orulo_audit.national_control('append',r,0,'',
      jsonb_build_object('type','INTENT','id',pilot));
    RAISE EXCEPTION 'UNAUTHORIZED_INTENT_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_SCOPE_CONTEXT_REQUIRED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM orulo_audit.national_cas(r,gen_random_uuid());
    RAISE EXCEPTION 'UNAUTHORIZED_CAS_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_FRESH_INTENT_REQUIRED' THEN RAISE; END IF;
  END;
END;
$test$;
RESET ROLE;
