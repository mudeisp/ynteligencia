// Internal server-side reader. No endpoint, hook, scheduler or mutation.
import projection from "./observed-session-return.js";
import { rest, supabaseConfigured } from "./ads-store.js";

const FIELDS = ["event_id", "visitor_id", "session_id", "event_time", "created_at"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 200, MAX_ROWS = 20000, MAX_PAGES = 200;
const MAX_WINDOW = 7n * 86400000000n;

function time(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(match[1] + ".000Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== match[1] + ".000Z") return null;
  return BigInt(ms) * 1000n + BigInt((match[2] || "").padEnd(6, "0"));
}

function identifier(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function period(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 2 || Object.keys(input).some(key => !["coverage_start", "as_of"].includes(key))) return null;
  const start = time(input.coverage_start), end = time(input.as_of);
  if (start === null || end === null || start >= end || end - start > MAX_WINDOW ||
      end > BigInt(Date.now()) * 1000n) return null;
  return { coverage_start: input.coverage_start, as_of: input.as_of, start, end };
}

function reply(status, window = null, aggregate = null) {
  return {
    status,
    coverage: window ? {
      coverage_start: window.coverage_start, as_of: window.as_of,
      complete: status === "OK",
      consistency: status === "OK" ? "two_matching_scans" : "unverified",
      snapshot: "not_guaranteed"
    } : null,
    projection: aggregate
  };
}

// PostgREST quoted filter value, then URLSearchParams performs URL encoding once.
function quoted(value) {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function pathFor(window, cursor, limit = PAGE_SIZE) {
  const params = new URLSearchParams([
    ["select", FIELDS.join(",")], ["created_at", `gte.${window.coverage_start}`],
    ["created_at", `lte.${window.as_of}`], ["order", "created_at.asc,event_id.asc"], ["limit", String(limit)]
  ]);
  if (cursor) params.set("or", `(created_at.gt.${quoted(cursor.created_at)},and(created_at.eq.${quoted(cursor.created_at)},event_id.gt.${quoted(cursor.event_id)}))`);
  return `ads_events?${params}`;
}

function fail(code) { throw new Error(code); }

async function scan(window, signal, expected = null) {
  const rows = [], seen = new Set();
  let total = null, cursor = null, previousTime = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    signal.throwIfAborted();
    const response = await rest(pathFor(window, cursor), {
      method: "GET", prefer: "count=exact", includeContentRange: true, signal
    });
    signal.throwIfAborted();
    if (!response.ok || ![200, 206].includes(response.status)) fail("READ_FAILED");
    if (!Array.isArray(response.data)) fail("INVALID_STORAGE");
    const range = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(response.contentRange || "");
    if (!range) fail("INCOMPLETE");
    const remaining = Number(range[3]), batch = response.data;
    if (!Number.isSafeInteger(remaining)) fail("INCOMPLETE");
    if (remaining + rows.length > MAX_ROWS) fail("LIMIT_EXCEEDED");
    // Every query includes the cursor: Content-Range counts the REMAINING suffix.
    if (total === null) total = remaining;
    if (rows.length + remaining !== total || (expected && total !== expected.length)) fail("INCOMPLETE");
    if (total === 0) {
      if (batch.length || range[1] !== undefined) fail("INCOMPLETE");
      return rows;
    }
    if (!batch.length || batch.length > PAGE_SIZE || Number(range[1]) !== 0 ||
        Number(range[2]) !== batch.length - 1 || batch.length > remaining) fail("INCOMPLETE");
    for (const row of batch) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== FIELDS.length ||
          Object.keys(row).some(key => !FIELDS.includes(key)) || !identifier(row.event_id, 512) ||
          !identifier(row.visitor_id, 36) || !UUID.test(row.visitor_id) || !identifier(row.session_id, 120)) fail("INVALID_STORAGE");
      const received = time(row.created_at);
      if (received === null || time(row.event_time) === null || received < window.start || received > window.end) fail("INVALID_STORAGE");
      if (seen.has(row.event_id) || (cursor && (received < previousTime ||
          (received === previousTime && row.event_id <= cursor.event_id)))) fail("INCOMPLETE");
      const selected = Object.fromEntries(FIELDS.map(key => [key, row[key]]));
      if (expected && JSON.stringify(selected) !== JSON.stringify(expected[rows.length])) fail("INCOMPLETE");
      rows.push(selected);
      seen.add(row.event_id);
      cursor = selected;
      previousTime = received;
    }
    if (rows.length === total) return rows;
  }
  fail("INCOMPLETE");
}

async function confirmTotal(window, rows, signal) {
  signal.throwIfAborted();
  const response = await rest(pathFor(window, null, 1), {
    method: "GET", prefer: "count=exact", includeContentRange: true, signal
  });
  signal.throwIfAborted();
  if (!response.ok || ![200, 206].includes(response.status)) fail("READ_FAILED");
  // Full-window count also catches insertions behind the second pass's cursor.
  const expectedRange = rows.length ? `0-0/${rows.length}` : "*/0";
  if (response.contentRange !== expectedRange || !Array.isArray(response.data) ||
      response.data.length !== Math.min(1, rows.length)) fail("INCOMPLETE");
  if (rows.length) {
    const row = response.data[0];
    if (!row || Object.keys(row).length !== FIELDS.length ||
        FIELDS.some(key => row[key] !== rows[0][key])) fail("INCOMPLETE");
  }
}

export async function readObservedSessionReturnProjection(input) {
  const window = period(input);
  if (!window) return reply("INVALID_INPUT");
  if (typeof globalThis.window !== "undefined" || !supabaseConfigured()) return reply("READ_FAILED", window);
  try {
    const signal = AbortSignal.timeout(20000); // shared budget for both passes and final count
    const rows = await scan(window, signal);
    await scan(window, signal, rows);
    await confirmTotal(window, rows, signal);
    signal.throwIfAborted();
    const aggregate = projection.projectObservedSessionReturn({
      source: "ads_events", complete: true,
      coverage_start: window.coverage_start, as_of: window.as_of, events: rows
    });
    if (aggregate.coverage_status !== "complete_window" || aggregate.authority !== "not_authoritative") return reply("INVALID_STORAGE", window);
    return reply("OK", window, aggregate);
  } catch (error) {
    // Never return storage bodies, exceptions, configuration or identifiers.
    const code = ["INCOMPLETE", "LIMIT_EXCEEDED", "INVALID_STORAGE"].includes(error?.message) ? error.message : "READ_FAILED";
    return reply(code, window);
  }
}
