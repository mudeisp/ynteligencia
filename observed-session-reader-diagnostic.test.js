const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { projectObservedSessionReturn } = require("./observed-session-return.js");

const HOST = "ynteligencia-immutable-team.vercel.app";
const ENV = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: HOST };
const WINDOW = { coverage_start: "2026-10-13T00:00:00.000000Z", as_of: "2026-10-14T00:00:00.000000Z" };
const NOW = Date.parse("2026-10-15T00:00:00Z");
const PATH = "/api/ads?action=observed-session-reader-diagnostic";
let factory, deployed;
before(async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("No import-time network"); };
  try {
    ({ createObservedSessionDiagnostic: factory, default: deployed } = await import("./observed-session-reader-diagnostic.js"));
    assert.equal(calls, 0);
  } finally { global.fetch = original; }
});
function request(extra = {}) {
  return { method: "GET", url: PATH + "&" + new URLSearchParams(WINDOW),
    headers: { host: HOST }, ...extra };
}
function projected(events = []) {
  return projectObservedSessionReturn({ ...WINDOW, source: "ads_events", complete: true, events });
}
function success(projection = projected()) {
  return { status: "OK", coverage: { ...WINDOW, complete: true,
    consistency: "two_matching_scans", snapshot: "not_guaranteed" }, projection };
}
function response() {
  return { code: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
async function run(req = request(), { env = ENV, result = success(), error } = {}) {
  const calls = [], res = response();
  const reader = async args => {
    calls.push(args);
    if (error) throw error;
    return result;
  };
  await factory({ env, read: reader, authorize: () => true, now: () => NOW })(req, res);
  return { ...res, calls };
}
function blocked(result, code) {
  assert.equal(result.code, code);
  assert.equal(result.calls.length, 0);
  assert.equal(result.body.projection, null);
}

test("Preview immutable host invokes reader exactly once with only validated UTC bounds", async () => {
  const result = await run();
  assert.equal(result.code, 200);
  assert.deepEqual(result.calls, [WINDOW]);
  assert.deepEqual(result.body, success());
  assert.deepEqual(Object.keys(result.body), ["status", "coverage", "projection"]);
});

test("existing MIA authorization rejects missing/wrong/query credentials before reader or input", async () => {
  const saved = { token: process.env.MIA_READ_TOKEN, previous: process.env.MIA_READ_TOKEN_PREVIOUS };
  process.env.MIA_READ_TOKEN = "diagnostic-unit-fixture-current";
  process.env.MIA_READ_TOKEN_PREVIOUS = "diagnostic-unit-fixture-previous";
  let calls = 0;
  const read = async args => { calls++; assert.deepEqual(args, WINDOW); return success(); };
  const handler = factory({ env: ENV, read, now: () => NOW });
  try {
    for (const req of [request(), request({ headers: { host: HOST, authorization: "Bearer wrong" } }),
      request({ url: PATH + "&token=diagnostic-unit-fixture-current" })]) {
      const res = response();
      await handler(req, res);
      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { status: "AUTH_REQUIRED", coverage: null, projection: null });
      assert.equal(calls, 0);
    }
    for (const token of [process.env.MIA_READ_TOKEN, process.env.MIA_READ_TOKEN_PREVIOUS]) {
      const res = response();
      await handler(request({ headers: { host: HOST, authorization: "Bearer " + token } }), res);
      assert.equal(res.code, 200);
      assert.equal(JSON.stringify(res.body).includes(token), false);
    }
    assert.equal(calls, 2);
    delete process.env.MIA_READ_TOKEN;
    delete process.env.MIA_READ_TOKEN_PREVIOUS;
    const res = response();
    await handler(request({ headers: { host: HOST, authorization: "Bearer diagnostic-unit-fixture-current" } }), res);
    assert.equal(res.code, 401);
    assert.equal(calls, 2);
  } finally {
    for (const [key, value] of [["MIA_READ_TOKEN", saved.token], ["MIA_READ_TOKEN_PREVIOUS", saved.previous]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("environment/host denial happens before authorization and any reader access", async () => {
  for (const env of [{ ...ENV, VERCEL_ENV: "production" }, {}]) {
    const res = response();
    await factory({ env, authorize() { assert.fail("must not authorize outside Preview"); },
      read() { assert.fail("must not read outside Preview"); } })(request(), res);
    assert.equal(res.code, 404);
  }
});

test("Production and custom targets deny before reader, method or query handling", async () => {
  for (const env of [{ ...ENV, VERCEL_ENV: "production" }, { ...ENV, VERCEL_TARGET_ENV: "production" },
    { ...ENV, VERCEL_TARGET_ENV: "staging" }]) {
    const result = await run(request({ method: "POST", url: PATH + "?invalid=secret" }), { env });
    blocked(result, 404);
    assert.equal(result.body.status, "NOT_FOUND");
  }
});

test("local, development, missing Vercel runtime and missing deployment host deny before reader", async () => {
  for (const env of [{}, { ...ENV, VERCEL_ENV: "development" }, { ...ENV, VERCEL: undefined },
    { ...ENV, VERCEL_ENV: undefined }, { ...ENV, VERCEL_URL: undefined }, { ...ENV, VERCEL_URL: "localhost:3000" }])
    blocked(await run(request(), { env }), 404);
});

test("custom domains, aliases, wrong Host, ports and forwarded-host spoofing are denied", async () => {
  for (const host of ["app.yincorp.com.br", "ynteligencia.vercel.app", "branch-team.vercel.app",
    HOST + ":443", undefined, "attacker.invalid"]) {
    blocked(await run(request({ headers: { host, "x-forwarded-host": HOST } })), 404);
  }
  blocked(await run(request({ headers: { host: "app.yincorp.com.br" } }),
    { env: { ...ENV, VERCEL_URL: "app.yincorp.com.br" } }), 404);
});

test("absolute URL cannot replace the real host and non-HTTPS/userinfo URLs are denied", async () => {
  for (const url of ["https://other.vercel.app" + PATH, "http://" + HOST + PATH,
    "https://user:secret@" + HOST + PATH, "https://["])
    blocked(await run(request({ url })), 404);
});

test("invalid input, duplicate/extra keys, arrays and conflicting query sources never call reader", async () => {
  const invalid = [
    PATH, PATH + "&coverage_start=private@example.invalid&as_of=secret",
    PATH + "&" + new URLSearchParams({ ...WINDOW, as_of: WINDOW.coverage_start }),
    PATH + "&" + new URLSearchParams({ ...WINDOW, as_of: "2026-02-30T00:00:00Z" }),
    PATH + "&" + new URLSearchParams({ ...WINDOW, as_of: "2026-10-14T00:00:00.000001Z" }),
    PATH + "&" + new URLSearchParams({ ...WINDOW, as_of: "2026-10-16T00:00:00Z" }),
    request().url + "&token=secret",
    request().url + "&action=observed-session-reader-diagnostic",
    request().url + "&as_of=" + encodeURIComponent(WINDOW.as_of)
  ];
  for (const url of invalid) {
    const result = await run(request({ url }));
    blocked(result, 400);
    assert.equal(result.body.status, "INVALID_INPUT");
    assert.equal(JSON.stringify(result.body).includes("private"), false);
  }
  blocked(await run(request({ query: { ...WINDOW, as_of: [WINDOW.as_of] } })), 400);
  blocked(await run(request({ query: { ...WINDOW, as_of: "2026-10-13T12:00:00Z" } })), 400);
  blocked(await run(request({ query: { ...WINDOW, unknown: "secret" } })), 400);
});

test("existing dispatcher selects the protected diagnostic without adding a Vercel Function", async () => {
  const { default: adsHandler } = await import("./api/ads.js");
  const originalFetch = global.fetch;
  let reads = 0;
  global.fetch = async () => { reads++; throw new Error("No network allowed"); };
  try {
    const res = response();
    await adsHandler({ ...request(), headers: {}, query: { action: "observed-session-reader-diagnostic" } }, res);
    assert.equal(res.code, 404);
    assert.equal(res.body.status, "NOT_FOUND");
    assert.equal(reads, 0);
  } finally { global.fetch = originalFetch; }
  function apiFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? apiFiles(dir + "/" + entry.name) : entry.name.endsWith(".js") ? [entry.name] : []);
  }
  assert.equal(apiFiles(__dirname + "/api").length, 12);
});

test("the diagnostic accepts 24 hours and UTC microseconds without broadening the reader contract", async () => {
  const result = await run();
  assert.equal(result.code, 200);
  assert.deepEqual(result.calls[0], WINDOW);
  assert.equal(Object.keys(result.calls[0]).length, 2);
});

test("only GET is allowed, with no CORS or browser/CDN caching", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
    blocked(await run(request({ method })), 405);
  const result = await run();
  for (const key of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"])
    assert.match(result.headers[key], /no-store/);
  assert.equal(result.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(Object.keys(result.headers).some(key => key.startsWith("Access-Control")), false);
});

test("reader OK returns positive and zero aggregates, preserving both partitions and no authority", async () => {
  const one = projected([{ event_id: "event-one", visitor_id: "83c98ca3-22ca-43a9-a7ed-9fb684b47263",
    session_id: "session-one", event_time: "2026-10-13T10:00:00Z", created_at: "2026-10-13T10:00:00Z" }]);
  for (const projection of [one, projected()]) {
    const result = await run(request(), { result: success(projection) });
    assert.equal(result.code, 200);
    assert.deepEqual(result.body.projection, projection);
    const p = result.body.projection;
    assert.equal(p.sessions_observed, p.sessions_ended_by_inactivity + p.sessions_active + p.sessions_unknown + p.sessions_ambiguous);
    assert.equal(p.visitors_observed, p.returning_visitors_observed + p.new_visitors_observed + p.visitors_unknown + p.visitors_ambiguous);
    assert.equal(p.new_visitors_observed, 0);
    assert.equal(p.authority, "not_authoritative");
  }
});

test("READ_FAILED and INCOMPLETE preserve safe status, discard raw error coverage/projection", async () => {
  for (const status of ["READ_FAILED", "INCOMPLETE", "LIMIT_EXCEEDED", "INVALID_STORAGE", "INVALID_INPUT"]) {
    const result = await run(request(), { result: { status, coverage: { secret: "raw-url" },
      projection: { visitor_id: "private", email: "private@example.invalid" }, Authorization: "secret" } });
    assert.equal(result.code, 502);
    assert.equal(result.body.status, status);
    assert.equal(result.body.projection, null);
    assert.equal(result.body.coverage.complete, false);
    assert.equal(result.body.coverage.consistency, "unverified");
    const output = JSON.stringify(result.body);
    for (const value of ["private", "raw-url", "Authorization", "secret", "visitor_id", "email"])
      assert.equal(output.includes(value), false);
  }
});

test("exceptions, unknown statuses and malformed successes fail closed without stack or secrets", async () => {
  const badResults = [null, { status: "https://secret.invalid" }, { ...success(), coverage: null },
    { ...success(), projection: { ...projected(), visitor_id: "private" } },
    success({ ...projected(), authority: "authoritative" }), success({ ...projected(), new_visitors_observed: 1 }),
    success({ ...projected(), sessions_active: 1 }), success({ ...projected(), visitors_unknown: 1 }),
    success({ ...projected(), delayed_event_cases: -1 }), success({ ...projected(), sessions_observed: NaN })];
  for (const result of badResults) {
    const out = await run(request(), { result });
    assert.equal(out.code, 502);
    assert.equal(out.body.status, "READ_FAILED");
    assert.equal(out.body.projection, null);
  }
  const out = await run(request(), { error: new Error("Authorization secret https://storage.invalid private@example.invalid") });
  assert.deepEqual(out.body, { status: "READ_FAILED", coverage: { ...WINDOW, complete: false,
    consistency: "unverified", snapshot: "not_guaranteed" }, projection: null });
});

test("success metadata is rebuilt from allowlists, never from arbitrary reader fields", async () => {
  const result = success();
  result.coverage.SUPABASE_URL = "https://secret.invalid";
  result.env = { Authorization: "secret", gclid: "private", session_id: "private" };
  const out = await run(request(), { result });
  assert.equal(out.code, 200);
  for (const value of ["SUPABASE", "secret", "Authorization", "gclid", "session_id", "http"])
    assert.equal(JSON.stringify(out.body).includes(value), false);
});

test("caller does not mutate reader/producer/public contracts/tracking or make a direct storage call", async () => {
  const files = ["observed-session-return.js", "observed-session-return-reader.js", "audience-persistence.js",
    "audience-persistence-transport.js", "index.html", "ads-intelligence.js", "ads-routes.js", "vercel.json"];
  const hashes = () => files.map(p => crypto.createHash("sha256").update(fs.readFileSync(__dirname + "/" + p)).digest("hex"));
  const prior = hashes(), originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("caller must only use injected reader"); };
  try {
    assert.equal((await run()).code, 200);
    assert.deepEqual(hashes(), prior);
    const source = fs.readFileSync(__dirname + "/observed-session-reader-diagnostic.js", "utf8");
    assert.match(source, /read = readObservedSessionReturnProjection/);
    assert.match(source, /export default createObservedSessionDiagnostic\(\)/);
    assert.match(source, /authorizedMiaRead/);
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("console."), false);
    const res = response();
    await deployed({ method: "GET", headers: {}, url: PATH }, res);
    assert.equal(res.code, 404);
  } finally { global.fetch = originalFetch; }
});
