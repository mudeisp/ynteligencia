-- Órulo V2: candidate target mapping and live baseline inspection.
-- Read-only. This report never assumes plan_id = typology_id.
BEGIN READ ONLY;
WITH property_plans AS (
 SELECT p.id AS property_id, p.external_id,
        p.raw_data->>'building_id' AS building_id,
        p.raw_data->>'typology_id' AS typology_id,
        plan.value->>'id' AS plan_id,
        plan.value->'associations'->'typologies' AS associated_typologies,
        plan.value->'associations'->'building_units' AS associated_units,
        encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS record_sha256,
        p.updated_at
 FROM public.properties p
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(p.raw_data#>'{building,floor_plans}')='array'
     THEN p.raw_data#>'{building,floor_plans}' ELSE '[]'::jsonb END
 ) AS plan(value)
 WHERE p.source='novos' AND p.external_id LIKE 'orulo:%'
), matches AS (
 SELECT building_id,plan_id,
        count(DISTINCT property_id) AS property_count,
        count(DISTINCT typology_id) AS typology_count,
        count(*) AS appearances,
        bool_and(jsonb_typeof(associated_typologies)='array') AS association_arrays_present
 FROM property_plans
 WHERE plan_id ~ '^[0-9]+$' AND building_id ~ '^[0-9]+$'
 GROUP BY building_id,plan_id
)
SELECT count(*) AS distinct_building_plan_pairs,
 count(*) FILTER (WHERE property_count=1) AS single_property_pairs,
 count(*) FILTER (WHERE property_count>1) AS shared_across_properties,
 count(*) FILTER (WHERE appearances>property_count) AS duplicate_occurrences,
 count(*) FILTER (WHERE NOT association_arrays_present) AS missing_association_arrays
FROM matches;
COMMIT;
