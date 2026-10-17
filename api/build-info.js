// Public deployment provenance only. Never copy request data or arbitrary env vars.
export function buildInfo(env = process.env) {
  const value = key => String(env[key] || "").trim() || null;
  const owner = value("VERCEL_GIT_REPO_OWNER");
  const repo = value("VERCEL_GIT_REPO_SLUG");
  return {
    schemaVersion: 1,
    gitSha: value("VERCEL_GIT_COMMIT_SHA"),
    branch: value("VERCEL_GIT_COMMIT_REF"),
    environment: value("VERCEL_TARGET_ENV") || value("VERCEL_ENV"),
    deploymentId: value("VERCEL_DEPLOYMENT_ID"),
    deploymentUrl: value("VERCEL_URL"),
    projectId: value("VERCEL_PROJECT_ID"),
    repository: owner && repo ? owner + "/" + repo : null
  };
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({error: "Method not allowed"});
  }
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).json(buildInfo());
}
