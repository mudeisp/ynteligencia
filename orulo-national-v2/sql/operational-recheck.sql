BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT jsonb_build_object(
 'observed_at',clock_timestamp(),
 'properties',count(*),
 'inventory_sha256',encode(sha256(convert_to(string_agg(
 id::text||':'||encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),
 E'\n' ORDER BY id),'UTF8')),'hex')
) AS recheck FROM public.properties p WHERE source='novos' AND external_id LIKE 'orulo:%';
COMMIT;
