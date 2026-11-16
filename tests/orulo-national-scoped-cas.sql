\set ON_ERROR_STOP on
\set run '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'
\set pilot '000a4d50-a014-4270-bb89-26adb841f142'
\set op 'a1c3e9b0-5121-44f2-9e13-d731e9096201'

-- Remove only the synthetic rejected INTENT from the preceding negative test.
DELETE FROM orulo_audit.entries WHERE sequence=6244 AND kind='INTENT';
ALTER TABLE orulo_audit.entries ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_current_xact_id();
INSERT INTO public.properties VALUES (:'pilot',
  '{"building_id":"30701","building":{"floor_plans":[{"id":"1","images":[]}]}}',
  'novos','orulo:30701:49924','2026-11-01 UTC','2026-11-02 UTC',123450);

-- The pilot has four plans. Compensate the synthetic occurrence count on
-- another frozen target, keeping the deterministic national total unchanged.
UPDATE orulo_audit.entries e SET event=jsonb_set(e.event,'{target,patches}',
  (e.event->'target'->'patches')||'[0,0,0,0]'::jsonb)
WHERE e.sequence=5684;
UPDATE public.properties SET raw_data=jsonb_set(raw_data,'{building,floor_plans}',
  (SELECT jsonb_agg(jsonb_build_object('id',i::text,'images','[]'::jsonb) ORDER BY i) FROM generate_series(1,4) i))
WHERE id=:'pilot';
WITH image AS (
 SELECT 'https://static.orulo.com.br/images/properties/large/1.jpg' AS url
), patches AS (
 SELECT jsonb_agg(jsonb_build_object('id',i::text,'validation','SOURCE_IMAGE_VALID','sourceChunk',0,
   'sourceResultSha256',repeat('a',64),'images',jsonb_build_array(url),
   'checks',jsonb_build_array(jsonb_build_object('url',url,'evidenceSha256',repeat('b',64),
     'evidence',jsonb_build_object('url',url,'status','VALIDATED_PREFIX','prefixSha256',repeat('c',64)))))
     ORDER BY i) AS body FROM image CROSS JOIN generate_series(1,4) i
)
UPDATE orulo_audit.entries e SET event=jsonb_build_object('target',
  (e.event->'target')||jsonb_build_object('buildingId','30701','baselineSha256',
    encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),'patches',patches.body))
FROM public.properties p CROSS JOIN patches
WHERE e.sequence=1 AND p.id=:'pilot';

ALTER FUNCTION orulo_audit.national_policy(jsonb) OWNER TO orulo_audit_owner;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_read ON public.properties FOR SELECT TO orulo_audit_owner USING (true);
CREATE POLICY fixture_scoped_update ON public.properties FOR UPDATE TO orulo_audit_owner
  USING (orulo_audit.national_policy(to_jsonb(properties)))
  WITH CHECK (orulo_audit.national_policy(to_jsonb(properties)));
SET ROLE orulo_audit_owner;
UPDATE orulo_audit.entries SET event=event||jsonb_build_object('columns',orulo_audit.columns_v2())
WHERE sequence=6241 AND kind='NATIONAL_MANIFEST_SEALED';
RESET ROLE;
GRANT SELECT ON orulo_audit.entries TO service_role;
GRANT SELECT ON public.properties TO service_role;
CREATE POLICY fixture_service_read ON public.properties FOR SELECT TO service_role USING (true);

SELECT orulo_audit.national_scoped_plan(:'run',1,ARRAY[:'pilot'::uuid],'9001',repeat('a',40))->>'planSha256' AS plan \gset
SELECT hash AS head FROM orulo_audit.entries ORDER BY sequence DESC LIMIT 1 \gset
SELECT orulo_audit.authorize_national_scope(:'run',1,ARRAY[:'pilot'::uuid],'9001',repeat('a',40),:'plan',:'head',10)->>'eventUuid' AS lease \gset
SELECT jsonb_build_object('authorizationId',:'lease','lot',1,'githubRunId','9001','controlSha',repeat('a',40),'planSha256',:'plan') AS scope \gset
SET ROLE service_role;
SELECT set_config('test.scope',:'scope',false);
SELECT set_config('test.run',:'run',false);
SELECT set_config('test.id',:'pilot',false);
SELECT set_config('test.op',:'op',false);

DO $test$
DECLARE
  r uuid:=current_setting('test.run')::uuid;
  id uuid:=current_setting('test.id')::uuid;
  op uuid:=current_setting('test.op')::uuid;
  context jsonb:=current_setting('test.scope')::jsonb;
  event jsonb;
  seq bigint;
  head text;
  action text;
  expected jsonb;
  patches jsonb;
BEGIN
  SELECT sequence,hash INTO seq,head FROM orulo_audit.entries WHERE run_uuid=r ORDER BY sequence DESC LIMIT 1;
  FOREACH action IN ARRAY ARRAY['snapshot_begin','snapshot_page','snapshot_seal'] LOOP
    event:=orulo_audit.national_control(action,r,seq+1,head,
      jsonb_build_object('kind','BASELINE_V2','scope',context,'id',id,'offset',0,'eventUuid',gen_random_uuid()));
    seq:=(event->>'sequence')::bigint; head:=event->>'hash';
  END LOOP;
  SELECT to_jsonb(p) INTO expected FROM public.properties p WHERE p.id=current_setting('test.id')::uuid;
  SELECT e.event->'target'->'patches' INTO patches FROM orulo_audit.entries e WHERE e.run_uuid=r AND e.sequence=1;
  PERFORM orulo_audit.national_control('append',r,seq+1,head,jsonb_build_object(
    'type','INTENT','eventUuid',gen_random_uuid(),'operationId',op,'id',id,'scope',context,
    'expected',expected,'desiredPlans',
    (SELECT jsonb_agg(jsonb_build_object('id',p->>'id','images',p->'images') ORDER BY (p->>'id')::int)
       FROM jsonb_array_elements(patches) p)));
END;
$test$;

-- The scoped route must reject an external commercial update that races after
-- a durable INTENT and after the authorization's frozen baseline. This models
-- another writer committing before the CAS locks the row. The guard must not
-- issue a CAS_RESULT, alter price back, or partially populate any image.
RESET ROLE;
UPDATE public.properties SET price=123451
WHERE id=:'pilot';
SET ROLE service_role;
DO $test$
BEGIN
  BEGIN
    PERFORM orulo_audit.national_cas(
      current_setting('test.run')::uuid,current_setting('test.op')::uuid);
    RAISE EXCEPTION 'SCOPED_EXTERNAL_UPDATE_WAS_OVERWRITTEN';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('NATIONAL_FROZEN_TARGET_DIVERGENCE','NATIONAL_SCOPED_SNAPSHOT_ROW_MISMATCH')
    THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM orulo_audit.entries
             WHERE operation_uuid=current_setting('test.op')::uuid AND kind='CAS_RESULT')
    OR (SELECT price FROM public.properties
        WHERE id=current_setting('test.id')::uuid) <> 123451
    OR EXISTS (SELECT 1 FROM public.properties p
      CROSS JOIN LATERAL jsonb_array_elements(p.raw_data#>'{building,floor_plans}') plan
      WHERE p.id=current_setting('test.id')::uuid AND plan->'images'<>'[]'::jsonb)
  THEN RAISE EXCEPTION 'SCOPED_EXTERNAL_UPDATE_NOT_ATOMIC'; END IF;
  RAISE NOTICE 'SCOPED_EXTERNAL_UPDATE_REJECTED';
END;
$test$;
RESET ROLE;
-- Only the disposable test fixture restores its synthetic price; no production
-- writer may repair a divergent frozen row this way.
UPDATE public.properties SET price=123450 WHERE id=:'pilot';
SET ROLE service_role;

-- Real two-connection race in disposable PostgreSQL: the external writer
-- commits while scoped CAS is waiting for its property row lock.
-- The shell test must leave an explicit database marker; a shell failure
-- alone is not treated as a passing psql meta-command.
\! bash tests/orulo-national-scoped-concurrency.sh
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM orulo_audit.scoped_race_fixture_passed WHERE ok)=0
 THEN RAISE EXCEPTION 'SCOPED_TWO_SESSION_RACE_NOT_VERIFIED'; END IF;
END;
$test$;
SET ROLE service_role;

-- The attempted property update and its receipt must roll back together.
BEGIN;
DO $test$
DECLARE
  result jsonb;
BEGIN
  result:=orulo_audit.national_cas(
    current_setting('test.run')::uuid,current_setting('test.op')::uuid);
  IF result->>'status' IS DISTINCT FROM 'UPDATED' THEN
    RAISE EXCEPTION 'SCOPED_ROLLBACK_CAS_DID_NOT_UPDATE';
  END IF;
END;
$test$;
ROLLBACK;

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM orulo_audit.entries
         WHERE operation_uuid=current_setting('test.op')::uuid AND kind='CAS_RESULT')
    OR EXISTS (
      SELECT 1 FROM public.properties p
      CROSS JOIN LATERAL jsonb_array_elements(p.raw_data#>'{building,floor_plans}') plan
      WHERE p.id=current_setting('test.id')::uuid AND plan->'images'<>'[]'::jsonb
    )
  THEN RAISE EXCEPTION 'SCOPED_CAS_ROLLBACK_NOT_ATOMIC'; END IF;
END;
$test$;

-- Separate transactions prove the INTENT is durable before the real CAS.
DO $test$
DECLARE
  r uuid:=current_setting('test.run')::uuid;
  op uuid:=current_setting('test.op')::uuid;
  result jsonb;
BEGIN
  result:=orulo_audit.national_cas(r,op);
  IF result->>'status' IS DISTINCT FROM 'UPDATED' OR result->'receipt'->>'verified' IS DISTINCT FROM 'true'
    OR result->'row'->>'price' IS DISTINCT FROM '123450'
    OR (SELECT count(*) FROM jsonb_array_elements(result->'row'->'raw_data'#>'{building,floor_plans}') p
        WHERE p->'images'='["https://static.orulo.com.br/images/properties/large/1.jpg"]'::jsonb)<>4
    OR NOT EXISTS(SELECT 1 FROM orulo_audit.entries e WHERE e.run_uuid=r AND e.operation_uuid=op
      AND e.kind='CAS_RESULT' AND e.hash=encode(sha256(convert_to(e.canonical,'UTF8')),'hex'))
  THEN RAISE EXCEPTION 'SCOPED_CAS_RECEIPT_INVALID'; END IF;
  RAISE NOTICE 'SCOPED_CAS_UPDATED';
END;
$test$;
-- Simulate a lost network response AFTER the previous CAS committed:
-- the caller receives no result, but a fresh database lookup locates the
-- durable CAS_RESULT and verifies the exact live hash. It must NOT retry CAS.
DO $test$
DECLARE
  r uuid:=current_setting('test.run')::uuid;
  id uuid:=current_setting('test.id')::uuid;
  op uuid:=current_setting('test.op')::uuid;
  seen jsonb;
BEGIN
  seen:=orulo_audit.national_control('national_row',r,0,'',
    jsonb_build_object('id',id));
  IF seen->'result'->>'operationId' IS DISTINCT FROM op::text
     OR seen->'result'->'result'->>'status' IS DISTINCT FROM 'UPDATED'
     OR seen->'result'->'result'->'receipt'->>'afterSha256' IS DISTINCT FROM seen->>'sha256'
     OR (SELECT count(*) FROM orulo_audit.entries
       WHERE run_uuid=r AND operation_uuid=op AND kind='CAS_RESULT')<>1
     OR EXISTS (SELECT 1 FROM orulo_audit.entries
       WHERE run_uuid=r AND operation_uuid=op AND kind='CLIENT_READBACK')
  THEN RAISE EXCEPTION 'SCOPED_LOST_RESPONSE_UNRECOVERABLE'; END IF;
  RAISE NOTICE 'SCOPED_LOST_RESPONSE_RECOVERED_FROM_LEDGER';
END;
$test$;

DO $test$
DECLARE
  r uuid:=current_setting('test.run')::uuid;
  id uuid:=current_setting('test.id')::uuid;
  op uuid:=current_setting('test.op')::uuid;
  context jsonb:=current_setting('test.scope')::jsonb;
  ack jsonb;
  seq bigint;
  head text;
  action text;
  sha text;
BEGIN
  SELECT sequence,hash INTO seq,head FROM orulo_audit.entries WHERE run_uuid=r ORDER BY sequence DESC LIMIT 1;
  SELECT event->'result'->'receipt'->>'afterSha256' INTO sha FROM orulo_audit.entries
    WHERE run_uuid=r AND operation_uuid=op AND kind='CAS_RESULT';
  ack:=orulo_audit.national_control('append',r,seq+1,head,jsonb_build_object(
    'type','CLIENT_READBACK','eventUuid',gen_random_uuid(),'stage','NATIONAL_ROW_VERIFIED',
    'id',id,'operationId',op,'sha256',sha
  ));
  seq:=(ack->>'sequence')::bigint; head:=ack->>'hash';
  FOREACH action IN ARRAY ARRAY['snapshot_begin','snapshot_page','snapshot_seal'] LOOP
    ack:=orulo_audit.national_control(action,r,seq+1,head,
      jsonb_build_object('kind','READBACK_V2','scope',context,'id',id,'offset',0,'eventUuid',gen_random_uuid()));
    seq:=(ack->>'sequence')::bigint; head:=ack->>'hash';
  END LOOP;
  ack:=orulo_audit.national_control('national_scope_finish',r,seq+1,head,
    jsonb_build_object('scope',context,'id',id,'eventUuid',gen_random_uuid()));
  IF NOT EXISTS (
    SELECT 1 FROM orulo_audit.entries WHERE run_uuid=r AND sequence=(ack->>'sequence')::bigint
      AND kind='NATIONAL_SCOPE_FINISHED' AND event->'counts'='{"UPDATED":1}'
  ) THEN RAISE EXCEPTION 'SCOPED_FINISH_INVALID'; END IF;
END;
$test$;
RESET ROLE;

-- A completed authorization must not accept further mutations. Existing CAS
-- evidence stays available and a separate lot can open its own capture.
SET ROLE service_role;
DO $test$
BEGIN
  BEGIN
    PERFORM orulo_audit.national_cas(current_setting('test.run')::uuid,current_setting('test.op')::uuid);
    RAISE EXCEPTION 'SCOPED_REPLAY_UNEXPECTEDLY_SUCCEEDED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_SCOPE_ALREADY_FINISHED' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM orulo_audit.entries
      WHERE operation_uuid=current_setting('test.op')::uuid AND kind='CAS_RESULT')<>1
  THEN RAISE EXCEPTION 'SCOPED_REPLAY_DUPLICATED_RECEIPT'; END IF;
END;
$test$;
RESET ROLE;

SELECT orulo_audit.national_scoped_plan(:'run',2,NULL,'9002',repeat('a',40)) AS next_plan \gset
SELECT hash AS next_head FROM orulo_audit.entries ORDER BY sequence DESC LIMIT 1 \gset
SELECT orulo_audit.authorize_national_scope(:'run',2,NULL,'9002',repeat('a',40),
  :'next_plan'::jsonb->>'planSha256',:'next_head',10)->>'eventUuid' AS next_lease \gset
SELECT jsonb_build_object('authorizationId',:'next_lease','lot',2,'githubRunId','9002',
  'controlSha',repeat('a',40),'planSha256',:'next_plan'::jsonb->>'planSha256') AS next_scope \gset
SELECT :'next_plan'::jsonb->'targetIds'->>0 AS next_target \gset
SELECT sequence+1 AS next_sequence,hash AS next_hash FROM orulo_audit.entries ORDER BY sequence DESC LIMIT 1 \gset
SET ROLE service_role;
SELECT orulo_audit.national_control('snapshot_begin',:'run',:'next_sequence',:'next_hash',
  jsonb_build_object('kind','BASELINE_V2','scope',:'next_scope'::jsonb,'id',:'next_target','eventUuid',gen_random_uuid()));
RESET ROLE;
DO $test$
BEGIN
  IF (SELECT count(*) FROM orulo_audit.snapshot_sets WHERE kind LIKE 'BASELINE_V2:%')<>2
  THEN RAISE EXCEPTION 'SCOPED_BASELINE_REUSED_ACROSS_LEASES'; END IF;
  RAISE NOTICE 'SCOPED_NEXT_LOT_ISOLATED';
END;
$test$;
