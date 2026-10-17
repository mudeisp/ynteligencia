/* Internal pure projection. No reader, runtime hook, public contract or authority. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MINUTE = 60000000n; // microseconds; retain Postgres timestamp precision
const IDLE = 30n * MINUTE;
const GRACE = 5n * MINUTE;
const COUNTS = ["sessions_observed", "sessions_ended_by_inactivity", "sessions_active",
  "sessions_ambiguous", "sessions_unknown", "visitors_observed", "returning_visitors_observed",
  "new_visitors_observed", "visitors_ambiguous", "visitors_unknown", "overlapping_session_cases",
  "delayed_event_cases", "clock_inconsistent_cases", "reused_session_gap_cases", "synthetic_event_cases"];

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function timestamp(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(match[1] + ".000Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== match[1] + ".000Z") return null;
  return BigInt(ms) * 1000n + BigInt((match[2] || "").padEnd(6, "0"));
}

// Same conservative repeated-nibble/motif policy as reconciliation; no operational imports.
function syntheticUuid(value) {
  if (!UUID.test(value)) return false;
  const parts = value.toLowerCase().split("-").map((part, i) => i === 2 || i === 3 ? part.slice(1) : part);
  const counts = Array(16).fill(0);
  for (const digit of parts.join("")) counts[parseInt(digit, 16)]++;
  const [a, b] = counts.map((count, digit) => ({ count, digit: digit.toString(16) })).sort((x, y) => y.count - x.count);
  if (a.count >= 28) return true;
  if (a.count + b.count < 28) return false;
  return parts.reduce((sum, part) => {
    let forward = 0, reverse = 0;
    for (let i = 0; i < part.length; i++) {
      if (part[i] === (i % 2 ? b.digit : a.digit)) forward++;
      if (part[i] === (i % 2 ? a.digit : b.digit)) reverse++;
    }
    return sum + Math.max(forward, reverse);
  }, 0) >= 28;
}

function synthetic(row) {
  return [row.test, row.metadata?.test].some(flag => /^(true|1)$/i.test(String(flag))) ||
    [row.visitor_id, row.session_id, row.event_id].some(syntheticUuid) ||
    /test|fixture|playwright|puppeteer|selenium|automation|qa[-_:]/i.test(
      [row.visitor_id, row.session_id, row.event_id].join(" "));
}

function shell(coverage) {
  return {
    version: "internal-session-return-observation/1",
    coverage_status: coverage,
    coverage_start: null,
    as_of: null,
    authority: "not_authoritative",
    inactivity_minutes: 30,
    lateness_grace_minutes: 5,
    new_identity_evidence: "unavailable",
    ...Object.fromEntries(COUNTS.map(key => [key, coverage === "complete_window" ? 0 : null]))
  };
}

/**
 * Trusted internal caller must supply all persisted rows RECEIVED in [coverage_start, as_of].
 * Completeness is a caller precondition, not something this pure function can verify.
 * No Date.now, I/O, env, client returning claim, inferred identity birth or eligibility.
 */
function projectObservedSessionReturn(input) {
  if (!record(input) || input.source !== "ads_events" || input.complete !== true || input.events == null)
    return shell("incomplete");
  const asOf = timestamp(input.as_of), start = timestamp(input.coverage_start);
  if (asOf === null || start === null || start >= asOf || !Array.isArray(input.events) || input.events.length > 20000)
    return shell("invalid");
  const result = shell("complete_window");
  result.coverage_start = input.coverage_start;
  result.as_of = input.as_of;
  const events = new Map(), visitors = new Map(), owners = new Map();
  for (const row of input.events) {
    if (!record(row) || !identifier(row.visitor_id, 36) || !UUID.test(row.visitor_id) ||
        !identifier(row.session_id, 120) || !identifier(row.event_id, 512)) return shell("invalid");
    const at = timestamp(row.event_time), received = timestamp(row.created_at);
    if (at === null || received === null || received < start || received > asOf) return shell("invalid");
    const visitor = row.visitor_id.toLowerCase();
    const key = JSON.stringify([visitor, row.session_id, String(at), String(received)]);
    const previous = events.get(row.event_id);
    if (previous) {
      if (previous.key !== key) return shell("invalid");
      previous.synthetic ||= synthetic(row); // duplicate order must not hide a test marker
      continue;
    }
    events.set(row.event_id, { key, visitor, session: row.session_id, at, received, synthetic: synthetic(row) });
  }
  for (const event of events.values()) {
    if (!owners.has(event.session)) owners.set(event.session, new Set());
    owners.get(event.session).add(event.visitor);
    if (!visitors.has(event.visitor)) visitors.set(event.visitor, new Map());
    const sessions = visitors.get(event.visitor);
    if (!sessions.has(event.session)) sessions.set(event.session, []);
    sessions.get(event.session).push(event);
  }
  result.visitors_observed = visitors.size;
  for (const sessions of visitors.values()) {
    let ambiguous = [...sessions.keys()].some(session => owners.get(session).size > 1);
    const intervals = [];
    for (const rows of sessions.values()) {
      rows.sort((a, b) => a.received < b.received ? -1 : a.received > b.received ? 1 :
        a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
      let firstAt = rows[0].at, lastAt = rows[0].at;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.synthetic) { result.synthetic_event_cases++; ambiguous = true; }
        if (row.at > row.received || (i && row.at < rows[i - 1].at)) {
          result.clock_inconsistent_cases++; ambiguous = true;
        }
        if (row.received - row.at > GRACE) { result.delayed_event_cases++; ambiguous = true; }
        if (i && (row.received - rows[i - 1].received >= IDLE || row.at - rows[i - 1].at >= IDLE)) {
          result.reused_session_gap_cases++; ambiguous = true;
        }
        if (row.at < firstAt) firstAt = row.at;
        if (row.at > lastAt) lastAt = row.at;
      }
      intervals.push({ first: rows[0].received, last: rows[rows.length - 1].received, firstAt, lastAt });
    }
    intervals.sort((a, b) => a.first < b.first ? -1 : a.first > b.first ? 1 :
      a.firstAt < b.firstAt ? -1 : a.firstAt > b.firstAt ? 1 : 0);
    let last = null, lastAt = null;
    for (const interval of intervals) {
      // Count later intervals conflicting with any earlier interval, not all pair combinations.
      if (last !== null && (interval.first - last < IDLE + GRACE || interval.firstAt - lastAt < IDLE + GRACE)) {
        result.overlapping_session_cases++; ambiguous = true;
      }
      if (last === null || interval.last > last) last = interval.last;
      if (lastAt === null || interval.lastAt > lastAt) lastAt = interval.lastAt;
    }
    result.sessions_observed += intervals.length;
    if (ambiguous) {
      result.visitors_ambiguous++;
      result.sessions_ambiguous += intervals.length;
      continue;
    }
    for (const interval of intervals) {
      const age = asOf - interval.last;
      if (age >= IDLE + GRACE) result.sessions_ended_by_inactivity++;
      else if (age < IDLE) result.sessions_active++;
      else result.sessions_unknown++; // idle threshold passed; lateness grace not settled
    }
    // Absence of an earlier row does not prove identity creation, even for complete windows.
    if (intervals.length >= 2) result.returning_visitors_observed++;
    else result.visitors_unknown++;
  }
  return result;
}

module.exports = { projectObservedSessionReturn };
