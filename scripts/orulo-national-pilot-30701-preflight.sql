-- Órulo national, candidate PILOT 30701: production READ ONLY preflight.
-- This file does not authorize writes or issue CAS. It cannot be used as an approval.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='12s';
SET LOCAL work_mem='4MB';

WITH ledger AS (
 SELECT MAX(e.sequence) AS head,
        MAX(e.hash) FILTER(WHERE e.sequence=6241) AS seal_hash,
        COUNT(*) FILTER(WHERE e.kind='NATIONAL_MANIFEST_SEALED') AS seals,
        COUNT(*) FILTER(WHERE e.kind IN ('WRITE_AUTHORIZED','INTENT','CAS_RESULT')) AS write_events
 FROM orulo_audit.entries e
 WHERE e.run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
), frozen AS (
 SELECT e.event->'target' AS target
 FROM orulo_audit.entries e
 WHERE e.run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND e.kind='NATIONAL_TARGET'
 AND e.event->'target'->>'id'='000a4d50-a014-4270-bb89-26adb841f142'
), checked AS (
 SELECT p.id, t.target, p.raw_data,
        encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS current_sha,
        p.source, p.external_id
 FROM frozen t JOIN public.properties p
 ON p.id=(t.target->>'id')::uuid
), patch_counts AS (
 SELECT c.id,
 COUNT(*) AS expected,
 COUNT(*) FILTER(WHERE floor.plan IS NULL) AS missing_plans,
 COUNT(*) FILTER(WHERE floor.plan IS NOT NULL
  AND COALESCE(floor.plan->'images','[]'::jsonb)='[]'::jsonb) AS empty_plans,
 COUNT(*) FILTER(WHERE floor.plan IS NOT NULL
  AND COALESCE(floor.plan->'images','[]'::jsonb)<>'[]'::jsonb) AS populated_plans,
 COUNT(*) FILTER(WHERE jsonb_typeof(p.patch->'images') IS DISTINCT FROM 'array'
  OR jsonb_array_length(COALESCE(p.patch->'images','[]'::jsonb))=0) AS invalid_desired
 FROM checked c
 CROSS JOIN LATERAL jsonb_array_elements(c.target->'patches') AS p(patch)
 LEFT JOIN LATERAL (
  SELECT f.plan
  FROM jsonb_array_elements(COALESCE(c.raw_data#>'{building,floor_plans}','[]'::jsonb)) AS f(plan)
  WHERE f.plan->>'id'=p.patch->>'id'
  LIMIT 1
 ) floor ON TRUE
 GROUP BY c.id
)
SELECT
 l.head=6241 AND
 l.seal_hash='80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f' AND
 l.seals=1 AND l.write_events=0 AND
 c.current_sha=c.target->>'baselineSha256' AND
 c.current_sha='ca042e5572ce2421400b4f95e572b4802bf1966f837395103776521963e7e4d6' AND
 c.source='novos' AND
 c.target->>'buildingId'='30701' AND
 c.external_id LIKE 'orulo:30701:%' AND
 p.expected=4 AND p.missing_plans=0 AND p.empty_plans=4 AND
 p.populated_plans=0 AND p.invalid_desired=0 AS eligible,
 COALESCE(l.head,0) AS ledger_head,
 COALESCE(p.expected,0) AS expected_plans,
 COALESCE(p.empty_plans,0) AS empty_plans,
 COALESCE(p.missing_plans,0) AS missing_plans,
 COALESCE(p.populated_plans,0) AS populated_plans,
 COALESCE(p.invalid_desired,0) AS invalid_desired
FROM ledger l
LEFT JOIN checked c ON TRUE
LEFT JOIN patch_counts p ON p.id=c.id;
COMMIT;
