-- Read-only target-side CAS baseline candidates for Órulo V2.
-- This is NOT an eligibility or recovery manifest. Source checkpoint
-- reconciliation must independently match (building_id,plan_id).
-- Run in a read-only transaction; output must be handled as private evidence.
BEGIN READ ONLY;
WITH candidates AS (
 SELECT p.id AS property_id,
        p.raw_data->>'building_id' AS building_id,
        plan.value->>'id' AS plan_id,
        p.external_id,
        encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS record_sha256,
        to_jsonb(p) AS expected_record,
        plan.value AS original_plan,
        count(*) OVER (PARTITION BY p.id, plan.value->>'id') AS n
 FROM public.properties p
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(p.raw_data#>'{building,floor_plans}')='array'
        THEN p.raw_data#>'{building,floor_plans}' ELSE '[]'::jsonb END
) AS plan(value)
 WHERE p.source='novos'
   AND p.external_id LIKE 'orulo:%'
   AND p.raw_data->>'building_id' ~ '^[0-9]+$'
   AND plan.value->>'id' ~ '^[0-9]+$'
 )
SELECT c.property_id,c.building_id,c.plan_id,c.external_id,
       c.record_sha256,c.expected_record,c.original_plan
FROM candidates c
WHERE c.n=1
  AND (NOT (c.original_plan ? 'images')
       OR c.original_plan->'images' IN ('null'::jsonb, '[]'::jsonb))
ORDER BY c.building_id::numeric,c.plan_id::numeric,c.property_id;
COMMIT;
