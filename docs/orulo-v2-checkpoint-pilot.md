# Órulo National V2 — checkpoint pilot (read-only)

This remains V2. The original frozen manifest, source queue, and CAS guard are not changed.

## Confirmed evidence loss
GitHub Actions run 42693046648 completed 2,667 source buildings and 44,736 CDN requests, but uploaded **no artifact**. Its runner-local results cannot be reconstructed from the summary logs. This PR cannot recover them.

## Pilot
1. Review this PR; ensure no source data is published unencrypted.
2. Configure GitHub Actions secret `ORULO_V2_EVIDENCE_CERT_B64`: base64 of an approved X.509 **public certificate**, with the corresponding private key held securely outside GitHub. Never commit or print the private key.
3. Merge only after reviewing the workflow, source scope and evidence-handling policy. The workflow dispatch is restricted to main, the repository owner, and first attempt.
4. Dispatch **Orulo National V2 - persistent source checkpoints** with `chunk=0` only. The source queue is partitioned into 27 fixed, non-overlapping chunks (0–26), each at most 100 buildings.
5. Verify the artifact `orulo-v2-source-chunk-0-<run_id>` contains `source.cms` and `source.cms.sha256`. Check the SHA-256 and decrypt **offline** using the authorized private key. Inspect index.json, per-building result hashes, CDN evidence and incident counts.
6. Do not dispatch remaining chunks until the pilot is independently validated.

## Limitations and safety
- Each invocation runs exactly one chunk, not the entire country.
- **This is checkpoint persistence, not automatic resume**. A separate tested restore/decrypt step is needed to resume partial chunks; until then, a restarted chunk would re-query its buildings.
- The existing 1,886 changed-hash properties must remain ineligible for CAS. The 52 new IDs are out of frozen V2 scope. The V2 simulator is not yet updated to filter the 16,036 unchanged hashes.
- The job makes no Supabase requests or production writes.
- Encrypted artifacts have 30-day retention. Archive approved evidence in controlled storage before expiration.
- Source evidence may contain URLs or sensitive source metadata. Never upload raw evidence to a public repository or unencrypted GitHub artifacts.
