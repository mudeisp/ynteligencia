/* Server-side projection of a complete persisted ads_events slice. No I/O or runtime dependencies. */
const VERSION = "audience-persistence/1";
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function signal(status, visitors = null, sessions = null, multiple = null) {
  // Construct every output field explicitly; never copy any source row or identifier.
  return {
    version: VERSION,
    status,
    session_end_authority: "UNRESOLVED",
    visitors_observed: visitors,
    sessions_observed: sessions,
    visitors_with_multiple_sessions: multiple,
    return_status: status === "observed" ? "unresolved" : "unknown",
    new_vs_returning: "unknown",
    client_is_returning_adopted: false,
    sample_size: visitors
  };
}

/**
 * Internal caller supplies ALL persisted rows of one declared observation scope,
 * after successful reads/pagination. A client payload or one mia-read page is not
 * evidence of completeness. Counts describe this slice, never lifetime audience.
 * Only event_id, visitor_id and session_id are read; other fields carry no authority.
 */
function projectAudiencePersistence(input) {
  if (!record(input)) return signal("unknown");
  if (input.source !== "ads_events" || input.complete !== true) return signal("unknown");
  if (input.events == null) return signal("unknown");
  if (!Array.isArray(input.events)) return signal("invalid");

  const events = new Map();
  const visitors = new Map();
  for (const row of input.events) {
    if (!record(row) || typeof row.visitor_id !== "string" || row.visitor_id.length !== 36 || !VISITOR_ID.test(row.visitor_id) ||
        !identifier(row.session_id, 120) || !identifier(row.event_id, 512)) return signal("invalid");
    const visitor = row.visitor_id.toLowerCase();
    const pair = JSON.stringify([visitor, row.session_id]);
    // Repeated delivery of the same event is harmless; conflicting identity is not.
    if (events.has(row.event_id) && events.get(row.event_id) !== pair) return signal("invalid");
    events.set(row.event_id, pair);
    if (!visitors.has(visitor)) visitors.set(visitor, new Set());
    visitors.get(visitor).add(row.session_id);
  }

  let sessions = 0;
  let multiple = 0;
  for (const observed of visitors.values()) {
    sessions += observed.size;
    if (observed.size > 1) multiple += 1;
  }
  return signal("observed", visitors.size, sessions, multiple);
}

module.exports = { projectAudiencePersistence };
