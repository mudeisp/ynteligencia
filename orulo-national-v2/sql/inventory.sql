-- READ ONLY. Replace __AFTER__ with a UUID cursor and __LIMIT__ with an integer.
-- Full-record hashes use PostgreSQL JSONB text, UTF-8 and UTC (not JS JSON.stringify).
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';
WITH page AS (
 SELECT p.* FROM public.properties p
 WHERE source='novos' AND external_id LIKE 'orulo:%' AND id > '__AFTER__'::uuid
 ORDER BY id LIMIT __LIMIT__
), inventory AS (
 SELECT p.id, coalesce(p.raw_data->>'building_id',p.raw_data->'building'->>'id') AS "buildingId",
 p.state,p.active,p.external_id AS "externalId",
 encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS "recordSha256",
 jsonb_typeof(p.raw_data->'building'->'floor_plans') AS "plansType",
 coalesce((SELECT jsonb_agg(jsonb_build_array(x.plan->>'id',
 coalesce(EXISTS(SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(x.plan)='object' THEN x.plan ELSE '{}'::jsonb END) e
 WHERE e.key IN ('image_url','url','520x280','1024x1024','2280x1800') AND jsonb_typeof(e.value)='string' AND e.value#>>'{}'<> '')
 OR CASE WHEN jsonb_typeof(x.plan->'images')='array' THEN jsonb_array_length(x.plan->'images')>0 ELSE false END,false)) ORDER BY x.n)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.raw_data->'building'->'floor_plans')='array' THEN p.raw_data->'building'->'floor_plans' ELSE '[]'::jsonb END) WITH ORDINALITY x(plan,n)),'[]'::jsonb) AS plans
 FROM page p
)
SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]'::jsonb) AS rows FROM inventory i;
COMMIT;
