/*
  Buyer Profile V1.

  ads_events continua sendo o histórico. Esta projeção guarda
  identidade técnica, preferência declarada e agregados de comportamento.
  Falha aqui não pode impedir o evento, o handoff nem o lead.
*/

const PROFILE_EVENTS = new Set([
  "ad_entry",
  "ai_search",
  "property_view",
  "property_view_multiple",
  "agent_handoff_created",
  "agent_opened",
  "lead_created"
]);
const DECLARED_EVENTS = new Set(["ad_entry", "ai_search"]);
const PROPERTY_EVENTS = new Set([
  "property_view",
  "property_view_multiple",
  "agent_handoff_created",
  "agent_opened",
  "lead_created"
]);
const PII_KEYS = new Set([
  "nome",
  "name_lead",
  "telefone",
  "phone",
  "email",
  "lead_summary",
  "mensagem",
  "conversation",
  "conversation_text",
  "transcript",
  "notes"
]);
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVENTORY_SOURCES = new Set(["novos", "usados", "todos"]);
const STAGE_RANK = { anonymous: 0, exploring: 1, engaged: 2, lead: 3 };
const VIEWED_PROPERTY_CAP = 200;
const SESSION_CAP = 80;
const EVENT_CAP = 300;
const LIST_CAP = 12;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fold(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clip(value, max = 180) {
  return clean(value).slice(0, max);
}

function scrub(value, max = 180) {
  return clip(
    clean(value)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
      .replace(/\+?\d[\d\s().-]{8,}\d/g, ""),
    max
  );
}

function positive(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function whole(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

function isVisitorId(value) {
  return VISITOR_ID_PATTERN.test(clean(value));
}

function omitPii(value) {
  if (!value || typeof value !== "object") return {};
  if (Array.isArray(value)) return {};
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (PII_KEYS.has(String(key).toLowerCase())) continue;
    if (item && typeof item === "object") continue;
    copy[key] = item;
  }
  return copy;
}

function copyList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(item => clean(item)).filter(Boolean) : [];
}

function copyTouch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const touch = {};
  for (const key of ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "product", "at"]) {
    const text = clean(value[key]);
    if (text) touch[key] = text;
  }
  return touch;
}

function hasTouch(touch) {
  return Boolean(touch && (touch.gclid || touch.gbraid || touch.wbraid || touch.utm_source || touch.utm_campaign));
}

function blankProfile(visitorId, at) {
  return {
    visitor_id: visitorId,
    buyer_id: null,
    first_seen_at: at,
    last_seen_at: at,
    total_sessions: 0,
    city: "",
    state: "",
    regions: [],
    neighborhoods: [],
    property_types: [],
    bedrooms_min: null,
    bedrooms_max: null,
    min_price: null,
    max_price: null,
    inventory_sources: [],
    purpose: "",
    total_property_views: 0,
    unique_properties_viewed: 0,
    total_ai_searches: 0,
    total_agent_opens: 0,
    total_leads: 0,
    last_property_id: "",
    last_property_name: "",
    last_property_neighborhood: "",
    last_search_summary: "",
    last_activity_type: "",
    last_activity_at: null,
    observed_neighborhoods: [],
    first_touch: {},
    current_touch: {},
    last_gclid: "",
    last_utm_source: "",
    last_utm_medium: "",
    last_utm_campaign: "",
    stage: "anonymous",
    viewed_property_ids: [],
    known_session_ids: [],
    applied_event_ids: [],
    created_at: at,
    updated_at: at
  };
}

function fromRow(row) {
  const at = clean(row.first_seen_at || row.created_at) || new Date().toISOString();
  const profile = blankProfile(clean(row.visitor_id), at);
  profile.buyer_id = isVisitorId(row.buyer_id) ? clean(row.buyer_id) : null;
  profile.first_seen_at = clean(row.first_seen_at) || at;
  profile.last_seen_at = clean(row.last_seen_at) || profile.first_seen_at;
  profile.total_sessions = whole(row.total_sessions);
  profile.city = scrub(row.city, 80);
  profile.state = scrub(row.state, 40);
  profile.regions = copyList(row.regions).slice(-LIST_CAP);
  profile.neighborhoods = copyList(row.neighborhoods).slice(-LIST_CAP);
  profile.property_types = copyList(row.property_types).slice(-LIST_CAP);
  profile.bedrooms_min = whole(row.bedrooms_min) || null;
  profile.bedrooms_max = whole(row.bedrooms_max) || null;
  profile.min_price = positive(row.min_price) || null;
  profile.max_price = positive(row.max_price) || null;
  profile.inventory_sources = copyList(row.inventory_sources).filter(item => INVENTORY_SOURCES.has(item));
  profile.purpose = scrub(row.purpose, 80);
  profile.total_property_views = whole(row.total_property_views);
  profile.unique_properties_viewed = whole(row.unique_properties_viewed);
  profile.total_ai_searches = whole(row.total_ai_searches);
  profile.total_agent_opens = whole(row.total_agent_opens);
  profile.total_leads = whole(row.total_leads);
  profile.last_property_id = clip(row.last_property_id, 120);
  profile.last_property_name = scrub(row.last_property_name);
  profile.last_property_neighborhood = scrub(row.last_property_neighborhood, 80);
  profile.last_search_summary = scrub(row.last_search_summary, 240);
  profile.last_activity_type = clip(row.last_activity_type, 40);
  profile.last_activity_at = clean(row.last_activity_at) || null;
  profile.observed_neighborhoods = copyList(row.observed_neighborhoods).slice(-8);
  profile.first_touch = copyTouch(row.first_touch);
  profile.current_touch = copyTouch(row.current_touch);
  profile.last_gclid = clip(row.last_gclid, 200);
  profile.last_utm_source = clip(row.last_utm_source, 120);
  profile.last_utm_medium = clip(row.last_utm_medium, 120);
  profile.last_utm_campaign = clip(row.last_utm_campaign, 120);
  profile.stage = STAGE_RANK[row.stage] !== undefined ? row.stage : "anonymous";
  profile.viewed_property_ids = copyList(row.viewed_property_ids).slice(-VIEWED_PROPERTY_CAP);
  profile.known_session_ids = copyList(row.known_session_ids).slice(-SESSION_CAP);
  profile.applied_event_ids = copyList(row.applied_event_ids).slice(-EVENT_CAP);
  profile.created_at = clean(row.created_at) || at;
  profile.updated_at = clean(row.updated_at) || profile.last_seen_at;
  return profile;
}

function inventorySource(value) {
  const source = clean(value).toLowerCase();
  return INVENTORY_SOURCES.has(source) ? source : "";
}

function coerceEvent(input) {
  const source = input && typeof input === "object" ? input : {};
  const fromRowShape = source.declared_neighborhood !== undefined || source.property_name !== undefined;
  const intentSource = fromRowShape ? {
    neighborhood: source.declared_neighborhood,
    development: source.declared_development,
    bedrooms: source.declared_bedrooms,
    min_price: source.declared_min_price,
    max_price: source.declared_max_price,
    inventory_source: source.declared_inventory_source
  } : (source.intent || {});
  const propertySource = fromRowShape ? {
    property_id: source.property_id,
    name: source.property_name,
    neighborhood: source.property_neighborhood
  } : (source.property || {});
  const preference = source.preference && typeof source.preference === "object" ? source.preference : intentSource;
  const metadata = omitPii(source.metadata);
  if (!metadata.buyer_id && isVisitorId(source.buyer_id)) metadata.buyer_id = clean(source.buyer_id);
  const eventTime = clean(source.event_time);
  const parsed = eventTime ? new Date(eventTime) : new Date();
  return {
    event_id: clip(source.event_id, 80),
    event_name: clean(source.event_name),
    event_time: Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(),
    visitor_id: clean(source.visitor_id),
    session_id: clip(source.session_id, 120),
    product: clip(source.product, 40),
    gclid: clip(source.gclid, 200),
    gbraid: clip(source.gbraid, 200),
    wbraid: clip(source.wbraid, 200),
    utm_source: clip(source.utm_source, 120),
    utm_medium: clip(source.utm_medium, 120),
    utm_campaign: clip(source.utm_campaign, 120),
    utm_term: clip(source.utm_term, 120),
    utm_content: clip(source.utm_content, 120),
    intent: {
      neighborhood: scrub(intentSource.neighborhood, 80),
      development: scrub(intentSource.development, 120),
      bedrooms: whole(intentSource.bedrooms),
      min_price: positive(intentSource.min_price),
      max_price: positive(intentSource.max_price),
      inventory_source: inventorySource(intentSource.inventory_source)
    },
    preference: {
      city: scrub(preference.city, 80),
      state: scrub(preference.state, 40),
      region: scrub(preference.region, 80),
      property_type: scrub(preference.property_type || preference.propertyType, 80),
      purpose: scrub(preference.purpose || preference.intention, 80)
    },
    property: {
      property_id: clip(propertySource.property_id, 120),
      name: scrub(propertySource.name, 180),
      neighborhood: scrub(propertySource.neighborhood, 80)
    },
    metadata
  };
}

function pushUnique(list, value, cap) {
  const text = clean(value);
  const key = fold(text);
  if (!key) return list;
  if (list.some(item => fold(item) === key)) return list;
  list.push(text);
  if (list.length > cap) list.splice(0, list.length - cap);
  return list;
}

function remember(list, value, cap) {
  const text = clean(value);
  if (!text || list.includes(text)) return false;
  list.push(text);
  if (list.length > cap) list.splice(0, list.length - cap);
  return list.includes(text);
}

function raiseStage(current, next) {
  return STAGE_RANK[next] > STAGE_RANK[current] ? next : current;
}

function resolveStage(profile, eventName) {
  if (eventName === "lead_created" || profile.total_leads > 0) return "lead";
  let stage = raiseStage(profile.stage, "exploring");
  if (
    eventName === "agent_opened" ||
    eventName === "agent_handoff_created" ||
    eventName === "property_view_multiple" ||
    profile.total_agent_opens > 0 ||
    profile.unique_properties_viewed >= 2 ||
    profile.total_ai_searches >= 2 ||
    (profile.total_ai_searches >= 1 && profile.total_property_views >= 1)
  ) {
    stage = raiseStage(stage, "engaged");
  }
  return stage;
}

function applyDeclared(profile, event) {
  const intent = event.intent;
  const preference = event.preference;
  if (intent.neighborhood) pushUnique(profile.neighborhoods, intent.neighborhood, LIST_CAP);
  if (preference.city) profile.city = preference.city;
  if (preference.state) profile.state = preference.state;
  if (preference.region) pushUnique(profile.regions, preference.region, LIST_CAP);
  if (preference.property_type) pushUnique(profile.property_types, preference.property_type, LIST_CAP);
  if (preference.purpose) profile.purpose = preference.purpose;
  if (intent.inventory_source) pushUnique(profile.inventory_sources, intent.inventory_source, LIST_CAP);
  if (intent.bedrooms > 0) {
    if (!profile.bedrooms_min) {
      profile.bedrooms_min = intent.bedrooms;
    } else if (intent.bedrooms !== profile.bedrooms_min) {
      const low = Math.min(profile.bedrooms_min, intent.bedrooms);
      const high = Math.max(profile.bedrooms_max || profile.bedrooms_min, intent.bedrooms);
      profile.bedrooms_min = low;
      profile.bedrooms_max = high === low ? null : high;
    }
  }
  if (intent.min_price > 0) profile.min_price = intent.min_price;
  if (intent.max_price > 0) profile.max_price = intent.max_price;
  const summary = searchSummary(intent);
  if (summary) profile.last_search_summary = summary;
}

function searchSummary(intent) {
  const parts = [];
  if (intent.neighborhood) parts.push(intent.neighborhood);
  if (intent.development) parts.push(intent.development);
  if (intent.bedrooms > 0) parts.push(`${intent.bedrooms} dorms`);
  if (intent.min_price > 0) parts.push(`desde ${intent.min_price}`);
  if (intent.max_price > 0) parts.push(`até ${intent.max_price}`);
  if (intent.inventory_source) parts.push(intent.inventory_source);
  return parts.join(" · ").slice(0, 240);
}

function touchFromEvent(event) {
  const touch = {};
  for (const key of ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    if (event[key]) touch[key] = event[key];
  }
  if (event.event_name === "ad_entry" && !touch.gclid && !touch.gbraid && !touch.wbraid && !touch.utm_source) {
    touch.utm_source = "organic";
  }
  if (!hasTouch(touch) && !touch.utm_medium && !touch.utm_term && !touch.utm_content) return null;
  touch.product = event.product || "";
  touch.at = event.event_time;
  return touch;
}

function safeBuyerId(event) {
  const metadata = event.metadata || {};
  const candidate = clean(metadata.buyer_id || metadata.lead_id);
  if (!isVisitorId(candidate)) return "";
  if (candidate.toLowerCase() === event.visitor_id.toLowerCase()) return "";
  return candidate;
}

function applyEventToProfile(profile, input) {
  const event = coerceEvent(input);
  if (!isVisitorId(event.visitor_id)) {
    return { ok: false, error: "visitor_id obrigatório", profile: profile || null };
  }
  if (!PROFILE_EVENTS.has(event.event_name)) {
    return { ok: true, ignored: true, profile: profile || null };
  }

  const next = profile ? fromRow(profile) : blankProfile(event.visitor_id, event.event_time);
  if (event.event_id && next.applied_event_ids.includes(event.event_id)) {
    return { ok: true, duplicate: true, profile: next };
  }

  const eventMs = new Date(event.event_time).getTime();
  if (eventMs < new Date(next.first_seen_at).getTime()) next.first_seen_at = event.event_time;
  if (eventMs >= new Date(next.last_seen_at).getTime()) next.last_seen_at = event.event_time;
  next.updated_at = event.event_time;
  next.last_activity_type = event.event_name;
  next.last_activity_at = event.event_time;

  if (event.session_id && remember(next.known_session_ids, event.session_id, SESSION_CAP)) {
    next.total_sessions += 1;
  }

  const touch = touchFromEvent(event);
  if (touch) {
    if (!hasTouch(next.first_touch)) next.first_touch = { ...touch };
    next.current_touch = { ...touch };
  }
  if (event.gclid) next.last_gclid = event.gclid;
  if (event.utm_source) next.last_utm_source = event.utm_source;
  else if (event.event_name === "ad_entry" && !event.gclid && !event.gbraid && !event.wbraid) {
    next.last_utm_source = "organic";
  }
  if (event.utm_medium) next.last_utm_medium = event.utm_medium;
  if (event.utm_campaign) next.last_utm_campaign = event.utm_campaign;

  if (DECLARED_EVENTS.has(event.event_name)) applyDeclared(next, event);
  if (event.event_name === "ai_search") next.total_ai_searches += 1;
  if (event.event_name === "property_view") {
    next.total_property_views += 1;
    if (event.property.property_id && remember(next.viewed_property_ids, event.property.property_id, VIEWED_PROPERTY_CAP)) {
      next.unique_properties_viewed += 1;
    }
  }
  if (event.event_name === "agent_opened") next.total_agent_opens += 1;
  if (event.event_name === "lead_created") {
    next.total_leads += 1;
    const buyerId = safeBuyerId(event);
    if (buyerId && !next.buyer_id) next.buyer_id = buyerId;
  }
  if (PROPERTY_EVENTS.has(event.event_name) && event.property.property_id) {
    next.last_property_id = event.property.property_id;
    if (event.property.name) next.last_property_name = event.property.name;
    if (event.property.neighborhood) next.last_property_neighborhood = event.property.neighborhood;
    if (event.property.neighborhood) pushUnique(next.observed_neighborhoods, event.property.neighborhood, 8);
  }

  next.stage = resolveStage(next, event.event_name);
  if (event.event_id) remember(next.applied_event_ids, event.event_id, EVENT_CAP);
  return { ok: true, changed: true, profile: next };
}

function rebuildProfiles(events) {
  const ordered = (Array.isArray(events) ? events : []).slice().sort((a, b) => {
    const time = String(a && a.event_time || "").localeCompare(String(b && b.event_time || ""));
    if (time !== 0) return time;
    return String(a && a.event_id || "").localeCompare(String(b && b.event_id || ""));
  });
  const profiles = new Map();
  for (const event of ordered) {
    const visitorId = clean(event && event.visitor_id);
    const current = profiles.get(visitorId) || null;
    const applied = applyEventToProfile(current, event);
    if (applied.profile) profiles.set(applied.profile.visitor_id, applied.profile);
  }
  return [...profiles.values()];
}

function toPublic(profile) {
  const row = fromRow(profile);
  return {
    visitor_id: row.visitor_id,
    buyer_id: row.buyer_id,
    stage: row.stage,
    preferences: {
      city: row.city,
      state: row.state,
      regions: row.regions.slice(),
      neighborhoods: row.neighborhoods.slice(),
      property_types: row.property_types.slice(),
      bedrooms_min: row.bedrooms_min,
      bedrooms_max: row.bedrooms_max,
      min_price: row.min_price,
      max_price: row.max_price,
      inventory_sources: row.inventory_sources.slice(),
      purpose: row.purpose
    },
    behavior: {
      total_sessions: row.total_sessions,
      total_property_views: row.total_property_views,
      unique_properties_viewed: row.unique_properties_viewed,
      total_ai_searches: row.total_ai_searches,
      total_agent_opens: row.total_agent_opens,
      total_leads: row.total_leads,
      last_property: row.last_property_id ? {
        property_id: row.last_property_id,
        name: row.last_property_name,
        neighborhood: row.last_property_neighborhood
      } : null,
      last_search_summary: row.last_search_summary,
      last_activity_type: row.last_activity_type,
      observed_neighborhoods: row.observed_neighborhoods.slice()
    },
    attribution: {
      first_touch: copyTouch(row.first_touch),
      current_touch: copyTouch(row.current_touch),
      last_gclid: row.last_gclid,
      last_utm_source: row.last_utm_source,
      last_utm_medium: row.last_utm_medium,
      last_utm_campaign: row.last_utm_campaign
    },
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    last_activity_at: row.last_activity_at
  };
}

async function loadProfile(rest, visitorId) {
  const result = await rest(
    `buyer_profiles?select=*&visitor_id=eq.${encodeURIComponent(visitorId)}&limit=1`,
    { method: "GET" }
  );
  if (!result || result.ok === false) {
    return { ok: false, status: result && result.status || 0 };
  }
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return { ok: true, profile: row ? fromRow(row) : null };
}

async function saveProfile(rest, existed, row) {
  if (!existed) {
    const inserted = await rest("buyer_profiles", { method: "POST", body: row });
    if (inserted && inserted.ok) return { ok: true };
    if (!inserted || inserted.status !== 409) {
      return { ok: false, status: inserted && inserted.status || 0 };
    }
  }
  const patched = await rest(
    `buyer_profiles?visitor_id=eq.${encodeURIComponent(row.visitor_id)}`,
    { method: "PATCH", body: row }
  );
  if (!patched || patched.ok === false) {
    return { ok: false, status: patched && patched.status || 0 };
  }
  return { ok: true };
}

async function updateBuyerProfileFromEvent(event, rest) {
  const coerced = coerceEvent(event);
  if (!isVisitorId(coerced.visitor_id)) {
    return { ok: false, error: "visitor_id obrigatório" };
  }
  if (!PROFILE_EVENTS.has(coerced.event_name)) {
    return { ok: true, ignored: true };
  }
  if (typeof rest !== "function") {
    return { ok: false, error: "buyer_profile_storage_unavailable" };
  }

  const loaded = await loadProfile(rest, coerced.visitor_id);
  if (!loaded.ok) return { ok: false, status: loaded.status };
  const applied = applyEventToProfile(loaded.profile, event);
  if (!applied.ok) return applied;
  if (!applied.changed) {
    return { ok: true, duplicate: Boolean(applied.duplicate), profile: toPublic(applied.profile) };
  }
  const saved = await saveProfile(rest, Boolean(loaded.profile), applied.profile);
  if (!saved.ok && saved.status === 409) {
    const again = await loadProfile(rest, coerced.visitor_id);
    if (!again.ok) return { ok: false, status: again.status };
    const retried = applyEventToProfile(again.profile, event);
    if (!retried.changed) return { ok: true, duplicate: true, profile: toPublic(retried.profile) };
    const patched = await saveProfile(rest, true, retried.profile);
    if (!patched.ok) return { ok: false, status: patched.status };
    return { ok: true, profile: toPublic(retried.profile) };
  }
  if (!saved.ok) return { ok: false, status: saved.status };
  return { ok: true, profile: toPublic(applied.profile) };
}

async function getBuyerProfile(visitorId, rest) {
  if (!isVisitorId(visitorId)) {
    return { ok: false, error: "visitor_id obrigatório", profile: null };
  }
  if (typeof rest !== "function") {
    return { ok: false, error: "buyer_profile_storage_unavailable", profile: null };
  }
  const loaded = await loadProfile(rest, visitorId);
  if (!loaded.ok) return { ok: false, status: loaded.status, profile: null };
  return { ok: true, profile: loaded.profile ? toPublic(loaded.profile) : null };
}

module.exports = {
  PROFILE_EVENTS,
  applyEventToProfile,
  rebuildProfiles,
  toPublic,
  updateBuyerProfileFromEvent,
  getBuyerProfile
};
