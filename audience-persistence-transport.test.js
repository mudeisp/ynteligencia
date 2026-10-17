const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const producer = require("./audience-persistence.js");

const FROM = "2026-10-13T00:00:00.000Z", TO = "2026-10-14T00:00:00.000Z";
const VISITOR = "83c98ca3-22ca-43a9-a7ed-9fb684b47263";
const unknown = producer.projectAudiencePersistence();
function row(index, extra = {}) {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event_id: `event-${index}`, visitor_id: VISITOR, session_id: `session-${index % 3}`,
    event_time: "2026-10-13T12:00:00.000Z", ...extra };
}
function request(extra = {}) {
  return { method: "GET", query: { action: "audience-persistence", from: FROM, to: TO },
    headers: { authorization: "Bearer internal-secret" }, ...extra };
}
async function invoke(req = request(), handler) {
  const headers = {};
  let code, body;
  const res = { setHeader(key, value) { headers[key] = value; },
    status(value) { code = value; return this; }, json(value) { body = value; return this; } };
  await (handler || (await import("./audience-persistence-transport.js")).handleAudiencePersistence)(req, res);
  return { code, body, headers };
}
function json(data, range, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: range === undefined ? {} : { "Content-Range": range } });
}
function storage(rows, cap = 200) {
  return async url => {
    const query = new URL(url).searchParams;
    const offset = Number(query.get("offset"));
    const data = rows.slice(offset, offset + Math.min(cap, Number(query.get("limit"))));
    return json(data, data.length ? `${offset}-${offset + data.length - 1}/${rows.length}` : `*/${rows.length}`, 200);
  };
}
async function withServer(fetcher, run, env = {}) {
  const values = { SUPABASE_URL: "https://storage.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-key",
    SUPABASE_SECRET_KEY: undefined, MIA_READ_TOKEN: "internal-secret", MIA_READ_TOKEN_PREVIOUS: "previous-secret", ...env };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const originalFetch = global.fetch;
  const originalProject = producer.projectAudiencePersistence;
  const calls = [], projections = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Prefer, "count=exact");
    assert.equal(new URL(url).pathname, "/rest/v1/ads_events");
    assert.equal(new URL(url).searchParams.get("select"), "id,event_id,visitor_id,session_id,event_time");
    assert.deepEqual(new URL(url).searchParams.getAll("event_time"), [`gte.${FROM}`, `lt.${TO}`]);
    assert.equal(options.signal.aborted, false);
    return fetcher(url, options, calls.length);
  };
  producer.projectAudiencePersistence = input => {
    projections.push({ input, afterReads: calls.length });
    return originalProject(input);
  };
  try { await run(calls, projections); }
  finally {
    global.fetch = originalFetch;
    producer.projectAudiencePersistence = originalProject;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("multiple pages: exhaust exact totals twice before invoking original producer once", async () => {
  const rows = Array.from({ length: 405 }, (_, i) => row(i + 1));
  await withServer(storage(rows), async (calls, projections) => {
    const result = await invoke();
    assert.equal(result.code, 200);
    assert.deepEqual(calls.map(call => Number(new URL(call.url).searchParams.get("offset"))), [0, 200, 400, 0, 200, 400]);
    assert.equal(projections.length, 1);
    assert.equal(projections[0].afterReads, 6);
    assert.equal(projections[0].input.complete, true);
    assert.equal(projections[0].input.events.length, 405);
    assert.equal(result.body.visitors_observed, 1);
    assert.equal(result.body.sessions_observed, 3);
    assert.equal(result.body.return_status, "unresolved");
  });
});

test("a single complete page produces observed data; empty complete data produces real zeros", async () => {
  for (const rows of [[row(1)], []]) await withServer(storage(rows), async (calls, projections) => {
    const result = await invoke();
    assert.equal(result.code, 200);
    assert.equal(calls.length, 2);
    assert.equal(projections.length, 1);
    assert.equal(result.body.visitors_observed, rows.length);
    assert.equal(result.body.sample_size, rows.length);
    assert.equal(result.body.sessions_observed, rows.length);
    assert.equal(result.body.visitors_with_multiple_sessions, 0);
    assert.equal(result.body.session_end_authority, "UNRESOLVED");
    assert.equal(result.body.client_is_returning_adopted, false);
    assert.equal(result.body.new_vs_returning, "unknown");
  });
});

test("server-capped short pages continue until exact total, never infer zero/completion from length", async () => {
  await withServer(storage([row(1), row(2), row(3)], 1), async calls => {
    const result = await invoke();
    assert.equal(result.code, 200);
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.map(call => Number(new URL(call.url).searchParams.get("offset"))), [0, 1, 2, 0, 1, 2]);
  });
});

test("intermediate HTTP/network failure returns unknown without invoking producer or exposing errors", async () => {
  for (const fail of [() => json({ email: "private@example.test" }, undefined, 500),
    () => { throw new Error("gclid=PRIVATE-NETWORK-ERROR"); }]) {
    await withServer((url, opts, index) => index === 2 ? fail() : storage([row(1), row(2)], 1)(url),
      async (calls, projections) => {
        const result = await invoke();
        assert.equal(result.code, 502);
        assert.deepEqual(result.body, unknown);
        assert.equal(calls.length, 2);
        assert.equal(projections.length, 0);
      });
  }
});

test("incomplete/invalid storage evidence fails closed rather than publishing partial or zero counts", async () => {
  const bad = [json([], undefined), json([], "*/*"), json([], "*/1"), json({}, "*/0"),
    json(null, "*/0"), json([], "0-0/0"), json([row(1)], "1-1/1"),
    json([row(1)], "0-1/2"), json([row(1)], "0-0/20001"), json([null], "0-0/1"),
    json([row(1, { event_time: TO })], "0-0/1"), json([row(1, { event_time: "invalid" })], "0-0/1")];
  for (const response of bad) await withServer(() => response.clone(), async (_, projections) => {
    const result = await invoke();
    assert.equal(result.code, 502);
    assert.deepEqual(result.body, unknown);
    assert.equal(projections.length, 0);
  });
});

test("gap, overlap, non-progress, changing exact totals or second-pass content invalidates completeness", async () => {
  const cases = [
    index => index === 1 ? json([row(1)], "0-0/2") : json([], "*/2"),
    index => index === 1 ? json([row(1)], "0-0/2") : json([row(1)], "1-1/2"),
    index => index === 1 ? json([row(1)], "0-0/2") : json([row(2)], "1-1/3"),
    index => index === 1 ? json([row(1)], "0-0/1") : json([row(1, { session_id: "changed" })], "0-0/1"),
    index => index === 1 ? json([], "*/0") : json([row(1)], "0-0/1")
  ];
  for (const fetcher of cases) await withServer((url, opts, index) => fetcher(index), async (_, projections) => {
    const result = await invoke();
    assert.equal(result.code, 502);
    assert.deepEqual(result.body, unknown);
    assert.equal(projections.length, 0);
  });
});

test("duplicate event identity does not inflate counts; conflicting identity or malformed UUID stays invalid", async () => {
  for (const extra of [{ event_id: "event-1", session_id: "session-1" },
    { event_id: "event-1", session_id: "different" }, { visitor_id: "bad-uuid" }]) {
    await withServer(storage([row(1), row(2, extra)]), async (_, projections) => {
      const result = await invoke();
      assert.equal(projections.length, 1);
      if (extra.session_id === "session-1") {
        assert.equal(result.code, 200);
        assert.equal(result.body.sessions_observed, 1);
      } else {
        assert.equal(result.code, 502);
        assert.equal(result.body.status, "invalid");
        assert.equal(result.body.sample_size, null);
      }
    });
  }
});

test("verification page failures, page budget and aborted reads never call the producer", async () => {
  for (const fetcher of [
    (url, opts, index) => index === 1 ? storage([row(1)])(url) : json([], undefined, 500),
    storage(Array.from({ length: 201 }, (_, index) => row(index + 1)), 1)
  ]) await withServer(fetcher, async (_, projections) => {
    const result = await invoke();
    assert.equal(result.code, 502);
    assert.deepEqual(result.body, unknown);
    assert.equal(projections.length, 0);
  });
  const original = AbortSignal.timeout;
  AbortSignal.timeout = () => AbortSignal.abort();
  try {
    await withServer(() => assert.fail("unexpected read"), async (_, projections) => {
      assert.deepEqual((await invoke()).body, unknown);
      assert.equal(projections.length, 0);
    });
  } finally { AbortSignal.timeout = original; }
});

test("actual runtime import graph is allowlisted and loading performs no I/O or send/execution", () => {
  const script = `
    const { registerHooks } = require('node:module');
    const { fileURLToPath } = require('node:url');
    const path = require('node:path');
    const allowed = new Set(['audience-persistence-transport.js', 'audience-persistence.js',
      'ads-store.js', 'ads-intelligence.js', 'buyer-profile.js', 'quality-scoring.js', 'mia-read.js']
      .map(file => path.resolve(file)));
    const unexpected = [];
    registerHooks({ resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (result.url === 'node:crypto') return result;
      if (!result.url.startsWith('file:') || !allowed.has(fileURLToPath(result.url))) {
        unexpected.push(result.url);
        throw new Error('Unexpected runtime dependency: ' + result.url);
      }
      return result;
    } });
    process.on('beforeExit', () => { if (unexpected.length) process.exitCode = 1; });
    global.fetch = global.WebSocket = () => { throw new Error('Unexpected I/O'); };
    import('./audience-persistence-transport.js').then(async module => {
      const res = { setHeader() {}, status(code) { if (code !== 405) throw new Error('status'); return this; }, json() {} };
      await module.handleAudiencePersistence({ method: 'POST', headers: {} }, res);
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: __dirname, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("S2S bearer only, current/previous token; browser/CORS, query tokens, wrong method and invalid windows are rejected", async () => {
  await withServer(storage([]), async calls => {
    for (const token of ["internal-secret", "previous-secret"]) {
      assert.equal((await invoke(request({ headers: { authorization: `Bearer ${token}` } }))).code, 200);
    }
    assert.equal((await invoke(request({ headers: {
      authorization: "Bearer internal-secret", "sec-fetch-mode": "cors"
    } }))).code, 200);
    calls.length = 0;
    const cases = [
      [request({ headers: {} }), 401], [request({ headers: { authorization: "Bearer wrong" } }), 401],
      [request({ headers: { authorization: "Bearer internal-secret", origin: "https://app.yincorp.com.br" } }), 403],
      [request({ headers: { authorization: "Bearer internal-secret", "sec-fetch-site": "same-origin" } }), 403],
      [request({ headers: { authorization: "Bearer internal-secret", "sec-fetch-dest": "empty" } }), 403],
      [request({ method: "OPTIONS" }), 405], [request({ method: "POST" }), 405],
      [request({ query: { from: FROM } }), 400],
      [request({ query: { from: FROM, to: TO, token: "internal-secret" } }), 400],
      [request({ query: { from: FROM, to: TO, cursor: "x" } }), 400],
      [request({ query: { from: FROM, to: TO, limit: 1 } }), 400],
      [request({ query: { from: TO, to: FROM } }), 400],
      [request({ query: { from: FROM, to: "2099-10-14T00:00:00.000Z" } }), 400],
      [request({ query: { from: "2026-10-01T00:00:00.000Z", to: TO } }), 400],
      [request({ url: `/?from=${FROM}&from=${FROM}&to=${TO}` }), 400],
      [request({ query: { from: [FROM, FROM], to: TO } }), 400]
    ];
    for (const [req, expected] of cases) {
      const result = await invoke(req);
      assert.equal(result.code, expected);
      assert.deepEqual(result.body, unknown);
      assert.equal(Object.keys(result.headers).some(key => key.toLowerCase().startsWith("access-control")), false);
    }
    assert.equal(calls.length, 0);
  });
  for (const env of [{ MIA_READ_TOKEN: undefined }, { SUPABASE_URL: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined }])
    await withServer(() => assert.fail("unexpected read"), async () => {
      assert.equal((await invoke()).code, 503);
    }, env);
});

test("final payload is only the sanitized producer object, without PII/IDs/raw or hashed clicks", async () => {
  const extra = Object.fromEntries(["gclid", "gbraid", "wbraid", "fbclid", "hashed_gclid", "lead_id", "email", "phone", "name",
    "address", "document", "url", "referrer", "history", "conversation", "event_data", "metadata", "ip", "user_agent"]
    .map(key => [key, `PRIVATE-${key}`]));
  await withServer(storage([row(1, extra)]), async (_, projections) => {
    const result = await invoke();
    const final = JSON.stringify(result.body);
    assert.deepEqual(result.body, producer.projectAudiencePersistence({ source: "ads_events", complete: true, events: [row(1)] }));
    for (const forbidden of [VISITOR, "event-1", "session-1", "PRIVATE-", "visitor_id", "session_id", "event_id", ...Object.keys(extra)])
      assert.equal(final.includes(forbidden === "ip" ? '"ip"' : forbidden), false, forbidden);
    assert.equal(projections[0].input.events[0].metadata, undefined);
    assert.match(result.headers["Cache-Control"], /no-store/);
  });
});

test("producer remains byte-identical to main and the existing rest return shape is opt-in", async () => {
  const bytes = fs.readFileSync(require.resolve("./audience-persistence.js"));
  const gitBlob = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  // Hash normalized LF to also support Windows autocrlf checkouts.
  const lf = Buffer.from(bytes.toString().replace(/\r\n/g, "\n"));
  assert.equal(crypto.createHash("sha1").update(`blob ${lf.length}\0`).update(lf).digest("hex"), "02dea50c54c7cba35ad510c403b8fb51374668d7", gitBlob);
  const { rest } = await import("./ads-store.js");
  const original = global.fetch;
  global.fetch = async () => json([], "*/0");
  try {
    assert.deepEqual(await rest("ads_events"), { ok: true, status: 200, data: [] });
    assert.deepEqual(await rest("ads_events", { includeContentRange: true }), { ok: true, status: 200, data: [], contentRange: "*/0" });
  } finally { global.fetch = original; }
});

test("local HTTP integration: full persisted fixture -> real REST adapter -> API action -> sanitized original producer", async () => {
  const rows = [row(1), row(2), row(3)];
  const methods = [];
  const db = http.createServer(async (req, res) => {
    methods.push(req.method);
    assert.equal(req.headers.authorization, "Bearer fixture-key");
    const response = await storage(rows, 1)(`http://127.0.0.1${req.url}`);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise(resolve => db.listen(0, "127.0.0.1", resolve));
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, token: process.env.MIA_READ_TOKEN };
  process.env.SUPABASE_URL = `http://127.0.0.1:${db.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-key";
  process.env.MIA_READ_TOKEN = "internal-secret";
  let api;
  try {
    const { default: handler } = await import("./api/ads.js");
    api = http.createServer((req, res) => {
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => res.end(JSON.stringify(body));
      Promise.resolve(handler(req, res)).catch(error => res.destroy(error));
    });
    await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${api.address().port}/api/ads?` +
      new URLSearchParams({ action: "audience-persistence", from: FROM, to: TO });
    // Native Node fetch sends Sec-Fetch-Mode: cors even from a trusted server.
    const response = await fetch(url, { headers: { authorization: "Bearer internal-secret" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), producer.projectAudiencePersistence({ source: "ads_events", complete: true, events: rows }));
    const browser = await fetch(url, { headers: { authorization: "Bearer internal-secret", origin: "https://app.yincorp.com.br" } });
    assert.equal(browser.status, 403);
    assert.equal(browser.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await browser.json(), unknown);
    assert.deepEqual(methods, Array(6).fill("GET"));
  } finally {
    for (const [key, value] of Object.entries({ SUPABASE_URL: before.url, SUPABASE_SERVICE_ROLE_KEY: before.key, MIA_READ_TOKEN: before.token })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise(resolve => db.close(resolve));
    if (api) await new Promise(resolve => api.close(resolve));
  }
});
