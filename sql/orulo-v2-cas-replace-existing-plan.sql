-- Órulo V2 CAS: transaction-scoped, fail-closed update for one validated plan.
-- Invoke with independently verified building_id, plan_id, source plan JSON,
-- expected complete-record JSONB baseline. No implicit mapping to typology_id.
-- The calling workflow MUST independently validate source hashes, provenance,
-- image signatures, and audit/readback before marking a batch complete.
-- This function is intentionally not deployed by this PR.
CREATE SCHEMA IF NOT EXISTS orulo_recovery;
CREATE OR REPLACE FUNCTION orulo_recovery.cas_replace_existing_plan(
  p_property_id uuid,
  p_building_id text,
  p_plan_id text,
  p_expected_record jsonb,
  p_recovered_images jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.properties%ROWTYPE;
  v_plans jsonb;
  v_new_plans jsonb;
  v_match_count int;
  v_old_plan jsonb;
  v_new_plan jsonb;
BEGIN
  IF p_building_id !~ '^[0-9]+$' OR p_plan_id !~ '^[0-9]+$'
    OR jsonb_typeof(p_recovered_images) <> 'array'
    OR jsonb_array_length(p_recovered_images)=0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_recovered_images) e WHERE jsonb_typeof(e.value)<>'string' OR e.value #>> '{}' !~ '^https://static[.]orulo[.]com[.]br/images/')
    OR jsonb_typeof(p_expected_record) <> 'object'
    THEN RETURN false;
  END IF;
  SELECT * INTO v_current FROM public.properties
  WHERE id=p_property_id AND source='novos'
    AND external_id LIKE 'orulo:'||p_building_id||':%'
    AND raw_data->>'building_id'=p_building_id
  FOR UPDATE;
  IF NOT FOUND OR to_jsonb(v_current) IS DISTINCT FROM p_expected_record THEN
    RETURN false;
  END IF;
  v_plans:=v_current.raw_data#>'{building,floor_plans}';
  IF jsonb_typeof(v_plans) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT count(*) INTO v_match_count FROM jsonb_array_elements(v_plans) AS p(plan)
  WHERE p.plan->>'id'=p_plan_id;
  IF v_match_count <> 1 THEN RETURN false; END IF;
  SELECT p.plan INTO v_old_plan FROM jsonb_array_elements(v_plans) p(plan) WHERE p.plan->>'id'=p_plan_id;
  IF jsonb_typeof(v_old_plan)<>'object' THEN RETURN false; END IF;
  v_new_plan:=jsonb_set(v_old_plan,'{images}',p_recovered_images,true);
  SELECT jsonb_agg(CASE WHEN items.plan->>'id'=p_plan_id THEN v_new_plan ELSE items.plan END ORDER BY ordinal)
  INTO v_new_plans FROM jsonb_array_elements(v_plans) WITH ORDINALITY AS items(plan,ordinal);
  UPDATE public.properties
  SET raw_data=jsonb_set(v_current.raw_data,'{building,floor_plans}',v_new_plans,false)
  WHERE id=p_property_id AND to_jsonb(public.properties)=p_expected_record;
  RETURN FOUND;
END;
$$;
-- Do not grant EXECUTE to anon/authenticated/public. Keep schema outside Data API.
REVOKE ALL ON FUNCTION orulo_recovery.cas_replace_existing_plan(uuid,text,text,jsonb,jsonb) FROM PUBLIC;
