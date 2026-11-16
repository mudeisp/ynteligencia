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

WITH image AS (
 SELECT 'https://static.orulo.com.br/images/properties/large/1.jpg' AS url
), patch AS (
 SELECT jsonb_build_object('id','1','validation','SOURCE_IMAGE_VALID','sourceChunk',0,
   'sourceResultSha256',repeat('a',64),'images',jsonb_build_array(url),
   'checks',jsonb_build_array(jsonb_build_object('url',url,'evidenceSha256',repeat('b',64),
     'evidence',jsonb_build_object('url',url,'status','VALIDATED_PREFIX','prefixSha256',repeat('c',64))))) AS body FROM image
)
UPDATE orulo_audit.entries e SET event=jsonb_build_object('target',
  (e.event->'target')||jsonb_build_object('buildingId','30701','baselineSha256',
    encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),
    'patches',jsonb_build_array(patch.body)||(e.event->'target'->'patches'-0)))
FROM public.properties p CROSS JOIN patch
WHERE e.sequence=1 AND p.id=:'pilot';

-- Keep the frozen fixture's occurrence counts while exercising one real plan:
-- register the remaining seven synthetic plans and valid distinct patches.
UPDATE public.properties SET raw_data=jsonb_set(raw_data,'{building,floor_plans}',
  (SELECT jsonb_agg(jsonb_build_object('id',i::text,'images','[]'::jsonb) ORDER BY i) FROM generate_series(1,8) i))
WHERE id=:'pilot';
UPDATE orulo_audit.entries e SET event=jsonb_build_object('target',
  (e.event->'target')||jsonb_build_object(
    'baselineSha256',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),
    'patches',(SELECT jsonb_agg((e.event->'target'->'patches'->0)||jsonb_build_object('id',i::text) ORDER BY i)
      FROM generate_series(1,8) i)))
FROM public.properties p WHERE e.sequence=1 AND p.id=:'pilot';

ALTER FUNCTION orulo_audit.national_policy(jsonb) OWNER TO orulo_audit_owner;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_read ON public.properties FOR SELECT TO orulo_audit_owner USING (true);
CREATE POLICY fixture_scoped_update ON public.properties FOR UPDATE TO orulo_audit_owner
  USING (orulo_audit.national_policy(to_jsonb(properties)))
  WITH CHECK (orulo_audit.national_policy(to_jsonb(properties)));
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
    OR NOT EXISTS(SELECT 1 FROM orulo_audit.entries e WHERE e.run_uuid=r AND e.operation_uuid=op
      AND e.kind='CAS_RESULT' AND e.hash=encode(sha256(convert_to(e.canonical,'UTF8')),'hex'))
  THEN RAISE EXCEPTION 'SCOPED_CAS_RECEIPT_INVALID'; END IF;
  RAISE NOTICE 'SCOPED_CAS_UPDATED';
END;
$test$;
RESET ROLE;
