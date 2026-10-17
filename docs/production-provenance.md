# Production Provenance / Deployment Truth

## Canonical production path

- GitHub repository: https://github.com/mudeisp/ynteligencia
- Production source branch: `main`.
- Correct Vercel project: `ynteligencia` (project ID recorded in existing GitHub deployment comments: `prj_wdLbJbBn59Ho8ZjdUVau3ADNDyT8`).
- Production domain: https://app.yincorp.com.br
- The old/alternative Vercel project `ynteligencia-app` also exists. It must **not** be used for Production, domain assignment, promotion or rollback.

The intended path is GitHub `mudeisp/ynteligencia:main` → Vercel project `ynteligencia` → its active Production deployment → `app.yincorp.com.br`. A PR branch or a successful preview on either project does not prove that production is running that commit. The domain serves its assigned deployment, which can differ from the latest GitHub commit after a failed build, rollback or manual alias change.

This document records the production target specified by the repository owner. During preparation, the Vercel project/domain API returned 403 for scope `rafael-8f11`; live Git linkage, Production Branch and domain assignment could not be independently verified. Before any future release, inspect those settings in the correct project. This PR does not change Vercel settings or deploy anything.

## Read the version actually served

After this change is released through the normal process, request:

```sh
curl --fail --silent --show-error https://app.yincorp.com.br/api/build-info
```

Or inspect it from the browser console without modifying the UI:

```js
await fetch("/api/build-info", {cache:"no-store"}).then(r => {
  if (!r.ok) throw new Error("Build diagnostics unavailable: " + r.status);
  return r.json();
});
```

The JSON contains only an explicit allowlist:

| Field | Source |
| --- | --- |
| `schemaVersion` | Diagnostic contract version, currently 1 |
| `gitSha` | `VERCEL_GIT_COMMIT_SHA`, full source commit |
| `branch` | `VERCEL_GIT_COMMIT_REF` |
| `environment` | `VERCEL_TARGET_ENV`, falling back to `VERCEL_ENV` |
| `deploymentId` | `VERCEL_DEPLOYMENT_ID` |
| `deploymentUrl` | `VERCEL_URL`, hostname of this deployment |
| `projectId` | `VERCEL_PROJECT_ID`, actual hosting project |
| `repository` | `VERCEL_GIT_REPO_OWNER` + `VERCEL_GIT_REPO_SLUG` |

Missing values are `null`, including outside Vercel; they are not proof of production. No request timestamp is presented as a build timestamp. The deployment identifier distinguishes rebuilds of the same SHA; its creation/build time can be inspected in Vercel using that identifier. No author, email, visitor, cookie, token, request data or arbitrary environment variables are exposed.

Vercel documents these variables as available at build and runtime: https://vercel.com/docs/environment-variables/system-environment-variables. Enable access to System Environment Variables in the project's settings if required. For CLI/prebuilt releases without Git metadata, the endpoint leaves unavailable fields null; do not fill them with an assumed branch or latest GitHub SHA.

## Verify deployment truth

1. Read the endpoint on the production domain, not just a preview URL.
2. Compare the full `gitSha` with the intended GitHub commit and check `repository` and `branch`.
3. Check `environment === "production"`, and confirm `projectId` belongs to `ynteligencia`. A `main` branch or production-looking hostname alone is insufficient.
4. Find `deploymentId` (or `deploymentUrl`) in that project's dashboard. Confirm its commit, target, state and alias/domain assignment. Compare the response at its deployment URL with the production-domain response.
5. If the endpoint is absent, returns HTML, or has missing metadata, record provenance as unverified. Do not infer the version from UI appearance or from the newest successful preview.

The endpoint sends `no-store` for browsers and both CDN cache layers. The existing service worker already bypasses `/api/`; it is unchanged. This identifies the deployment answering the network request, not an old/offline HTML document held in a browser cache. Use a direct network request when diagnosing a stale client.

## Tests and scope

Run `node --test build-info.test.js`. Tests cover production/preview/custom identity, missing values, secret/PII exclusion, GET/HEAD behavior, rejected methods and cache headers. No dependencies, build command, UX, MATCH, Push, AI, inventory, tracking, leads or service workers are changed.
