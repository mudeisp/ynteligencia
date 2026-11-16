-- Synthetic PostgreSQL fixture. Never point this script at production.
-- Creates an immutable-looking head and 5,684 synthetic targets only for tests.
DO $$BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'TEST_DATABASE_MUST_BE_POSTGRES';
  END IF;
END$$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE orulo_audit_owner NOLOGIN;
CREATE SCHEMA orulo_audit;
GRANT USAGE ON SCHEMA orulo_audit TO orulo_audit_owner, service_role;

CREATE TABLE orulo_audit.runs (run_uuid uuid PRIMARY KEY);
CREATE TABLE orulo_audit.entries (
 run_uuid uuid NOT NULL REFERENCES orulo_audit.runs(run_uuid),
 sequence bigint NOT NULL, kind text NOT NULL,
 event jsonb NOT NULL, hash text NOT NULL,
 PRIMARY KEY (run_uuid,sequence)
);
GRANT SELECT ON orulo_audit.runs,orulo_audit.entries TO orulo_audit_owner;
CREATE FUNCTION orulo_audit.require_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF session_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'SERVICE_REQUIRED'; END IF; END
$$;
CREATE FUNCTION orulo_audit.lock_run(r uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(r::text,0));
 PERFORM 1 FROM orulo_audit.runs WHERE run_uuid=r FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RUN_NOT_FOUND'; END IF;
END$$;
GRANT EXECUTE ON FUNCTION orulo_audit.require_service() TO orulo_audit_owner;
GRANT EXECUTE ON FUNCTION orulo_audit.lock_run(uuid) TO orulo_audit_owner;
INSERT INTO orulo_audit.runs VALUES ('1c8ec62a-9c38-41ac-8091-f1ceef98ca91');

INSERT INTO orulo_audit.entries(run_uuid,sequence,kind,event,hash)
SELECT '1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid, n,
  CASE WHEN n=1 THEN 'START' WHEN n<=556 THEN 'NATIONAL_MANIFEST_PART'
       ELSE 'NATIONAL_TARGET' END,
  CASE WHEN n<=556 THEN '{}'::jsonb ELSE
    jsonb_build_object('target',jsonb_build_object(
      'id', substring(md5(n::text),1,8)||'-'||substring(md5(n::text),9,4)||'-'||
            substring(md5(n::text),13,4)||'-'||substring(md5(n::text),17,4)||'-'||
            substring(md5(n::text),21,12),
      'buildingId', (n-556)::text, 'patches','[]'::jsonb
    )) END,
  CASE WHEN n=6240 THEN
    'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6'
       ELSE repeat('0',64) END
FROM generate_series(1,6240) AS x(n);

DO $$BEGIN
  IF (SELECT count(*) FROM orulo_audit.entries WHERE kind='NATIONAL_TARGET')<>5684
   OR (SELECT count(*) FROM orulo_audit.entries WHERE kind='NATIONAL_MANIFEST_PART')<>555
  THEN RAISE EXCEPTION 'FIXTURE_INCOMPLETE'; END IF;
END$$;
