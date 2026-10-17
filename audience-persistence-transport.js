// Internal read-only transport. Never project or publish a partially read slice.
import producer from "./audience-persistence.js";
import { authorizedMiaRead, rest, supabaseConfigured } from "./ads-store.js";
import { parseMiaReadQuery } from "./mia-read.js";

const PAGE_SIZE = 200;
const MAX_ROWS = 20000;
const MAX_PAGES = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN = Object.freeze({
  version: "audience-persistence/1", status: "unknown", session_end_authority: "UNRESOLVED",
  visitors_observed: null, sessions_observed: null, visitors_with_multiple_sessions: null,
  return_status: "unknown", new_vs_returning: "unknown", client_is_returning_adopted: false, sample_size: null
});

function reply(res, code, body = UNKNOWN) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(code).json(body);
}

function period(req, now) {
  const url = new URL(req.url || "/", "https://app.yincorp.com.br");
  const query = { ...(req.query || {}) };
  for (const [key, value] of url.searchParams) {
    if (url.searchParams.getAll(key).length !== 1) return null;
    if (query[key] !== undefined && query[key] !== value) return null;
    query[key] = value;
  }
  if (Object.keys(query).some(key => !["action", "from", "to"].includes(key))) return null;
  // Explicit closed observation window; no implicit now, cursor or caller page size.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (![query.from, query.to].every(value => typeof value === "string" && iso.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value)) return null;
  const parsed = parseMiaReadQuery({ from: query.from, to: query.to }, now);
  return parsed.ok && Date.parse(parsed.to) <= now.getTime() ? parsed : null;
}

function pathFor(window, offset) {
  const query = new URLSearchParams([
    ["select", "id,event_id,visitor_id,session_id,event_time"],
    ["event_time", `gte.${window.from}`], ["event_time", `lt.${window.to}`],
    ["order", "id.asc"], ["offset", String(offset)], ["limit", String(PAGE_SIZE)]
  ]);
  return `ads_events?${query}`;
}

async function scan(window, signal, expected = null) {
  const rows = [];
  let total = null;
  let previousId = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    signal.throwIfAborted();
    const result = await rest(pathFor(window, rows.length), {
      method: "GET", prefer: "count=exact", includeContentRange: true, signal
    });
    if (!result.ok || ![200, 206].includes(result.status) || !Array.isArray(result.data)) throw new Error("storage");
    const range = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(result.contentRange || "");
    if (!range) throw new Error("range");
    const count = Number(range[3]);
    if (!Number.isSafeInteger(count) || count > MAX_ROWS || (total !== null && count !== total) ||
        (expected && count !== expected.length)) throw new Error("count");
    total = count;
    const batch = result.data;
    if (total === 0) {
      if (range[1] !== undefined || rows.length || batch.length) throw new Error("empty");
      return rows;
    }
    if (!batch.length || batch.length > PAGE_SIZE || Number(range[1]) !== rows.length ||
        Number(range[2]) !== rows.length + batch.length - 1 || rows.length + batch.length > total) throw new Error("partial");
    for (const row of batch) {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || !UUID.test(row.id) || row.id.length !== 36 || row.id <= previousId ||
          typeof row.event_time !== "string" || !Number.isFinite(Date.parse(row.event_time)) ||
          Date.parse(row.event_time) < Date.parse(window.from) || Date.parse(row.event_time) >= Date.parse(window.to)) throw new Error("order");
      previousId = row.id;
      // Keep only selected evidence, never forward source objects or extra fields.
      const selected = [row.id, row.event_id, row.visitor_id, row.session_id, row.event_time];
      if (expected && JSON.stringify(selected) !== JSON.stringify(expected[rows.length])) throw new Error("changed");
      rows.push(selected);
    }
    // A short server-capped page is NOT proof of completion: exact total is required.
    if (rows.length === total) return rows;
  }
  throw new Error("page_budget");
}

export async function handleAudiencePersistence(req, res) {
  // Bearer is exclusively server-side. Never call applyCors, even for OPTIONS.
  const headers = req.headers || {};
  // Node's server fetch also sends Sec-Fetch-Mode: cors; that alone is not a browser signal.
  if (Object.keys(headers).some(key => ["origin", "sec-fetch-site", "sec-fetch-dest", "sec-fetch-user"].includes(key.toLowerCase()))) return reply(res, 403);
  if (req.method !== "GET") return reply(res, 405);
  if (!process.env.MIA_READ_TOKEN) return reply(res, 503);
  if (!authorizedMiaRead(req)) return reply(res, 401);
  if (!supabaseConfigured()) return reply(res, 503);
  try {
    const window = period(req, new Date());
    if (!window) return reply(res, 400);
    // Bound both passes together. No background work or partial result on exhaustion.
    const signal = AbortSignal.timeout(20000);
    const rows = await scan(window, signal);
    await scan(window, signal, rows);
    signal.throwIfAborted();
    // Only now is pagination complete and independently observed twice.
    const result = producer.projectAudiencePersistence({ source: "ads_events", complete: true,
      events: rows.map(([, event_id, visitor_id, session_id]) => ({ event_id, visitor_id, session_id })) });
    return reply(res, result.status === "observed" ? 200 : 502, result);
  } catch {
    // No upstream body, request, identifier or exception message crosses the boundary.
    return reply(res, 502);
  }
}
