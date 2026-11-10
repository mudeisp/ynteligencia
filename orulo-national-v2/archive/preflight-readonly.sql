-- Orulo audit archive preflight: READ ONLY. Never delete or mutate.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '45s';
SELECT pg_database_size(current_database()) AS database_bytes;
SELECT n.nspname AS schema_name,c.relname AS table_name,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_indexes_size(c.oid) AS index_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='orulo_audit' AND c.relkind='r'
ORDER BY total_bytes DESC;
SELECT 'entries' AS table_name,run_uuid::text,count(*) AS row_count,
       min(created_at) AS first_seen,max(created_at) AS last_seen,
       sum(pg_column_size(event)+pg_column_size(canonical)) AS payload_bytes
FROM orulo_audit.entries GROUP BY run_uuid
UNION ALL
SELECT 'snapshot_records',run_uuid::text,count(*),NULL,NULL,
       sum(pg_column_size(record))
FROM orulo_audit.snapshot_records GROUP BY run_uuid
ORDER BY table_name,row_count DESC;
SELECT run_uuid::text,kind,count(*) AS snapshot_sets
FROM orulo_audit.snapshot_sets GROUP BY run_uuid,kind ORDER BY run_uuid,kind;
COMMIT;
