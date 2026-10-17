const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { projectObservedSessionReturn: project } = require("./observed-session-return.js");

const V = "83c98ca3-22ca-43a9-a7ed-9fb684b47263";
const V2 = "59a109de-be94-47d4-9f53-8884fd51cfe4";
const at = time => `2026-10-17T${time}:00.000Z`;
const row = (id = "event-one", session = "session-one", time = "10:00", extra = {}) => ({
  event_id: id, visitor_id: V, session_id: session, event_time: at(time), created_at: at(time), ...extra
});
const input = (events = [], extra = {}) => ({ source: "ads_events", complete: true,
  coverage_start: at("09:00"), as_of: at("12:00"), events, ...extra });
function conserved(result) {
  assert.equal(result.sessions_observed, result.sessions_active + result.sessions_ended_by_inactivity +
    result.sessions_ambiguous + result.sessions_unknown);
  assert.equal(result.visitors_observed, result.returning_visitors_observed + result.new_visitors_observed +
    result.visitors_ambiguous + result.visitors_unknown);
  assert.equal(result.authority, "not_authoritative");
}

test("multiple events, reload and same-session tabs are one observation, never return", () => {
  const events = [row(), row("reload", "session-one", "10:05"), row("tab", "session-one", "10:06")];
  const result = project(input(events));
  assert.equal(result.sessions_observed, 1);
  assert.equal(result.sessions_ended_by_inactivity, 1);
  assert.equal(result.returning_visitors_observed, 0);
  assert.equal(result.visitors_unknown, 1);
  conserved(result);
});

test("two separated sessions establish observed recurrence, never authority", () => {
  const result = project(input([row(), row("two", "session-two", "11:00")]));
  assert.equal(result.returning_visitors_observed, 1);
  assert.equal(result.sessions_ended_by_inactivity, 2);
  assert.equal(result.new_visitors_observed, 0);
  conserved(result);
});

test("overlap, concurrent new tab and gaps shorter than policy taint the visitor", () => {
  for (const time of ["10:00", "10:10", "10:34"]) {
    const result = project(input([row(), row("two", "session-two", time)]));
    assert.equal(result.overlapping_session_cases, 1);
    assert.equal(result.sessions_ambiguous, 2);
    assert.equal(result.visitors_ambiguous, 1);
    assert.equal(result.returning_visitors_observed, 0);
    conserved(result);
  }
});

test("an old page emitting its stale session cannot manufacture a clean return", () => {
  const result = project(input([row(), row("two", "session-two", "11:00"), row("old", "session-one", "11:05")]));
  assert.equal(result.reused_session_gap_cases, 1);
  assert.equal(result.overlapping_session_cases, 1);
  assert.equal(result.sessions_ambiguous, 2);
  assert.equal(result.returning_visitors_observed, 0);
  conserved(result);
});

test("a reused session after inactivity is ambiguous even with no second session ID", () => {
  const result = project(input([row(), row("later", "session-one", "11:00")]));
  assert.equal(result.sessions_ambiguous, 1);
  assert.equal(result.reused_session_gap_cases, 1);
  conserved(result);
});

test("insufficient history is null evidence; a complete empty window is real zero", () => {
  for (const value of [undefined, {}, input(null), input([], { complete: false }), input([], { source: "client" })]) {
    const result = project(value);
    assert.equal(result.coverage_status, "incomplete");
    assert.equal(result.sessions_observed, null);
    assert.equal(result.returning_visitors_observed, null);
  }
  const zero = project(input());
  assert.equal(zero.coverage_status, "complete_window");
  assert.equal(zero.sessions_observed, 0);
  conserved(zero);
});

test("identity reset/storage loss is unknown, not new or joined to the previous visitor", () => {
  const result = project(input([row(), row("two", "session-two", "11:00", { visitor_id: V2 })]));
  assert.equal(result.visitors_unknown, 2);
  assert.equal(result.returning_visitors_observed, 0);
  assert.equal(result.new_visitors_observed, 0);
  conserved(result);
});

test("delayed persisted event, including an event predating coverage, stays ambiguous", () => {
  const result = project(input([row("one", "session-one", "08:00", { created_at: at("10:00") }),
    row("two", "session-two", "11:00")]));
  assert.equal(result.delayed_event_cases, 1);
  assert.equal(result.sessions_ambiguous, 2);
  assert.equal(result.returning_visitors_observed, 0);
  conserved(result);
});

test("future client clock and received-order clock reversal stay ambiguous", () => {
  for (const events of [
    [row("future", "session-one", "11:00", { created_at: at("10:00") })],
    [row("one", "session-one", "10:02"), row("two", "session-one", "10:01", { created_at: at("10:03") })]
  ]) {
    const result = project(input(events));
    assert.equal(result.clock_inconsistent_cases, 1);
    assert.equal(result.sessions_ambiguous, 1);
    conserved(result);
  }
});

test("synthetic IDs and explicit markers cannot be certified, including duplicate marker order", () => {
  const fixtures = ["abababab-abab-4bab-8bab-abababababab", "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
    "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    "11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111116",
    "22222222-2222-4222-8222-222222222216"];
  const marked = [...fixtures.map(visitor_id => row("one", "s-one", "10:00", { visitor_id })),
    row("fixture-one"), row("one", "qa-session"), row("one", "s-one", "10:00", { metadata: { test: true } }),
    row("one", "s-one", "10:00", { test: false, metadata: { test: true } })];
  for (const event of marked) {
    const result = project(input([event]));
    assert.equal(result.synthetic_event_cases, 1);
    assert.equal(result.sessions_ambiguous, 1);
    assert.equal(result.new_visitors_observed, 0);
    conserved(result);
  }
  const normal = row(), flagged = { ...normal, metadata: { test: true } };
  assert.deepEqual(project(input([normal, flagged])), project(input([flagged, normal])));
  assert.equal(project(input([normal, flagged])).synthetic_event_cases, 1);
});

test("idle/grace/separation boundaries and microseconds are explicit", () => {
  const event = row();
  for (const [time, key] of [["10:29", "sessions_active"], ["10:30", "sessions_unknown"],
    ["10:34", "sessions_unknown"], ["10:35", "sessions_ended_by_inactivity"]]) {
    const result = project(input([event], { as_of: at(time) }));
    assert.equal(result[key], 1);
    conserved(result);
  }
  const micro = { ...event, created_at: "2026-10-17T10:00:00.000001+00:00" };
  assert.equal(project(input([micro], { as_of: at("10:35") })).sessions_unknown, 1);
  assert.equal(project(input([event, row("two", "second", "10:35")])).returning_visitors_observed, 1);
});

test("a session ID shared by different visitor identities is ambiguous for both", () => {
  const result = project(input([row(), row("two", "session-one", "11:00", { visitor_id: V2 })]));
  assert.equal(result.sessions_ambiguous, 2);
  assert.equal(result.visitors_ambiguous, 2);
  assert.equal(result.returning_visitors_observed, 0);
  conserved(result);
});

test("invalid timestamps, out-of-scope rows and conflicting evidence fail closed", () => {
  const values = [input([], { as_of: "2026-02-30T12:00:00Z" }), input([], { as_of: at("09:00") }),
    input([], { coverage_start: "not-a-date" }), input([null]), input([row("one", "", "10:00")]),
    input([row("one", "session-one", "10:00", { created_at: null })]),
    input([row("one", "session-one", "08:00")]), input([row("one", "session-one", "13:00")]),
    input([row(), row("event-one", "second", "11:00")]), input({}), input(Array(20001).fill(row()))];
  for (const value of values) {
    const result = project(value);
    assert.equal(result.coverage_status, "invalid");
    assert.equal(result.sessions_observed, null);
  }
});

test("deduplication, permutation, immutability and client claims do not change observation", () => {
  const events = [row(), row("two", "second", "11:00")];
  const baseline = project(input(events));
  const decorated = input([...events, events[0]].reverse().map(event => Object.freeze({ ...event,
    is_returning: true, metadata: Object.freeze({ is_returning: true, session_end: true }),
    email: "private@example.invalid", gclid: "private-click", url: "https://private.invalid/person" })));
  const before = JSON.stringify(decorated);
  assert.deepEqual(project(Object.freeze(decorated)), baseline);
  assert.equal(JSON.stringify(decorated), before);
  const output = JSON.stringify(baseline);
  for (const forbidden of [V, "visitor_id", "session_id", "event_id", "gclid", "gbraid", "wbraid", "email",
    "private", "https://", "eligible", "AUTHORITATIVE"])
    assert.equal(output.includes(forbidden), false, forbidden);
  conserved(baseline);
});

test("isolated module has no runtime imports, clock, writes, sends or public V1 modification", () => {
  const run = spawnSync(process.execPath, ["-e", `
    const Module = require('node:module');
    const load = Module._load;
    const target = require.resolve('./observed-session-return.js');
    Module._load = function(id, parent, main) {
      if (id !== target) throw new Error('unexpected import');
      return load.call(this, id, parent, main);
    };
    global.fetch = global.setTimeout = global.setInterval = Date.now = () => { throw new Error('side effect'); };
    const project = require(target).projectObservedSessionReturn;
    const result = project(${JSON.stringify(input([row()]))});
    if (result.sessions_observed !== 1) throw new Error('projection');
  `], { cwd: __dirname, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const { projectAudiencePersistence } = require("./audience-persistence.js");
  const before = projectAudiencePersistence({ source: "ads_events", complete: true, events: [row()] });
  project(input([row()]));
  assert.deepEqual(projectAudiencePersistence({ source: "ads_events", complete: true, events: [row()] }), before);
  assert.equal(before.session_end_authority, "UNRESOLVED");
  assert.equal(before.new_vs_returning, "unknown");
});
