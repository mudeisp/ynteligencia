-- Release only phase3-rest in existing immutable audit catalog.
-- Owner approval remains mandatory; no property writes.
BEGIN;
DO $preflight$
BEGIN
  IF orulo_audit.batch_catalog()->'batches'->'phase3-rest'->>'released' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'PHASE3_EXPECTED_UNRELEASED'; END IF;
  IF orulo_audit.batch_catalog()->'batches'->'phase3-rest'->>'hash' IS DISTINCT FROM '86de0194d405759242ade9a2059a4575def36e90e33e8fd43f8d1eabcb5520fc' THEN RAISE EXCEPTION 'PHASE3_MANIFEST_HASH_CHANGED'; END IF;
  IF orulo_audit.batch_prerequisite_result('phase2-30-b') IS NULL THEN RAISE EXCEPTION 'PHASE3_PREREQUISITE_MISSING'; END IF;
END;
$preflight$;
CREATE OR REPLACE FUNCTION orulo_audit.batch_catalog()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_set(
    jsonb_set(jsonb_set(
    jsonb_set(orulo_audit.batch_catalog_before5971(), '{batches,pilot-5971-images}',
      '{"hash":"7b05ead9d4583ae07682ffda7d52fe490ca7450710879d2066b1cea467e7f188","released":true,"phase":0,"prerequisite":null,"buildingIds":["5971"],"targets":[{"id":"55701ebd-747e-4968-92f1-647d2e6a79d9","buildingId":"5971","missingPlanIds":["251614","251615"]}]}'::jsonb, true),
    '{batches,terrarium-51496-v7}',
    $terrarium${"hash":"8051760fa1b7e076a8916d600611c131421177640daa412a3ef2ccab62732871","released":true,"phase":2,"prerequisite":null,"buildingIds":["51496"],"targets":[{"id":"48cb3d0a-2187-4552-9d44-5761c5562396","buildingId":"51496","missingPlanIds":["1622038","1622039","1622040","1622041","1622042","1622043","1622044","1622045","1622046","1622047","1622048","1622049","1622050","1622051","1622052","1622053","1622054"]},{"id":"4ad44c7d-96c2-4282-832b-516c1ba29047","buildingId":"51496","missingPlanIds":["1622038","1622039","1622040","1622041","1622042","1622043","1622044","1622045","1622046","1622047","1622048","1622049","1622050","1622051","1622052","1622053","1622054"]},{"id":"5a216315-0175-44ba-aa59-256339fff83b","buildingId":"51496","missingPlanIds":["1622038","1622039","1622040","1622041","1622042","1622043","1622044","1622045","1622046","1622047","1622048","1622049","1622050","1622051","1622052","1622053","1622054"]},{"id":"69496590-5269-4d4c-89f8-6c56447f1106","buildingId":"51496","missingPlanIds":["1622038","1622039","1622040","1622041","1622042","1622043","1622044","1622045","1622046","1622047","1622048","1622049","1622050","1622051","1622052","1622053","1622054"]},{"id":"ae3e0e5b-6e53-4c26-ba88-033c5e01eb9c","buildingId":"51496","missingPlanIds":["1622038","1622039","1622040","1622041","1622042","1622043","1622044","1622045","1622046","1622047","1622048","1622049","1622050","1622051","1622052","1622053","1622054"]},{"id":"e12eb7c4-8607-4f01-907f-dff5df0361f9","buildingId":"51496","missingPlanIds":["1622038","1622039","1622040","1622041","1622042","1622043","1622044","1622045","1622046","1622047","1622048","1622049","1622050","1622051","1622052","1622053","1622054"]}]}$terrarium$::jsonb,
    true
  ), '{batches,phase2-30-b,released}', 'true'::jsonb, false),
    '{batches,phase3-rest,released}', 'true'::jsonb, false
  );
$function$

DO $verify$
BEGIN
 IF orulo_audit.batch_catalog()->'batches'->'phase3-rest'->>'released' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'PHASE3_RELEASE_NOT_APPLIED'; END IF;
END;
$verify$;
COMMIT;
