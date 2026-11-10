-- Órulo V2 CAS prototype. NOT deployed. Requires independently verified provenance and audit.
CREATE SCHEMA IF NOT EXISTS orulo_recovery;
CREATE OR REPLACE FUNCTION orulo_recovery.cas_replace_existing_plan(
  p_property_id uuid, p_building_id text, p_plan_id text,
  p_expected_record jsonb, p_recovered_images jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $cas$
DECLARE
  v_current public.properties%ROWTYPE;
  v_plans jsonb;
  v_new_plans jsonb;
  v_old_plan jsonb;
  v_count integer;
BEGIN
  IF p_property_id IS NULL OR p_building_id IS NULL OR p_plan_id IS NULL
     OR p_building_id !~ '^[0-9]+$' OR p_plan_id !~ '^[0-9]+$'
     OR jsonb_typeof(p_expected_record) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_recovered_images) IS DISTINCT FROM 'array'
  THEN RETURN false; END IF;
  IF jsonb_array_length(p_recovered_images)=0 THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_recovered_images) e(value)
    WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string'
       OR e.value #>> '{}' !~ '^https://static[.]orulo[.]com[.]br/images/'
  ) THEN RETURN false; END IF;
  SELECT * INTO v_current FROM public.properties
  WHERE id=p_property_id AND source='novos'
    AND external_id LIKE 'orulo:'||p_building_id||':%'
    AND raw_data->>'building_id'=p_building_id FOR UPDATE;
  IF NOT FOUND OR to_jsonb(v_current) IS DISTINCT FROM p_expected_record
  THEN RETURN false; END IF;
  v_plans:=v_current.raw_data#>'{building,floor_plans}';
  IF jsonb_typeof(v_plans) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT count(*), (jsonb_agg(p.value)->0) INTO v_count,v_old_plan
  FROM jsonb_array_elements(v_plans) p(value)
  WHERE p.value->>'id'=p_plan_id;
  IF v_count<>1 OR jsonb_typeof(v_old_plan) IS DISTINCT FROM 'object'
  THEN RETURN false; END IF;
  IF v_old_plan ? 'images'
    AND v_old_plan->'images' IS DISTINCT FROM 'null'::jsonb
    AND v_old_plan->'images' IS DISTINCT FROM '[]'::jsonb
  THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['image_url','520x280','1024x1024','2280x1800']) f(name) WHERE COALESCE(v_old_plan->>f.name,'') <> '') THEN RETURN false; END IF;
  SELECT jsonb_agg(
    CASE WHEN item.value->>'id'=p_plan_id
      THEN jsonb_set(item.value,'{images}',p_recovered_images,true)
      ELSE item.value END ORDER BY item.ordinality
  ) INTO v_new_plans
  FROM jsonb_array_elements(v_plans) WITH ORDINALITY item(value,ordinality);
  UPDATE public.properties AS target
  SET raw_data=jsonb_set(v_current.raw_data,'{building,floor_plans}',v_new_plans,false)
  WHERE target.id=p_property_id AND to_jsonb(target)=p_expected_record;
  RETURN FOUND;
END;
$cas$;
REVOKE ALL ON FUNCTION orulo_recovery.cas_replace_existing_plan(uuid,text,text,jsonb,jsonb) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS orulo_recovery.cas_batch_audit (
  transaction_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  property_id uuid NOT NULL,
  building_id text NOT NULL,
  plan_id text NOT NULL,
  baseline_sha256 text NOT NULL,
  result_sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (transaction_id, property_id, plan_id)
);
REVOKE ALL ON orulo_recovery.cas_batch_audit FROM PUBLIC;

-- Each call is atomic. Locks are acquired in property order. Callers must supply
-- full current baselines and provenance-validated images from a trusted batch.
CREATE OR REPLACE FUNCTION orulo_recovery.cas_apply_batch(p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $batch$
DECLARE
  v_item record;
  v_previous uuid;
  v_record jsonb;
  v_initial jsonb;
  v_before jsonb;
  v_applied integer := 0;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_BATCH';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'INVALID_BATCH_SIZE';
  END IF;
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS i(
      property_id uuid, building_id text, plan_id text, baseline jsonb, images jsonb
    ) ORDER BY property_id, building_id, plan_id
  LOOP
    IF v_item.property_id IS NULL THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
    IF v_item.property_id IS DISTINCT FROM v_previous THEN
      SELECT to_jsonb(p) INTO v_record FROM public.properties p
      WHERE p.id=v_item.property_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CAS_TARGET_MISSING'; END IF;
      v_initial := v_record;
      v_previous := v_item.property_id;
    END IF;
    -- A replay may find the exact desired state. It must still verify identity
    -- and a unique plan before treating that occurrence as already applied.
    IF v_record->>'source'='novos'
       AND v_record->>'external_id' LIKE 'orulo:'||v_item.building_id||':%'
       AND v_record#>>'{raw_data,building_id}'=v_item.building_id
       AND v_item.building_id ~ '^[0-9]+$' AND v_item.plan_id ~ '^[0-9]+$'
       AND jsonb_typeof(v_item.images)='array' AND v_item.images NOT IN ('[]','[null]')
       AND jsonb_typeof(v_record#>'{raw_data,building,floor_plans}')='array'
    THEN
      IF (SELECT count(*)=1 AND bool_and(p->'images'=v_item.images)
          FROM jsonb_array_elements(v_record#>'{raw_data,building,floor_plans}') p
          WHERE p->>'id'=v_item.plan_id)
      THEN CONTINUE; END IF;
    END IF;
    v_before := v_record;
    IF v_item.baseline IS DISTINCT FROM v_initial OR NOT
       orulo_recovery.cas_replace_existing_plan(v_item.property_id, v_item.building_id,
         v_item.plan_id, v_record, v_item.images)
    THEN RAISE EXCEPTION 'CAS_BATCH_CONFLICT'; END IF;
    v_applied := v_applied + 1;
    SELECT to_jsonb(p) INTO STRICT v_record FROM public.properties p WHERE p.id=v_item.property_id;
    INSERT INTO orulo_recovery.cas_batch_audit
      (property_id, building_id, plan_id, baseline_sha256, result_sha256)
    VALUES (v_item.property_id, v_item.building_id, v_item.plan_id,
      encode(sha256(convert_to(v_before::text,'UTF8')),'hex'),
      encode(sha256(convert_to(v_record::text,'UTF8')),'hex'));
  END LOOP;
  RETURN v_applied;
END;
$batch$;
REVOKE ALL ON FUNCTION orulo_recovery.cas_apply_batch(jsonb) FROM PUBLIC;
