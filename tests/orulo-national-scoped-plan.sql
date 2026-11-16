\set ON_ERROR_STOP on
CREATE SCHEMA orulo_audit;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE orulo_audit.entries (
 run_uuid uuid NOT NULL, sequence bigint NOT NULL, kind text NOT NULL,
 hash text, event jsonb NOT NULL, PRIMARY KEY(run_uuid,sequence)
);
\ir ../supabase/migrations/20261116120000_orulo_national_scoped_plan.sql

INSERT INTO orulo_audit.entries
SELECT '1c8ec62a-9c38-41ac-8091-f1ceef98ca91', id, 'NATIONAL_TARGET', NULL,
 jsonb_build_object('target',jsonb_build_object(
   'id', '00000000-0000-0000-0000-'||lpad(id::text,12,'0'),
   'patches', (SELECT jsonb_agg(n) FROM generate_series(1,CASE WHEN id<=3105 THEN 8 ELSE 7 END)n)
 ))
FROM generate_series(1,5684) id;
INSERT INTO orulo_audit.entries VALUES (
 '1c8ec62a-9c38-41ac-8091-f1ceef98ca91',6241,'NATIONAL_MANIFEST_SEALED',
 '80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f',
 '{"manifestHash":"ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288"}'
);

DO $test$
DECLARE
  run_id constant uuid := '1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
  first_id constant uuid := '00000000-0000-0000-0000-000000000001';
  last_id constant uuid := '00000000-0000-0000-0000-000000005684';
  sha constant text := repeat('a',40);
  plan jsonb;
  other jsonb;
  lot_ids bigint;
  distinct_ids bigint;
BEGIN
  plan := orulo_audit.national_scoped_plan(run_id,1,ARRAY[first_id],'123',sha);
  IF plan->'targetIds' IS DISTINCT FROM jsonb_build_array(first_id)
     OR plan IS DISTINCT FROM orulo_audit.national_scoped_plan(run_id,1,ARRAY[first_id],'123',sha)
  THEN RAISE EXCEPTION 'PLAN_NOT_DETERMINISTIC'; END IF;
  other := orulo_audit.national_scoped_plan(run_id,1,ARRAY[first_id],'124',sha);
  IF plan->>'planSha256' = other->>'planSha256' THEN
    RAISE EXCEPTION 'PLAN_NOT_BOUND_TO_GITHUB_RUN';
  END IF;
  SELECT count(*),count(DISTINCT id) INTO lot_ids,distinct_ids
  FROM generate_series(1,10) n
  CROSS JOIN LATERAL jsonb_array_elements_text(
    orulo_audit.national_scoped_plan(run_id,n,NULL,'123',sha)->'targetIds'
  ) ids(id);
  IF lot_ids<>5684 OR distinct_ids<>5684 THEN RAISE EXCEPTION 'LOT_PARTITION_INVALID'; END IF;
  BEGIN
    PERFORM orulo_audit.national_scoped_plan(run_id,1,ARRAY[last_id],'123',sha);
    RAISE EXCEPTION 'OUT_OF_LOT_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_SCOPED_TARGET_MISMATCH' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM orulo_audit.national_scoped_plan(run_id,1,ARRAY[first_id,first_id],'123',sha);
    RAISE EXCEPTION 'DUPLICATE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_SCOPED_PLAN_INVALID' THEN RAISE; END IF;
  END;
  IF has_function_privilege('service_role',
    'orulo_audit.national_scoped_plan(uuid,integer,uuid[],text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'PUBLIC_EXECUTION_ALLOWED'; END IF;
  UPDATE orulo_audit.entries SET hash = repeat('0',64) WHERE sequence=6241;
  BEGIN
    PERFORM orulo_audit.national_scoped_plan(run_id,1,ARRAY[first_id],'123',sha);
    RAISE EXCEPTION 'CHANGED_SEAL_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NATIONAL_SCOPED_SEAL_MISMATCH' THEN RAISE; END IF;
  END;
END
$test$;
