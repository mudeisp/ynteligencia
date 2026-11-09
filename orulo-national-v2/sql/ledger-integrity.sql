BEGIN READ ONLY;
WITH e AS (
 SELECT *, lag(hash,1,'') OVER(PARTITION BY run_uuid ORDER BY sequence) prev,
 row_number() OVER(PARTITION BY run_uuid ORDER BY sequence) n
 FROM orulo_audit.entries
)
SELECT (SELECT count(*) FROM orulo_audit.runs) runs, count(*) entries,
 count(*) FILTER(WHERE hash<>encode(sha256(convert_to(canonical,'UTF8')),'hex')) invalid_hashes,
 count(*) FILTER(WHERE previous_hash<>prev OR sequence<>n) chain_breaks,
 count(*) FILTER(WHERE canonical::jsonb->'event' IS DISTINCT FROM event OR canonical::jsonb->>'previousHash' IS DISTINCT FROM previous_hash) canonical_divergences,
 count(*) FILTER(WHERE kind='INTENT' AND NOT EXISTS(
 SELECT 1 FROM e z WHERE z.run_uuid=e.run_uuid AND z.kind='CAS_RESULT' AND z.operation_uuid=e.operation_uuid)) unresolved_intents,
 max(created_at) latest_event FROM e;
COMMIT;
