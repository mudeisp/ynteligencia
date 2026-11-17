-- CAS2 scoped reconciliation — production READ ONLY.
-- Operation: 1c8ec62a-9c38-41ac-8091-f1ceef98ca91
-- Lease: 83a3abe5-f676-4d33-b21a-c8ed14fc61ed
-- Run: 44067652525; frozen lot 2; 574 authorized UUIDs.
-- Deliberately contains no INSERT, UPDATE, DELETE, DDL or administrative RPC.
-- Run each SELECT separately if the SQL Editor imposes execution deadlines.

-- 1. Verify authorization, scope and finish status.
WITH authorized AS (
  SELECT event
  FROM orulo_audit.entries
  WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
    AND kind='NATIONAL_SCOPE_AUTHORIZED'
    AND event->>'githubRunId'='44067652525'
), run_entries AS (
  SELECT kind,event,operation_uuid
  FROM orulo_audit.entries
  WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
)
SELECT
 (SELECT jsonb_array_length(event->'targetIds') FROM authorized) authorized_properties,
 (SELECT count(*) FROM run_entries WHERE kind='INTENT' AND event->'scope'->>'authorizationId'='83a3abe5-f676-4d33-b21a-c8ed14fc61ed') intents,
 (SELECT count(*) FROM run_entries c WHERE c.kind='CAS_RESULT' AND EXISTS(
    SELECT 1 FROM run_entries i WHERE i.kind='INTENT' AND i.operation_uuid=c.operation_uuid
     AND i.event->'scope'->>'authorizationId'='83a3abe5-f676-4d33-b21a-c8ed14fc61ed'
   )) cas_results,
 (SELECT count(*) FROM run_entries i WHERE i.kind='INTENT'
    AND NOT EXISTS (SELECT 1 FROM run_entries c WHERE c.kind='CAS_RESULT' AND c.operation_uuid=i.operation_uuid)
   ) unresolved_intents,
 (SELECT count(*) FROM run_entries WHERE kind='NATIONAL_SCOPE_FINISHED'
    AND event->>'authorizationId'='83a3abe5-f676-4d33-b21a-c8ed14fc61ed') finished_events,
 (SELECT count(*) FROM run_entries WHERE kind='NATIONAL_SCOPE_PARTIAL_RECONCILED'
    AND event->>'authorizationId'='83a3abe5-f676-4d33-b21a-c8ed14fc61ed') partial_reconciliation_events;

-- 2. Compare the scoped, sealed baseline/readback snapshots.
WITH baseline AS (
 SELECT id,record FROM orulo_audit.snapshot_records
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND kind='BASELINE_V2:83a3abe5-f676-4d33-b21a-c8ed14fc61ed'
), readback AS (
 SELECT id,record FROM orulo_audit.snapshot_records
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND kind='READBACK_V2:83a3abe5-f676-4d33-b21a-c8ed14fc61ed'
), scope AS (
 SELECT event->'targetIds' ids FROM orulo_audit.entries
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
   AND kind='NATIONAL_SCOPE_AUTHORIZED'
   AND event->>'githubRunId'='44067652525'
)
SELECT
 (SELECT count(*) FROM baseline) baseline_rows,
 (SELECT count(*) FROM readback) readback_rows,
 count(*) FILTER(WHERE baseline.record IS DISTINCT FROM readback.record) changed_rows,
 count(*) FILTER(WHERE baseline.record IS DISTINCT FROM readback.record
   AND (SELECT ids FROM scope) ? coalesce(baseline.id,readback.id)::text) in_scope_changes,
 count(*) FILTER(WHERE baseline.record IS DISTINCT FROM readback.record
   AND NOT ((SELECT ids FROM scope) ? coalesce(baseline.id,readback.id)::text)) outside_scope_changes
FROM baseline FULL JOIN readback USING(id);

-- 3. Re-check current images against exact intended arrays for the 349 CAS writes.
WITH i AS (
 SELECT (event->>'id')::uuid id,event->'desiredPlans' desired
 FROM orulo_audit.entries
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND kind='INTENT'
 AND event->'scope'->>'authorizationId'='83a3abe5-f676-4d33-b21a-c8ed14fc61ed'
)
SELECT count(*) checked,
 count(*) FILTER (WHERE p.raw_data#>'{building,floor_plans}'=i.desired) exact_match,
 count(*) FILTER (WHERE p.raw_data#>'{building,floor_plans}' IS DISTINCT FROM i.desired) mismatch
FROM i JOIN public.properties p ON p.id=i.id;

-- 4. Classify unprocessed targets by image equality with the frozen manifest.
-- 'already_complete' means ALL targeted plan image arrays match.
-- 'not_matching' requires separate eligibility/baseline review; never blind retry.
WITH auth AS (
 SELECT event->'targetIds' ids FROM orulo_audit.entries
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND kind='NATIONAL_SCOPE_AUTHORIZED'
 AND event->>'githubRunId'='44067652525'
), todo AS (
 SELECT v.id
 FROM auth CROSS JOIN LATERAL jsonb_array_elements_text(auth.ids) AS v(id)
 WHERE NOT EXISTS (
 SELECT 1 FROM orulo_audit.entries i
 WHERE i.run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND i.kind='INTENT' AND i.event->>'id'=v.id
 AND i.event->'scope'->>'authorizationId'='83a3abe5-f676-4d33-b21a-c8ed14fc61ed'
 )
), targets AS (
 SELECT todo.id,p.raw_data#>'{building,floor_plans}' plans,
   e.event->'target'->'patches' patches
 FROM todo JOIN public.properties p ON p.id=todo.id::uuid
 JOIN orulo_audit.entries e ON
   e.run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
   AND e.kind='NATIONAL_TARGET' AND e.event->'target'->>'id'=todo.id
), classified AS (
 SELECT id,
  (SELECT count(*) FROM jsonb_array_elements(patches) patch) n,
  (SELECT count(*) FROM jsonb_array_elements(patches) patch
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(plans) current_plan
      WHERE current_plan->>'id'=patch->>'id'
      AND current_plan->'images'=patch->'images')) matching
 FROM targets
)
SELECT count(*) unprocessed,
 count(*) FILTER(WHERE matching=n) already_complete,
 count(*) FILTER(WHERE matching>0 AND matching<n) partially_matching,
 count(*) FILTER(WHERE matching=0) not_matching,
 sum(n-matching) unmatched_plan_occurrences
FROM classified;

-- 5. Identify non-CAS snapshot drift without asserting its cause.
WITH b AS (
 SELECT id,record FROM orulo_audit.snapshot_records
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND kind='BASELINE_V2:83a3abe5-f676-4d33-b21a-c8ed14fc61ed'
), a AS (
 SELECT id,record FROM orulo_audit.snapshot_records
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND kind='READBACK_V2:83a3abe5-f676-4d33-b21a-c8ed14fc61ed'
), auth AS (
 SELECT event->'targetIds' ids FROM orulo_audit.entries
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
 AND kind='NATIONAL_SCOPE_AUTHORIZED' AND event->>'githubRunId'='44067652525'
)
SELECT coalesce(b.id,a.id) property_id,
 b.record->>1 external_id,b.record->>4 before_hash,a.record->>4 after_hash
FROM b FULL JOIN a USING(id)
WHERE b.record IS DISTINCT FROM a.record
 AND NOT ((SELECT ids FROM auth) ? coalesce(b.id,a.id)::text)
ORDER BY property_id;

-- No statement above closes a scope, renews a lease or writes images.
