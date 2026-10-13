/*
  Camada comum de inteligência de anúncios.

  YNTELIGENCIA e o agente-yincorp enviam o mesmo contrato.
  A regra de high_intent_buyer fica aqui, não nos produtos.
  O feed público não recebe nome, telefone, e-mail nem resumo de lead.
*/

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (typeof root !== "undefined") {
    root.AdsIntelligence = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function adsIntelligenceFactory() {
  const DEDUPE_WINDOW_MS = 15000;
  const PRODUCTS = ["ynteligencia", "agente_yincorp"];
  const CLIENT_EVENTS = [
    "ad_entry",
    "ai_search",
    "property_view",
    "property_view_multiple",
    "specialist_cta_opened",
    "lead_created",
    "agent_opened"
  ];
  const INTERNAL_EVENTS = ["agent_handoff_created"];
  const PII_KEYS = [
    "nome",
    "telefone",
    "phone",
    "email",
    "lead_summary",
    "mensagem",
    "conversation",
    "conversation_text",
    "transcript",
    "notes"
  ];
  const APP_ORIGIN = "https://app.yincorp.com.br";
  const AGENT_ORIGIN = "https://agente.yincorp.com.br";
  const HANDOFF_TTL_MS = 15 * 60 * 1000;
  const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const HIGH_INTENT_CONVERSION_VALUE = 1;
  const LEAD_CONVERSION_VALUE = 10;
  const CONVERSION_CURRENCY = "BRL";
  const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const EXPLICIT_SEARCH_EVENTS = new Set(["ai_search", "ad_entry"]);
  const GOOGLE_CONVERSIONS = {
    high_intent_buyer: {
      name: "High Intent Buyer",
      value: HIGH_INTENT_CONVERSION_VALUE
    },
    lead_created: {
      name: "Lead Created",
      value: LEAD_CONVERSION_VALUE
    }
  };
  const GOOGLE_CONVERSION_COLUMNS = [
    "Google Click ID",
    "GBRAID",
    "WBRAID",
    "Conversion Name",
    "Conversion Time",
    "Conversion Value",
    "Conversion Currency",
    "Order ID",
    "Product"
  ];

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeText(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function slug(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function numberOrZero(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function whole(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
  }

  function omitPii(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(omitPii);
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if (PII_KEYS.includes(String(key).toLowerCase())) continue;
      copy[key] = item && typeof item === "object" ? omitPii(item) : item;
    }
    return copy;
  }

  function normalizeIntent(intent) {
    const source = intent && typeof intent === "object" ? intent : {};
    const inventory = clean(source.inventory_source || source.source).toLowerCase();
    return {
      neighborhood: clean(source.neighborhood),
      development: clean(source.development || source.project || source.exact_name),
      bedrooms: whole(source.bedrooms),
      min_price: numberOrZero(source.min_price ?? source.minPrice),
      max_price: numberOrZero(source.max_price ?? source.maxPrice),
      inventory_source: ["novos", "usados", "todos"].includes(inventory) ? inventory : ""
    };
  }

  function isUuid(value) {
    return VISITOR_ID_PATTERN.test(clean(value));
  }

  function normalizeProperty(property) {
    const source = property && typeof property === "object" ? property : {};
    const inventory = clean(source.inventory_source || source.source).toLowerCase();
    const external = clean(source.external_id);
    const rawPropertyId = clean(source.property_id);
    const rawId = clean(source.id);
    const propertyId = [external, rawPropertyId, rawId].find(value => value && !isUuid(value)) || "";
    const dbId = [clean(source.db_id || source.dbId), rawPropertyId, rawId].find(value => isUuid(value)) || "";
    const normalized = {
      property_id: propertyId,
      name: clean(source.name || source.property_name),
      neighborhood: clean(source.neighborhood),
      development: clean(source.development || source.development_name),
      bedrooms: whole(source.bedrooms),
      price: numberOrZero(source.price ?? source.value ?? source.property_value),
      inventory_source: ["novos", "usados"].includes(inventory) ? inventory : ""
    };
    if (dbId && dbId !== propertyId) normalized.db_id = dbId;
    return normalized;
  }

  function isValidSearch(intent) {
    if (!intent) return false;
    return Boolean(
      intent.neighborhood ||
      intent.development ||
      intent.bedrooms > 0 ||
      intent.min_price > 0 ||
      intent.max_price > 0
    );
  }

  function normalizeEvent(input, now = new Date(), options = {}) {
    const body = omitPii(input || {});
    const product = clean(body.product).toLowerCase();
    const eventName = clean(body.event_name);
    const allowedEvents = options.internal ? CLIENT_EVENTS.concat(INTERNAL_EVENTS) : CLIENT_EVENTS;
    const visitorId = clean(body.visitor_id);
    const sessionId = clean(body.session_id);

    if (!PRODUCTS.includes(product)) {
      return { error: "product inválido" };
    }
    if (!allowedEvents.includes(eventName)) {
      return { error: "event_name inválido" };
    }
    if (!visitorId || !sessionId) {
      return { error: "visitor_id e session_id são obrigatórios" };
    }

    const eventTime = clean(body.event_time);
    const parsedTime = eventTime ? new Date(eventTime) : now;
    if (Number.isNaN(parsedTime.getTime())) {
      return { error: "event_time inválido" };
    }

    if (!validVisitorId(visitorId)) {
      return { error: "visitor_id inválido" };
    }

    const metadata = omitPii(body.metadata && typeof body.metadata === "object" ? body.metadata : {});
    delete metadata.observed_intent;
    delete metadata.declared_intent;
    delete metadata.first_declared_intent;
    delete metadata.current_declared_intent;

    return {
      event: {
        event_id: clean(body.event_id) || "",
        event_name: eventName,
        event_time: parsedTime.toISOString(),
        product,
        visitor_id: visitorId,
        session_id: sessionId,
        gclid: clean(body.gclid),
        gbraid: clean(body.gbraid),
        wbraid: clean(body.wbraid),
        utm_source: clean(body.utm_source),
        utm_medium: clean(body.utm_medium),
        utm_campaign: clean(body.utm_campaign),
        utm_term: clean(body.utm_term),
        utm_content: clean(body.utm_content),
        intent: normalizeIntent(body.intent || body.declared_intent),
        property: normalizeProperty(body.property),
        metadata
      }
    };
  }

  function validVisitorId(value) {
    return VISITOR_ID_PATTERN.test(clean(value));
  }

  function acceptVisitorId(candidate, localId) {
    if (validVisitorId(candidate)) return clean(candidate);
    if (validVisitorId(localId)) return clean(localId);
    return "";
  }

  function clip(value, max = 180) {
    return clean(value).slice(0, max);
  }

  function createHandoffToken() {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function sanitizeAttribution(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      gclid: clip(source.gclid, 200),
      gbraid: clip(source.gbraid, 200),
      wbraid: clip(source.wbraid, 200),
      utm_source: clip(source.utm_source, 120),
      utm_medium: clip(source.utm_medium, 120),
      utm_campaign: clip(source.utm_campaign, 120),
      utm_term: clip(source.utm_term, 120),
      utm_content: clip(source.utm_content, 120)
    };
  }

  function sanitizeObserved(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const observed = {
      neighborhood: clip(value.neighborhood),
      development: clip(value.development),
      bedrooms: whole(value.bedrooms),
      price_min: numberOrZero(value.price_min),
      price_max: numberOrZero(value.price_max)
    };
    if (!observed.neighborhood && !observed.development && !observed.bedrooms && !observed.price_min && !observed.price_max) {
      return null;
    }
    return observed;
  }

  function allowedReturnOrigin(origin, allowedOrigins) {
    const candidate = clean(origin).replace(/\/$/, "");
    if ((allowedOrigins || []).includes(candidate)) return candidate;
    return "";
  }

  function propertyReturnUrl(origin, propertyId, visitorId, allowedOrigins) {
    const base = allowedReturnOrigin(origin, allowedOrigins) || APP_ORIGIN;
    const url = new URL(`${base}/`);
    if (propertyId) url.searchParams.set("imovel", propertyId);
    if (validVisitorId(visitorId)) url.searchParams.set("vid", visitorId);
    return url.toString();
  }

  function agentHandoffUrl(token) {
    const url = new URL(`${AGENT_ORIGIN}/`);
    url.searchParams.set("handoff", token);
    return url.toString();
  }

  function handoffEnv(options) {
    if (options && Object.prototype.hasOwnProperty.call(options, "env")) return options.env || {};
    return typeof process !== "undefined" && process.env ? process.env : {};
  }

  function agentHandoffEnabled(env) {
    const source = env || handoffEnv();
    return String(source.ADS_AGENT_HANDOFF_ENABLED || "") === "true";
  }

  function authoritativeAttribution(body) {
    if (body.current_touch && typeof body.current_touch === "object" && !Array.isArray(body.current_touch)) {
      return sanitizeAttribution(body.current_touch);
    }
    return sanitizeAttribution(body.attribution);
  }

  function handoffContext(input, visitor, allowedOrigins) {
    const body = omitPii(input || {});
    const property = normalizeProperty(body.property || body.current_property);
    const recent = (Array.isArray(body.recent_properties) ? body.recent_properties : [])
      .slice(-8)
      .map(item => normalizeProperty(item))
      .filter(item => item.property_id);
    const screenIntent = normalizeIntent(body.declared_intent || body.intent);
    const storedCurrent = visitor ? normalizeIntent(visitor.current_declared_intent) : normalizeIntent(null);
    const storedFirst = visitor ? normalizeIntent(visitor.first_declared_intent) : normalizeIntent(null);
    return {
      property,
      current_property: property,
      declared_intent: screenIntent,
      first_declared_intent: isValidSearch(storedFirst) ? storedFirst : null,
      current_declared_intent: isValidSearch(storedCurrent) ? storedCurrent : screenIntent,
      observed_intent: visitor ? sanitizeObserved(visitor.observed_intent) : null,
      recent_properties: recent,
      attribution: authoritativeAttribution(body),
      last_product: clip(visitor && visitor.last_product) || "ynteligencia",
      return_url: propertyReturnUrl(body.return_origin, property.property_id, body.visitor_id, allowedOrigins)
    };
  }

  async function createHandoff(input, rest, now = new Date(), options = {}) {
    if (!agentHandoffEnabled(handoffEnv(options))) {
      return { status: 409, body: { success: false, error: "handoff_disabled" } };
    }

    const body = omitPii(input || {});
    const visitorId = clean(body.visitor_id);
    const sessionId = clip(body.session_id, 120);
    const source = clean(body.source_product).toLowerCase() || "ynteligencia";
    if (source !== "ynteligencia") {
      return { status: 400, body: { success: false, error: "source_product inválido" } };
    }
    if (!validVisitorId(visitorId) || !sessionId) {
      return { status: 400, body: { success: false, error: "visitor_id e session_id são obrigatórios" } };
    }

    const visitorRows = await rest(
      `ads_visitors?select=visitor_id,last_product,first_declared_intent,current_declared_intent,observed_intent,observed_confidence&visitor_id=eq.${encodeURIComponent(visitorId)}&limit=1`,
      { method: "GET" }
    );
    if (!visitorRows.ok) {
      return { status: 502, body: { success: false, error: "Não foi possível criar o handoff" } };
    }

    const visitor = Array.isArray(visitorRows.data) ? visitorRows.data[0] : null;
    const token = (options.createToken || createHandoffToken)();
    if (!HANDOFF_TOKEN_PATTERN.test(token)) {
      return { status: 500, body: { success: false, error: "Não foi possível criar o handoff" } };
    }

    const context = handoffContext({ ...body, visitor_id: visitorId }, visitor, options.allowedOrigins || []);
    const expires = new Date(now.getTime() + HANDOFF_TTL_MS);
    const saved = await rest("ads_handoffs", {
      method: "POST",
      body: {
        handoff_id: token,
        visitor_id: visitorId,
        session_id: sessionId,
        source_product: "ynteligencia",
        target_product: "agente_yincorp",
        context,
        created_at: now.toISOString(),
        expires_at: expires.toISOString(),
        consumed_at: null
      }
    });
    if (!saved.ok) {
      return { status: 502, body: { success: false, error: "Não foi possível criar o handoff" } };
    }

    const recorded = await recordAdsEvent({
      product: "ynteligencia",
      event_name: "agent_handoff_created",
      visitor_id: visitorId,
      session_id: sessionId,
      ...context.attribution,
      intent: context.declared_intent,
      property: context.property,
      metadata: { target_product: "agente_yincorp" }
    }, rest, now, options.createId || cryptoRandom, { internal: true });
    if (recorded.status >= 500) {
      return { status: 502, body: { success: false, error: "Não foi possível criar o handoff" } };
    }

    return {
      status: 200,
      body: {
        success: true,
        expires_at: expires.toISOString(),
        url: agentHandoffUrl(token)
      }
    };
  }

  async function readHandoff(input, rest, now = new Date()) {
    const token = clean(input && (input.handoff_id || input.handoff));
    if (!HANDOFF_TOKEN_PATTERN.test(token)) {
      return { status: 400, body: { success: false, error: "handoff_malformed" } };
    }

    const rows = await rest(
      "ads_handoffs?select=visitor_id,session_id,source_product,target_product,context,created_at,expires_at,consumed_at" +
      `&handoff_id=eq.${encodeURIComponent(token)}&limit=1`,
      { method: "GET" }
    );
    if (!rows.ok) {
      return { status: 502, body: { success: false, error: "Não foi possível ler o handoff" } };
    }

    const row = Array.isArray(rows.data) ? rows.data[0] : null;
    if (!row) return { status: 404, body: { success: false, error: "handoff_invalid" } };
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      return { status: 410, body: { success: false, error: "handoff_expired" } };
    }

    if (!row.consumed_at) {
      await rest(`ads_handoffs?handoff_id=eq.${encodeURIComponent(token)}`, {
        method: "PATCH",
        body: { consumed_at: now.toISOString() }
      });
    }

    return {
      status: 200,
      body: {
        success: true,
        visitor_id: row.visitor_id,
        session_id: row.session_id,
        source_product: row.source_product,
        target_product: row.target_product,
        context: omitPii(row.context),
        created_at: row.created_at,
        expires_at: row.expires_at
      }
    };
  }

  function visitorHandoffUrl(baseUrl, visitorId) {
    const base = clean(baseUrl);
    if (!base || !validVisitorId(visitorId)) return base;
    try {
      const url = new URL(base);
      url.searchParams.set("vid", clean(visitorId));
      return url.toString();
    } catch (error) {
      const joiner = base.includes("?") ? "&" : "?";
      return `${base}${joiner}vid=${encodeURIComponent(clean(visitorId))}`;
    }
  }

  function samePlace(left, right) {
    const a = normalizeText(left);
    const b = normalizeText(right);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  function developmentMatch(search, property) {
    if (!search || !search.development || !property) return false;
    return samePlace(search.development, property.development) ||
      samePlace(search.development, property.name);
  }

  function evaluateHighIntent(events) {
    const list = Array.isArray(events) ? events : [];
    const searches = list
      .filter(item => item.event_name === "ai_search" || item.event_name === "ad_entry")
      .map(item => item.intent)
      .filter(isValidSearch);
    const views = list.filter(item =>
      item.event_name === "property_view" &&
      item.property &&
      item.property.property_id
    );
    const properties = new Set(views.map(item => item.property.property_id));
    const specialist = list.some(item => item.event_name === "specialist_cta_opened");
    const namedSearch = searches.find(item => item.development);
    const reasons = [];

    if (searches.length && properties.size >= 2) {
      reasons.push("busca_valida_e_dois_imoveis");
    }
    if (searches.length && properties.size >= 1 && specialist) {
      reasons.push("busca_imovel_e_cta");
    }
    if (namedSearch && views.some(item => developmentMatch(namedSearch, item.property))) {
      reasons.push("empreendimento_e_imovel_correspondente");
    }

    return {
      high_intent: reasons.length > 0,
      reasons
    };
  }

  function mode(values) {
    const counts = new Map();
    for (const value of values) {
      const key = String(value);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let winner = "";
    let best = 0;
    for (const [key, count] of counts) {
      if (count > best) {
        winner = key;
        best = count;
      }
    }
    return winner;
  }

  function bandDown(value) {
    return Math.floor((Number(value) * 0.95) / 50000) * 50000;
  }

  function bandUp(value) {
    return Math.round((Number(value) * 1.03) / 50000) * 50000;
  }

  function observedIntentFromViews(views) {
    const priced = (Array.isArray(views) ? views : []).filter(item =>
      item.property &&
      item.property.neighborhood &&
      item.property.bedrooms > 0 &&
      item.property.price >= 1
    );
    if (priced.length < 3) {
      return { observed_intent: null, observed_confidence: 0 };
    }

    const neighborhood = mode(priced.map(item => item.property.neighborhood));
    const inPlace = priced.filter(item =>
      normalizeText(item.property.neighborhood) === normalizeText(neighborhood)
    );
    if (inPlace.length < 3) {
      return { observed_intent: null, observed_confidence: 0 };
    }

    const bedrooms = Number(mode(inPlace.map(item => item.property.bedrooms)));
    const cluster = inPlace.filter(item => item.property.bedrooms === bedrooms);
    if (cluster.length < 3) {
      return { observed_intent: null, observed_confidence: 0 };
    }

    const prices = cluster.map(item => item.property.price).sort((a, b) => a - b);
    return {
      observed_intent: {
        neighborhood,
        bedrooms,
        price_min: bandDown(prices[0]),
        price_max: bandUp(prices[prices.length - 1])
      },
      observed_confidence: Math.min(0.9, Math.round((0.45 + (0.1 * cluster.length)) * 100) / 100)
    };
  }

  function eventRow(event, observed = {}) {
    const intent = event.intent || normalizeIntent(null);
    const property = event.property || normalizeProperty(null);
    const preference = observed.observed_intent || {};
    return {
      event_id: event.event_id,
      event_name: event.event_name,
      event_time: event.event_time,
      product: event.product,
      visitor_id: event.visitor_id,
      session_id: event.session_id,
      gclid: event.gclid || "",
      gbraid: event.gbraid || "",
      wbraid: event.wbraid || "",
      utm_source: event.utm_source || "",
      utm_medium: event.utm_medium || "",
      utm_campaign: event.utm_campaign || "",
      utm_term: event.utm_term || "",
      utm_content: event.utm_content || "",
      declared_neighborhood: intent.neighborhood,
      declared_development: intent.development,
      declared_bedrooms: intent.bedrooms || null,
      declared_min_price: intent.min_price || null,
      declared_max_price: intent.max_price || null,
      declared_inventory_source: intent.inventory_source,
      property_id: property.property_id,
      property_name: property.name,
      property_neighborhood: property.neighborhood,
      property_development: property.development,
      property_bedrooms: property.bedrooms || null,
      property_price: property.price || null,
      property_inventory_source: property.inventory_source,
      observed_neighborhood: preference.neighborhood || "",
      observed_bedrooms: preference.bedrooms || null,
      observed_price_min: preference.price_min || null,
      observed_price_max: preference.price_max || null,
      observed_confidence: observed.observed_confidence || 0,
      metadata: event.metadata || {}
    };
  }

  function rowToEvent(row) {
    return {
      event_id: row.event_id,
      event_name: row.event_name,
      event_time: row.event_time,
      product: row.product,
      visitor_id: row.visitor_id,
      session_id: row.session_id,
      gclid: row.gclid || "",
      gbraid: row.gbraid || "",
      wbraid: row.wbraid || "",
      utm_source: row.utm_source || "",
      utm_medium: row.utm_medium || "",
      utm_campaign: row.utm_campaign || "",
      utm_term: row.utm_term || "",
      utm_content: row.utm_content || "",
      intent: {
        neighborhood: row.declared_neighborhood || "",
        development: row.declared_development || "",
        bedrooms: Number(row.declared_bedrooms) || 0,
        min_price: Number(row.declared_min_price) || 0,
        max_price: Number(row.declared_max_price) || 0,
        inventory_source: row.declared_inventory_source || ""
      },
      property: {
        property_id: row.property_id || "",
        name: row.property_name || "",
        neighborhood: row.property_neighborhood || "",
        development: row.property_development || "",
        bedrooms: Number(row.property_bedrooms) || 0,
        price: Number(row.property_price) || 0,
        inventory_source: row.property_inventory_source || ""
      }
    };
  }

  function searchIntentKey(intent) {
    const normalized = normalizeIntent(intent);
    return JSON.stringify([
      normalizeText(normalized.neighborhood),
      normalizeText(normalized.development),
      normalized.bedrooms,
      normalized.min_price,
      normalized.max_price,
      normalized.inventory_source
    ]);
  }

  function dedupeMatch(existing, event, now) {
    const cutoff = now.getTime() - DEDUPE_WINDOW_MS;
    return (Array.isArray(existing) ? existing : []).find(row => {
      const at = new Date(row.event_time).getTime();
      return row.event_name === event.event_name &&
        row.visitor_id === event.visitor_id &&
        row.session_id === event.session_id &&
        clean(row.property_id) === clean(event.property.property_id) &&
        (event.event_name !== "ai_search" ||
          searchIntentKey(rowToEvent(row).intent) === searchIntentKey(event.intent)) &&
        at >= cutoff &&
        at <= now.getTime() + 1000;
    }) || null;
  }

  function explicitDeclaredIntent(event) {
    if (!event || !EXPLICIT_SEARCH_EVENTS.has(event.event_name)) return null;
    if (!isValidSearch(event.intent)) return null;
    return event.intent;
  }

  function organicArrival(event) {
    return event.event_name === "ad_entry" &&
      !event.gclid &&
      !event.gbraid &&
      !event.wbraid &&
      !event.utm_source;
  }

  function touchPatch(current, event) {
    const seen = event.event_time;
    const declared = explicitDeclaredIntent(event);
    const next = {
      visitor_id: event.visitor_id,
      last_seen: seen,
      last_product: event.product || "",
      updated_at: seen
    };
    if (event.gclid) next.last_gclid = event.gclid;
    if (event.gbraid) next.last_gbraid = event.gbraid;
    if (event.wbraid) next.last_wbraid = event.wbraid;
    if (event.utm_source) next.last_utm_source = event.utm_source;
    else if (organicArrival(event)) next.last_utm_source = "organic";
    if (event.utm_campaign) next.last_utm_campaign = event.utm_campaign;

    if (!current) {
      const paid = Boolean(event.gclid || event.gbraid || event.wbraid);
      return {
        ...next,
        first_seen: seen,
        first_product: event.product || "",
        first_gclid: event.gclid || "",
        first_gbraid: event.gbraid || "",
        first_wbraid: event.wbraid || "",
        first_utm_source: event.utm_source || (paid ? "" : (organicArrival(event) ? "organic" : "")),
        first_utm_campaign: event.utm_campaign || "",
        last_gclid: event.gclid || "",
        last_gbraid: event.gbraid || "",
        last_wbraid: event.wbraid || "",
        last_utm_source: event.utm_source || (organicArrival(event) ? "organic" : ""),
        last_utm_campaign: event.utm_campaign || "",
        first_declared_intent: declared,
        current_declared_intent: declared
      };
    }

    if (!current.first_declared_intent && declared) {
      next.first_declared_intent = declared;
    }
    if (declared) {
      next.current_declared_intent = declared;
    }
    return next;
  }

  function propertyFeedItem(row) {
    const propertyId = clean(row.external_id || row.property_id || row.id);
    const price = numberOrZero(row.price ?? row.value);
    return {
      item_id: propertyId,
      property_id: propertyId,
      name: clean(row.development_name || row.title || row.name),
      development: clean(row.development_name || row.development),
      neighborhood: clean(row.neighborhood),
      price: price >= 1 ? price : null,
      bedrooms: whole(row.bedrooms),
      area: numberOrZero(row.area),
      inventory_source: clean(row.source || row.inventory_source).toLowerCase(),
      image_url: clean(row.image_url),
      final_url: `${APP_ORIGIN}/?imovel=${encodeURIComponent(propertyId)}`,
      availability: row.active === false ? "out_of_stock" : "in_stock"
    };
  }

  function intentKey(intent) {
    const price = intent.max_price >= 100000
      ? Math.round(intent.max_price / 100000) * 100000
      : 0;
    return [
      normalizeText(intent.neighborhood),
      normalizeText(intent.development),
      intent.bedrooms || 0,
      price
    ].join("|");
  }

  function intentUrl(intent) {
    /*
      O app ainda não consome ?empreendimento=.
      Intenção que depende do empreendimento não vira URL.
    */
    if (intent.development) return "";
    const params = new URLSearchParams();
    if (intent.neighborhood) params.set("bairro", slug(intent.neighborhood));
    if (intent.bedrooms > 0) params.set("dormitorios", String(intent.bedrooms));
    if (intent.max_price >= 100000) {
      params.set("valor_max", String(Math.round(intent.max_price / 100000) * 100000));
    }
    const query = params.toString();
    return query ? `${APP_ORIGIN}/?${query}` : "";
  }

  function inventoryHasIntent(intent, inventory) {
    const names = new Set((inventory || []).map(item => normalizeText(item.neighborhood)).filter(Boolean));
    const developments = new Set((inventory || []).map(item => normalizeText(item.development || item.development_name || item.name)).filter(Boolean));
    if (intent.development && [...developments].some(name => samePlace(name, intent.development))) {
      return true;
    }
    if (intent.neighborhood && names.has(normalizeText(intent.neighborhood))) {
      return true;
    }
    return false;
  }

  function intentFromRecord(event) {
    const declared = event.intent || normalizeIntent({
      neighborhood: event.declared_neighborhood,
      development: event.declared_development,
      bedrooms: event.declared_bedrooms,
      max_price: event.declared_max_price,
      inventory_source: event.declared_inventory_source
    });
    if (isValidSearch(declared)) return declared;
    const property = event.property || {};
    return normalizeIntent({
      neighborhood: event.property_neighborhood || property.neighborhood,
      development: event.property_development || property.development,
      bedrooms: event.property_bedrooms || property.bedrooms,
      max_price: event.property_price || property.price
    });
  }

  function intentFeedItems(events, inventory) {
    const grouped = new Map();
    for (const event of events || []) {
      const intent = intentFromRecord(event);
      if (!isValidSearch(intent)) continue;
      if (intent.bedrooms > 6) continue;
      if (!inventoryHasIntent(intent, inventory)) continue;
      const key = intentKey(intent);
      const current = grouped.get(key) || { intent, count: 0 };
      current.count += 1;
      grouped.set(key, current);
    }

    return [...grouped.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 200)
      .map(item => ({
        url: intentUrl(item.intent),
        neighborhood: item.intent.neighborhood,
        development: item.intent.development,
        bedrooms: item.intent.bedrooms,
        max_price: item.intent.max_price >= 100000
          ? Math.round(item.intent.max_price / 100000) * 100000
          : 0,
        signals: item.count
      }))
      .filter(item => item.url);
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  const SHEET_COLUMNS = [
    "event_time",
    "event_name",
    "product",
    "visitor_id",
    "session_id",
    "gclid",
    "gbraid",
    "wbraid",
    "utm_source",
    "utm_campaign",
    "declared_neighborhood",
    "declared_development",
    "declared_bedrooms",
    "declared_max_price",
    "observed_neighborhood",
    "observed_bedrooms",
    "observed_price_min",
    "observed_price_max",
    "observed_confidence",
    "property_id",
    "property_name",
    "property_price",
    "property_inventory_source"
  ];

  function sheetCsv(rows) {
    const lines = [SHEET_COLUMNS.join(",")];
    for (const row of rows || []) {
      lines.push(SHEET_COLUMNS.map(column => csvCell(row[column])).join(","));
    }
    return `${lines.join("\n")}\n`;
  }

  function hasClickId(row) {
    return Boolean(clean(row && row.gclid) || clean(row && row.gbraid) || clean(row && row.wbraid));
  }

  function googleAdsConversionTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const shifted = new Date(date.getTime() - (3 * 60 * 60 * 1000));
    const pad = number => String(number).padStart(2, "0");
    return [
      shifted.getUTCFullYear(),
      pad(shifted.getUTCMonth() + 1),
      pad(shifted.getUTCDate())
    ].join("-") + ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}-0300`;
  }

  function googleAdsConversionRows(rows) {
    const seen = new Set();
    const exported = [];
    for (const row of rows || []) {
      const spec = GOOGLE_CONVERSIONS[clean(row.event_name)];
      const orderId = clean(row.event_id);
      if (!spec || !orderId || seen.has(orderId) || !hasClickId(row)) continue;
      seen.add(orderId);
      exported.push({
        "Google Click ID": clean(row.gclid),
        GBRAID: clean(row.gbraid),
        WBRAID: clean(row.wbraid),
        "Conversion Name": spec.name,
        "Conversion Time": googleAdsConversionTime(row.event_time),
        "Conversion Value": spec.value,
        "Conversion Currency": CONVERSION_CURRENCY,
        "Order ID": orderId,
        Product: clean(row.product)
      });
    }
    return exported;
  }

  function googleAdsConversionsCsv(rows) {
    const exported = googleAdsConversionRows(rows);
    const lines = [GOOGLE_CONVERSION_COLUMNS.join(",")];
    for (const row of exported) {
      lines.push(GOOGLE_CONVERSION_COLUMNS.map(column => csvCell(row[column])).join(","));
    }
    return `${lines.join("\n")}\n`;
  }

  function derivedEvent(base, eventName, property, intent, observed) {
    return {
      ...base,
      event_id: "",
      event_name: eventName,
      property: property || normalizeProperty(null),
      intent: intent || base.intent,
      metadata: { derived: true },
      observed
    };
  }

  async function recordAdsEvent(input, rest, now = new Date(), createId = () => cryptoRandom(), options = {}) {
    const normalized = normalizeEvent(input, now, options);
    if (normalized.error) {
      return { status: 400, body: { success: false, error: normalized.error } };
    }

    const event = { ...normalized.event, event_id: normalized.event.event_id || createId() };
    const recent = await rest(
      "ads_events?select=event_id,event_name,event_time,visitor_id,session_id,property_id" +
      (event.event_name === "ai_search"
        ? ",declared_neighborhood,declared_development,declared_bedrooms,declared_min_price,declared_max_price,declared_inventory_source"
        : "") +
      `&visitor_id=eq.${encodeURIComponent(event.visitor_id)}` +
      `&session_id=eq.${encodeURIComponent(event.session_id)}` +
      `&event_name=eq.${encodeURIComponent(event.event_name)}` +
      `&order=event_time.desc&limit=20`,
      { method: "GET" }
    );
    if (!recent.ok) return supabaseFailure(recent);

    const duplicate = dedupeMatch(recent.data, event, now);
    if (duplicate) {
      return {
        status: 200,
        body: {
          success: true,
          duplicate: true,
          event_id: duplicate.event_id,
          high_intent_buyer: false
        }
      };
    }

    const visitorRows = await rest(
      `ads_visitors?select=*&visitor_id=eq.${encodeURIComponent(event.visitor_id)}&limit=1`,
      { method: "GET" }
    );
    if (!visitorRows.ok) return supabaseFailure(visitorRows);
    const visitor = Array.isArray(visitorRows.data) ? visitorRows.data[0] : null;

    const viewRows = await rest(
      "ads_events?select=event_name,property_id,property_name,property_neighborhood,property_development,property_bedrooms,property_price,property_inventory_source" +
      `&visitor_id=eq.${encodeURIComponent(event.visitor_id)}` +
      "&event_name=eq.property_view&order=event_time.desc&limit=12",
      { method: "GET" }
    );
    if (!viewRows.ok) return supabaseFailure(viewRows);

    const priorViews = (viewRows.data || []).map(rowToEvent).reverse();
    const viewsForObserved = event.event_name === "property_view"
      ? priorViews.concat(event)
      : priorViews;
    const observed = observedIntentFromViews(viewsForObserved);
    const inserted = await rest("ads_events", {
      method: "POST",
      body: eventRow(event, observed)
    });
    if (!inserted.ok) return supabaseFailure(inserted);

    const touch = touchPatch(visitor, event);
    if (observed.observed_intent) {
      touch.observed_intent = observed.observed_intent;
      touch.observed_confidence = observed.observed_confidence;
    }
    const savedVisitor = await rest(
      visitor ? `ads_visitors?visitor_id=eq.${encodeURIComponent(event.visitor_id)}` : "ads_visitors",
      { method: visitor ? "PATCH" : "POST", body: touch }
    );
    if (!savedVisitor.ok) return supabaseFailure(savedVisitor);

    const sessionRows = await rest(
      "ads_events?select=*" +
      `&visitor_id=eq.${encodeURIComponent(event.visitor_id)}` +
      `&session_id=eq.${encodeURIComponent(event.session_id)}` +
      "&order=event_time.asc&limit=100",
      { method: "GET" }
    );
    if (!sessionRows.ok) return supabaseFailure(sessionRows);
    const sessionEvents = (sessionRows.data || []).map(rowToEvent);
    const decision = evaluateHighIntent(sessionEvents);
    const names = new Set(sessionEvents.map(item => item.event_name));
    const views = sessionEvents.filter(item => item.event_name === "property_view");
    const distinct = new Set(views.map(item => item.property.property_id));
    let multipleId = "";
    let highIntentId = "";

    if (distinct.size >= 2 && !names.has("property_view_multiple")) {
      const second = views[1] || views[views.length - 1];
      const extra = derivedEvent(event, "property_view_multiple", second.property, event.intent, observed);
      extra.event_id = createId();
      const saved = await rest("ads_events", { method: "POST", body: eventRow(extra, observed) });
      if (!saved.ok) return supabaseFailure(saved);
      multipleId = extra.event_id;
    }

    if (decision.high_intent && !names.has("high_intent_buyer")) {
      const lastView = views[views.length - 1];
      const firstSearch = sessionEvents.find(item =>
        (item.event_name === "ai_search" || item.event_name === "ad_entry") &&
        isValidSearch(item.intent)
      );
      const extra = derivedEvent(
        event,
        "high_intent_buyer",
        lastView ? lastView.property : event.property,
        firstSearch ? firstSearch.intent : event.intent,
        observed
      );
      extra.event_id = createId();
      extra.metadata = { derived: true, reasons: decision.reasons };
      const saved = await rest("ads_events", { method: "POST", body: eventRow(extra, observed) });
      if (!saved.ok) return supabaseFailure(saved);
      highIntentId = extra.event_id;
    }

    return {
      status: 200,
      body: {
        success: true,
        duplicate: false,
        event_id: event.event_id,
        property_view_multiple: Boolean(multipleId),
        high_intent_buyer: Boolean(highIntentId),
        high_intent_event_id: highIntentId,
        observed_confidence: observed.observed_confidence || 0
      }
    };
  }

  function supabaseFailure(result) {
    return {
      status: 502,
      body: {
        success: false,
        error: "Não foi possível gravar o evento de anúncio"
      },
      detailStatus: result.status
    };
  }

  function cryptoRandom() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
      const rand = Math.floor(Math.random() * 16);
      const value = char === "x" ? rand : (rand & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  return {
    DEDUPE_WINDOW_MS,
    PRODUCTS,
    CLIENT_EVENTS,
    SHEET_COLUMNS,
    GOOGLE_CONVERSION_COLUMNS,
    HIGH_INTENT_CONVERSION_VALUE,
    LEAD_CONVERSION_VALUE,
    CONVERSION_CURRENCY,
    APP_ORIGIN,
    AGENT_ORIGIN,
    HANDOFF_TTL_MS,
    clean,
    normalizeText,
    slug,
    omitPii,
    validVisitorId,
    acceptVisitorId,
    visitorHandoffUrl,
    agentHandoffUrl,
    agentHandoffEnabled,
    createHandoff,
    readHandoff,
    normalizeIntent,
    normalizeProperty,
    isValidSearch,
    normalizeEvent,
    evaluateHighIntent,
    observedIntentFromViews,
    eventRow,
    rowToEvent,
    searchIntentKey,
    dedupeMatch,
    touchPatch,
    propertyFeedItem,
    intentFeedItems,
    intentUrl,
    sheetCsv,
    googleAdsConversionTime,
    googleAdsConversionRows,
    googleAdsConversionsCsv,
    recordAdsEvent
  };
});
