BEGIN READ ONLY; SET LOCAL statement_timeout='30s';
WITH f AS (SELECT p.oid::regprocedure::text AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p WHERE p.prokind='f' AND (p.pronamespace='orulo_audit'::regnamespace OR (p.pronamespace='public'::regnamespace AND p.proname LIKE 'orulo%'))),
ops AS (SELECT run_uuid,operation_uuid,bool_or(kind='INTENT') AS intent,bool_or(kind='CAS_RESULT') AS result FROM orulo_audit.entries WHERE operation_uuid IS NOT NULL GROUP BY run_uuid,operation_uuid)
SELECT r.run_uuid,
(SELECT jsonb_agg(f.name) FROM f WHERE strpos(f.definition,r.run_uuid::text)>0) AS functions_with_literal_run_reference,
(SELECT count(*) FROM ops WHERE ops.run_uuid=r.run_uuid AND intent AND NOT result) AS intents_without_result,
(SELECT count(*) FROM orulo_audit.entries e WHERE e.run_uuid=r.run_uuid AND e.kind='WRITE_AUTHORIZED') AS authorizations,
(SELECT e.kind FROM orulo_audit.entries e WHERE e.run_uuid=r.run_uuid ORDER BY sequence DESC LIMIT 1) AS terminal_kind
FROM orulo_audit.runs r ORDER BY r.run_uuid; COMMIT;
