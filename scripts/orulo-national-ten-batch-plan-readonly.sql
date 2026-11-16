-- Órulo Nacional V2 — PLANO IMUTÁVEL DE 10 LOTES (READ ONLY).
-- Nenhuma DML, migration, selo ou chamada CAS.
-- Manifesto original: ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288
-- Ledger original congelado: 6240 / a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6
-- Selo de produção: 6241 / 80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f
-- Política: ordenar target.id ASC; atribuir o imóvel inteiro pelo ponto médio
-- de suas ocorrências. 10 lotes, sem dividir um imóvel ou duplicar patches.
-- Este plano NÃO deve ser aplicado contra inventory vivo sem o gate completo.
BEGIN TRANSACTION READ ONLY;
WITH frozen AS (
 SELECT e.event->'target'->>'id' AS target_id,
        e.event->'target'->>'buildingId' AS building_id,
        jsonb_array_length(e.event->'target'->'patches') AS occurrences
 FROM orulo_audit.entries e
 WHERE e.run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
   AND e.kind='NATIONAL_TARGET'
),
totals AS (
 SELECT COUNT(*) AS target_count,SUM(occurrences) AS occurrences,
        COUNT(DISTINCT target_id) AS unique_targets,
        MIN(occurrences) AS minimum_occurrences
 FROM frozen
),
head AS (
 SELECT MAX(sequence) AS sequence,
        MAX(hash) FILTER (WHERE sequence=6240) AS hash,
        MAX(hash) FILTER (WHERE sequence=6241 AND kind='NATIONAL_MANIFEST_SEALED') AS seal_hash,
        COUNT(*) FILTER (WHERE kind='NATIONAL_MANIFEST_SEALED') AS seals,
        COUNT(*) FILTER (WHERE kind='WRITE_AUTHORIZED') AS authorizations,
        COUNT(*) FILTER (WHERE kind='CAS_RESULT') AS cas
 FROM orulo_audit.entries
 WHERE run_uuid='1c8ec62a-9c38-41ac-8091-f1ceef98ca91'::uuid
),
verified AS (
 SELECT t.occurrences AS total_occurrences FROM totals t CROSS JOIN head h
 WHERE t.target_count=5684 AND t.unique_targets=5684
   AND t.occurrences=42893 AND t.minimum_occurrences>0
   AND h.sequence=6241
   AND h.seal_hash='80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f'
   AND h.hash='a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6'
   AND h.seals=1 AND h.authorizations=0 AND h.cas=0
),
ordered AS (
 SELECT f.*,SUM(f.occurrences) OVER (ORDER BY f.target_id ROWS UNBOUNDED PRECEDING)
            -f.occurrences AS before_count
 FROM frozen f
),
assignment AS (
 SELECT LEAST(10,FLOOR(
   (o.before_count+o.occurrences/2.0)*10.0/v.total_occurrences
 )::int+1) AS lot,
 o.target_id,o.building_id,o.occurrences
 FROM ordered o CROSS JOIN verified v
)
SELECT lot,
       COUNT(*)::int AS properties,
       SUM(occurrences)::int AS eligible_occurrences,
       MIN(target_id) AS first_target_id,
       MAX(target_id) AS last_target_id
FROM assignment
GROUP BY lot ORDER BY lot;
COMMIT;
