const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const ads = require("./ads-intelligence.js");

const visitor = "11111111-1111-4111-8111-111111111111";
const session = "session-ads-1";
const laterSession = "session-ads-2";

function decodeFilter(value) {
  if (!value) return "";
  return decodeURIComponent(value.replace(/^eq\./, ""));
}

function memory() {
  const events = [];
  const visitors = [];
  const rest = async (requestPath, options = {}) => {
    const method = options.method || "GET";
    const [table, query = ""] = requestPath.split("?");
    const params = new URLSearchParams(query);
    if (method === "POST" && table === "ads_events") {
      events.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "POST" && table === "ads_visitors") {
      visitors.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "PATCH" && table === "ads_visitors") {
      const id = decodeFilter(params.get("visitor_id"));
      const row = visitors.find(item => item.visitor_id === id);
      Object.assign(row, options.body);
      return { ok: true, status: 204, data: null };
    }
    if (method === "GET" && table === "ads_events") {
      let rows = events.slice();
      const visitorId = decodeFilter(params.get("visitor_id"));
      const sessionId = decodeFilter(params.get("session_id"));
      const name = decodeFilter(params.get("event_name"));
      if (visitorId) rows = rows.filter(row => row.visitor_id === visitorId);
      if (sessionId) rows = rows.filter(row => row.session_id === sessionId);
      if (name) rows = rows.filter(row => row.event_name === name);
      const descending = String(params.get("order") || "").endsWith("desc");
      rows.sort((a, b) => descending
        ? String(b.event_time).localeCompare(String(a.event_time))
        : String(a.event_time).localeCompare(String(a.event_time)));
      return { ok: true, status: 200, data: rows.slice(0, Number(params.get("limit")) || rows.length) };
    }
    if (method === "GET" && table === "ads_visitors") {
      const id = decodeFilter(params.get("visitor_id"));
      return { ok: true, status: 200, data: visitors.filter(row => row.visitor_id === id) };
    }
    return { ok: false, status: 404, data: null };
  };
  return { events, visitors, rest };
}

function base(extra = {}) {
  return {
    product: "ynteligencia",
    visitor_id: visitor,
    session_id: session,
    ...extra
  };
}

test("entrada com GCLID grava o clique e a primeira origem", async () => {
  const store = memory();
  const now = new Date("2026-10-08T12:00:00.000Z");
  const result = await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    gclid: "gclid-perdizes",
    utm_source: "google",
    utm_campaign: "perdizes-2-dorms",
    intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000, inventory_source: "todos" }
  }), store.rest, now);

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(store.visitors[0].first_gclid, "gclid-perdizes");
  assert.equal(store.visitors[0].first_utm_campaign, "perdizes-2-dorms");
  assert.equal(store.visitors[0].declared_intent.neighborhood, "Perdizes");
  assert.equal(store.events[0].event_name, "ad_entry");
});

test("agente usa o mesmo contrato com product próprio", async () => {
  const store = memory();
  const result = await ads.recordAdsEvent({
    product: "agente_yincorp",
    event_name: "ad_entry",
    visitor_id: visitor,
    session_id: "agent-session",
    gclid: "gclid-agente"
  }, store.rest, new Date("2026-10-08T12:01:00.000Z"));

  assert.equal(result.status, 200);
  assert.equal(store.events[0].product, "agente_yincorp");
  assert.equal(store.events[0].gclid, "gclid-agente");
});

test("busca, dois imóveis e high_intent_buyer seguem a regra central", async () => {
  const store = memory();
  const start = new Date("2026-10-08T12:00:00.000Z");
  await ads.recordAdsEvent(base({
    event_name: "ai_search",
    gclid: "gclid-perdizes",
    intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 }
  }), store.rest, start);

  const firstView = await ads.recordAdsEvent(base({
    event_name: "property_view",
    intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 },
    property: {
      property_id: "nonstop:a",
      name: "Ed. Ba806",
      neighborhood: "Perdizes",
      bedrooms: 3,
      price: 980000,
      inventory_source: "usados"
    }
  }), store.rest, new Date(start.getTime() + 20000));
  assert.equal(firstView.body.high_intent_buyer, false);

  const secondView = await ads.recordAdsEvent(base({
    event_name: "property_view",
    property: {
      property_id: "nonstop:b",
      name: "Ed. Vizinho",
      neighborhood: "Perdizes",
      bedrooms: 3,
      price: 1020000,
      inventory_source: "usados"
    }
  }), store.rest, new Date(start.getTime() + 40000));

  assert.equal(secondView.body.high_intent_buyer, true);
  assert.equal(secondView.body.property_view_multiple, true);
  assert.equal(store.visitors[0].declared_intent.bedrooms, 2);
  assert.equal(store.visitors[0].declared_intent.max_price, 900000);
  const names = store.events.map(item => item.event_name);
  assert.deepEqual(names, [
    "ai_search",
    "property_view",
    "property_view",
    "property_view_multiple",
    "high_intent_buyer"
  ]);
});

test("CTA com uma busca e um imóvel também é high intent", async () => {
  const store = memory();
  const start = new Date("2026-10-08T13:00:00.000Z");
  await ads.recordAdsEvent(base({
    event_name: "ai_search",
    intent: { neighborhood: "Pinheiros", bedrooms: 1 }
  }), store.rest, start);
  await ads.recordAdsEvent(base({
    event_name: "property_view",
    property: { property_id: "orulo:1", name: "Fradique", neighborhood: "Pinheiros", bedrooms: 1, price: 700000 }
  }), store.rest, new Date(start.getTime() + 20000));
  const cta = await ads.recordAdsEvent(base({
    event_name: "specialist_cta_opened",
    property: { property_id: "orulo:1", name: "Fradique" }
  }), store.rest, new Date(start.getTime() + 40000));
  assert.equal(cta.body.high_intent_buyer, true);
});

test("empreendimento pesquisado e imóvel correspondente gera high intent", async () => {
  const store = memory();
  const start = new Date("2026-10-08T14:00:00.000Z");
  await ads.recordAdsEvent(base({
    event_name: "ai_search",
    intent: { development: "Marka Perdizes" }
  }), store.rest, start);
  const view = await ads.recordAdsEvent(base({
    event_name: "property_view",
    property: { property_id: "orulo:marka", name: "Marka Perdizes", neighborhood: "Perdizes", bedrooms: 2, price: 400000 }
  }), store.rest, new Date(start.getTime() + 20000));
  assert.equal(view.body.high_intent_buyer, true);
});

test("abertura isolada não vira high intent", () => {
  const decision = ads.evaluateHighIntent([
    { event_name: "property_view", intent: ads.normalizeIntent(null), property: { property_id: "x" } }
  ]);
  assert.equal(decision.high_intent, false);
});

test("property_view repetido em 15 segundos não duplica e visita posterior entra", async () => {
  const store = memory();
  const start = new Date("2026-10-08T15:00:00.000Z");
  const property = { property_id: "nonstop:a", name: "Ed. Ba806", neighborhood: "Aclimação", bedrooms: 1, price: 500000 };
  const first = await ads.recordAdsEvent(base({ event_name: "property_view", property }), store.rest, start);
  const repeat = await ads.recordAdsEvent(base({ event_name: "property_view", property }), store.rest, new Date(start.getTime() + 5000));
  const later = await ads.recordAdsEvent(base({ event_name: "property_view", property }), store.rest, new Date(start.getTime() + 20000));
  assert.equal(first.body.duplicate, false);
  assert.equal(repeat.body.duplicate, true);
  assert.equal(repeat.body.event_id, first.body.event_id);
  assert.equal(later.body.duplicate, false);
  assert.equal(store.events.filter(item => item.event_name === "property_view").length, 2);
});

test("retorno orgânico preserva a primeira origem e atualiza a última visita", async () => {
  const store = memory();
  await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    gclid: "gclid-primeiro",
    utm_campaign: "campanha-a"
  }), store.rest, new Date("2026-10-08T10:00:00.000Z"));

  await ads.recordAdsEvent(base({
    event_name: "ai_search",
    session_id: laterSession,
    gclid: "",
    utm_campaign: "",
    intent: { neighborhood: "Aclimação", bedrooms: 1 }
  }), store.rest, new Date("2026-10-09T10:00:00.000Z"));

  assert.equal(store.visitors[0].first_gclid, "gclid-primeiro");
  assert.equal(store.visitors[0].first_utm_campaign, "campanha-a");
  assert.equal(store.visitors[0].last_gclid, "gclid-primeiro");
  assert.equal(store.visitors[0].last_seen, "2026-10-09T10:00:00.000Z");
  assert.equal(store.visitors[0].declared_intent.neighborhood, "Aclimação");
  assert.equal(store.events.filter(item => item.visitor_id === visitor).length, 2);
  assert.equal(store.events[1].session_id, laterSession);
});

test("intenção observada não substitui a declarada", async () => {
  const views = [950000, 980000, 1020000].map((price, index) => ({
    event_name: "property_view",
    property: {
      property_id: `nonstop:${index}`,
      neighborhood: "Perdizes",
      bedrooms: 3,
      price
    }
  }));
  const observed = ads.observedIntentFromViews(views);
  assert.equal(observed.observed_intent.neighborhood, "Perdizes");
  assert.equal(observed.observed_intent.bedrooms, 3);
  assert.equal(observed.observed_intent.price_min, 900000);
  assert.equal(observed.observed_intent.price_max, 1050000);
  assert.equal(observed.observed_confidence, 0.75);

  const declared = ads.normalizeIntent({ neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 });
  assert.equal(declared.bedrooms, 2);
  assert.notEqual(declared.bedrooms, observed.observed_intent.bedrooms);
});

test("lead confirmado entra sem dados pessoais", async () => {
  const store = memory();
  const result = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    email: "ana@example.com",
    telefone: "11999999999",
    lead_summary: "resumo privado",
    property: { property_id: "nonstop:a", name: "Ed. Ba806", price: 500000 }
  }), store.rest, new Date("2026-10-08T16:00:00.000Z"));

  assert.equal(result.status, 200);
  const dumped = JSON.stringify(store.events[0]);
  assert.equal(dumped.includes("ana@example.com"), false);
  assert.equal(dumped.includes("11999999999"), false);
  assert.equal(dumped.includes("resumo privado"), false);
  assert.equal(store.events[0].event_name, "lead_created");
});

test("feed de imóvel não leva visitante nem contato e aponta para imovel", () => {
  const item = ads.propertyFeedItem({
    external_id: "nonstop:XYZ",
    development_name: "Ed. Ba806",
    neighborhood: "Aclimação",
    price: 0.1,
    bedrooms: 1,
    area: 42,
    source: "usados",
    image_url: "https://cdn.example/foto.jpg",
    active: true,
    email: "nao@example.com"
  });
  assert.equal(item.final_url, "https://app.yincorp.com.br/?imovel=nonstop%3AXYZ");
  assert.equal(item.price, null);
  assert.equal(item.email, undefined);
  assert.equal(JSON.stringify(item).includes("visitor"), false);
});

test("feed de intenção usa só combinação real do inventário", () => {
  const items = ads.intentFeedItems([
    { declared_neighborhood: "Perdizes", declared_bedrooms: 2, declared_max_price: 900000 },
    { declared_neighborhood: "Perdizes", declared_bedrooms: 3, declared_max_price: 1000000 },
    { declared_development: "Marka Perdizes", declared_bedrooms: 2 },
    { declared_neighborhood: "Bairro Inexistente", declared_bedrooms: 2, declared_max_price: 800000 }
  ], [
    { neighborhood: "Perdizes", development_name: "Marka Perdizes" }
  ]);
  assert.equal(items.length, 3);
  assert.equal(items.some(item => item.url.includes("bairro=perdizes")), true);
  assert.equal(items.some(item => item.url.includes("dormitorios=2")), true);
  assert.equal(items.some(item => item.url.includes("valor_max=900000")), true);
  assert.equal(items.some(item => item.url.includes("empreendimento=marka-perdizes")), true);
  assert.equal(items.some(item => item.development_routed), false);
  assert.equal(items.some(item => item.url.includes("inexistente")), false);
});

test("planilha única traz os dois produtos e não tem contato", () => {
  const csv = ads.sheetCsv([
    {
      event_time: "2026-10-08T12:00:00.000Z",
      event_name: "high_intent_buyer",
      product: "ynteligencia",
      visitor_id: visitor,
      session_id: session,
      gclid: "gclid-1",
      declared_neighborhood: "Perdizes",
      declared_bedrooms: 2,
      property_id: "nonstop:a"
    },
    {
      event_time: "2026-10-08T12:05:00.000Z",
      event_name: "lead_created",
      product: "agente_yincorp",
      visitor_id: visitor,
      session_id: "agent-session"
    }
  ]);
  assert.match(csv, /^event_time,event_name,product,/);
  assert.match(csv, /ynteligencia/);
  assert.match(csv, /agente_yincorp/);
  assert.equal(csv.includes("telefone"), false);
  assert.equal(csv.includes("email"), false);
});

test("evento desconhecido e high intent enviado pelo cliente são recusados", async () => {
  const store = memory();
  const unknown = await ads.recordAdsEvent(base({ event_name: "page_view" }), store.rest);
  const forced = await ads.recordAdsEvent(base({ event_name: "high_intent_buyer" }), store.rest);
  assert.equal(unknown.status, 400);
  assert.equal(forced.status, 400);
  assert.equal(store.events.length, 0);
});

test("a YNTELIGENCIA reutiliza visitor e sessão e aceita property_id na URL", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /product:"ynteligencia"/);
  assert.match(html, /visitor_id:YNTELIGENCIA_VISITOR_ID/);
  assert.match(html, /session_id:YNTELIGENCIA_SESSION_ID/);
  assert.match(html, /launchParams\.get\("property_id"\)/);
  assert.match(html, /yntAdsTrack\("ai_search"/);
  assert.match(html, /yntAdsTrack\("property_view"/);
  assert.match(html, /yntAdsTrack\("lead_created"/);
  const lead = html.indexOf('fetch(\n              "/api/lead"');
  const persisted = html.indexOf("if(!leadPersisted)", lead);
  const adsLead = html.indexOf('yntAdsTrack("lead_created"', lead);
  const whatsapp = html.indexOf("window.location.href=", lead);
  assert.ok(lead > 0 && persisted > lead && adsLead > persisted && whatsapp > adsLead);
});

test("POST externo continua bloqueado e a planilha exige token", async () => {
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  delete process.env.ADS_EXPORT_TOKEN;
  const { default: eventHandler } = await import(`./api/ads-event.js?t=${Date.now()}`);
  const blocked = await new Promise(resolve => {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ code: this.statusCode, body }); },
      end() { resolve({ code: this.statusCode }); }
    };
    eventHandler({
      method: "POST",
      headers: { origin: "https://exemplo.com" },
      body: { product: "ynteligencia", event_name: "ad_entry" }
    }, res);
  });
  assert.equal(blocked.code, 403);

  const { default: sheetHandler } = await import(`./api/ads-sheet.js?t=${Date.now()}`);
  const sheet = await new Promise(resolve => {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ code: this.statusCode, body }); },
      end() { resolve({ code: this.statusCode }); }
    };
    sheetHandler({ method: "GET", headers: {} }, res);
  });
  assert.equal(sheet.code, 503);
});
