# Órulo national read-only dry run V5

The existing V4 report SHA256 is b69c4a451a7fb1b340f58f81d1f47f30fb4f6fddb8a36561523928fa1059226d. The checked-in manifest preserves its 257 batch objects without rebuilding or adding IDs. Manifest SHA256: 0536bb7bec9a788967624a4b94edf7cf62c7b2636215db6a06ac73e7181637e9.

The executor verifies the manifest bytes and original batch hash, blocks complete, previously sampled and pending-reconciliation IDs, and uses NATIONAL_MARKETS and the existing floor-plan client. A strict HTTP allowlist permits only the selected buildings' public Supabase reads, one OAuth token request and one floor-plan GET per building. RPC, writes, redirects and other endpoints are rejected before transport. No Supabase write credential is supplied. Prices are not compared; active-unit count changes are recorded separately.

The manual job requires main, the repository owner, attempt 1, and an exact full approved commit SHA. It has no deployment Environment, schedule, retry or inventory/audit writes. Internal deadline is seven minutes, HTTP timeout 15 seconds and job timeout ten minutes. Checkpoints and a final JSON SHA256 are uploaded as orulo-dry-run-RUN_ID. The PR job uses simulated requests without secrets.

## First real execution (after review and merge only)

1. Review and merge this PR through the normal protections. Set the nonsecret repository variable ORULO_DRY_RUN_APPROVED_SHA to the exact reviewed merge commit on main. A later main commit requires renewed review and an updated approved SHA.
2. Verify that the existing ORULO_CLIENT_ID and ORULO_CLIENT_SECRET are available as repository Actions secrets. Their availability at repository scope has not been verified; Environment-only secrets are deliberately not inherited. Missing credentials block execution. Do not supply a Supabase service key or use a deployment Environment.
3. On main, manually run .github/workflows/orulo-national-dry-run.yml once with batch_id=V4-SP-P1-NEW-002. No other input is accepted. Do not rerun the job or start a second batch automatically.
4. Download the artifact and verify report.json.sha256 against report.json. Inspect terminal status, examined/unexamined IDs, source errors and conflicts before considering any future action. This workflow never authorizes recovery writes.

First batch: SP, P1, original building IDs 4942, 5302, 5375, 5971, 6099, 6784, 7475, 7561, 9669, 9756. Original batch SHA256: 6a7aa1e95680d401d006bdbc0ca64c1d0ca704ca60b3cea0023481b666bb44ef. These ten IDs exclude the previous eight-building sample, ES/63731, complete records and pending reconciliation cases.

Validation: node --check scripts/orulo-national-dry-run.mjs; node --test scripts/orulo-national-dry-run.test.mjs orulo-floor-plans.test.js. No application build is needed for these standalone scripts and workflow files. No real batch has been dispatched from this unintegrated code.
