const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { projectAudiencePersistence: project } = require("./audience-persistence.js");

const V1 = "83c98ca3-22ca-43a9-a7ed-9fb684b47263";
const V2 = "59a109de-be94-47d4-9f53-8884fd51cfe4";
const event = (event_id = "event-one", session_id = "session-one", visitor_id = V1) =>
  ({ event_id, session_id, visitor_id });
const snapshot = (events = []) => ({ source: "ads_events", complete: true, events });

test("missing or incomplete evidence stays unknown, including null, not zero", () => {
  for (const input of [undefined, null, [], {}, snapshot(null),
    { ...snapshot(), complete: false }, { ...snapshot(), source: "client" },
    { ...snapshot(), events: undefined }]) {
    const result = project(input);
    assert.equal(result.status, "unknown");
    for (const key of ["visitors_observed", "sessions_observed", "visitors_with_multiple_sessions", "sample_size"])
      assert.equal(result[key], null);
    assert.equal(result.return_status, "unknown");
  }
});

test("a successful complete empty slice is observed zero with exact consumer shape", () => {
  assert.deepEqual(project(snapshot()), {
    version: "audience-persistence/1", status: "observed", session_end_authority: "UNRESOLVED",
    visitors_observed: 0, sessions_observed: 0, visitors_with_multiple_sessions: 0,
    return_status: "unresolved", new_vs_returning: "unknown", client_is_returning_adopted: false, sample_size: 0
  });
});

test("count distinct visitor/session pairs without promoting recurrence to return", () => {
  const result = project(snapshot([event(), event(), event("two"), event("three", "second"),
    event("four", "session-one", V2)]));
  assert.equal(result.visitors_observed, 2);
  assert.equal(result.sessions_observed, 3);
  assert.equal(result.visitors_with_multiple_sessions, 1);
  assert.equal(result.sample_size, 2);
  assert.equal(result.return_status, "unresolved");
  assert.equal(result.new_vs_returning, "unknown");
  assert.equal(result.session_end_authority, "UNRESOLVED");
  assert.equal("eligible" in result, false);
});

test("client flags, timestamps, session events and repeated property views confer no authority", () => {
  const base = snapshot([event(), event("two")]);
  const decorated = snapshot(base.events.map(row => ({ ...row, is_returning: true,
    first_seen: "2020-01-01", last_seen: "2026-10-17", session_end: true,
    event_name: "property_view", metadata: { is_returning: true, session_end: true } })));
  assert.deepEqual(project(decorated), project(base));
  decorated.events[0].event_name = "session_start";
  assert.deepEqual(project(decorated), project(base));
});

test("malformed rows or conflicting event identity invalidate the whole slice without partial counts", () => {
  for (const events of [{}, [null], [event(), {}], [event("x"), event("x", "different")],
    [event("x"), event("x", "session-one", V2)], [event("", "session")],
    [event("e", "")], [event("e", "a".repeat(121))], [event("e", " x")],
    [event("e", "x\n")], [event("e", "s", "not-a-uuid")], [event("e", "s", V1 + "\n")]]) {
    const result = project(snapshot(events));
    assert.equal(result.status, "invalid");
    assert.equal(result.visitors_observed, null);
    assert.equal(result.sessions_observed, null);
    assert.equal(result.sample_size, null);
  }
});

test("UUID case and row order do not change counts; projection is deterministic and immutable", () => {
  const rows = [event(), event("two", "other", V1.toUpperCase()), event("three", "s", V2)];
  rows.forEach(Object.freeze);
  const input = Object.freeze(snapshot(Object.freeze(rows)));
  const before = JSON.stringify(input);
  assert.deepEqual(project(input), project(snapshot([...rows].reverse())));
  assert.deepEqual(project(input), project(input));
  assert.equal(JSON.stringify(input), before);
  assert.equal(project(input).visitors_observed, 2);
});

test("privacy allowlist excludes individual identifiers, PII, raw/hashed clicks and payloads", () => {
  const privateFields = Object.fromEntries([
    "lead_id", "gclid", "gbraid", "wbraid", "fbclid", "hashed_gclid", "hashed_gbraid", "hashed_wbraid",
    "email", "phone", "name", "document", "address", "message", "url", "referrer", "conversation",
    "history", "metadata", "fingerprint", "ip", "user_agent"
  ].map(key => [key, `PRIVATE-${key}`]));
  const input = snapshot([{ ...event(), ...privateFields }]);
  const result = project(input);
  const serialized = JSON.stringify(result);
  assert.deepEqual(Object.keys(result).sort(), ["version", "status", "session_end_authority",
    "visitors_observed", "sessions_observed", "visitors_with_multiple_sessions", "return_status",
    "new_vs_returning", "client_is_returning_adopted", "sample_size"].sort());
  for (const forbidden of ["visitor_id", "session_id", "event_id", ...Object.keys(privateFields),
    V1, "event-one", "session-one", "PRIVATE-"]) {
    // "ip" occurs inside the allowed word "multiple"; check its key exactly.
    assert.equal(serialized.includes(forbidden === "ip" ? '"ip"' : forbidden), false, forbidden);
  }
  assert.deepEqual(result, project(snapshot([event()])));
});

test("runtime dependency graph is empty: no external writes/calls, senders, executor, MIA or cycle", () => {
  // Intercept actual CommonJS loads in a fresh process, including transitive/dynamic requires.
  // Network globals throw; only the target may be loaded. Exercise every outcome.
  const script = `
    const Module = require('node:module');
    const path = require.resolve('./audience-persistence.js');
    const load = Module._load;
    Module._load = function(id, ...args) {
      if (id !== path) throw new Error('Unexpected runtime dependency: ' + id);
      return load.call(this, id, ...args);
    };
    global.fetch = global.WebSocket = () => { throw new Error('Network forbidden'); };
    const { projectAudiencePersistence: project } = require(path);
    project(); project({ source: 'ads_events', complete: true, events: [] });
    project({ source: 'ads_events', complete: true, events: [null] });
    project(${JSON.stringify(snapshot([event(), event("two", "second")]))});
    setImmediate(() => {
      const children = require.cache[path].children;
      if (children.length !== 0) throw new Error('Nonempty runtime graph');
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], { cwd: __dirname, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
});
