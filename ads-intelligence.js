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
    "lead_created"
  ];
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

  function normalizeProperty(property) {
    const source = property && typeof property === "object" ? property : {};
    const inventory = clean(source.inventory_source || source.source).toLowerCase();
    return {
      property_id: clean(source.property_id || source.id),
      name: clean(source.name || source.property_name),
      neighborhood: clean(source.neighborhood),
      development: clean(source.development || source.development_name),
      bedrooms: whole(source.bedrooms),
      price: numberOrZero(source.price ?? source.value ?? source.property_value),
      inventory_source: ["novos", "usados"].includes(inventory) ? inventory : ""
    };
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

  function normalizeEvent(input, now = new Date()) {
    const body = omitPii(input || {});
    const product = clean(body.product).toLowerCase();
    const eventName = clean(body.event_name);
    const visitorId = clean(body.visitor_id);
    const sessionId = clean(body.session_id);

    if (!PRODUCTS.includes(product)) {
      return { error: "product inválido" };
    }
    if (!CLIENT_EVENTS.includes(eventName)) {
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
        intent: normalizeIntent(body.intent),
        property: normalizeProperty(body.property),
        metadata: omitPii(body.metadata && typeof body.metadata === "object" ? body.metadata : {})
      }
    };
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

  function dedupeMatch(existing, event, now) {
    const cutoff = now.getTime() - DEDUPE_WINDOW_MS;
    return (Array.isArray(existing) ? existing : []).find(row => {
      const at = new Date(row.event_time).getTime();
      return row.event_name === event.event_name &&
        row.visitor_id === event.visitor_id &&
        row.session_id === event.session_id &&
        clean(row.property_id) === clean(event.property.property_id) &&
        at >= cutoff &&
        at <= now.getTime() + 1000;
    }) || null;
  }

  function touchPatch(current, event) {
    const seen = event.event_time;
    const next = {
      visitor_id: event.visitor_id,
      last_seen: seen,
      updated_at: seen
    };
    if (event.gclid) next.last_gclid = event.gclid;
    if (event.gbraid) next.last_gbraid = event.gbraid;
    if (event.wbraid) next.last_wbraid = event.wbraid;
    if (event.utm_source) next.last_utm_source = event.utm_source;
    if (event.utm_campaign) next.last_utm_campaign = event.utm_campaign;

    if (!current) {
      return {
        ...next,
        first_seen: seen,
        first_gclid: event.gclid || "",
        first_gbraid: event.gbraid || "",
        first_wbraid: event.wbraid || "",
        first_utm_source: event.utm_source || "",
        first_utm_campaign: event.utm_campaign || "",
        last_gclid: event.gclid || "",
        last_gbraid: event.gbraid || "",
        last_wbraid: event.wbraid || "",
        last_utm_source: event.utm_source || "",
        last_utm_campaign: event.utm_campaign || "",
        declared_intent: isValidSearch(event.intent) ? event.intent : null
      };
    }

    if (!current.declared_intent && isValidSearch(event.intent)) {
      next.declared_intent = event.intent;
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
    const params = new URLSearchParams();
    if (intent.neighborhood) params.set("bairro", slug(intent.neighborhood));
    if (intent.bedrooms > 0) params.set("dormitorios", String(intent.bedrooms));
    if (intent.max_price >= 100000) {
      params.set("valor_max", String(Math.round(intent.max_price / 100000) * 100000));
    }
    if (intent.development) params.set("empreendimento", slug(intent.development));
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
        signals: item.count,
        development_routed: false
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

  async function recordAdsEvent(input, rest, now = new Date(), createId = () => cryptoRandom()) {
    const normalized = normalizeEvent(input, now);
    if (normalized.error) {
      return { status: 400, body: { success: false, error: normalized.error } };
    }

    const event = { ...normalized.event, event_id: normalized.event.event_id || createId() };
    const recent = await rest(
      "ads_events?select=event_id,event_name,event_time,visitor_id,session_id,property_id" +
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
    APP_ORIGIN,
    clean,
    normalizeText,
    slug,
    omitPii,
    normalizeIntent,
    normalizeProperty,
    isValidSearch,
    normalizeEvent,
    evaluateHighIntent,
    observedIntentFromViews,
    eventRow,
    rowToEvent,
    dedupeMatch,
    touchPatch,
    propertyFeedItem,
    intentFeedItems,
    intentUrl,
    sheetCsv,
    recordAdsEvent
  };
});
