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
  SELECT count(*), max(p.value) INTO v_count,v_old_plan
  FROM jsonb_array_elements(v_plans) p(value)
  WHERE p.value->>'id'=p_plan_id;
  IF v_count<>1 OR jsonb_typeof(v_old_plan) IS DISTINCT FROM 'object'
  THEN RETURN false; END IF;
  IF v_old_plan ? 'images'
    AND v_old_plan->'images' IS DISTINCT FROM 'null'::jsonb
    AND v_old_plan->'images' IS DISTINCT FROM '[]'::jsonb
  THEN RETURN false; END IF;
  SELECT jsonb_agg(
    CASE WHEN item.value->>'id'=p_plan_id
      THEN jsonb_set(item.value,'{images}',p_recovered_images,true)
      ELSE item.value END ORDER BY item.ordinality
  ) INTO v_new_plans
  FROM jsonb_array_elements(v_plans) WITH ORDINALITY item(value,ordinality);
  UPDATE public.properties
  SET raw_data=jsonb_set(v_current.raw_data,'{building,floor_plans}',v_new_plans,false)
  WHERE id=p_property_id AND to_jsonb(public.properties)=p_expected_record;
  RETURN FOUND;
END;
$cas$;
REVOKE ALL ON FUNCTION orulo_recovery.cas_replace_existing_plan(uuid,text,text,jsonb,jsonb) FROM PUBLIC;
