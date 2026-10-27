const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
let model, handler;
test.before(async () => {
  model = await import("./inventory-summary.js");
  handler = (await import("./api/search-properties.js")).default;
});
const at = "2026-10-15T10:00:00.000Z";
const row = { neighborhood: "Pinheiros", bedrooms_min: 1, price_band: "UP_TO_500K", available_properties: 20, new_count: 8, used_count: 12 };
function summary(groups = [row]) { return { schema_version: "ynt-inventory-summary/1", generated_at: at, city: "São Paulo", state: "SP", counting_unit: "active_priced_catalog_entries", complete: true, groups }; }
async function invoke(req) {
  let body; const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(value) { body = value; return this; } };
  await handler(req, res); return { status: res.code, headers: res.headers, body };
}
function request(overrides = {}) { return { method: "GET", url: "/api/search-properties?action=inventory-summary", query: { action: "inventory-summary" }, headers: { authorization: "Bearer test-mia-token" }, ...overrides }; }
async function withEnvironment(fetchImpl, run, env = {}) {
  const values = { MIA_READ_TOKEN: "test-mia-token", MIA_READ_TOKEN_PREVIOUS: undefined, ADS_EXPORT_TOKEN: "test-export-token", SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "private-service-key", SUPABASE_SECRET_KEY: undefined, ...env };
  const saved = new Map(Object.keys(values).map(key => [key, process.env[key]])); const previousFetch = global.fetch;
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  global.fetch = fetchImpl;
  try { return await run(); }
  finally { global.fetch = previousFetch; for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
function keys(value) { return !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(keys) : Object.keys(value).concat(Object.values(value).flatMap(keys)); }

test("exact consumer bands and canonical labels, no new inventory dimensions", () => {
  assert.deepEqual(model.PRICE_CAPS, { UP_TO_500K: 500000, UP_TO_1M: 1000000, UP_TO_2M: 2000000 });
  assert.equal(model.NEIGHBORHOODS.length, 63); assert.equal(model.catalogMatchesConsumer(), true);
});
test("valid complete summary produces only allowlisted aggregate keys and deterministic URL", () => {
  const result = model.projectInventorySummary(summary()); assert.equal(result.complete, true);
  assert.deepEqual(result.groups[0], { ...row, destination_url: "https://app.yincorp.com.br/?modo=explorar&cidade=S%C3%A3o+Paulo&estado=SP&bairro=Pinheiros&dormitorios=1&valor_max=500000&source=todos" });
});
test("empty complete inventory is valid with no invented groups", () => { assert.deepEqual(model.projectInventorySummary(summary([])).groups, []); });
test("partial, malformed and duplicate snapshots reject all rather than publishing totals", () => {
  for (const input of [null, {}, { ...summary(), complete: false }, summary([row, row]), summary([{ ...row, available_properties: 21 }]), summary([{ ...row, used_count: -1 }]), summary([{ ...row, price_band: "500k" }]), summary([{ ...row, bedrooms_min: 0 }]), summary([{ ...row, neighborhood: "person@example.test" }]), { ...summary(), city: "Rio" }, { ...summary(), generated_at: "invalid" }]) assert.equal(model.projectInventorySummary(input), null);
});
test("raw fields, IDs, malicious source URL and PII cannot be copied into output", () => {
  const secret = "private-person@example.test";
  const input = { ...summary([{ ...row, property_id: secret, name: secret, raw_data: { secret }, destination_url: "javascript:alert(1)" }]), visitor_id: secret, raw_behavior: secret };
  const output = model.projectInventorySummary(input); assert.equal(JSON.stringify(output).includes(secret), false); assert.equal(output.groups[0].destination_url.startsWith("https://app.yincorp.com.br/"), true);
  for (const key of ["property_id", "visitor_id", "session_id", "event_id", "lead_id", "gclid", "gbraid", "wbraid", "raw_data", "name", "email", "phone", "raw_behavior"]) assert.equal(keys(output).includes(key), false, key);
});
test("summary group ordering is deterministic", () => {
  const other = { ...row, neighborhood: "Brooklin" }; assert.deepEqual(model.projectInventorySummary(summary([row, other])), model.projectInventorySummary(summary([other, row])));
});
test("HTTP success performs one GET RPC, never SELECT star or paginated raw catalog reads", async () => {
  const calls = []; await withEnvironment(async (url, options) => { calls.push({ url, options }); return Response.json(summary()); }, async () => {
    const result = await invoke(request()); assert.equal(result.status, 200); assert.equal(result.body.complete, true); assert.equal(result.headers["Cache-Control"], "private, no-store");
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://supabase.test/rest/v1/rpc/mia_inventory_summary_v1"); assert.equal(calls[0].options.method, "GET"); assert.equal(calls[0].options.body, undefined); assert.equal(JSON.stringify(result).includes("private-service-key"), false);
  });
});
test("missing/wrong/export/query tokens never access Supabase", async () => {
  await withEnvironment(async () => { assert.fail("unauthorized database access"); }, async () => {
    for (const req of [request({ headers: {} }), request({ headers: { authorization: "Bearer wrong" } }), request({ headers: { authorization: "Bearer test-export-token" } }), request({ headers: {}, query: { action: "inventory-summary", token: "test-mia-token" } })]) assert.equal((await invoke(req)).status, 401);
  });
});
test("existing MIA_READ_TOKEN_PREVIOUS rotation is honored without new identity/token model", async () => {
  await withEnvironment(async () => Response.json(summary()), async () => { assert.equal((await invoke(request({ headers: { authorization: "Bearer rotating-token" } }))).status, 200); }, { MIA_READ_TOKEN_PREVIOUS: "rotating-token" });
});
test("missing token or service credentials fail closed before database read", async () => {
  for (const env of [{ MIA_READ_TOKEN: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined }]) await withEnvironment(async () => { assert.fail(); }, async () => { assert.equal((await invoke(request())).status, 503); }, env);
});
test("non-GET summary requests cannot fall through to public POST search", async () => {
  await withEnvironment(async () => { assert.fail(); }, async () => {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
      const result = await invoke(request({ method })); assert.equal(result.status, 405); assert.equal(result.headers.Allow, "GET");

    }
  });
});
test("network, timeout, missing-RPC and database errors return fixed errors without raw data", async () => {
  for (const read of [async () => { throw new Error("private-secret person@example.test"); }, async () => Response.json({ message: "private-secret", code: "PGRST202" }, { status: 404 }), async () => Response.json({ groups: [row], complete: false }, { status: 500 })]) await withEnvironment(read, async () => { const result = await invoke(request()); assert.equal(result.status, 503); assert.deepEqual(result.body, { success: false, error: "inventory_summary_unavailable" }); assert.equal("complete" in result.body, false); });
});
test("HTTP 200 partial/invalid RPC payload is rejected, never marked complete", async () => {
  await withEnvironment(async () => Response.json({ ...summary(), complete: false }), async () => { const result = await invoke(request()); assert.equal(result.status, 502); assert.deepEqual(result.body, { success: false, error: "invalid_inventory_summary" }); });
});
test("existing POST search remains unchanged and unknown GET keeps old 405", async () => {
  await withEnvironment(async () => { assert.fail(); }, async () => {
    assert.equal((await invoke({ method: "GET", url: "/api/search-properties", query: {}, headers: {} })).status, 405);
    const result = await invoke({ method: "POST", url: "/api/search-properties", query: {}, headers: {}, body: {} }); assert.equal(result.status, 500); assert.equal(result.body.error, "SUPABASE_URL não configurada");
  }, { SUPABASE_URL: undefined });
});
test("internal GET operation adds no Serverless Function or Ads routing; portal rewrites stay scoped", () => {
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8")); assert.deepEqual(config.crons, [{ path: "/api/push-daily", schedule: "0 13 * * *" }]);
  assert.equal(config.rewrites.length, 4);
  assert.ok(config.rewrites.every(rule => rule.destination.startsWith("/api/development?portalPath=") || (rule.source === "/api/portal/lead" && rule.destination === "/api/lead")));
  assert.ok(config.rewrites.every(rule => !rule.source.startsWith("/api/") || rule.source === "/api/portal/lead"));
  assert.equal(fs.readdirSync("api").filter(file => file.endsWith(".js")).length, 12);
  const code = fs.readFileSync("inventory-summary-route.js", "utf8"); assert.doesNotMatch(code, /console\.|\.insert\(|\.update\(|method:\s*"POST"|select=\*|raw_data/);
});
