const { test, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const producer = require("./observed-session-return.js");
const publicProducer = require("./audience-persistence.js");

const WINDOW = { coverage_start: "2026-10-13T00:00:00.000000Z", as_of: "2026-10-14T00:00:00.000000Z" };
const V = "83c98ca3-22ca-43a9-a7ed-9fb684b47263";
function row(index = 0, extra = {}) {
  return { event_id: "event-" + String(index).padStart(6, "0"), visitor_id: V, session_id: "session-one",
    event_time: "2026-10-13T10:00:00.000000Z", created_at: "2026-10-13T10:00:00.000000Z", ...extra };
}
function micros(value) {
  const fraction = (/\.(\d+)/.exec(value) || [])[1] || "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3));
}
function compare(a, b) {
  const x = micros(a.created_at), y = micros(b.created_at);
  return x < y ? -1 : x > y ? 1 : a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
}
function response(data, range, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Range": range } });
}

let read, saved, calls, projected;
const originalProject = producer.projectObservedSessionReturn;
before(async () => {
  const previous = global.fetch;
  let importReads = 0;
  global.fetch = async () => { importReads++; throw new Error("No import-time network"); };
  try {
    ({ readObservedSessionReturnProjection: read } = await import("./observed-session-return-reader.js"));
    assert.equal(importReads, 0);
  } finally {
    global.fetch = previous;
  }
});
beforeEach(() => {
  saved = { fetch: global.fetch, timeout: AbortSignal.timeout,
    url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, secret: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = "https://storage.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-only-key";
  calls = []; projected = [];
  global.fetch = async () => { throw new Error("No real network allowed"); };
  producer.projectObservedSessionReturn = input => {
    projected.push(input);
    return originalProject(input);
  };
});
afterEach(() => {
  global.fetch = saved.fetch;
  AbortSignal.timeout = saved.timeout;
  for (const [key, value] of [["SUPABASE_URL", saved.url], ["SUPABASE_SERVICE_ROLE_KEY", saved.key], ["SUPABASE_SECRET_KEY", saved.secret]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  producer.projectObservedSessionReturn = originalProject;
  delete global.window;
});

function storage(initial, { cap = 200, intercept } = {}) {
  const records = initial.map(value => ({ ...value }));
  global.fetch = async (address, options) => {
    const url = new URL(address), query = url.searchParams;
    calls.push(url);
    assert.equal(url.origin, "https://storage.invalid");
    assert.equal(url.pathname, "/rest/v1/ads_events");
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Prefer, "count=exact");
    assert.ok(options.signal);
    assert.equal(query.get("select"), "event_id,visitor_id,session_id,event_time,created_at");
    assert.equal(query.get("order"), "created_at.asc,event_id.asc");
    assert.equal(query.has("offset"), false);
    assert.equal(query.has("event_time"), false);
    const bounds = query.getAll("created_at");
    assert.deepEqual(bounds, ["gte." + WINDOW.coverage_start, "lte." + WINDOW.as_of]);
    let filtered = records.filter(r => micros(r.created_at) >= micros(WINDOW.coverage_start) &&
      micros(r.created_at) <= micros(WINDOW.as_of)).sort(compare);
    if (query.has("or")) {
      const match = /^\(created_at\.gt\.("(?:\\.|[^"\\])*"),and\(created_at\.eq\.("(?:\\.|[^"\\])*"),event_id\.gt\.("(?:\\.|[^"\\])*")\)\)$/.exec(query.get("or"));
      assert.ok(match, "composite cursor must quote both timestamp and event ID");
      assert.equal(JSON.parse(match[1]), JSON.parse(match[2]));
      const cursor = { created_at: JSON.parse(match[1]), event_id: JSON.parse(match[3]) };
      filtered = filtered.filter(r => compare(r, cursor) > 0);
    }
    const data = filtered.slice(0, Math.min(cap, Number(query.get("limit")))).map(r => ({ ...r }));
    const range = data.length ? "0-" + (data.length - 1) + "/" + filtered.length : "*/" + filtered.length;
    const override = intercept?.(calls.length, { data, range, total: filtered.length, records, query, options });
    return override || response(data, range);
  };
  return records;
}
function failure(result, status) {
  assert.equal(result.status, status);
  assert.equal(result.projection, null);
  assert.equal(result.coverage?.complete || false, false);
  assert.equal(projected.length, 0, "never project complete:true after a failed read");
}

test("complete zero window is verified twice plus final total, then projects real zeros once", async () => {
  storage([]);
  const result = await read(WINDOW);
  assert.equal(result.status, "OK");
  assert.equal(calls.length, 3);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].complete, true);
  assert.equal(result.projection.sessions_observed, 0);
  assert.equal(result.coverage.snapshot, "not_guaranteed");
});

test("one page uses original projection and returns only sanitized aggregates", async () => {
  const events = [row()];
  storage(events);
  const result = await read(WINDOW);
  assert.equal(result.status, "OK");
  assert.equal(calls.length, 3);
  assert.deepEqual(result.projection, originalProject({ ...WINDOW, source: "ads_events", complete: true, events }));
  assert.equal(result.projection.authority, "not_authoritative");
  assert.equal(projected.length, 1);
});

test("multiple pages, equal receipt times, server caps and stable keyset boundaries lose no events", async () => {
  const events = Array.from({ length: 451 }, (_, i) => row(i));
  storage(events, { cap: 73 });
  const result = await read(WINDOW);
  assert.equal(result.status, "OK");
  assert.equal(calls.length, 15); // 7 pages/pass, then final full-window total
  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0].events, events);
  assert.equal(result.projection.sessions_observed, 1);
});

test("microseconds and inclusive receipt boundaries survive cursor pagination", async () => {
  const events = [row(0, { created_at: WINDOW.coverage_start, event_time: WINDOW.coverage_start }),
    row(1, { created_at: "2026-10-13T10:00:00.000001+00:00" }),
    row(2, { created_at: "2026-10-13T10:00:00.000002Z" }),
    row(3, { created_at: WINDOW.as_of, event_time: WINDOW.as_of })];
  storage(events, { cap: 1 });
  assert.equal((await read(WINDOW)).status, "OK");
  assert.deepEqual(projected[0].events, events);
  assert.ok(calls.some(url => url.searchParams.get("or")?.includes(".000001+00:00")));
});

test("old event_time received inside coverage is included and classified by the real projection", async () => {
  storage([row(0, { event_time: "2026-10-12T10:00:00Z" })]);
  const result = await read(WINDOW);
  assert.equal(result.status, "OK");
  assert.equal(result.projection.delayed_event_cases, 1);
  assert.equal(result.projection.sessions_ambiguous, 1);
});

test("reserved cursor characters are quoted without creating extra filters", async () => {
  storage([row(0, { event_id: 'a",\\():x' }), row(1, { event_id: "b" })], { cap: 1 });
  assert.equal((await read(WINDOW)).status, "OK");
  assert.equal(projected[0].events.length, 2);
  for (const url of calls) assert.deepEqual([...new Set(url.searchParams.keys())].sort(),
    url.searchParams.has("or") ? ["created_at", "limit", "or", "order", "select"] : ["created_at", "limit", "order", "select"]);
});

test("intermediate network/HTTP failure is sanitized and never calls the projection", async () => {
  for (const network of [true, false]) {
    projected = [];
    storage(Array.from({ length: 201 }, (_, i) => row(i)), { intercept: (_, context) => {
      if (context.query.has("or")) {
        if (network) throw new Error("secret upstream URL Authorization private@example.invalid");
        return response({ secret: "not forwarded" }, "*/0", 503);
      }
    } });
    const result = await read(WINDOW);
    failure(result, "READ_FAILED");
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("exact count above 20,000 fails before projection and never becomes zero", async () => {
  storage([row()], { intercept: () => response([row()], "0-0/20001") });
  failure(await read(WINDOW), "LIMIT_EXCEEDED");
  assert.equal(calls.length, 1);
});

test("malformed JSON/storage shape and extra fields fail closed", async () => {
  for (const bad of [null, {}, "text", [null], [{ ...row(), email: "private@example.invalid" }],
    [{ ...row(), event_time: "invalid" }], [{ ...row(), created_at: "2026-02-30T00:00:00Z" }],
    [{ ...row(), session_id: "" }], [{ ...row(), visitor_id: "invalid" }]]) {
    projected = [];
    storage([row()], { intercept: () => response(bad, "0-0/1") });
    failure(await read(WINDOW), "INVALID_STORAGE");
  }
  storage([row()], { intercept: () => new Response("{malformed", { status: 200, headers: { "Content-Range": "0-0/1" } }) });
  failure(await read(WINDOW), "INVALID_STORAGE");
});

test("missing/wildcard counts, bad ranges and empty truncated pages cannot certify coverage", async () => {
  for (const range of ["0-0/*", "", "1-1/1", "0-2/1", "*/1"]) {
    projected = [];
    storage([row()], { intercept: () => response(range === "*/1" ? [] : [row()], range) });
    failure(await read(WINDOW), "INCOMPLETE");
  }
  storage(Array.from({ length: 201 }, (_, i) => row(i)), { intercept: (_, c) =>
    c.query.has("or") ? response([], "*/1") : undefined });
  failure(await read(WINDOW), "INCOMPLETE");
});

test("duplicate/nonprogressing/out-of-order rows cannot silently inflate completeness", async () => {
  for (const data of [[row(), row()], [row(1), row(0)]]) {
    projected = [];
    storage([row(), row(1)], { intercept: () => response(data, "0-1/2") });
    failure(await read(WINDOW), "INCOMPLETE");
  }
});

test("changing suffix counts or receipts outside the fixed window are rejected", async () => {
  storage(Array.from({ length: 201 }, (_, i) => row(i)), { intercept: (_, c) =>
    c.query.has("or") ? response(c.data, "0-0/2") : undefined });
  failure(await read(WINDOW), "INCOMPLETE");
  storage([row()], { intercept: (_, c) => {
    c.data[0].created_at = "2026-10-12T23:59:59.999999Z";
  } });
  failure(await read(WINDOW), "INVALID_STORAGE");
});

test("a changed second pass, even at equal count, is incomplete", async () => {
  storage([row()], { intercept: (index, c) => {
    if (index === 2) c.data[0].session_id = "changed";
  } });
  failure(await read(WINDOW), "INCOMPLETE");
  assert.equal(calls.length, 2);
});

test("an inserted row between passes invalidates the first pass's exact count", async () => {
  storage([row()], { intercept: (index, c) => {
    if (index === 1) c.records.push(row(1));
  } });
  failure(await read(WINDOW), "INCOMPLETE");
});

test("final global count catches an insertion behind the second pass cursor", async () => {
  storage(Array.from({ length: 201 }, (_, i) => row(i)), { intercept: (index, c) => {
    if (index === 4) c.records.push(row(999, { created_at: "2026-10-13T09:00:00Z" }));
  } });
  failure(await read(WINDOW), "INCOMPLETE");
  assert.equal(calls.length, 5);
});

test("verification/final-count failure cannot call projection complete:true", async () => {
  for (const index of [2, 3]) {
    projected = []; calls = [];
    storage([row()], { intercept: (n) => n === index ? response([], "*/0", 500) : undefined });
    failure(await read(WINDOW), "READ_FAILED");
  }
});

test("page budget exhaustion fails closed even when row cap was not exceeded", async () => {
  storage(Array.from({ length: 201 }, (_, i) => row(i)), { cap: 1 });
  failure(await read(WINDOW), "INCOMPLETE");
  assert.equal(calls.length, 200);
});

test("invalid/future/oversized windows fail before any upstream request", async () => {
  storage([]);
  for (const input of [null, {}, { ...WINDOW, extra: true }, { ...WINDOW, as_of: WINDOW.coverage_start },
    { ...WINDOW, as_of: "2026-02-30T00:00:00Z" }, { ...WINDOW, coverage_start: "2026-10-01T00:00:00Z" },
    { ...WINDOW, as_of: new Date(Date.now() + 86400000).toISOString() },
    { coverage_start: "private@example.invalid", as_of: "Authorization secret" }]) {
    const result = await read(input);
    failure(result, "INVALID_INPUT");
    assert.equal(result.coverage, null);
  }
  assert.equal(calls.length, 0);
});

test("missing server configuration or browser execution cannot make a request", async () => {
  storage([]);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  failure(await read(WINDOW), "READ_FAILED");
  process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-only-key";
  global.window = {};
  failure(await read(WINDOW), "READ_FAILED");
  assert.equal(calls.length, 0);
});

test("shared timeout aborts before I/O and is never treated as complete empty coverage", async () => {
  storage([]);
  AbortSignal.timeout = ms => {
    assert.equal(ms, 20000);
    return AbortSignal.abort();
  };
  failure(await read(WINDOW), "READ_FAILED");
  assert.equal(calls.length, 0);
});

test("timeout after an HTTP response still prevents a complete projection", async () => {
  const controller = new AbortController();
  AbortSignal.timeout = () => controller.signal;
  storage([], { intercept: () => { controller.abort(); } });
  failure(await read(WINDOW), "READ_FAILED");
  assert.equal(calls.length, 1);
});

test("output has no IDs/PII, and no write, runtime hook or public contract alteration", async () => {
  const files = ["audience-persistence.js", "audience-persistence-transport.js", "index.html",
    "ads-intelligence.js", "ads-routes.js", "api/ads.js", "observed-session-return.js"];
  const hashes = () => files.map(path => crypto.createHash("sha256").update(fs.readFileSync(__dirname + "/" + path)).digest("hex"));
  const beforeHashes = hashes();
  const events = [row(0, { session_id: "private@example.invalid", event_id: "private-click" })];
  const v1 = publicProducer.projectAudiencePersistence({ source: "ads_events", complete: true, events });
  storage(events);
  const result = await read(WINDOW), output = JSON.stringify(result);
  assert.equal(result.status, "OK");
  assert.deepEqual(Object.keys(result), ["status", "coverage", "projection"]);
  for (const forbidden of [V, "visitor_id", "session_id", "event_id", "gclid", "gbraid", "wbraid",
    "private", "Authorization", "storage.invalid", "unit-only-key", "http", "eligible"])
    assert.equal(output.includes(forbidden), false, forbidden);
  assert.deepEqual(hashes(), beforeHashes);
  assert.deepEqual(publicProducer.projectAudiencePersistence({ source: "ads_events", complete: true, events }), v1);
  assert.equal(v1.session_end_authority, "UNRESOLVED");
  for (const file of ["api/ads.js", "ads-routes.js", "audience-persistence-transport.js", "index.html"])
    assert.equal(fs.readFileSync(__dirname + "/" + file, "utf8").includes("observed-session-return-reader"), false);
});
