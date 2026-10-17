import crypto from "node:crypto";
import ads from "./ads-intelligence.js";

export function supabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  );
}

export async function rest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || "GET",
    signal: options.signal,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer
        || (options.method && options.method !== "GET"
          ? "return=minimal"
          : "return=representation")
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  const result = { ok: response.ok, status: response.status, data };
  // Opt-in evidence for internal readers; existing callers retain their shape.
  if (options.includeContentRange) result.contentRange = response.headers.get("content-range");
  return result;
}

export function deploymentOrigins() {
  const extra = String(process.env.ADS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, ...extra]
    .map(host => String(host || "").trim())
    .filter(Boolean)
    .map(host => host.replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .map(host => `https://${host}`);
}

export function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = new Set([
    "https://app.yincorp.com.br",
    "https://www.yincorp.com.br",
    "https://yincorp.com.br",
    "https://agente.yincorp.com.br",
    ...deploymentOrigins()
  ]);

  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "POST" && origin && !allowed.has(origin)) {
    res.status(403).json({ success: false, error: "Origin not allowed" });
    return false;
  }
  return true;
}

export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body;
}

function bearerToken(req) {
  const headers = req && req.headers ? req.headers : {};
  const header = String(headers.authorization || headers.Authorization || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function tokenEquals(provided, expected) {
  if (!expected || !provided) return false;
  try {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  } catch (error) {
    return false;
  }
}

export function authorizedExport(req) {
  return tokenEquals(bearerToken(req), process.env.ADS_EXPORT_TOKEN || "");
}

export function authorizedMiaRead(req) {
  const provided = bearerToken(req);
  if (tokenEquals(provided, process.env.MIA_READ_TOKEN || "")) return true;
  return tokenEquals(provided, process.env.MIA_READ_TOKEN_PREVIOUS || "");
}

export { ads };
