/*
  Leitura read-only da M.I.A. Não grava, não recalcula high intent
  e não transforma buyer_class em evento.
*/

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 7 * DAY_MS;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const SCHEMA_VERSION = "mia-ads-read/1";
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HIGH_INTENT_REASONS = new Set([
  "busca_valida_e_dois_imoveis",
  "busca_imovel_e_cta",
  "empreendimento_e_imovel_correspondente"
]);
const PREFERENCE_KEYS = ["city", "state", "region", "property_type", "purpose"];
const TOUCH_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content"
];
const SOURCE_TABLES = [
  "ads_events",
  "ads_visitors",
  "buyer_profiles",
  "buyer_quality_scores"
];

const EVENT_COLUMNS = [
  "event_id",
  "event_name",
  "event_time",
  "product",
  "visitor_id",
  "session_id",
  "gclid",
  "gbraid",
  "wbraid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "declared_neighborhood",
  "declared_development",
  "declared_bedrooms",
  "declared_min_price",
  "declared_max_price",
  "declared_inventory_source",
  "property_id",
  "property_neighborhood",
  "property_development",
  "property_bedrooms",
  "property_price",
  "property_inventory_source",
  "observed_neighborhood",
  "observed_bedrooms",
  "observed_price_min",
  "observed_price_max",
  "observed_confidence",
  "conversion_gclid",
  "conversion_gbraid",
  "conversion_wbraid",
  "conversion_click_source",
  "metadata"
];

const VISITOR_COLUMNS = [
  "visitor_id",
  "first_seen",
  "last_seen",
  "first_product",
  "last_product",
  "first_gclid",
  "first_gbraid",
  "first_wbraid",
  "last_gclid",
  "last_gbraid",
  "last_wbraid",
  "first_utm_source",
  "first_utm_campaign",
  "last_utm_source",
  "last_utm_campaign",
  "first_declared_intent",
  "current_declared_intent",
  "observed_intent",
  "observed_confidence"
];

const PROFILE_COLUMNS = [
  "visitor_id",
  "buyer_id",
  "stage",
  "city",
  "state",
  "regions",
  "neighborhoods",
  "property_types",
  "bedrooms_min",
  "bedrooms_max",
  "min_price",
  "max_price",
  "inventory_sources",
  "purpose",
  "total_sessions",
  "total_property_views",
  "unique_properties_viewed",
  "total_ai_searches",
  "total_agent_opens",
  "total_leads",
  "last_property_id",
  "last_property_neighborhood",
  "observed_neighborhoods",
  "first_touch",
  "current_touch",
  "last_gclid",
  "last_utm_source",
  "last_utm_medium",
  "last_utm_campaign",
  "first_seen_at",
  "last_seen_at"
];

const QUALITY_COLUMNS = [
  "visitor_id",
  "buyer_intent_score",
  "commercial_intent_score",
  "recurrence_score",
  "broker_tester_score",
  "data_confidence_score",
  "buyer_class",
  "traffic_quality_class",
  "first_event_at",
  "last_event_at",
  "distinct_days",
  "session_count",
  "event_count",
  "property_count",
  "neighborhood_count",
  "updated_at"
];

function plain(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function preferenceValue(value) {
  const text = plain(value, 80);
  if (!text) return "";
  if (text.includes("@")) return "";
  if (/whatsapp|wa\.me/i.test(text)) return "";
  if (/\d{8,}/.test(text)) return "";
  return text;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function count(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0;
}

function confidence(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function timeOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (Number.isNaN(Date.parse(value))) return null;
  return value.trim();
}

function quotePostgrest(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function queryString(pairs) {
  return pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => plain(item, 80)).filter(Boolean);
}

function projectDeclared(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const intent = {
    neighborhood: plain(value.neighborhood, 80),
    development: plain(value.development, 180),
    bedrooms: nullableNumber(value.bedrooms),
    min_price: nullableNumber(value.min_price),
    max_price: nullableNumber(value.max_price),
    inventory_source: plain(value.inventory_source, 20)
  };
  const present = intent.neighborhood || intent.development || intent.bedrooms ||
    intent.min_price || intent.max_price || intent.inventory_source;
  return present ? intent : null;
}

function projectObserved(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const intent = {
    neighborhood: plain(value.neighborhood, 80),
    bedrooms: nullableNumber(value.bedrooms),
    price_min: nullableNumber(value.price_min),
    price_max: nullableNumber(value.price_max)
  };
  const present = intent.neighborhood || intent.bedrooms || intent.price_min || intent.price_max;
  return present ? intent : null;
}

function projectTouch(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const touch = {};
  for (const key of TOUCH_KEYS) {
    const text = plain(source[key], 200);
    if (text) touch[key] = text;
  }
  return touch;
}

function projectMetadata(metadata) {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const projected = {};
  if (typeof source.derived === "boolean") projected.derived = source.derived;
  if (Array.isArray(source.reasons)) {
    const reasons = [];
    for (const reason of source.reasons) {
      if (typeof reason === "string" && HIGH_INTENT_REASONS.has(reason) && !reasons.includes(reason)) {
        reasons.push(reason);
      }
    }
    if (reasons.length) projected.reasons = reasons;
  }
  const preference = source.canonical_preference;
  if (preference && typeof preference === "object" && !Array.isArray(preference)) {
    const allowed = {};
    for (const key of PREFERENCE_KEYS) {
      const text = preferenceValue(preference[key]);
      if (text) allowed[key] = text;
    }
    if (Object.keys(allowed).length) projected.canonical_preference = allowed;
  }
  return projected;
}

function clickTrio(gclid, gbraid, wbraid) {
  return {
    gclid: plain(gclid, 200),
    gbraid: plain(gbraid, 200),
    wbraid: plain(wbraid, 200)
  };
}

function emptyVisitor(visitorId, profile, quality) {
  return {
    visitor_id: visitorId,
    first_seen: null,
    last_seen: null,
    first_product: "",
    last_product: "",
    click_ids: {
      first: clickTrio("", "", ""),
      last: clickTrio("", "", "")
    },
    utm: {
      first: { utm_source: "", utm_campaign: "" },
      last: { utm_source: "", utm_campaign: "" }
    },
    declared_intent: { first: null, current: null },
    observed_intent: null,
    observed_confidence: 0,
    profile,
    quality
  };
}

export function projectEvent(row) {
  const source = row || {};
  const metadata = projectMetadata(source.metadata);
  const event = {
    event_id: plain(source.event_id, 200),
    event_name: plain(source.event_name, 80),
    event_time: timeOrNull(source.event_time),
    product: plain(source.product, 40),
    visitor_id: plain(source.visitor_id, 80),
    session_id: plain(source.session_id, 120),
    gclid: plain(source.gclid, 200),
    gbraid: plain(source.gbraid, 200),
    wbraid: plain(source.wbraid, 200),
    utm_source: plain(source.utm_source, 120),
    utm_medium: plain(source.utm_medium, 120),
    utm_campaign: plain(source.utm_campaign, 120),
    utm_term: plain(source.utm_term, 120),
    utm_content: plain(source.utm_content, 120),
    declared_neighborhood: plain(source.declared_neighborhood, 80),
    declared_development: plain(source.declared_development, 180),
    declared_bedrooms: nullableNumber(source.declared_bedrooms),
    declared_min_price: nullableNumber(source.declared_min_price),
    declared_max_price: nullableNumber(source.declared_max_price),
    declared_inventory_source: plain(source.declared_inventory_source, 20),
    property_id: plain(source.property_id, 80),
    property_neighborhood: plain(source.property_neighborhood, 80),
    property_development: plain(source.property_development, 180),
    property_bedrooms: nullableNumber(source.property_bedrooms),
    property_price: nullableNumber(source.property_price),
    property_inventory_source: plain(source.property_inventory_source, 20),
    observed_neighborhood: plain(source.observed_neighborhood, 80),
    observed_bedrooms: nullableNumber(source.observed_bedrooms),
    observed_price_min: nullableNumber(source.observed_price_min),
    observed_price_max: nullableNumber(source.observed_price_max),
    observed_confidence: confidence(source.observed_confidence),
    conversion_attribution: {
      gclid: plain(source.conversion_gclid, 200),
      gbraid: plain(source.conversion_gbraid, 200),
      wbraid: plain(source.conversion_wbraid, 200),
      source: plain(source.conversion_click_source, 40)
    }
  };
  if (typeof metadata.derived === "boolean") event.derived = metadata.derived;
  if (metadata.reasons) event.reasons = metadata.reasons;
  if (metadata.canonical_preference) event.canonical_preference = metadata.canonical_preference;
  return event;
}

export function projectProfile(row) {
  if (!row) return null;
  const propertyId = plain(row.last_property_id, 80);
  return {
    buyer_id: plain(row.buyer_id, 80) || null,
    stage: plain(row.stage, 40),
    preferences: {
      city: plain(row.city, 80),
      state: plain(row.state, 40),
      regions: stringList(row.regions),
      neighborhoods: stringList(row.neighborhoods),
      property_types: stringList(row.property_types),
      bedrooms_min: nullableNumber(row.bedrooms_min),
      bedrooms_max: nullableNumber(row.bedrooms_max),
      min_price: nullableNumber(row.min_price),
      max_price: nullableNumber(row.max_price),
      inventory_sources: stringList(row.inventory_sources),
      purpose: plain(row.purpose, 80)
    },
    behavior: {
      total_sessions: count(row.total_sessions),
      total_property_views: count(row.total_property_views),
      unique_properties_viewed: count(row.unique_properties_viewed),
      total_ai_searches: count(row.total_ai_searches),
      total_agent_opens: count(row.total_agent_opens),
      total_leads: count(row.total_leads),
      last_property: propertyId ? {
        property_id: propertyId,
        neighborhood: plain(row.last_property_neighborhood, 80)
      } : null,
      observed_neighborhoods: stringList(row.observed_neighborhoods)
    },
    attribution: {
      first_touch: projectTouch(row.first_touch),
      current_touch: projectTouch(row.current_touch),
      last_gclid: plain(row.last_gclid, 200),
      last_utm_source: plain(row.last_utm_source, 120),
      last_utm_medium: plain(row.last_utm_medium, 120),
      last_utm_campaign: plain(row.last_utm_campaign, 120)
    },
    first_seen_at: timeOrNull(row.first_seen_at),
    last_seen_at: timeOrNull(row.last_seen_at)
  };
}

export function projectQuality(row) {
  if (!row) return null;
  return {
    buyer_intent_score: count(row.buyer_intent_score),
    commercial_intent_score: count(row.commercial_intent_score),
    recurrence_score: count(row.recurrence_score),
    broker_tester_score: count(row.broker_tester_score),
    data_confidence_score: count(row.data_confidence_score),
    buyer_class: plain(row.buyer_class, 40),
    traffic_quality_class: plain(row.traffic_quality_class, 40),
    first_event_at: timeOrNull(row.first_event_at),
    last_event_at: timeOrNull(row.last_event_at),
    distinct_days: count(row.distinct_days),
    session_count: count(row.session_count),
    event_count: count(row.event_count),
    property_count: count(row.property_count),
    neighborhood_count: count(row.neighborhood_count),
    updated_at: timeOrNull(row.updated_at)
  };
}

function projectVisitor(visitorId, row, profile, quality) {
  const projectedProfile = projectProfile(profile);
  const projectedQuality = projectQuality(quality);
  if (!row) return emptyVisitor(visitorId, projectedProfile, projectedQuality);
  return {
    visitor_id: visitorId,
    first_seen: timeOrNull(row.first_seen),
    last_seen: timeOrNull(row.last_seen),
    first_product: plain(row.first_product, 40),
    last_product: plain(row.last_product, 40),
    click_ids: {
      first: clickTrio(row.first_gclid, row.first_gbraid, row.first_wbraid),
      last: clickTrio(row.last_gclid, row.last_gbraid, row.last_wbraid)
    },
    utm: {
      first: {
        utm_source: plain(row.first_utm_source, 120),
        utm_campaign: plain(row.first_utm_campaign, 120)
      },
      last: {
        utm_source: plain(row.last_utm_source, 120),
        utm_campaign: plain(row.last_utm_campaign, 120)
      }
    },
    declared_intent: {
      first: projectDeclared(row.first_declared_intent),
      current: projectDeclared(row.current_declared_intent)
    },
    observed_intent: projectObserved(row.observed_intent),
    observed_confidence: confidence(row.observed_confidence),
    profile: projectedProfile,
    quality: projectedQuality
  };
}

export function uniqueVisitorIds(rows) {
  return [...new Set((rows || [])
    .map(row => row && row.visitor_id)
    .filter(id => VISITOR_ID_PATTERN.test(String(id || ""))))].sort();
}

export function projectMiaRead({
  visitorIds,
  events,
  visitors,
  profiles,
  scores,
  page,
  generatedAt
}) {
  const visitorsById = new Map((visitors || []).map(row => [row.visitor_id, row]));
  const profilesById = new Map((profiles || []).map(row => [row.visitor_id, row]));
  const scoresById = new Map((scores || []).map(row => [row.visitor_id, row]));
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    source: {
      tables: SOURCE_TABLES.slice(),
      contract: SCHEMA_VERSION
    },
    visitors: (visitorIds || []).map(id => projectVisitor(
      id,
      visitorsById.get(id) || null,
      profilesById.get(id) || null,
      scoresById.get(id) || null
    )),
    events: (events || []).map(projectEvent),
    page
  };
}

export function encodeCursor(row) {
  const eventId = row && typeof row.event_id === "string" ? row.event_id.trim() : "";
  const eventTime = row && typeof row.event_time === "string" ? row.event_time.trim() : "";
  if (!eventId || eventId.length > 200 || /[\u0000-\u001f]/.test(eventId)) return null;
  if (!eventTime || Number.isNaN(Date.parse(eventTime))) return null;
  return Buffer.from(JSON.stringify({ t: eventTime, i: eventId }), "utf8").toString("base64url");
}

export function decodeCursor(value) {
  if (typeof value !== "string" || !value || value.length > 600) return null;
  if (!/^[A-Za-z0-9_=-]+$/.test(value)) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (typeof parsed.t !== "string" || typeof parsed.i !== "string") return null;
  if (!parsed.i || parsed.i.length > 200 || /[\u0000-\u001f]/.test(parsed.i)) return null;
  if (Number.isNaN(Date.parse(parsed.t))) return null;
  return { event_time: parsed.t, event_id: parsed.i };
}

function parseLimit(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, limit: DEFAULT_LIMIT };
  }
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return { ok: false, error: "limit inválido" };
  }
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return { ok: false, error: "limit inválido" };
  const limit = Number(text);
  if (limit > MAX_LIMIT) return { ok: false, error: "limit inválido" };
  return { ok: true, limit };
}

function parseTime(value) {
  if (value === undefined || value === null || value === "") return { ok: true, time: null };
  if (Array.isArray(value) || typeof value === "object") return { ok: false, error: "from ou to inválido" };
  const parsed = new Date(String(value).trim());
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: "from ou to inválido" };
  return { ok: true, time: parsed };
}

export function parseMiaReadQuery(query, now = new Date()) {
  const source = query && typeof query === "object" ? query : {};
  const limitResult = parseLimit(source.limit);
  if (!limitResult.ok) return limitResult;
  const fromResult = parseTime(source.from);
  if (!fromResult.ok) return fromResult;
  const toResult = parseTime(source.to);
  if (!toResult.ok) return toResult;
  let cursor = null;
  if (source.cursor !== undefined && source.cursor !== null && source.cursor !== "") {
    cursor = decodeCursor(String(source.cursor));
    if (!cursor) return { ok: false, error: "cursor inválido" };
  }
  const end = toResult.time || now;
  const start = fromResult.time || new Date(end.getTime() - DAY_MS);
  if (end.getTime() <= start.getTime()) return { ok: false, error: "from ou to inválido" };
  if (end.getTime() - start.getTime() > MAX_WINDOW_MS) {
    return { ok: false, error: "Janela maior que 7 dias" };
  }
  return {
    ok: true,
    limit: limitResult.limit,
    from: start.toISOString(),
    to: end.toISOString(),
    cursor
  };
}

export function eventsPath(query) {
  const pairs = [
    ["select", EVENT_COLUMNS.join(",")],
    ["event_time", `gte.${quotePostgrest(query.from)}`],
    ["event_time", `lt.${quotePostgrest(query.to)}`]
  ];
  if (query.cursor) {
    const time = quotePostgrest(query.cursor.event_time);
    const id = quotePostgrest(query.cursor.event_id);
    pairs.push(["or", `(event_time.gt.${time},and(event_time.eq.${time},event_id.gt.${id}))`]);
  }
  pairs.push(["order", "event_time.asc,event_id.asc"]);
  pairs.push(["limit", String(query.limit + 1)]);
  return `ads_events?${queryString(pairs)}`;
}

function rowsPath(table, columns, ids) {
  return `${table}?${queryString([
    ["select", columns.join(",")],
    ["visitor_id", `in.(${ids.join(",")})`]
  ])}`;
}

export function visitorsPath(ids) {
  return rowsPath("ads_visitors", VISITOR_COLUMNS, ids);
}

export function profilesPath(ids) {
  return rowsPath("buyer_profiles", PROFILE_COLUMNS, ids);
}

export function scoresPath(ids) {
  return rowsPath("buyer_quality_scores", QUALITY_COLUMNS, ids);
}

export function sliceEventPage(rows, limit) {
  const list = Array.isArray(rows) ? rows : [];
  const hasMore = list.length > limit;
  const page = list.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last) : null
  };
}

export {
  EVENT_COLUMNS,
  VISITOR_COLUMNS,
  PROFILE_COLUMNS,
  QUALITY_COLUMNS,
  SCHEMA_VERSION,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
