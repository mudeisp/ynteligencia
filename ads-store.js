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
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.method && options.method !== "GET"
        ? "return=minimal"
        : "return=representation"
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
  return { ok: response.ok, status: response.status, data };
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

export function authorizedExport(req) {
  const expected = process.env.ADS_EXPORT_TOKEN || "";
  const header = String(req.headers.authorization || "");
  const provided = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!expected || !provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export { ads };
