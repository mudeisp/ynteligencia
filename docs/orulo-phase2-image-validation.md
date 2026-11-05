# phase2-30-a: uppercase Órulo image extension

## Diagnosis

GitHub [42041447706](https://github.com/mudeisp/ynteligencia/actions/runs/42041447706) completed/failure at control SHA 58224735ddab9b850b18d782a13a142e0c70d026. Run UUID 80075d5c-12a6-4109-9573-8f25a2598e00 stopped in IMAGE_VALIDATION for building 20333 (Lure Perdizes).

The first missing source plan is 632499, Implantação. Its URL is:

https://static.orulo.com.br/images/properties/large/632499.JPG

The previous regular expression allowed only lowercase jpg/jpeg/png/webp. The URL has a legitimate uppercase JPG extension. All eight current plans 632499–632506 use this same extension format. The existing read-only application endpoint /api/development?building_id=20333, which fetches authenticated Órulo data server-side, returned that plan ID and exact URL. The saved read-only source audit from 2026-11-04 also contains the same URL.

A direct ranged GET to the first URL returned HTTP 206, image/jpeg, no redirects, and JPEG bytes ff d8 ff e0 00 10 4a 46. Its host is exactly the already-authorized static.orulo.com.br; no new domain or path family is authorized. The historical job diagnostic did not store the rejected URL/plan ID, so this identification is a deterministic reproduction using source order and data, corroborated by the earlier source audit, rather than a historical per-URL trace.

## Minimal change

Accept casing variations only in the four previously permitted extensions. Keep HTTPS, the exact lowercase hostname and /images/properties/ path, filename grammar, no credentials/ports/query/fragment, redirect:error, request timeout, Range and binary JPEG/PNG/WebP signature validation. No generic case-insensitive regex flag, wildcard hosts, new extensions or retry is introduced.

Gate, catalog, manifests, workflow, SQL, CAS and authorization are unchanged. Tests are appended to the existing batch test file so existing CI runs them without workflow/package changes.

## Production read-only evidence

The ledger contains exactly START and CLIENT_STOP, with confirmedRows=0 and verifiedRows=0. SHA-256/sequence links were validated. There is no BATCH_PLAN, WRITE_AUTHORIZED, INTENT or CAS_RESULT. This execution never reached audited property mutation. No production property, ledger event or credential was modified during this investigation. This PR does not reconcile the still-open stopped run.

## Validation and next attempt

Regression tests cover the actual uppercase URL, mixed-case permitted extensions, malicious domains/userinfo/ports/path traversal/query/fragment/unsupported extensions, redirects, 404 and non-image responses. Existing batch tests cover durable STOP and zero CAS on source/image failure.

Local tests use the existing restricted catalog fixture; no phase release was changed. Main already released phase2-30-a in commit 58224735ddab9b850b18d782a13a142e0c70d026. Three stale test expectations that still treated it as locked now exercise phase2-30-b and phase3-rest, which remain locked. This adjusts tests to existing main; no catalog, dispatch control or release is changed. CI tests the actual PR tree.

After review and merge, obtain the exact new main commit (not this branch's SHA), review it and update ORULO_BATCH_APPROVED_SHA through the existing owner procedure. Reconcile the stopped prior run separately using the existing administrative process after audit. Only then may the owner manually initiate a new independent run; its newly persisted plan requires its own administrative authorization. This PR does not dispatch, authorize, merge or enable any lot.
