const test = require("node:test");
const assert = require("node:assert/strict");
const buyer = require("./buyer-profile.js");
const ads = require("./ads-intelligence.js");

const visitor = "11111111-1111-4111-8111-111111111111";
const buyerId = "22222222-2222-4222-8222-222222222222";
const session = "session-profile-1";
const laterSession = "session-profile-2";

function event(extra = {}) {
  return {
    event_id: extra.event_id || "",
    event_name: "ad_entry",
    event_time: "2026-10-08T12:00:00.000Z",
    visitor_id: visitor,
    session_id: session,
    product: "ynteligencia",
    ...extra
  };
}

function fold(events) {
  let profile = null;
  for (const item of events) {
    const applied = buyer.applyEventToProfile(profile, item);
    assert.equal(applied.ok, true);
    profile = applied.profile;
  }
  return buyer.toPublic(profile);
}

test("cria buyer_profile no primeiro evento", () => {
  const profile = fold([event({
    event_id: "evt-1",
    gclid: "gclid-1",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "perdizes"
  })]);
  assert.equal(profile.visitor_id, visitor);
  assert.equal(profile.buyer_id, null);
  assert.equal(profile.stage, "exploring");
  assert.equal(profile.behavior.total_sessions, 1);
  assert.equal(profile.attribution.first_touch.gclid, "gclid-1");
  assert.equal(profile.attribution.current_touch.utm_campaign, "perdizes");
  assert.equal(profile.last_activity_at, "2026-10-08T12:00:00.000Z");
});

test("first_touch não muda e current_touch muda", () => {
  const profile = fold([
    event({ event_id: "evt-1", gclid: "first", utm_source: "google", utm_campaign: "one" }),
    event({
      event_id: "evt-2",
      event_time: "2026-10-09T12:00:00.000Z",
      session_id: laterSession,
      gclid: "second",
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: "two"
    })
  ]);
  assert.equal(profile.attribution.first_touch.gclid, "first");
  assert.equal(profile.attribution.first_touch.utm_campaign, "one");
  assert.equal(profile.attribution.current_touch.gclid, "second");
  assert.equal(profile.attribution.current_touch.utm_source, "meta");
  assert.equal(profile.attribution.last_gclid, "second");
  assert.equal(profile.attribution.last_utm_source, "meta");
  assert.equal(profile.attribution.last_utm_medium, "paid");
  assert.equal(profile.attribution.last_utm_campaign, "two");
  assert.equal(profile.behavior.total_sessions, 2);
});

test("ai_search acumula preferência e não mistura o imóvel visto", () => {
  const profile = fold([
    event({
      event_id: "search-1",
      event_name: "ai_search",
      intent: {
        neighborhood: "Perdizes",
        bedrooms: 2,
        min_price: 500000,
        max_price: 900000,
        inventory_source: "novos",
        city: "São Paulo",
        state: "SP",
        region: "Oeste",
        property_type: "apartamento",
        purpose: "morar"
      }
    }),
    event({
      event_id: "view-1",
      event_name: "property_view",
      event_time: "2026-10-08T12:05:00.000Z",
      property: { property_id: "orulo:9", name: "Solar", neighborhood: "Moema" }
    })
  ]);
  assert.deepEqual(profile.preferences.neighborhoods, ["Perdizes"]);
  assert.equal(profile.preferences.city, "São Paulo");
  assert.equal(profile.preferences.state, "SP");
  assert.deepEqual(profile.preferences.regions, ["Oeste"]);
  assert.deepEqual(profile.preferences.property_types, ["apartamento"]);
  assert.equal(profile.preferences.purpose, "morar");
  assert.equal(profile.preferences.bedrooms_min, 2);
  assert.equal(profile.preferences.bedrooms_max, null);
  assert.equal(profile.preferences.min_price, 500000);
  assert.equal(profile.preferences.max_price, 900000);
  assert.deepEqual(profile.preferences.inventory_sources, ["novos"]);
  assert.equal(profile.behavior.total_ai_searches, 1);
  assert.equal(profile.behavior.last_search_summary.includes("Perdizes"), true);
  assert.deepEqual(profile.behavior.observed_neighborhoods, ["Moema"]);
  assert.equal(profile.preferences.neighborhoods.includes("Moema"), false);
  assert.equal(profile.stage, "engaged");
});

test("zero e vazio não apagam preferência válida", () => {
  const profile = fold([
    event({
      event_id: "search-1",
      event_name: "ai_search",
      intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000, inventory_source: "todos" }
    }),
    event({
      event_id: "search-2",
      event_name: "ai_search",
      event_time: "2026-10-08T13:00:00.000Z",
      intent: { neighborhood: "", bedrooms: 0, min_price: 0, max_price: 0, inventory_source: "" }
    }),
    event({
      event_id: "search-3",
      event_name: "ai_search",
      event_time: "2026-10-08T14:00:00.000Z",
      intent: { neighborhood: "Pinheiros", bedrooms: 3, max_price: 1200000, inventory_source: "usados" }
    })
  ]);
  assert.deepEqual(profile.preferences.neighborhoods, ["Perdizes", "Pinheiros"]);
  assert.equal(profile.preferences.bedrooms_min, 2);
  assert.equal(profile.preferences.bedrooms_max, 3);
  assert.equal(profile.preferences.max_price, 1200000);
  assert.deepEqual(profile.preferences.inventory_sources, ["todos", "usados"]);
  assert.equal(profile.behavior.total_ai_searches, 3);
  assert.equal(profile.behavior.last_search_summary.includes("Pinheiros"), true);
});

test("property_view incrementa e não duplica o único", () => {
  const profile = fold([
    event({
      event_id: "view-1",
      event_name: "property_view",
      property: { property_id: "orulo:1", name: "Solar", neighborhood: "Perdizes" }
    }),
    event({
      event_id: "view-2",
      event_name: "property_view",
      event_time: "2026-10-08T12:10:00.000Z",
      property: { property_id: "orulo:1", name: "Solar", neighborhood: "Perdizes" }
    }),
    event({
      event_id: "view-3",
      event_name: "property_view_multiple",
      event_time: "2026-10-08T12:11:00.000Z",
      property: { property_id: "orulo:1", name: "Solar", neighborhood: "Perdizes" }
    })
  ]);
  assert.equal(profile.behavior.total_property_views, 2);
  assert.equal(profile.behavior.unique_properties_viewed, 1);
  assert.equal(profile.behavior.last_property.property_id, "orulo:1");
  assert.equal(profile.behavior.last_property.name, "Solar");
  assert.equal(profile.stage, "engaged");
});

test("agent_opened incrementa e lead_created fixa o estágio", () => {
  const profile = fold([
    event({ event_id: "open-1", event_name: "agent_opened", event_time: "2026-10-08T12:20:00.000Z" }),
    event({
      event_id: "lead-1",
      event_name: "lead_created",
      event_time: "2026-10-08T12:30:00.000Z",
      metadata: {
        lead_id: buyerId,
        nome: "Maria",
        email: "maria@example.com",
        phone: "11988887777",
        lead_summary: "quer comprar"
      },
      property: { property_id: "orulo:2", name: "Casa", neighborhood: "Pinheiros" }
    }),
    event({
      event_id: "open-2",
      event_name: "agent_opened",
      event_time: "2026-10-08T12:40:00.000Z"
    })
  ]);
  assert.equal(profile.behavior.total_agent_opens, 2);
  assert.equal(profile.behavior.total_leads, 1);
  assert.equal(profile.stage, "lead");
  assert.equal(profile.buyer_id, buyerId);
});

test("perfil público não carrega PII nem o livro interno", () => {
  const profile = fold([event({
    event_id: "lead-1",
    event_name: "lead_created",
    metadata: { email: "maria@example.com", phone: "11988887777", nome: "Maria", lead_id: "nao-e-uuid" },
    property: { property_id: "orulo:3", name: "maria@example.com Solar", neighborhood: "Ligar 11988887777" }
  })]);
  const serialized = JSON.stringify(profile);
  assert.equal(serialized.includes("maria@example.com"), false);
  assert.equal(serialized.includes("11988887777"), false);
  assert.equal(serialized.includes("Maria"), false);
  assert.equal(serialized.includes("applied_event_ids"), false);
  assert.equal(serialized.includes("viewed_property_ids"), false);
  assert.equal(profile.buyer_id, null);
  assert.equal(profile.behavior.last_property.property_id, "orulo:3");
});

test("visitor_id obrigatório e evento desconhecido não corrompe", () => {
  const missing = buyer.applyEventToProfile(null, { event_name: "ad_entry", session_id: session });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "visitor_id obrigatório");

  const created = buyer.applyEventToProfile(null, event({ event_id: "evt-1", event_name: "ai_search", intent: { neighborhood: "Perdizes", bedrooms: 2 } }));
  const unknown = buyer.applyEventToProfile(created.profile, event({ event_id: "evt-x", event_name: "high_intent_buyer" }));
  assert.equal(unknown.ignored, true);
  assert.equal(unknown.profile.total_ai_searches, 1);
  assert.equal(unknown.profile.neighborhoods[0], "Perdizes");
  assert.equal(unknown.profile.stage, "exploring");

  const again = buyer.applyEventToProfile(created.profile, event({ event_id: "evt-1", event_name: "ai_search", intent: { neighborhood: "Moema" } }));
  assert.equal(again.duplicate, true);
  assert.equal(again.profile.total_ai_searches, 1);
  assert.equal(again.profile.neighborhoods.includes("Moema"), false);
});

test("releitura e backfill são idempotentes", async () => {
  const rows = [
    {
      event_id: "row-1",
      event_name: "ai_search",
      event_time: "2026-10-08T12:00:00.000Z",
      visitor_id: visitor,
      session_id: session,
      declared_neighborhood: "Perdizes",
      declared_bedrooms: 2,
      declared_max_price: 900000,
      declared_inventory_source: "novos",
      property_id: "",
      gclid: "abc"
    },
    {
      event_id: "row-2",
      event_name: "property_view",
      event_time: "2026-10-08T12:05:00.000Z",
      visitor_id: visitor,
      session_id: session,
      property_id: "nonstop:4",
      property_name: "Vista",
      property_neighborhood: "Lapa"
    }
  ];
  const once = buyer.rebuildProfiles(rows);
  const twice = buyer.rebuildProfiles(rows);
  assert.equal(once.length, 1);
  assert.equal(once[0].total_ai_searches, twice[0].total_ai_searches);
  assert.equal(once[0].unique_properties_viewed, 1);
  assert.equal(twice[0].total_property_views, 1);
  assert.deepEqual(once[0].neighborhoods, twice[0].neighborhoods);

  const stored = [];
  const rest = async (path, options = {}) => {
    const method = options.method || "GET";
    if (method === "GET") return { ok: true, status: 200, data: stored.filter(item => item.visitor_id === visitor) };
    if (method === "POST") {
      stored.push(options.body);
      return { ok: true, status: 201, data: null };
    }
    return { ok: false, status: 500, data: null };
  };
  const saved = await buyer.updateBuyerProfileFromEvent(event({ event_id: "evt-1", event_name: "agent_handoff_created" }), rest);
  assert.equal(saved.ok, true);
  assert.equal(saved.profile.stage, "engaged");
  const read = await buyer.getBuyerProfile(visitor, rest);
  assert.equal(read.profile.behavior.total_agent_opens, 0);
  assert.equal(read.profile.stage, "engaged");
  const invalid = await buyer.getBuyerProfile("nao-uuid", rest);
  assert.equal(invalid.ok, false);
  const untouched = await buyer.updateBuyerProfileFromEvent({ event_name: "page_view" }, rest);
  assert.equal(untouched.ok, false);
});

test("duas visualizações no ads_event não triplicam o perfil", async () => {
  const events = [];
  const visitors = [];
  const profiles = [];
  const rest = async (requestPath, options = {}) => {
    const method = options.method || "GET";
    const [table, query = ""] = requestPath.split("?");
    const params = new URLSearchParams(query);
    const eq = key => decodeURIComponent(String(params.get(key) || "").replace(/^eq\./, ""));
    if (method === "POST" && table === "ads_events") {
      events.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "GET" && table === "ads_events") {
      return { ok: true, status: 200, data: events.filter(row => row.visitor_id === eq("visitor_id") && (!eq("session_id") || row.session_id === eq("session_id")) && (!eq("event_name") || row.event_name === eq("event_name"))) };
    }
    if (method === "GET" && table === "ads_visitors") {
      return { ok: true, status: 200, data: visitors.filter(row => row.visitor_id === eq("visitor_id")) };
    }
    if (method === "POST" && table === "ads_visitors") {
      visitors.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "PATCH" && table === "ads_visitors") {
      Object.assign(visitors.find(row => row.visitor_id === eq("visitor_id")), options.body);
      return { ok: true, status: 204, data: null };
    }
    if (method === "GET" && table === "buyer_profiles") {
      return { ok: true, status: 200, data: profiles.filter(row => row.visitor_id === eq("visitor_id")) };
    }
    if (method === "POST" && table === "buyer_profiles") {
      profiles.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "PATCH" && table === "buyer_profiles") {
      Object.assign(profiles.find(row => row.visitor_id === eq("visitor_id")), options.body);
      return { ok: true, status: 204, data: null };
    }
    return { ok: false, status: 404, data: null };
  };

  const property = (id, neighborhood) => ({ property_id: id, name: id, neighborhood });
  await ads.recordAdsEvent({
    product: "ynteligencia",
    event_name: "property_view",
    visitor_id: visitor,
    session_id: session,
    property: property("orulo:1", "Perdizes")
  }, rest, new Date("2026-10-08T12:00:00.000Z"));
  await ads.recordAdsEvent({
    product: "ynteligencia",
    event_name: "property_view",
    visitor_id: visitor,
    session_id: session,
    property: property("orulo:2", "Lapa")
  }, rest, new Date("2026-10-08T12:05:00.000Z"));

  assert.equal(events.some(item => item.event_name === "property_view_multiple"), true);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].total_property_views, 2);
  assert.equal(profiles[0].unique_properties_viewed, 2);
  assert.equal(profiles[0].stage, "engaged");
  const read = await buyer.getBuyerProfile(visitor, rest);
  assert.equal(read.profile.preferences.neighborhoods.length, 0);
  assert.deepEqual(read.profile.behavior.observed_neighborhoods, ["Perdizes", "Lapa"]);
});
