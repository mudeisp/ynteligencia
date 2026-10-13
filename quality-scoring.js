/*
  Quality Scoring V1.

  Camada derivada. ads_events é o fato. Buyer Profile não é reescrito.
  Estes pesos são a especificação da V1. A função
  public.recompute_buyer_quality_score repete os mesmos números.
  Não há mediana ao vivo: o score de um visitante depende só dos
  eventos dele. Um limiar fixo representa volume muito acima do usual.

  Nenhum score prova profissão. broker_tester_score alto significa
  suspected broker/tester, nunca "corretor". Renda não entra.
*/

const SCORE_VERSION = "v1";
const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * DAY_MS;
const QUALITY_SCORE_TIMEOUT_MS = 400;

const QUALITY_RECOMPUTE_EVENTS = new Set([
  "property_view",
  "property_interest",
  "ai_assistant_message",
  "agent_opened",
  "specialist_cta_opened",
  "property_whatsapp_click",
  "ai_lead_submitted",
  "lead_created"
]);

const BUYER_SIGNAL_WEIGHTS = {
  lead_created: { weight: 55, cap: 70 },
  ai_lead_success: { weight: 50, cap: 70 },
  ai_lead_submitted: { weight: 40, cap: 50 },
  property_whatsapp_click: { weight: 32, cap: 40 },
  ai_phone_detected: { weight: 28, cap: 36 },
  specialist_cta_opened: { weight: 24, cap: 32 },
  property_interest: { weight: 22, cap: 30 },
  vip_offer_click: { weight: 18, cap: 24 },
  ai_lead_form_opened: { weight: 16, cap: 22 },
  agent_opened: { weight: 12, cap: 18 },
  ai_assistant_message: { weight: 4, cap: 12 },
  ai_assistant_open: { weight: 4, cap: 8 },
  floorplan_view: { weight: 6, cap: 12 },
  development_floorplan_click: { weight: 4, cap: 8 },
  development_table_request: { weight: 8, cap: 12 },
  development_book_request: { weight: 8, cap: 12 },
  property_gallery_view: { weight: 3, cap: 8 },
  map_view: { weight: 2, cap: 6 },
  property_view: { weight: 2, cap: 12 },
  property_view_multiple: { weight: 4, cap: 8 }
};

const BUYER_COHERENCE_WEIGHTS = {
  return_days: 8,
  return_days_sustained: 8,
  same_neighborhood_across_days: 8,
  same_bedrooms_across_days: 6,
  same_price_band_across_days: 6,
  few_neighborhoods: 8,
  few_property_types: 6,
  same_property_across_days: 6
};

const COMMERCIAL_SIGNAL_WEIGHTS = {
  lead_created: { weight: 70, cap: 80 },
  ai_lead_success: { weight: 65, cap: 80 },
  ai_lead_submitted: { weight: 50, cap: 60 },
  property_whatsapp_click: { weight: 40, cap: 50 },
  ai_phone_detected: { weight: 35, cap: 42 },
  specialist_cta_opened: { weight: 28, cap: 36 },
  property_interest: { weight: 26, cap: 34 },
  vip_offer_click: { weight: 20, cap: 28 },
  ai_lead_form_opened: { weight: 18, cap: 24 },
  agent_opened: { weight: 12, cap: 18 },
  ai_assistant_message: { weight: 4, cap: 12 },
  floorplan_view: { weight: 6, cap: 12 },
  development_table_request: { weight: 10, cap: 16 },
  development_book_request: { weight: 10, cap: 16 }
};

const COMMERCIAL_PROGRESSION_EVENTS = [
  "lead_created",
  "ai_lead_success",
  "ai_lead_submitted",
  "property_whatsapp_click",
  "ai_phone_detected",
  "specialist_cta_opened",
  "property_interest",
  "vip_offer_click",
  "ai_lead_form_opened"
];

const RECURRENCE_RULES = {
  day_points: { 1: 8, 2: 28, 3: 42, 4: 58, 5: 68, 6: 76, 7: 84 },
  extra_session_points: 3,
  extra_session_cap_same_day: 6,
  extra_session_cap_cross_day: 15,
  same_neighborhood_across_days: 8,
  same_bedrooms_across_days: 6,
  same_property_across_days: 8,
  span_1_day: 6,
  span_3_days: 8,
  span_7_days: 6
};

const BROKER_TESTER_RULES = {
  volume_spike: { points: 28, views_per_day: 40, events_per_day: 80 },
  view_burst: { points: 22, views_in_two_hours: 25, views_per_day: 40 },
  neighborhood_scatter: { points: 24, neighborhoods: 8, window_days: 2 },
  bedroom_flip: { points: 18, bedrooms: 3, window_days: 2 },
  price_swing: { points: 16, bands: 3, window_days: 2 },
  developer_scatter: { points: 14, developers: 6, window_days: 2 },
  session_burst: { points: 12, sessions_per_day: 8 },
  filter_churn: { points: 14, filters_per_day: 8 },
  browse_without_commerce: { points: 20, views: 25, neighborhoods: 6 },
  breadth_same_day: { points: 18, neighborhoods: 8, properties: 20 },
  qa_repetition: { points: 16, repeats: 20 },
  segment_cross: { points: 16, price_ratio: 8, neighborhoods: 5, window_days: 2 },
  metadata_test: { points: 55 },
  test_identifier: { points: 40 },
  test_click_id: { points: 28 }
};

const DATA_CONFIDENCE_RULES = {
  events: [
    { min: 20, points: 42 },
    { min: 10, points: 36 },
    { min: 5, points: 28 },
    { min: 2, points: 16 },
    { min: 1, points: 8 }
  ],
  sessions: [
    { min: 4, points: 22 },
    { min: 2, points: 14 },
    { min: 1, points: 6 }
  ],
  days: [
    { min: 4, points: 20 },
    { min: 2, points: 12 },
    { min: 1, points: 4 }
  ],
  valid_visitor: 8,
  session_consistency: 6,
  property_presence: 6,
  intent_presence: 6,
  touch_presence: 6,
  synthetic_penalty: 30
};

const CLASS_THRESHOLDS = {
  high_intent_buyer: 70,
  high_intent_commercial: 45,
  engaged_buyer: 50,
  exploring_buyer: 25,
  broker_class: 70,
  confidence_floor: 40,
  mixed_buyer: 50,
  mixed_broker: 50,
  likely_buyer_floor: 50,
  likely_buyer_broker_ceiling: 50
};

const IGNORED_FEATURES = ["income", "renda", "income_percentile", "household_income", "google_income"];

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function containsTest(value) {
  return text(value).toLowerCase().includes("test");
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function bedroomValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 20) return null;
  return number;
}

function priceBand(price) {
  if (!(price > 0)) return null;
  if (price < 500000) return 0;
  if (price < 1000000) return 1;
  if (price < 2000000) return 2;
  if (price < 4000000) return 3;
  return 4;
}

function bucket(value, steps) {
  for (const step of steps) {
    if (value >= step.min) return step.points;
  }
  return 0;
}

function capped(count, spec) {
  if (!count || !spec) return 0;
  return Math.min(spec.cap, count * spec.weight);
}

function metadataObject(event) {
  const metadata = event && event.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function metadataTest(event) {
  const flag = metadataObject(event).test;
  return flag === true || flag === 1 || String(flag).toLowerCase() === "true" || String(flag) === "1";
}

function neighborhoodOf(event) {
  return text(event.property_neighborhood || event.declared_neighborhood || event.observed_neighborhood).toLowerCase();
}

function bedroomsOf(event) {
  const property = bedroomValue(event.property_bedrooms);
  if (property !== null) return property;
  const declared = bedroomValue(event.declared_bedrooms);
  if (declared !== null) return declared;
  return bedroomValue(event.observed_bedrooms);
}

function priceOf(event) {
  const property = positive(event.property_price);
  if (property) return property;
  const declaredMin = positive(event.declared_min_price);
  const declaredMax = positive(event.declared_max_price);
  if (declaredMin && declaredMax) return (declaredMin + declaredMax) / 2;
  if (declaredMin || declaredMax) return declaredMin || declaredMax;
  const observedMin = positive(event.observed_price_min);
  const observedMax = positive(event.observed_price_max);
  if (observedMin && observedMax) return (observedMin + observedMax) / 2;
  return observedMin || observedMax || 0;
}

function developmentOf(event) {
  return text(event.property_development || event.declared_development).toLowerCase();
}

function propertyTypeOf(event) {
  const metadata = metadataObject(event);
  const preference = metadata.canonical_preference && typeof metadata.canonical_preference === "object"
    ? metadata.canonical_preference
    : {};
  return text(preference.property_type || preference.propertyType || metadata.property_type || metadata.propertyType).toLowerCase();
}

function filterKey(event) {
  const neighborhood = text(event.declared_neighborhood).toLowerCase();
  const bedrooms = bedroomValue(event.declared_bedrooms);
  const minPrice = positive(event.declared_min_price);
  const maxPrice = positive(event.declared_max_price);
  if (!neighborhood && bedrooms === null && !minPrice && !maxPrice) return "";
  return [
    neighborhood,
    bedrooms === null ? "" : String(bedrooms),
    minPrice ? String(priceBand(minPrice)) : "",
    maxPrice ? String(priceBand(maxPrice)) : ""
  ].join("|");
}

function hasIntent(event) {
  return Boolean(
    text(event.declared_neighborhood) ||
    bedroomValue(event.declared_bedrooms) !== null ||
    positive(event.declared_min_price) ||
    positive(event.declared_max_price) ||
    text(event.observed_neighborhood) ||
    bedroomValue(event.observed_bedrooms) !== null ||
    positive(event.observed_price_min) ||
    positive(event.observed_price_max)
  );
}

function hasTouch(event) {
  return Boolean(
    text(event.gclid) ||
    text(event.gbraid) ||
    text(event.wbraid) ||
    text(event.utm_source) ||
    text(event.utm_medium) ||
    text(event.utm_campaign) ||
    text(event.conversion_gclid) ||
    text(event.conversion_gbraid) ||
    text(event.conversion_wbraid)
  );
}

function utcDay(time) {
  return Math.floor(time / DAY_MS);
}

function normalizeEvents(events) {
  const rows = [];
  for (const event of events || []) {
    const time = new Date(event && event.event_time).getTime();
    if (!Number.isFinite(time)) continue;
    rows.push({
      event_id: text(event.event_id),
      event_name: text(event.event_name),
      time,
      visitor_id: text(event.visitor_id),
      session_id: text(event.session_id),
      property_id: text(event.property_id),
      neighborhood: neighborhoodOf(event),
      bedrooms: bedroomsOf(event),
      price: priceOf(event),
      band: priceBand(priceOf(event)),
      development: developmentOf(event),
      property_type: propertyTypeOf(event),
      filter_key: filterKey(event),
      intent: hasIntent(event),
      touch: hasTouch(event),
      metadata_test: metadataTest(event),
      gclid: text(event.gclid),
      gbraid: text(event.gbraid),
      wbraid: text(event.wbraid),
      conversion_gclid: text(event.conversion_gclid),
      conversion_gbraid: text(event.conversion_gbraid),
      conversion_wbraid: text(event.conversion_wbraid)
    });
  }
  rows.sort((left, right) => left.time - right.time || left.event_id.localeCompare(right.event_id));
  return rows;
}

function maxDistinct(rows, windowMs, valueOf) {
  let best = 0;
  for (let start = 0; start < rows.length; start += 1) {
    const seen = new Set();
    for (let index = start; index < rows.length; index += 1) {
      if (rows[index].time >= rows[start].time + windowMs) break;
      const value = valueOf(rows[index]);
      if (value === null || value === undefined || value === "") continue;
      seen.add(value);
    }
    if (seen.size > best) best = seen.size;
  }
  return best;
}

function maxPerDay(rows, valueOf) {
  const counts = new Map();
  for (const row of rows) {
    const value = valueOf(row);
    if (!value) continue;
    const key = utcDay(row.time);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0;
  for (const count of counts.values()) best = Math.max(best, count);
  return best;
}

function maxDistinctPerDay(rows, valueOf) {
  const days = new Map();
  for (const row of rows) {
    const value = valueOf(row);
    if (value === null || value === undefined || value === "") continue;
    const day = utcDay(row.time);
    if (!days.has(day)) days.set(day, new Set());
    days.get(day).add(value);
  }
  let best = 0;
  for (const values of days.values()) best = Math.max(best, values.size);
  return best;
}

function appearsAcrossDays(rows, valueOf) {
  const days = new Map();
  for (const row of rows) {
    const value = valueOf(row);
    if (value === null || value === undefined || value === "") continue;
    const key = String(value);
    if (!days.has(key)) days.set(key, new Set());
    days.get(key).add(utcDay(row.time));
  }
  for (const seen of days.values()) {
    if (seen.size >= 2) return true;
  }
  return false;
}

function segmentCross(rows) {
  const rule = BROKER_TESTER_RULES.segment_cross;
  for (let start = 0; start < rows.length; start += 1) {
    let minPrice = 0;
    let maxPrice = 0;
    const neighborhoods = new Set();
    for (let index = start; index < rows.length; index += 1) {
      if (rows[index].time >= rows[start].time + rule.window_days * DAY_MS) break;
      if (rows[index].price > 0) {
        minPrice = minPrice === 0 ? rows[index].price : Math.min(minPrice, rows[index].price);
        maxPrice = Math.max(maxPrice, rows[index].price);
      }
      if (rows[index].neighborhood) neighborhoods.add(rows[index].neighborhood);
    }
    if (minPrice > 0 && maxPrice / minPrice >= rule.price_ratio && neighborhoods.size >= rule.neighborhoods) {
      return true;
    }
  }
  return false;
}

function breadthOnOneDay(rows) {
  const rule = BROKER_TESTER_RULES.breadth_same_day;
  const days = new Map();
  for (const row of rows) {
    const day = utcDay(row.time);
    if (!days.has(day)) days.set(day, { neighborhoods: new Set(), properties: new Set() });
    const bucketDay = days.get(day);
    if (row.neighborhood) bucketDay.neighborhoods.add(row.neighborhood);
    if (row.property_id) bucketDay.properties.add(row.property_id);
  }
  for (const day of days.values()) {
    if (day.neighborhoods.size >= rule.neighborhoods && day.properties.size >= rule.properties) return true;
  }
  return false;
}

function qaRepetition(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = `${utcDay(row.time)}|${row.event_name}|${row.property_id}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0;
  for (const count of counts.values()) best = Math.max(best, count);
  return best;
}

function signal(name, count, weight, cap, points) {
  return { name, count, weight, cap, points };
}

function ruleSignal(name, points) {
  return { name, points };
}

function emptyScore(visitorId) {
  const breakdown = {
    version: SCORE_VERSION,
    buyer_intent: { score: 0, signals: [] },
    commercial_intent: { score: 0, signals: [] },
    recurrence: { score: 0, signals: [] },
    broker_tester: { score: 0, signals: [] },
    data_confidence: { score: 0, signals: [] },
    classes: {
      buyer_class: "unknown",
      traffic_quality_class: "unknown",
      thresholds: CLASS_THRESHOLDS
    },
    ignored: IGNORED_FEATURES
  };
  return {
    visitor_id: visitorId || "",
    buyer_intent_score: 0,
    commercial_intent_score: 0,
    recurrence_score: 0,
    broker_tester_score: 0,
    data_confidence_score: 0,
    buyer_class: "unknown",
    traffic_quality_class: "unknown",
    score_breakdown: breakdown,
    first_event_at: null,
    last_event_at: null,
    distinct_days: 0,
    session_count: 0,
    event_count: 0,
    property_count: 0,
    neighborhood_count: 0
  };
}

function scoreVisitor(events, visitorId) {
  const rows = normalizeEvents(events);
  if (!rows.length) return emptyScore(visitorId || (events && events[0] && events[0].visitor_id) || "");
  const resolvedVisitor = visitorId || rows[0].visitor_id;
  const counts = {};
  for (const row of rows) counts[row.event_name] = (counts[row.event_name] || 0) + 1;

  const sessions = new Set(rows.map(row => row.session_id).filter(Boolean));
  const days = new Set(rows.map(row => utcDay(row.time)));
  const properties = new Set(rows.map(row => row.property_id).filter(Boolean));
  const neighborhoods = new Set(rows.map(row => row.neighborhood).filter(Boolean));
  const types = new Set(rows.map(row => row.property_type).filter(Boolean));
  const spanDays = (rows[rows.length - 1].time - rows[0].time) / DAY_MS;
  const views = rows.filter(row => row.event_name === "property_view");
  const maxViewsPerDay = maxPerDay(views, () => true);
  const maxEventsPerDay = maxPerDay(rows, () => true);
  let burst = 0;
  for (let start = 0; start < views.length; start += 1) {
    let count = 0;
    for (let index = start; index < views.length; index += 1) {
      if (views[index].time >= views[start].time + TWO_HOURS_MS) break;
      count += 1;
    }
    burst = Math.max(burst, count);
  }

  const buyerSignals = [];
  let buyer = 0;
  for (const [name, spec] of Object.entries(BUYER_SIGNAL_WEIGHTS)) {
    const count = counts[name] || 0;
    const points = capped(count, spec);
    if (!points) continue;
    buyer += points;
    buyerSignals.push(signal(name, count, spec.weight, spec.cap, points));
  }
  const coherence = [];
  if (days.size >= 2) coherence.push(["return_days", BUYER_COHERENCE_WEIGHTS.return_days]);
  if (days.size >= 4) coherence.push(["return_days_sustained", BUYER_COHERENCE_WEIGHTS.return_days_sustained]);
  if (appearsAcrossDays(rows, row => row.neighborhood)) {
    coherence.push(["same_neighborhood_across_days", BUYER_COHERENCE_WEIGHTS.same_neighborhood_across_days]);
  }
  if (appearsAcrossDays(rows, row => row.bedrooms)) {
    coherence.push(["same_bedrooms_across_days", BUYER_COHERENCE_WEIGHTS.same_bedrooms_across_days]);
  }
  if (appearsAcrossDays(rows, row => row.band)) {
    coherence.push(["same_price_band_across_days", BUYER_COHERENCE_WEIGHTS.same_price_band_across_days]);
  }
  if (properties.size >= 3 && neighborhoods.size >= 1 && neighborhoods.size <= 2) {
    coherence.push(["few_neighborhoods", BUYER_COHERENCE_WEIGHTS.few_neighborhoods]);
  }
  if ((counts.property_view || 0) >= 3 && types.size >= 1 && types.size <= 2) {
    coherence.push(["few_property_types", BUYER_COHERENCE_WEIGHTS.few_property_types]);
  }
  if (appearsAcrossDays(rows, row => row.property_id)) {
    coherence.push(["same_property_across_days", BUYER_COHERENCE_WEIGHTS.same_property_across_days]);
  }
  for (const [name, points] of coherence) {
    buyer += points;
    buyerSignals.push(signal(name, 1, points, points, points));
  }
  buyer = clampScore(buyer);

  const commercialSignals = [];
  let commercial = 0;
  for (const [name, spec] of Object.entries(COMMERCIAL_SIGNAL_WEIGHTS)) {
    const count = counts[name] || 0;
    const points = capped(count, spec);
    if (!points) continue;
    commercial += points;
    commercialSignals.push(signal(name, count, spec.weight, spec.cap, points));
  }
  commercial = clampScore(commercial);

  const recurrenceSignals = [];
  let recurrence = 0;
  const dayPoints = days.size >= 7 ? RECURRENCE_RULES.day_points[7] : (RECURRENCE_RULES.day_points[days.size] || 0);
  if (dayPoints) {
    recurrence += dayPoints;
    recurrenceSignals.push(signal("distinct_days", days.size, dayPoints, dayPoints, dayPoints));
  }
  const sessionCap = days.size <= 1
    ? RECURRENCE_RULES.extra_session_cap_same_day
    : RECURRENCE_RULES.extra_session_cap_cross_day;
  const sessionPoints = Math.min(sessionCap, Math.max(0, sessions.size - 1) * RECURRENCE_RULES.extra_session_points);
  if (sessionPoints) {
    recurrence += sessionPoints;
    recurrenceSignals.push(signal("extra_sessions", Math.max(0, sessions.size - 1), RECURRENCE_RULES.extra_session_points, sessionCap, sessionPoints));
  }
  if (appearsAcrossDays(rows, row => row.neighborhood)) {
    recurrence += RECURRENCE_RULES.same_neighborhood_across_days;
    recurrenceSignals.push(ruleSignal("same_neighborhood_across_days", RECURRENCE_RULES.same_neighborhood_across_days));
  }
  if (appearsAcrossDays(rows, row => row.bedrooms)) {
    recurrence += RECURRENCE_RULES.same_bedrooms_across_days;
    recurrenceSignals.push(ruleSignal("same_bedrooms_across_days", RECURRENCE_RULES.same_bedrooms_across_days));
  }
  if (appearsAcrossDays(rows, row => row.property_id)) {
    recurrence += RECURRENCE_RULES.same_property_across_days;
    recurrenceSignals.push(ruleSignal("same_property_across_days", RECURRENCE_RULES.same_property_across_days));
  }
  let spanPoints = 0;
  if (spanDays >= 1) spanPoints += RECURRENCE_RULES.span_1_day;
  if (spanDays >= 3) spanPoints += RECURRENCE_RULES.span_3_days;
  if (spanDays >= 7) spanPoints += RECURRENCE_RULES.span_7_days;
  if (spanPoints) {
    recurrence += spanPoints;
    recurrenceSignals.push(signal("activity_span", Number(spanDays.toFixed(4)), spanPoints, 20, spanPoints));
  }
  recurrence = clampScore(recurrence);

  const brokerSignals = [];
  let broker = 0;
  const addBroker = (name, points) => {
    broker += points;
    brokerSignals.push(ruleSignal(name, points));
  };
  if (maxViewsPerDay >= BROKER_TESTER_RULES.volume_spike.views_per_day || maxEventsPerDay >= BROKER_TESTER_RULES.volume_spike.events_per_day) {
    addBroker("volume_spike", BROKER_TESTER_RULES.volume_spike.points);
  }
  if (burst >= BROKER_TESTER_RULES.view_burst.views_in_two_hours || maxViewsPerDay >= BROKER_TESTER_RULES.view_burst.views_per_day) {
    addBroker("view_burst", BROKER_TESTER_RULES.view_burst.points);
  }
  if (maxDistinct(rows, TWO_DAYS_MS, row => row.neighborhood) >= BROKER_TESTER_RULES.neighborhood_scatter.neighborhoods) {
    addBroker("neighborhood_scatter", BROKER_TESTER_RULES.neighborhood_scatter.points);
  }
  if (maxDistinct(rows, TWO_DAYS_MS, row => row.bedrooms) >= BROKER_TESTER_RULES.bedroom_flip.bedrooms) {
    addBroker("bedroom_flip", BROKER_TESTER_RULES.bedroom_flip.points);
  }
  if (maxDistinct(rows, TWO_DAYS_MS, row => row.band) >= BROKER_TESTER_RULES.price_swing.bands) {
    addBroker("price_swing", BROKER_TESTER_RULES.price_swing.points);
  }
  if (maxDistinct(rows, TWO_DAYS_MS, row => row.development) >= BROKER_TESTER_RULES.developer_scatter.developers) {
    addBroker("developer_scatter", BROKER_TESTER_RULES.developer_scatter.points);
  }
  if (maxDistinctPerDay(rows, row => row.session_id) >= BROKER_TESTER_RULES.session_burst.sessions_per_day) {
    addBroker("session_burst", BROKER_TESTER_RULES.session_burst.points);
  }
  if (maxDistinctPerDay(rows, row => row.filter_key) >= BROKER_TESTER_RULES.filter_churn.filters_per_day) {
    addBroker("filter_churn", BROKER_TESTER_RULES.filter_churn.points);
  }
  const progression = COMMERCIAL_PROGRESSION_EVENTS.reduce((sum, name) => sum + (counts[name] || 0), 0);
  if ((counts.property_view || 0) >= BROKER_TESTER_RULES.browse_without_commerce.views && progression === 0 && neighborhoods.size >= BROKER_TESTER_RULES.browse_without_commerce.neighborhoods) {
    addBroker("browse_without_commerce", BROKER_TESTER_RULES.browse_without_commerce.points);
  }
  if (breadthOnOneDay(rows)) addBroker("breadth_same_day", BROKER_TESTER_RULES.breadth_same_day.points);
  if (qaRepetition(rows) >= BROKER_TESTER_RULES.qa_repetition.repeats) {
    addBroker("qa_repetition", BROKER_TESTER_RULES.qa_repetition.points);
  }
  if (segmentCross(rows)) addBroker("segment_cross", BROKER_TESTER_RULES.segment_cross.points);
  if (rows.some(row => row.metadata_test)) addBroker("metadata_test", BROKER_TESTER_RULES.metadata_test.points);
  if (rows.some(row => containsTest(row.event_id) || containsTest(row.visitor_id) || containsTest(row.session_id) || containsTest(row.property_id))) {
    addBroker("test_identifier", BROKER_TESTER_RULES.test_identifier.points);
  }
  if (rows.some(row =>
    containsTest(row.gclid) || containsTest(row.gbraid) || containsTest(row.wbraid) ||
    containsTest(row.conversion_gclid) || containsTest(row.conversion_gbraid) || containsTest(row.conversion_wbraid)
  )) {
    addBroker("test_click_id", BROKER_TESTER_RULES.test_click_id.points);
  }
  broker = clampScore(broker);

  const confidenceSignals = [];
  let confidence = 0;
  const addConfidence = (name, points, count) => {
    if (!points) return;
    confidence += points;
    confidenceSignals.push(signal(name, count, points, points, points));
  };
  addConfidence("events", bucket(rows.length, DATA_CONFIDENCE_RULES.events), rows.length);
  addConfidence("sessions", bucket(sessions.size, DATA_CONFIDENCE_RULES.sessions), sessions.size);
  addConfidence("days", bucket(days.size, DATA_CONFIDENCE_RULES.days), days.size);
  if (VISITOR_ID_PATTERN.test(resolvedVisitor)) addConfidence("valid_visitor", DATA_CONFIDENCE_RULES.valid_visitor, 1);
  if (rows.every(row => row.session_id)) addConfidence("session_consistency", DATA_CONFIDENCE_RULES.session_consistency, rows.length);
  if (properties.size > 0) addConfidence("property_presence", DATA_CONFIDENCE_RULES.property_presence, properties.size);
  if (rows.some(row => row.intent)) addConfidence("intent_presence", DATA_CONFIDENCE_RULES.intent_presence, 1);
  if (rows.some(row => row.touch)) addConfidence("touch_presence", DATA_CONFIDENCE_RULES.touch_presence, 1);
  const synthetic = brokerSignals.some(item => item.name === "metadata_test" || item.name === "test_identifier" || item.name === "test_click_id");
  if (synthetic) confidence -= DATA_CONFIDENCE_RULES.synthetic_penalty;
  confidence = clampScore(confidence);
  if (synthetic) {
    confidenceSignals.push(signal("synthetic_penalty", 1, -DATA_CONFIDENCE_RULES.synthetic_penalty, 0, -DATA_CONFIDENCE_RULES.synthetic_penalty));
  }

  let buyerClass = "unknown";
  if ((counts.lead_created || 0) > 0 || (counts.ai_lead_success || 0) > 0) buyerClass = "lead";
  else if (buyer >= CLASS_THRESHOLDS.high_intent_buyer && commercial >= CLASS_THRESHOLDS.high_intent_commercial) buyerClass = "high_intent";
  else if (buyer >= CLASS_THRESHOLDS.engaged_buyer) buyerClass = "engaged";
  else if (buyer >= CLASS_THRESHOLDS.exploring_buyer) buyerClass = "exploring";
  else if (buyer > 0) buyerClass = "low_intent";

  let trafficClass = "unknown";
  if (buyer >= CLASS_THRESHOLDS.mixed_buyer && broker >= CLASS_THRESHOLDS.mixed_broker) trafficClass = "mixed";
  else if (broker >= CLASS_THRESHOLDS.broker_class && confidence >= CLASS_THRESHOLDS.confidence_floor) trafficClass = "likely_broker_or_tester";
  else if (buyer >= CLASS_THRESHOLDS.likely_buyer_floor && broker < CLASS_THRESHOLDS.likely_buyer_broker_ceiling && confidence >= CLASS_THRESHOLDS.confidence_floor) {
    trafficClass = "likely_buyer";
  }

  return {
    visitor_id: resolvedVisitor,
    buyer_intent_score: buyer,
    commercial_intent_score: commercial,
    recurrence_score: recurrence,
    broker_tester_score: broker,
    data_confidence_score: confidence,
    buyer_class: buyerClass,
    traffic_quality_class: trafficClass,
    score_breakdown: {
      version: SCORE_VERSION,
      buyer_intent: { score: buyer, signals: buyerSignals },
      commercial_intent: { score: commercial, signals: commercialSignals },
      recurrence: { score: recurrence, signals: recurrenceSignals },
      broker_tester: { score: broker, signals: brokerSignals },
      data_confidence: { score: confidence, signals: confidenceSignals },
      classes: {
        buyer_class: buyerClass,
        traffic_quality_class: trafficClass,
        thresholds: CLASS_THRESHOLDS
      },
      ignored: IGNORED_FEATURES
    },
    first_event_at: new Date(rows[0].time).toISOString(),
    last_event_at: new Date(rows[rows.length - 1].time).toISOString(),
    distinct_days: days.size,
    session_count: sessions.size,
    event_count: rows.length,
    property_count: properties.size,
    neighborhood_count: neighborhoods.size
  };
}

let unavailableLogged = false;

async function syncQualityScore(visitorId, rest) {
  if (typeof rest !== "function") return { ok: false, error: "quality_score_storage_unavailable" };
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false;
  let timer;
  try {
    const call = Promise.resolve(rest("rpc/recompute_buyer_quality_score", {
      method: "POST",
      prefer: "return=representation",
      body: { p_visitor_id: text(visitorId).slice(0, 80) },
      signal: controller && controller.signal
    })).catch(error => {
      if (timedOut || (error && error.name === "AbortError")) return { ok: false, timeout: true };
      return { ok: false, error: error && error.name ? error.name : "Error" };
    });
    const result = await Promise.race([
      call,
      new Promise(resolve => {
        timer = setTimeout(() => {
          timedOut = true;
          if (controller) controller.abort();
          resolve({ ok: false, timeout: true });
        }, QUALITY_SCORE_TIMEOUT_MS);
      })
    ]);
    if (result && result.timeout) {
      console.error("QUALITY_SCORE_TIMEOUT");
      return { ok: false, timeout: true };
    }
    if (!result || result.ok === false) {
      if (result && result.status === 404) {
        if (!unavailableLogged) {
          unavailableLogged = true;
          console.error("QUALITY_SCORE_UNAVAILABLE");
        }
        return { ok: false, status: 404 };
      }
      console.error("QUALITY_SCORE_ERROR", (result && (result.status || result.error)) || "Error");
      return { ok: false, status: result && result.status || 0 };
    }
    return { ok: true };
  } catch (error) {
    console.error("QUALITY_SCORE_ERROR", error && error.name ? error.name : "Error");
    return { ok: false, error: "Error" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  SCORE_VERSION,
  QUALITY_SCORE_TIMEOUT_MS,
  QUALITY_RECOMPUTE_EVENTS,
  BUYER_SIGNAL_WEIGHTS,
  BUYER_COHERENCE_WEIGHTS,
  COMMERCIAL_SIGNAL_WEIGHTS,
  COMMERCIAL_PROGRESSION_EVENTS,
  RECURRENCE_RULES,
  BROKER_TESTER_RULES,
  DATA_CONFIDENCE_RULES,
  CLASS_THRESHOLDS,
  IGNORED_FEATURES,
  scoreVisitor,
  syncQualityScore
};
