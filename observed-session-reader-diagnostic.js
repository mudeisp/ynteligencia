import { readObservedSessionReturnProjection } from "./observed-session-return-reader.js";
import { authorizedMiaRead } from "./ads-store.js";

const COUNTS = ["sessions_observed", "sessions_ended_by_inactivity", "sessions_active",
  "sessions_unknown", "sessions_ambiguous", "visitors_observed", "returning_visitors_observed",
  "new_visitors_observed", "visitors_unknown", "visitors_ambiguous", "overlapping_session_cases",
  "delayed_event_cases", "clock_inconsistent_cases", "reused_session_gap_cases", "synthetic_event_cases"];
const META = ["version", "coverage_status", "coverage_start", "as_of", "authority",
  "inactivity_minutes", "lateness_grace_minutes", "new_identity_evidence"];
const FAILURES = ["READ_FAILED", "INCOMPLETE", "LIMIT_EXCEEDED", "INVALID_STORAGE", "INVALID_INPUT"];

function time(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(match[1] + ".000Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== match[1] + ".000Z") return null;
  return BigInt(ms) * 1000n + BigInt((match[2] || "").padEnd(6, "0"));
}

function period(req, url, now) {
  const query = { ...(req.query || {}) };
  for (const [key, value] of url.searchParams) {
    if (url.searchParams.getAll(key).length !== 1 || (query[key] !== undefined && query[key] !== value)) return null;
    query[key] = value;
  }
  // Fixed dispatcher selector is routing metadata, never input to the reader.
  if (query.action !== "observed-session-reader-diagnostic") return null;
  delete query.action;
  if (Object.keys(query).length !== 2 || Object.keys(query).some(key => !["coverage_start", "as_of"].includes(key))) return null;
  const start = time(query.coverage_start), end = time(query.as_of);
  if (start === null || end === null || start >= end || end - start > 86400000000n || end > BigInt(now) * 1000n) return null;
  return { coverage_start: query.coverage_start, as_of: query.as_of };
}

function coverage(window, complete) {
  return window ? { ...window, complete, consistency: complete ? "two_matching_scans" : "unverified",
    snapshot: "not_guaranteed" } : null;
}

function aggregate(value, window) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== COUNTS.length + META.length ||
      Object.keys(value).some(key => !COUNTS.includes(key) && !META.includes(key)) ||
      value.version !== "internal-session-return-observation/1" || value.coverage_status !== "complete_window" ||
      value.coverage_start !== window.coverage_start || value.as_of !== window.as_of ||
      value.authority !== "not_authoritative" || value.inactivity_minutes !== 30 || value.lateness_grace_minutes !== 5 ||
      value.new_identity_evidence !== "unavailable" || !COUNTS.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) ||
      value.new_visitors_observed !== 0 ||
      value.sessions_observed !== value.sessions_ended_by_inactivity + value.sessions_active + value.sessions_unknown + value.sessions_ambiguous ||
      value.visitors_observed !== value.returning_visitors_observed + value.new_visitors_observed + value.visitors_unknown + value.visitors_ambiguous ||
      value.visitors_observed > value.sessions_observed) return null;
  return Object.fromEntries([...META, ...COUNTS].map(key => [key, value[key]]));
}

// Dependency seam is for unit tests only; the deployed default always uses the real reader.
export function createObservedSessionDiagnostic({ env = process.env, read = readObservedSessionReturnProjection, authorize = authorizedMiaRead, now = Date.now } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("CDN-Cache-Control", "no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const reply = (code, status, window = null, projection = null) =>
      res.status(code).json({ status, coverage: coverage(window, status === "OK"), projection });

    // Preserve platform protection; also require existing server-side MIA read authorization.
    const host = env.VERCEL_URL;
    if (env.VERCEL_ENV !== "preview" || env.VERCEL !== "1" ||
        (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== "preview") ||
        typeof host !== "string" || !/^[a-z0-9-]+\.vercel\.app$/.test(host) || req.headers?.host !== host ||
        typeof req.url !== "string" || !req.url)
      return reply(404, "NOT_FOUND");
    let url;
    try {
      url = new URL(req.url, "https://" + host);
      if (url.host !== host || url.protocol !== "https:" || url.username || url.password) return reply(404, "NOT_FOUND");
    } catch { return reply(404, "NOT_FOUND"); }
    if (!authorize(req)) return reply(401, "AUTH_REQUIRED");
    if (req.method !== "GET") return reply(405, "METHOD_NOT_ALLOWED");
    const window = period(req, url, now());
    if (!window) return reply(400, "INVALID_INPUT");
    try {
      const result = await read(window);
      if (result?.status !== "OK") return reply(502, FAILURES.includes(result?.status) ? result.status : "READ_FAILED", window);
      const projected = aggregate(result.projection, window);
      if (!projected || result.coverage?.complete !== true ||
          result.coverage.coverage_start !== window.coverage_start || result.coverage.as_of !== window.as_of ||
          result.coverage.consistency !== "two_matching_scans" || result.coverage.snapshot !== "not_guaranteed")
        return reply(502, "READ_FAILED", window);
      return reply(200, "OK", window, projected);
    } catch { return reply(502, "READ_FAILED", window); }
  };
}

export default createObservedSessionDiagnostic();
