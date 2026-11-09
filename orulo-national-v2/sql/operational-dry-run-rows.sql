-- Execute ONLY in the separately authorized operational environment.
-- Substitute __AFTER__ (UUID) and __LIMIT__ (integer, e.g. 100).
-- Read-only export for local simulation, NOT a production CAS baseline.
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';
WITH page AS (
 SELECT p.* FROM public.properties p
 WHERE source='novos' AND external_id LIKE 'orulo:%'
 AND id > '__AFTER__'::uuid ORDER BY id LIMIT __LIMIT__
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,
 'recordCanonical',to_jsonb(p)::text,
 'recordSha256',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')
) ORDER BY p.id),'[]'::jsonb) AS rows FROM page p;
COMMIT;
