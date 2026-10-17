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
  const handoffs = [];
  const rpcCalls = [];
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
      const propertyId = decodeFilter(params.get("property_id"));
      const eventId = decodeFilter(params.get("event_id"));
      if (params.has("property_id")) rows = rows.filter(row => (row.property_id || "") === propertyId);
      if (eventId) rows = rows.filter(row => row.event_id === eventId);
      if (params.get("or")) {
        rows = rows.filter(row => ["gclid", "gbraid", "wbraid"].some(key => String(row[key] || "").trim()));
      }
      const orders = String(params.get("order") || "").split(",").filter(Boolean);
      rows.sort((left, right) => {
        for (const order of orders) {
          const [field, direction] = order.split(".");
          const compared = String(left[field] ?? "").localeCompare(String(right[field] ?? ""));
          if (compared !== 0) return direction === "desc" ? -compared : compared;
        }
        return 0;
      });
      rows = rows.slice(0, Number(params.get("limit")) || rows.length);
      const select = params.get("select");
      if (select && select !== "*") {
        rows = rows.map(row => Object.fromEntries(select.split(",").map(key => [key, row[key]])));
      }
      return { ok: true, status: 200, data: rows };
    }
    if (method === "GET" && table === "ads_visitors") {
      const id = decodeFilter(params.get("visitor_id"));
      return { ok: true, status: 200, data: visitors.filter(row => row.visitor_id === id) };
    }
    if (method === "POST" && table === "ads_handoffs") {
      handoffs.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "PATCH" && table === "ads_handoffs") {
      const id = decodeFilter(params.get("handoff_id"));
      const row = handoffs.find(item => item.handoff_id === id);
      if (!row) return { ok: false, status: 404, data: null };
      Object.assign(row, options.body);
      return { ok: true, status: 204, data: null };
    }
    if (method === "GET" && table === "ads_handoffs") {
      const id = decodeFilter(params.get("handoff_id"));
      return { ok: true, status: 200, data: handoffs.filter(row => !id || row.handoff_id === id) };
    }
    if (method === "POST" && table === "rpc/apply_buyer_profile_event") {
      rpcCalls.push(options.body && options.body.p_event);
      return { ok: true, status: 200, data: { status: "applied" } };
    }
    if (method === "POST" && table === "rpc/record_ads_lead") {
      const row = (options.body && options.body.p_row) || {};
      const existingId = events.find(item => item.event_id === row.event_id);
      if (existingId) {
        const conflict = existingId.visitor_id !== row.visitor_id || existingId.event_name !== "lead_created";
        return {
          ok: true,
          status: 200,
          data: [{ event_id: existingId.event_id, duplicate: !conflict, conflict }]
        };
      }
      const at = new Date(row.event_time).getTime();
      const prior = events
        .filter(item =>
          item.event_name === "lead_created" &&
          item.visitor_id === row.visitor_id &&
          (item.property_id || "") === (row.property_id || "")
        )
        .filter(item => {
          const time = new Date(item.event_time).getTime();
          return time >= at - ads.LEAD_LOGICAL_WINDOW_MS && time <= at + 1000;
        })
        .sort((left, right) =>
          String(left.event_time).localeCompare(String(right.event_time)) ||
          String(left.event_id).localeCompare(String(right.event_id))
        )[0];
      if (prior) {
        return { ok: true, status: 200, data: [{ event_id: prior.event_id, duplicate: true, conflict: false }] };
      }
      events.push({ ...row });
      return { ok: true, status: 200, data: [{ event_id: row.event_id, duplicate: false, conflict: false }] };
    }
    return { ok: false, status: 404, data: null };
  };
  return { events, visitors, handoffs, rpcCalls, rest };
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
  assert.equal(store.visitors[0].first_declared_intent.neighborhood, "Perdizes");
  assert.equal(store.visitors[0].current_declared_intent.neighborhood, "Perdizes");
  assert.equal(store.visitors[0].first_declared_intent.bedrooms, 2);
  assert.equal(store.visitors[0].first_declared_intent.max_price, 900000);
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
  assert.equal(store.visitors[0].first_declared_intent.bedrooms, 2);
  assert.equal(store.visitors[0].current_declared_intent.max_price, 900000);
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
  assert.equal(store.visitors[0].first_declared_intent.neighborhood, "Aclimação");
  assert.equal(store.visitors[0].current_declared_intent.neighborhood, "Aclimação");
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
  assert.equal(items.length, 2);
  assert.equal(items.some(item => item.url.includes("bairro=perdizes")), true);
  assert.equal(items.some(item => item.url.includes("dormitorios=2")), true);
  assert.equal(items.some(item => item.url.includes("valor_max=900000")), true);
  assert.equal(items.some(item => item.url.includes("empreendimento=")), false);
  assert.equal(items.some(item => item.url.includes("inexistente")), false);
  assert.equal(ads.intentUrl({
    neighborhood: "Perdizes",
    development: "",
    bedrooms: 0,
    max_price: 0
  }), "https://app.yincorp.com.br/?bairro=perdizes");
  assert.equal(ads.intentUrl({
    neighborhood: "Perdizes",
    development: "",
    bedrooms: 2,
    max_price: 900000
  }), "https://app.yincorp.com.br/?bairro=perdizes&dormitorios=2&valor_max=900000");
  assert.equal(ads.intentUrl({
    neighborhood: "",
    development: "Marka Perdizes",
    bedrooms: 2,
    max_price: 0
  }), "");
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
  assert.match(html, /params\.get\("vid"\)/);
  assert.match(html, /yntValidVisitorId\(vid\)/);
  assert.match(html, /fetch\("\/api\/ads\?action=event"/);
  assert.match(html, /Conversar com a IA/);
  assert.match(html, /Falar com especialista/);
  assert.match(html, /\/api\/ads\?action=create-handoff/);
  assert.match(html, /openAgentConversation\(p\)/);
  assert.match(html, /openAiAssistant\(property\)/);
  assert.match(html, /data\.error==="handoff_disabled"/);
  assert.match(html, /current_touch:attribution,attribution/);
  assert.equal(html.includes("ADS_AGENT_HANDOFF_ENABLED"), false);
  assert.equal(html.includes("NEXT_PUBLIC"), false);
  assert.match(html, /openPropertySpecialist\(p\)/);
  assert.equal(html.includes("agente.yincorp.com.br/?property"), false);
  assert.equal(html.includes("?property_name="), false);
  assert.equal(html.includes("/api/ads-event"), false);
  assert.match(html, /yntAdsTrack\("ai_search"/);
  assert.match(html, /yntAdsTrack\("property_view"/);
  assert.match(html, /yntAdsTrack\("lead_created"/);
  const lead = html.indexOf('fetch(\n              "/api/lead"');
  const persisted = html.indexOf("if(!leadPersisted)", lead);
  const adsLead = html.indexOf('yntAdsTrack("lead_created"', lead);
  const whatsapp = html.indexOf("window.location.href=", lead);
  assert.ok(lead > 0 && persisted > lead && adsLead > persisted && whatsapp > adsLead);
});

function invokeAds(handler, req) {
  return new Promise(resolve => {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ code: this.statusCode, body }); },
      end() { resolve({ code: this.statusCode }); }
    };
    handler(req, res);
  });
}

test("POST externo continua bloqueado e a planilha exige token", async () => {
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  delete process.env.ADS_EXPORT_TOKEN;
  const { default: adsHandler } = await import(`./api/ads.js?t=${Date.now()}`);
  const blocked = await invokeAds(adsHandler, {
    method: "POST",
    query: { action: "event" },
    headers: { origin: "https://exemplo.com" },
    body: { product: "ynteligencia", event_name: "ad_entry" }
  });
  assert.equal(blocked.code, 403);

  const sheet = await invokeAds(adsHandler, {
    method: "GET",
    query: { action: "sheet" },
    headers: {}
  });
  assert.equal(sheet.code, 503);

  const conversions = await invokeAds(adsHandler, {
    method: "GET",
    url: "/api/ads?action=google-conversions",
    headers: {}
  });
  assert.equal(conversions.code, 503);

  const unknown = await invokeAds(adsHandler, {
    method: "GET",
    query: { action: "outra" },
    headers: {}
  });
  assert.equal(unknown.code, 404);

  const unconfirmedPost = await invokeAds(adsHandler, {
    method: "POST",
    query: { action: "google-conversions" },
    headers: { authorization: "Bearer token-teste" },
    body: { confirm_event_ids: ["evt-1"] }
  });
  assert.equal(unconfirmedPost.code, 503);

  process.env.ADS_EXPORT_TOKEN = "token-teste";
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body || "{}");
    calls.push({ url: String(url), body: payload });
    if (String(url).includes("claim_google_lead_conversions")) {
      return new Response(JSON.stringify([{
        event_id: "evt-1",
        event_time: "2026-10-08T18:40:00.000Z",
        product: "ynteligencia",
        gclid: "gclid-1",
        gbraid: "",
        wbraid: ""
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("confirm_google_lead_conversions")) {
      return new Response(JSON.stringify(
        (payload.p_event_ids || []).map(event_id => ({ event_id, status: "exported" }))
      ), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("fail_google_lead_conversions")) {
      return new Response(JSON.stringify(
        (payload.p_event_ids || []).map(event_id => ({ event_id, status: "failed" }))
      ), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("no", { status: 500 });
  };

  function invokeExport(req) {
    return new Promise(resolve => {
      const res = {
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ code: this.statusCode, body, headers: this.headers }); },
        end(payload) { resolve({ code: this.statusCode, body: payload, headers: this.headers }); }
      };
      Promise.resolve(adsHandler(req, res)).catch(error => resolve({ error }));
    });
  }

  try {
    const sheetPost = await invokeExport({
      method: "POST",
      query: { action: "sheet" },
      headers: { authorization: "Bearer token-teste" },
      body: {}
    });
    assert.equal(sheetPost.code, 405);
    assert.equal(calls.length, 0);

    const reserved = await invokeExport({
      method: "GET",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer token-teste" }
    });
    assert.equal(reserved.code, 200);
    assert.equal(reserved.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.match(reserved.body, /evt-1/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /claim_google_lead_conversions$/);
    assert.deepEqual(calls[0].body, { p_limit: 500 });

    const confirmed = await invokeExport({
      method: "POST",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer token-teste" },
      body: { confirm_event_ids: [" evt-1 ", "evt-1"], email: "ana@example.com" }
    });
    assert.equal(confirmed.code, 200);
    assert.deepEqual(confirmed.body, { success: true, confirmed: 1, event_ids: ["evt-1"] });
    assert.match(calls[1].url, /confirm_google_lead_conversions$/);
    assert.deepEqual(calls[1].body, { p_event_ids: ["evt-1"] });

    const failed = await invokeExport({
      method: "POST",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer token-teste" },
      body: { fail_event_ids: ["evt-2"], error: "conexao caiu" }
    });
    assert.equal(failed.code, 200);
    assert.deepEqual(failed.body, { success: true, failed: 1, event_ids: ["evt-2"] });
    assert.deepEqual(calls[2].body, { p_event_ids: ["evt-2"], p_error: "unknown" });

    const coded = await invokeExport({
      method: "POST",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer token-teste" },
      body: { fail_event_ids: ["evt-3"], error: "ana@example.com 11999998888" }
    });
    assert.equal(coded.code, 200);
    assert.deepEqual(calls[3].body, { p_event_ids: ["evt-3"], p_error: "unknown" });

    const allowed = await invokeExport({
      method: "POST",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer token-teste" },
      body: { fail_event_ids: ["evt-4"], error: "DOWNLOAD_FAILED" }
    });
    assert.equal(allowed.code, 200);
    assert.deepEqual(calls[4].body, { p_event_ids: ["evt-4"], p_error: "download_failed" });

    const missing = await invokeExport({
      method: "POST",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer token-teste" },
      body: {}
    });
    assert.equal(missing.code, 400);

    const both = await invokeExport({
      method: "POST",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer token-teste" },
      body: { confirm_event_ids: ["evt-1"], fail_event_ids: ["evt-2"] }
    });
    assert.equal(both.code, 400);
    assert.equal(calls.length, 5);

    const wrong = await invokeExport({
      method: "POST",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer outro" },
      body: { confirm_event_ids: ["evt-1"] }
    });
    assert.equal(wrong.code, 401);
  } finally {
    global.fetch = originalFetch;
    delete process.env.ADS_EXPORT_TOKEN;
  }
});

test("a camada de anúncios ocupa uma única Serverless Function", () => {
  const files = fs.readdirSync(path.join(__dirname, "api"))
    .filter(name => name.endsWith(".js"));
  const adsFiles = files.filter(name =>
    name.startsWith("ads") || name.startsWith("google-ads")
  );
  assert.deepEqual(adsFiles, ["ads.js"]);
  assert.equal(files.length, 12);
});

test("primeira busca grava first e current e a busca seguinte só move current", async () => {
  const store = memory();
  const start = new Date("2026-10-08T12:00:00.000Z");
  await ads.recordAdsEvent(base({
    event_name: "ai_search",
    gclid: "gclid-perdizes",
    utm_source: "google",
    utm_campaign: "perdizes-2-dorms",
    intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 }
  }), store.rest, start);

  const prices = [950000, 980000, 1020000];
  for (let index = 0; index < prices.length; index += 1) {
    await ads.recordAdsEvent(base({
      event_name: "property_view",
      gclid: "gclid-perdizes",
      property: {
        property_id: `nonstop:${index}`,
        neighborhood: "Perdizes",
        bedrooms: 3,
        price: prices[index]
      }
    }), store.rest, new Date(start.getTime() + ((index + 1) * 20000)));
  }

  await ads.recordAdsEvent(base({
    event_name: "ai_search",
    session_id: laterSession,
    declared_intent: { neighborhood: "Brooklin", bedrooms: 3, max_price: 1100000 },
    observed_intent: { neighborhood: "Moema", bedrooms: 1, price_min: 1, price_max: 2 }
  }), store.rest, new Date("2026-10-09T15:00:00.000Z"));

  await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    session_id: "session-ads-3"
  }), store.rest, new Date("2026-10-10T15:00:00.000Z"));

  const row = store.visitors[0];
  assert.equal(row.first_declared_intent.neighborhood, "Perdizes");
  assert.equal(row.first_declared_intent.bedrooms, 2);
  assert.equal(row.first_declared_intent.max_price, 900000);
  assert.equal(row.current_declared_intent.neighborhood, "Brooklin");
  assert.equal(row.current_declared_intent.bedrooms, 3);
  assert.equal(row.current_declared_intent.max_price, 1100000);
  assert.equal(row.observed_intent.neighborhood, "Perdizes");
  assert.equal(row.observed_intent.bedrooms, 3);
  assert.equal(row.observed_intent.price_min, 900000);
  assert.equal(row.observed_intent.price_max, 1050000);
  assert.equal(row.observed_confidence, 0.75);
  assert.equal(row.first_gclid, "gclid-perdizes");
  assert.equal(row.first_utm_source, "google");
  assert.equal(row.first_utm_campaign, "perdizes-2-dorms");
});

test("high intent e lead com clique entram na exportação e evento sem clique fica de fora", async () => {
  const store = memory();
  const start = new Date("2026-10-08T18:00:00.000Z");
  await ads.recordAdsEvent(base({
    event_name: "ai_search",
    gclid: "gclid-perdizes",
    intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 }
  }), store.rest, start);
  await ads.recordAdsEvent(base({
    event_name: "property_view",
    gclid: "gclid-perdizes",
    property: { property_id: "nonstop:a", neighborhood: "Perdizes", bedrooms: 2, price: 800000 }
  }), store.rest, new Date(start.getTime() + 20000));
  await ads.recordAdsEvent(base({
    event_name: "property_view",
    gclid: "gclid-perdizes",
    property: { property_id: "nonstop:b", neighborhood: "Perdizes", bedrooms: 2, price: 850000 }
  }), store.rest, new Date(start.getTime() + 40000));
  await ads.recordAdsEvent(base({
    event_name: "lead_created",
    gclid: "gclid-perdizes",
    email: "ana@example.com",
    telefone: "11999999999",
    property: { property_id: "nonstop:b", name: "Ed. Vizinho" }
  }), store.rest, new Date("2026-10-08T18:41:03.000Z"));

  const other = "22222222-2222-4222-8222-222222222222";
  await ads.recordAdsEvent({
    product: "ynteligencia",
    visitor_id: other,
    session_id: "session-sem-clique",
    event_name: "ai_search",
    intent: { neighborhood: "Pinheiros", bedrooms: 1 }
  }, store.rest, new Date("2026-10-08T19:00:00.000Z"));
  await ads.recordAdsEvent({
    product: "ynteligencia",
    visitor_id: other,
    session_id: "session-sem-clique",
    event_name: "property_view",
    property: { property_id: "orulo:1", neighborhood: "Pinheiros", bedrooms: 1, price: 700000 }
  }, store.rest, new Date("2026-10-08T19:01:00.000Z"));
  const quiet = await ads.recordAdsEvent({
    product: "ynteligencia",
    visitor_id: other,
    session_id: "session-sem-clique",
    event_name: "property_view",
    property: { property_id: "orulo:2", neighborhood: "Pinheiros", bedrooms: 1, price: 720000 }
  }, store.rest, new Date("2026-10-08T19:02:00.000Z"));
  assert.equal(quiet.body.high_intent_buyer, true);

  const high = store.events.find(item => item.event_name === "high_intent_buyer" && item.gclid === "gclid-perdizes");
  const lead = store.events.find(item => item.event_name === "lead_created");
  const hidden = store.events.find(item => item.event_name === "high_intent_buyer" && item.visitor_id === other);
  assert.ok(high.event_id);
  assert.ok(hidden.event_id);

  const csv = ads.googleAdsConversionsCsv(store.events);
  assert.match(csv, /^Google Click ID,GBRAID,WBRAID,Conversion Name,/);
  assert.equal(csv.includes("High Intent Buyer"), false);
  assert.match(csv, /Lead Created/);
  assert.match(csv, /2026-10-08 15:41:03-0300/);
  assert.equal(csv.includes(high.event_id), false);
  assert.match(csv, new RegExp(lead.event_id));
  assert.equal(csv.includes(hidden.event_id), false);
  assert.equal(csv.includes("ai_search"), false);
  assert.equal(csv.includes(visitor), false);
  assert.equal(csv.includes("ana@example.com"), false);
  assert.equal(csv.includes("11999999999"), false);
  assert.equal(ads.HIGH_INTENT_CONVERSION_VALUE, 1);
  assert.equal(ads.LEAD_CONVERSION_NAME, "Lead Created");
  assert.equal(ads.LEAD_CONVERSION_VALUE, 10);
  assert.equal(csv.includes('"1","BRL"'), false);
  assert.match(csv, /"10","BRL"/);

  const sheet = ads.sheetCsv(store.events);
  assert.match(sheet, /^event_time,event_name,product,visitor_id,session_id,/);
  assert.match(sheet, new RegExp(other));
  assert.match(sheet, /session-sem-clique/);
  assert.match(sheet, /high_intent_buyer/);
  assert.match(sheet, /gclid-perdizes/);
  assert.match(sheet, /ynteligencia/);
});

test("exportação deduplica pelo event_id e aceita gbraid ou wbraid", () => {
  const csv = ads.googleAdsConversionsCsv([
    {
      event_id: "evt-1",
      event_name: "high_intent_buyer",
      event_time: "2026-10-08T18:32:11.000Z",
      product: "ynteligencia",
      gclid: "gclid-perdizes",
      visitor_id: visitor,
      session_id: session
    },
    {
      event_id: "evt-1",
      event_name: "lead_created",
      event_time: "2026-10-08T18:40:00.000Z",
      product: "ynteligencia",
      gclid: "gclid-perdizes"
    },
    {
      event_id: "evt-gbraid",
      event_name: "lead_created",
      event_time: "2026-10-08T18:41:03.000Z",
      product: "agente_yincorp",
      gbraid: "gbraid-brooklin"
    },
    {
      event_id: "evt-wbraid",
      event_name: "lead_created",
      event_time: "2026-10-08T18:42:00.000Z",
      product: "agente_yincorp",
      wbraid: "wbraid-brooklin"
    },
    {
      event_id: "evt-sem-clique",
      event_name: "lead_created",
      event_time: "2026-10-08T18:43:00.000Z",
      product: "ynteligencia"
    }
  ]);
  assert.equal(csv.split("evt-1").length - 1, 1);
  assert.match(csv, /2026-10-08 15:40:00-0300/);
  assert.match(csv, /gbraid-brooklin/);
  assert.match(csv, /wbraid-brooklin/);
  assert.equal(csv.includes("evt-sem-clique"), false);
  assert.equal(csv.includes(visitor), false);
  assert.equal(csv.includes("session-ads"), false);
});

test("retorno no outro produto preserva a primeira origem e atualiza o último toque", async () => {
  const store = memory();
  await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    gclid: "gclid-original",
    utm_source: "google",
    utm_campaign: "campanha-original",
    intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 }
  }), store.rest, new Date("2026-10-08T12:00:00.000Z"));

  await ads.recordAdsEvent({
    product: "agente_yincorp",
    event_name: "ad_entry",
    visitor_id: visitor,
    session_id: laterSession
  }, store.rest, new Date("2026-10-10T12:00:00.000Z"));

  const row = store.visitors[0];
  assert.equal(row.first_product, "ynteligencia");
  assert.equal(row.first_gclid, "gclid-original");
  assert.equal(row.first_utm_source, "google");
  assert.equal(row.first_utm_campaign, "campanha-original");
  assert.equal(row.last_gclid, "gclid-original");
  assert.equal(row.last_utm_source, "organic");
  assert.equal(row.last_product, "agente_yincorp");
  assert.equal(row.last_seen, "2026-10-10T12:00:00.000Z");
  assert.equal(row.first_declared_intent.neighborhood, "Perdizes");
  assert.equal(row.current_declared_intent.neighborhood, "Perdizes");
});

test("vid válido atravessa produtos e vid inválido não substitui o local", () => {
  const shared = "33333333-3333-4333-8333-333333333333";
  assert.equal(ads.acceptVisitorId(shared, visitor), shared);
  assert.equal(ads.acceptVisitorId("nao-e-uuid", visitor), visitor);
  assert.equal(ads.acceptVisitorId("", ""), "");
  assert.equal(ads.validVisitorId("vid-perdizes"), false);
  const handoff = ads.visitorHandoffUrl("https://agente.example/chat", visitor);
  assert.equal(handoff, `https://agente.example/chat?vid=${visitor}`);
  assert.equal(ads.visitorHandoffUrl("https://agente.example/chat", "invalido"), "https://agente.example/chat");
});


const enabled = { env: { ADS_AGENT_HANDOFF_ENABLED: "true" }, allowedOrigins: ["https://app.yincorp.com.br"] };
const dbId = "22222222-2222-4222-8222-222222222222";

function handoffBody(extra = {}) {
  return {
    visitor_id: visitor,
    session_id: session,
    source_product: "ynteligencia",
    return_origin: "https://app.yincorp.com.br",
    declared_intent: { neighborhood: "Brooklin", bedrooms: 3, max_price: 1100000 },
    property: {
      external_id: "nonstop:florida",
      property_id: dbId,
      id: dbId,
      db_id: dbId,
      name: "Flórida",
      neighborhood: "Brooklin",
      bedrooms: 3,
      price: 847100,
      inventory_source: "usados"
    },
    ...extra
  };
}

test("flag ausente não cria handoff e não devolve URL do agente", async () => {
  const store = memory();
  const created = await ads.createHandoff(handoffBody(), store.rest, new Date("2026-10-09T18:00:00.000Z"), {
    env: {},
    allowedOrigins: ["https://app.yincorp.com.br"]
  });
  assert.equal(created.status, 409);
  assert.equal(created.body.error, "handoff_disabled");
  assert.equal(created.body.url, undefined);
  assert.equal(store.handoffs.length, 0);
  assert.equal(store.events.length, 0);
  assert.equal(ads.agentHandoffEnabled({}), false);
  assert.equal(ads.agentHandoffEnabled({ ADS_AGENT_HANDOFF_ENABLED: "false" }), false);
  assert.equal(ads.agentHandoffEnabled({ ADS_AGENT_HANDOFF_ENABLED: "1" }), false);
});

test("handoff leva o contexto sem PII e o agente reutiliza visitor e sessão", async () => {
  const store = memory();
  store.visitors.push({
    visitor_id: visitor,
    last_product: "ynteligencia",
    first_declared_intent: {
      neighborhood: "Perdizes",
      development: "",
      bedrooms: 2,
      min_price: 0,
      max_price: 900000,
      inventory_source: "todos"
    },
    current_declared_intent: {
      neighborhood: "Brooklin",
      development: "",
      bedrooms: 3,
      min_price: 0,
      max_price: 1100000,
      inventory_source: "todos"
    },
    observed_intent: {
      neighborhood: "Perdizes",
      bedrooms: 3,
      price_min: 850000,
      price_max: 1000000
    },
    observed_confidence: 0.75
  });

  const now = new Date("2026-10-09T18:00:00.000Z");
  const created = await ads.createHandoff(handoffBody({
    return_origin: "https://evil.example",
    email: "ana@example.com",
    nome: "Ana",
    telefone: "11999999999",
    conversation: "quero visitar",
    observed_intent: { neighborhood: "Moema", bedrooms: 1 },
    recent_properties: [
      { external_id: "nonstop:florida", property_id: dbId, db_id: dbId, name: "Flórida", neighborhood: "Brooklin", bedrooms: 3, price: 847100, inventory_source: "usados" },
      { property_id: "orulo:outro", name: "Outro", neighborhood: "Brooklin", bedrooms: 3, price: 960000, inventory_source: "usados", email: "ana@example.com" }
    ],
    current_touch: {
      gclid: "CURRENT-GCLID",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "brooklin_3d"
    },
    attribution: {
      gclid: "LEGACY-GCLID",
      utm_source: "legacy",
      utm_campaign: "old"
    }
  }), store.rest, now, enabled);

  assert.equal(created.status, 200);
  const url = new URL(created.body.url);
  assert.equal(url.origin, "https://agente.yincorp.com.br");
  assert.deepEqual([...url.searchParams.keys()], ["handoff"]);
  const token = url.searchParams.get("handoff");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.body.handoff_id, undefined);
  assert.equal(store.handoffs[0].visitor_id, visitor);
  assert.equal(store.handoffs[0].session_id, session);
  assert.equal(store.handoffs[0].target_product, "agente_yincorp");
  const context = store.handoffs[0].context;
  assert.equal(context.property.property_id, "nonstop:florida");
  assert.equal(context.property.db_id, dbId);
  assert.equal(context.current_property, context.property);
  assert.equal(context.property.name, "Flórida");
  assert.equal(context.property.neighborhood, "Brooklin");
  assert.equal(context.first_declared_intent.neighborhood, "Perdizes");
  assert.equal(context.first_declared_intent.bedrooms, 2);
  assert.equal(context.current_declared_intent.neighborhood, "Brooklin");
  assert.equal(context.current_declared_intent.max_price, 1100000);
  assert.equal(context.observed_intent.neighborhood, "Perdizes");
  assert.equal(context.observed_intent.bedrooms, 3);
  assert.equal(context.recent_properties.length, 2);
  assert.equal(context.recent_properties[1].property_id, "orulo:outro");
  assert.equal(context.attribution.gclid, "CURRENT-GCLID");
  assert.equal(context.attribution.utm_source, "google");
  assert.equal(context.attribution.utm_campaign, "brooklin_3d");
  assert.equal(JSON.stringify(context.attribution).includes("LEGACY-GCLID"), false);
  assert.equal(context.last_product, "ynteligencia");
  assert.equal(context.return_url, `https://app.yincorp.com.br/?imovel=nonstop%3Aflorida&vid=${visitor}`);
  const packed = JSON.stringify(context);
  assert.equal(packed.includes("ana@example.com"), false);
  assert.equal(packed.includes("11999999999"), false);
  assert.equal(packed.includes("quero visitar"), false);
  assert.equal(packed.includes("Moema"), false);
  assert.equal(store.events.some(item => item.event_name === "agent_handoff_created"), true);
  assert.equal(JSON.stringify(store.events).includes(token), false);

  const read = await ads.readHandoff({ handoff_id: token }, store.rest, now);
  assert.equal(read.status, 200);
  assert.equal(read.body.visitor_id, visitor);
  assert.equal(read.body.session_id, session);
  assert.equal(read.body.handoff_id, undefined);
  assert.equal(read.body.context.property.property_id, "nonstop:florida");
  assert.equal(read.body.context.property.db_id, dbId);
  assert.ok(store.handoffs[0].consumed_at);

  const again = await ads.readHandoff({ handoff_id: token }, store.rest, new Date(now.getTime() + 60000));
  assert.equal(again.status, 200);

  const second = await ads.createHandoff(handoffBody({
    property: {
      property_id: "nonstop:outro",
      name: "Apartamento",
      neighborhood: "Brooklin",
      bedrooms: 3,
      price: 960000,
      inventory_source: "usados"
    }
  }), store.rest, new Date(now.getTime() + 20000), enabled);
  assert.equal(second.status, 200);
  const secondToken = new URL(second.body.url).searchParams.get("handoff");
  assert.notEqual(secondToken, token);
  assert.equal(store.handoffs[1].context.property.property_id, "nonstop:outro");
  assert.equal(store.handoffs[1].context.return_url, `https://app.yincorp.com.br/?imovel=nonstop%3Aoutro&vid=${visitor}`);

  const expired = await ads.readHandoff({ handoff_id: token }, store.rest, new Date(now.getTime() + ads.HANDOFF_TTL_MS + 1000));
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "handoff_expired");
  assert.equal(expired.body.context, undefined);

  const unknown = "a".repeat(43);
  const missing = await ads.readHandoff({ handoff_id: unknown }, store.rest, now);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "handoff_invalid");
  const malformed = await ads.readHandoff({ handoff_id: "curto" }, store.rest, now);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, "handoff_malformed");

  const forced = await ads.recordAdsEvent(base({ event_name: "agent_handoff_created" }), store.rest, now);
  assert.equal(forced.status, 400);

  const opened = await ads.recordAdsEvent({
    product: "agente_yincorp",
    event_name: "agent_opened",
    visitor_id: visitor,
    session_id: session,
    gclid: "CURRENT-GCLID"
  }, store.rest, new Date(now.getTime() + 30000));
  assert.equal(opened.status, 200);
  const csv = ads.googleAdsConversionsCsv(store.events);
  assert.equal(csv.includes("agent_opened"), false);
  assert.equal(csv.includes("agent_handoff_created"), false);
  assert.equal(csv.includes(opened.body.event_id), false);
  assert.equal(csv.includes(token), false);
});

test("toque atual vazio não reaproveita a atribuição legada", async () => {
  const store = memory();
  const created = await ads.createHandoff(handoffBody({
    current_touch: {},
    attribution: { gclid: "LEGACY-GCLID", utm_source: "legacy" }
  }), store.rest, new Date("2026-10-09T18:00:00.000Z"), enabled);
  assert.equal(created.status, 200);
  assert.equal(store.handoffs[0].context.attribution.gclid, "");
  assert.equal(store.handoffs[0].context.attribution.utm_source, "");
});

test("falha de storage no handoff não devolve URL", async () => {
  const store = memory();
  const rest = async (requestPath, options = {}) => {
    const [table] = requestPath.split("?");
    if ((options.method || "GET") === "GET" && table === "ads_visitors") {
      return { ok: true, status: 200, data: [] };
    }
    return { ok: false, status: 500, data: null };
  };
  const created = await ads.createHandoff(handoffBody(), rest, new Date("2026-10-09T18:00:00.000Z"), enabled);
  assert.equal(created.status, 502);
  assert.equal(created.body.url, undefined);
  const read = await ads.readHandoff({ handoff_id: "a".repeat(43) }, rest, new Date("2026-10-09T18:00:00.000Z"));
  assert.equal(read.status, 502);
});

test("create-handoff cabe na function existente e o agente pode chamar", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.ADS_AGENT_HANDOFF_ENABLED;
  const { default: adsHandler } = await import(`./api/ads.js?handoff=${Date.now()}`);
  const disabled = await invokeAds(adsHandler, {
    method: "POST",
    query: { action: "create-handoff" },
    headers: { origin: "https://app.yincorp.com.br" },
    body: {}
  });
  assert.equal(disabled.code, 409);
  assert.equal(disabled.body.error, "handoff_disabled");

  process.env.ADS_AGENT_HANDOFF_ENABLED = "true";
  const { default: enabledHandler } = await import(`./api/ads.js?handoff-on=${Date.now()}`);
  const created = await invokeAds(enabledHandler, {
    method: "POST",
    query: { action: "create-handoff" },
    headers: { origin: "https://app.yincorp.com.br" },
    body: {}
  });
  assert.equal(created.code, 500);
  const wrongMethod = await invokeAds(enabledHandler, {
    method: "GET",
    query: { action: "create-handoff" },
    headers: { origin: "https://app.yincorp.com.br" }
  });
  assert.equal(wrongMethod.code, 405);
  const read = await invokeAds(enabledHandler, {
    method: "GET",
    query: { action: "get-handoff", handoff: "segredo-na-query" },
    headers: { origin: "https://agente.yincorp.com.br" }
  });
  assert.equal(read.code, 405);
  const event = await invokeAds(enabledHandler, {
    method: "POST",
    query: { action: "event" },
    headers: { origin: "https://exemplo.com" },
    body: { product: "ynteligencia", event_name: "ad_entry" }
  });
  assert.equal(event.code, 403);
  delete process.env.ADS_AGENT_HANDOFF_ENABLED;
  const files = fs.readdirSync(path.join(__dirname, "api")).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
  assert.equal(files.includes("ads.js"), true);
  assert.equal(files.some(name => name.startsWith("ads-") || name.startsWith("google-ads")), false);
});

function agentOpenHarness(openImpl, responseBody, responseOk = true) {
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const start = html.indexOf("function yntAgentHandoffUrl");
  const end = html.indexOf("function yntAdsTrack");
  const navigations = [];
  const context = vm.createContext({
    URL,
    URLSearchParams,
    navigations,
    window: {
      YntPropertyHandoff:require("./agent-property-handoff.js"),
      crypto:require("node:crypto").webcrypto,
      open(...args) {
        const features = String(args[2] || "");
        if (features.includes("noopener") || features.includes("noreferrer")) {
          navigations.push({ type: "noopener-open", url: args[0] });
          return null;
        }
        return openImpl(navigations, args);
      },
      location: {
        assign(url) { navigations.push({ type: "assign", url }); }
      }
    },
    location: { origin: "https://app.yincorp.com.br" },
    document: { querySelector() { return null; } },
    fetch() {
      return Promise.resolve({
        ok: responseOk,
        json: () => Promise.resolve(responseBody)
      });
    },
    YNTELIGENCIA_VISITOR_ID: visitor,
    YNTELIGENCIA_SESSION_ID: "22222222-2222-4222-8222-222222222222",
    YNTELIGENCIA_TOUCHES: { current_touch: { gclid: "CURRENT-GCLID" } },
    aiOpenedProperties: [],
    openAiAssistant(property) { navigations.push({ type: "assistant", id: property && property.id }); }
  });
  vm.runInContext(`${html.slice(start, end)}
function yntHasPaidClickContext(){ return true; }
function yntAdsIntentFromState(){ return {}; }
function yntAdsAttribution(){ return { gclid: "CURRENT-GCLID" }; }
`, context);
  return {
    navigations,
    open: property => context.openAgentConversation(property)
  };
}

function agentTokenUrl() {
  return `https://agente.yincorp.com.br/?handoff=${"a".repeat(43)}`;
}

function tokenUses(navigations) {
  return navigations.filter(item => String(item.url || item.href || "").includes("handoff="));
}

test("handoff ativo abre o agente uma única vez", async () => {
  const harness = agentOpenHarness((navigations, args) => {
    navigations.push({ type: "open", url: args[0] });
    return {
      opener: {},
      document: {
        body: { appendChild() {} },
        createElement() {
          const link = {
            rel: "",
            target: "",
            click() { navigations.push({ type: "popup", href: link.href, rel: link.rel }); }
          };
          return link;
        }
      },
      close() { navigations.push({ type: "close" }); }
    };
  }, { success: true, url: agentTokenUrl() });

  await harness.open({ id: "nonstop:florida", name: "Flórida" });
  const uses = tokenUses(harness.navigations);
  assert.equal(uses.length, 1);
  assert.equal(uses[0].type, "popup");
  assert.equal(uses[0].rel, "noopener noreferrer");
  assert.equal(harness.navigations.some(item => item.type === "assign"), false);
  assert.equal(harness.navigations.some(item => item.type === "noopener-open"), false);
  assert.equal(harness.navigations.filter(item => item.type === "open").length, 1);
  assert.equal(harness.navigations.find(item => item.type === "open").url, "about:blank");
});

test("null de noopener não dispara segunda navegação do mesmo token", async () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const opener = html.slice(html.indexOf("function yntOpenAgentOnce"), html.indexOf("async function openAgentConversation"));
  assert.equal(opener.includes("noopener,noreferrer"), false);
  assert.equal(opener.includes("window.location.assign(url)"), true);
  assert.equal(html.includes('window.open(url,"_blank","noopener,noreferrer")'), false);
  assert.equal(html.includes("if(!opened)window.location.assign"), false);

  const harness = agentOpenHarness(() => null, { success: true, url: agentTokenUrl() });
  await harness.open({ id: "nonstop:florida" });
  const uses = tokenUses(harness.navigations);
  assert.equal(uses.length, 1);
  assert.equal(uses[0].type, "assign");
  assert.equal(harness.navigations.filter(item => item.type === "assign").length, 1);
  assert.equal(harness.navigations.some(item => item.type === "popup" || item.type === "noopener-open"), false);
});

test("popup bloqueado navega a ficha uma vez e não abre outra aba", async () => {
  const harness = agentOpenHarness(() => null, { success: true, url: agentTokenUrl() });
  await harness.open({ id: "orulo:1" });
  assert.deepEqual(tokenUses(harness.navigations).map(item => item.type), ["assign"]);
});

test("falha ao usar a aba em branco não reabre o token na ficha", async () => {
  const harness = agentOpenHarness(navigations => {
    navigations.push({ type: "open", url: "about:blank" });
    return {
      opener: {},
      document: {
        body: { appendChild() { throw new Error("documento indisponível"); } },
        createElement() { return { rel: "", target: "", click() {} }; }
      },
      close() { navigations.push({ type: "close" }); }
    };
  }, { success: true, url: agentTokenUrl() });
  await harness.open({ id: "nonstop:florida" });
  assert.equal(tokenUses(harness.navigations).length, 0);
  assert.equal(harness.navigations.some(item => item.type === "close"), true);
  assert.equal(harness.navigations.some(item => item.type === "assign"), false);
});

test("flag desligada mantém a Match IA e não abre o agente", async () => {
  const harness = agentOpenHarness(() => {
    throw new Error("não deveria abrir janela");
  }, { success: false, error: "handoff_disabled" }, false);
  await harness.open({ id: "nonstop:florida" });
  assert.deepEqual(harness.navigations, [{ type: "assistant", id: "nonstop:florida" }]);
});

test("ai_search deduplica a intenção normalizada e grava intenções diferentes em menos de 15s", async () => {
  const store = memory();
  const start = new Date("2026-10-09T12:00:00Z");
  const intent = { neighborhood: "Perdizes", development: "Edifício A", bedrooms: 2, min_price: 500000, max_price: 900000, inventory_source: "todos" };
  const send = (value, seconds) => ads.recordAdsEvent(base({ event_name: "ai_search", intent: value }), store.rest, new Date(start.getTime() + seconds * 1000));
  const first = await send(intent, 0);
  const repeat = await send({ ...intent, neighborhood: "  PERDIZES ", development: "edificio a", bedrooms: "2", max_price: "900000" }, 1);
  assert.equal(first.body.duplicate, false);
  assert.equal(repeat.body.duplicate, true);
  assert.equal(repeat.body.event_id, first.body.event_id);
  const second = await send({ neighborhood: "Brooklin", bedrooms: 3, max_price: 1100000 }, 2);
  assert.equal(second.body.duplicate, false);
  assert.equal(store.events.filter(row => row.event_name === "ai_search").length, 2);
  for (const [key, value] of Object.entries({ neighborhood: "Moema", development: "Edifício B", bedrooms: 3, min_price: 600000, max_price: 1000000, inventory_source: "usados" })) {
    assert.equal((await send({ ...intent, [key]: value }, 3)).body.duplicate, false, key);
  }
  assert.equal((await send(intent, 16)).body.duplicate, false);
});

function browserAds(storage, sessionId, search, legacy = {}) {
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const payloads = [];
  const context = vm.createContext({
    URL, URLSearchParams,
    window: { location: { search, href: `https://app.yincorp.com.br/${search}`, hostname: "app.yincorp.com.br" } },
    document: { referrer: "" },
    YNTELIGENCIA_ATTRIBUTION: legacy,
    YNTELIGENCIA_VISITOR_ID: visitor,
    YNTELIGENCIA_SESSION_ID: sessionId,
    YNTELIGENCIA_SESSION: { session_number: 1 },
    clean: ads.clean,
    norm: ads.normalizeText,
    safeStorageGet: key => storage.get(key) || "",
    safeStorageSet: (key, value) => storage.set(key, value),
    safeStorageGetJSON: key => storage.has(key) ? JSON.parse(storage.get(key)) : null,
    safeStorageSetJSON: (key, value) => storage.set(key, JSON.stringify(value)),
    fetch: (url, options) => { payloads.push(JSON.parse(options.body)); return Promise.resolve(); }
  });
  vm.runInContext(html.slice(html.indexOf("function inferYnteligenciaCurrentTouch()"), html.indexOf("async function supabaseTrack(")), context);
  vm.runInContext(html.slice(html.indexOf("function yntAdsAttribution()"), html.indexOf("function yntAdsIntentFromState()")), context);
  return { payloads, track: (name, detail) => context.yntAdsTrack(name, detail) };
}

test("cliente separa current touch do legado entre três sessões e preserva first touch no servidor", async () => {
  const storage = new Map();
  const store = memory();
  const legacy = { gclid: "ABC", gbraid: "OLD-B", wbraid: "OLD-W", utm_source: "google", utm_campaign: "first" };
  const first = browserAds(storage, session, "?gclid=ABC&utm_source=google&utm_campaign=first", legacy);
  first.track("ai_search", { intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 } });
  await ads.recordAdsEvent(first.payloads[0], store.rest, new Date("2026-10-09T12:00:00Z"));
  assert.equal(first.payloads[0].gclid, "ABC");
  const direct = browserAds(storage, laterSession, "", legacy);
  direct.track("ai_search", { intent: { neighborhood: "Brooklin", bedrooms: 3, max_price: 1100000 } });
  for (const key of ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) assert.equal(direct.payloads[0][key], "", key);
  await ads.recordAdsEvent(direct.payloads[0], store.rest, new Date("2026-10-10T12:00:00Z"));
  assert.equal(store.events[1].gclid, "");
  assert.equal(store.events[1].visitor_id, visitor);
  assert.equal(store.events[1].session_id, laterSession);
  const last = browserAds(storage, "session-3", "?gclid=XYZ&utm_source=google&utm_campaign=third", legacy);
  last.track("ai_search", { intent: { neighborhood: "Moema", bedrooms: 4 } });
  await ads.recordAdsEvent(last.payloads[0], store.rest, new Date("2026-10-11T12:00:00Z"));
  assert.equal(store.events[2].gclid, "XYZ");
  assert.equal(store.visitors[0].first_gclid, "ABC");
  assert.equal(store.visitors[0].first_utm_source, "google");
  assert.equal(store.visitors[0].first_utm_campaign, "first");
  assert.equal(store.visitors[0].last_gclid, "XYZ");
  assert.equal(store.visitors[0].first_declared_intent.neighborhood, "Perdizes");
  assert.equal(store.visitors[0].current_declared_intent.neighborhood, "Moema");
  assert.equal(JSON.parse(storage.get("ynteligencia_first_touch_v2")).gclid, "ABC");
  // Reload sem parâmetros mantém somente o toque da própria sessão paga.
  const reload = browserAds(storage, "session-3", "", legacy);
  reload.track("property_view", { property: { property_id: "a" } });
  assert.equal(reload.payloads[0].gclid, "XYZ");
});

test("buyer profile acompanha o evento e não entra na resposta", async () => {
  const store = memory();
  const now = new Date("2026-10-08T12:00:00.000Z");
  const result = await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    gclid: "gclid-perfil",
    utm_source: "google",
    utm_campaign: "perfil",
    metadata: { buyer_id: "22222222-2222-4222-8222-222222222222", email: "maria@example.com" }
  }), store.rest, now);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.profile, undefined);
  assert.equal(store.events.length, 1);
  assert.equal(store.rpcCalls.length, 1);
  assert.equal(store.rpcCalls[0].gclid, "gclid-perfil");
  assert.equal(store.rpcCalls[0].buyer_id, undefined);
  assert.equal(JSON.stringify(store.rpcCalls[0]).includes("maria@example.com"), false);
});

test("retry deduplicado não reprojeta o payload novo", async () => {
  const store = memory();
  const now = new Date("2026-10-08T12:00:00.000Z");
  const payload = base({
    event_name: "ai_search",
    intent: { neighborhood: "Perdizes", bedrooms: 2, max_price: 900000 }
  });
  const first = await ads.recordAdsEvent(payload, store.rest, now);
  assert.equal(first.status, 200);
  assert.equal(store.rpcCalls.length, 1);
  const retry = await ads.recordAdsEvent({
    ...payload,
    gclid: "OUTRO-CLIQUE",
    utm_campaign: "maria@example.com"
  }, store.rest, new Date(now.getTime() + 5000));
  assert.equal(retry.body.duplicate, true);
  assert.equal(store.events.length, 1);
  assert.equal(store.rpcCalls.length, 1);
  assert.equal(store.rpcCalls[0].neighborhood, "Perdizes");
  assert.equal(store.rpcCalls[0].gclid, "");
  assert.equal(JSON.stringify(store.rpcCalls[0]).includes("maria@example.com"), false);
});

test("duas projeções do mesmo evento compartilham um único prazo", async () => {
  const store = memory();
  await ads.recordAdsEvent(base({
    event_name: "property_view",
    property: { property_id: "orulo:a", name: "Astorga", neighborhood: "Perdizes" }
  }), store.rest, new Date("2026-10-08T12:00:00.000Z"));
  let slowCalls = 0;
  const rest = (requestPath, options = {}) => {
    if (requestPath.split("?")[0] === "rpc/apply_buyer_profile_event") {
      slowCalls += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, status: 200, data: { status: "applied" } }), 5000);
        if (options.signal) {
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
      });
    }
    return store.rest(requestPath, options);
  };
  const budget = 80;
  const started = Date.now();
  const result = await ads.recordAdsEvent(base({
    event_name: "property_view",
    property: { property_id: "orulo:b" }
  }), rest, new Date("2026-10-08T12:01:00.000Z"), undefined, { buyerProfileTimeoutMs: budget });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.property_view_multiple, true);
  assert.equal(slowCalls, 1);
  assert.ok(elapsed < budget * 2, `elapsed ${elapsed}`);
  assert.ok(elapsed >= budget - 25, `elapsed ${elapsed}`);
});

test("prazo da projeção não quebra handoff, agent_opened nem lead_created", async () => {
  const store = memory();
  const handoff = await ads.createHandoff(handoffBody(), store.rest, new Date("2026-10-09T18:00:00.000Z"), enabled);
  assert.equal(handoff.status, 200);
  assert.equal(handoff.body.success, true);
  const opened = await ads.recordAdsEvent({
    product: "agente_yincorp",
    event_name: "agent_opened",
    visitor_id: visitor,
    session_id: session
  }, store.rest, new Date("2026-10-09T18:01:00.000Z"));
  assert.equal(opened.status, 200);
  assert.equal(opened.body.success, true);
  const lead = await ads.recordAdsEvent(base({
    event_name: "lead_created"
  }), store.rest, new Date("2026-10-09T18:02:00.000Z"));
  assert.equal(lead.status, 200);
  assert.equal(lead.body.success, true);
  assert.equal(store.events.some(item => item.event_name === "agent_handoff_created"), true);
  assert.equal(store.events.some(item => item.event_name === "agent_opened"), true);
  assert.equal(store.events.some(item => item.event_name === "lead_created"), true);
});

test("timeout da projeção não muda a resposta do evento", async () => {
  const store = memory();
  const rest = (requestPath, options = {}) => {
    if (requestPath.split("?")[0] === "rpc/apply_buyer_profile_event") {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, status: 200, data: { status: "applied" } }), 250);
        if (options.signal) {
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
      });
    }
    return store.rest(requestPath, options);
  };
  const result = await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    gclid: "gclid-lento"
  }), rest, new Date("2026-10-08T12:00:00.000Z"), undefined, { buyerProfileTimeoutMs: 40 });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(store.events.length, 1);
});

test("CR e LF na campanha não chegam à RPC", async () => {
  for (const campaign of [
    "campanha-x\nsegunda-linha",
    "campanha-x\rsegunda-linha",
    "campanha-x\r\nsegunda-linha"
  ]) {
    const store = memory();
    const result = await ads.recordAdsEvent(base({
      event_name: "ad_entry",
      gclid: "CLICK-OK",
      utm_source: "google",
      utm_campaign: campaign
    }), store.rest, new Date("2026-10-08T12:00:00.000Z"));
    assert.equal(result.status, 200);
    assert.equal(store.rpcCalls.length, 1);
    assert.equal(store.rpcCalls[0].utm_campaign, "");
    assert.equal(store.events[0].utm_campaign, "");
    assert.equal(JSON.stringify(store.rpcCalls[0]).includes("segunda-linha"), false);
    assert.equal(store.rpcCalls[0].gclid, "CLICK-OK");
    assert.equal(store.rpcCalls[0].utm_source, "google");
  }
  const store = memory();
  const kept = await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    utm_campaign: "campanha-x segunda-linha"
  }), store.rest, new Date("2026-10-08T12:00:00.000Z"));
  assert.equal(kept.status, 200);
  assert.equal(store.rpcCalls[0].utm_campaign, "campanha-x segunda-linha");
  assert.equal(store.events[0].utm_campaign, "campanha-x segunda-linha");
});

test("falha do buyer profile não apaga o ads_event", async () => {
  const store = memory();
  const rest = async (requestPath, options = {}) => {
    if (requestPath.split("?")[0] === "rpc/apply_buyer_profile_event") {
      return { ok: false, status: 404, data: null };
    }
    return store.rest(requestPath, options);
  };
  const result = await ads.recordAdsEvent(base({
    event_name: "property_view",
    property: { property_id: "orulo:1", name: "Solar", neighborhood: "Perdizes" }
  }), rest, new Date("2026-10-08T12:00:00.000Z"));
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].event_name, "property_view");
});

test("cliente deduplica ai_search com os seis campos e preserva property_view", () => {
  const client = browserAds(new Map(), session, "");
  const intent = { neighborhood: "Perdizes", development: "Edifício A", bedrooms: 2, min_price: 500000, max_price: 900000, inventory_source: "todos" };
  client.track("ai_search", { intent });
  client.track("ai_search", { intent: { ...intent, neighborhood: " PERDIZES ", development: "edificio a", bedrooms: "2" } });
  assert.equal(client.payloads.length, 1);
  for (const [key, value] of Object.entries({ neighborhood: "Brooklin", development: "B", bedrooms: 3, min_price: 600000, max_price: 1100000, inventory_source: "novos" })) {
    client.track("ai_search", { intent: { ...intent, [key]: value } });
  }
  assert.equal(client.payloads.length, 7);
  client.track("property_view", { property: { property_id: "a" } });
  client.track("property_view", { property: { property_id: "a" } });
  assert.equal(client.payloads.length, 8);
});

test("lead usa o clique da sessão e não mistura com um clique antigo", async () => {
  const store = memory();
  const start = new Date("2026-10-08T12:00:00.000Z");
  await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    session_id: "sessao-antiga",
    gclid: "GCLID-ANTIGO",
    gbraid: "GBRAID-ANTIGO",
    utm_campaign: "campanha-antiga"
  }), store.rest, start);
  await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    session_id: "sessao-atual",
    gclid: "GCLID-ATUAL",
    utm_source: "google",
    utm_campaign: "campanha-atual"
  }), store.rest, new Date(start.getTime() + 60000));

  const lead = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-sessao-atual",
    session_id: "sessao-atual",
    utm_source: "google",
    utm_campaign: "campanha-atual",
    property: { property_id: "nonstop:atual", name: "Atual" },
    nome: "Maria",
    email: "maria@example.com",
    telefone: "11988887777",
    whatsapp: "5511988887777",
    lead_summary: "quer visitar",
    transcript: "oi, quero comprar"
  }), store.rest, new Date(start.getTime() + 120000));

  assert.equal(lead.status, 200);
  assert.equal(lead.body.event_id, "lead-sessao-atual");
  const row = store.events.find(item => item.event_id === "lead-sessao-atual");
  assert.equal(row.gclid, "");
  assert.equal(row.gbraid, "");
  assert.equal(row.wbraid, "");
  assert.equal(row.conversion_gclid, "GCLID-ATUAL");
  assert.equal(row.conversion_gbraid, "");
  assert.equal(row.conversion_wbraid, "");
  assert.equal(row.conversion_click_source, "prior_session");
  assert.equal(row.utm_campaign, "campanha-atual");
  assert.equal(row.utm_source, "google");
  const leadProfile = store.rpcCalls.find(item => item && item.event_id === "lead-sessao-atual");
  assert.equal(leadProfile.gclid, "");
  assert.equal(leadProfile.utm_campaign, "campanha-atual");
  assert.equal(JSON.stringify(leadProfile).includes("GCLID-ANTIGO"), false);
  const stored = JSON.stringify(row);
  for (const secret of ["Maria", "maria@example.com", "11988887777", "5511988887777", "quer visitar", "oi, quero comprar"]) {
    assert.equal(stored.includes(secret), false, secret);
  }
});

test("lead orgânico herda o último clique do visitante e não o de outro", async () => {
  const store = memory();
  const start = new Date("2026-10-08T12:00:00.000Z");
  const other = "22222222-2222-4222-8222-222222222222";
  await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    gclid: "GCLID-VISITANTE",
    gbraid: "GBRAID-VISITANTE",
    wbraid: "WBRAID-VISITANTE"
  }), store.rest, start);
  await ads.recordAdsEvent({
    product: "ynteligencia",
    visitor_id: other,
    session_id: "sessao-alheia",
    event_name: "ad_entry",
    gclid: "GCLID-ALHEIO"
  }, store.rest, new Date(start.getTime() + 60000));

  const inherited = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-organico",
    session_id: "sessao-organica",
    gclid: "0",
    gbraid: "",
    utm_source: "organic",
    property: { property_id: "nonstop:florida", name: "Flórida" }
  }), store.rest, new Date(start.getTime() + 86400000));
  assert.equal(inherited.body.event_id, "lead-organico");
  const row = store.events.find(item => item.event_id === "lead-organico");
  assert.equal(row.gclid, "");
  assert.equal(row.gbraid, "");
  assert.equal(row.wbraid, "");
  assert.equal(row.conversion_gclid, "GCLID-VISITANTE");
  assert.equal(row.conversion_gbraid, "GBRAID-VISITANTE");
  assert.equal(row.conversion_wbraid, "WBRAID-VISITANTE");
  assert.equal(row.conversion_click_source, "prior_visitor");
  assert.equal(row.utm_source, "organic");
  assert.equal(row.utm_campaign, "");
  const inheritedProfile = store.rpcCalls.find(item => item && item.event_id === "lead-organico");
  assert.equal(inheritedProfile.gclid, "");
  assert.equal(inheritedProfile.utm_source, "organic");
  assert.equal(inheritedProfile.utm_campaign, "");
  assert.equal(JSON.stringify(store.events).includes("GCLID-ALHEIO") && row.conversion_gclid !== "GCLID-ALHEIO", true);

  const emptyVisitor = "33333333-3333-4333-8333-333333333333";
  const blank = await ads.recordAdsEvent({
    product: "ynteligencia",
    visitor_id: emptyVisitor,
    session_id: "sessao-sem-clique",
    event_name: "lead_created",
    event_id: "lead-sem-clique",
    property: { property_id: "nonstop:vazio" }
  }, store.rest, new Date(start.getTime() + 90000000));
  assert.equal(blank.body.event_id, "lead-sem-clique");
  const blankRow = store.events.find(item => item.event_id === "lead-sem-clique");
  assert.equal(blankRow.gclid, "");
  assert.equal(blankRow.gbraid, "");
  assert.equal(blankRow.wbraid, "");
  assert.equal(blankRow.conversion_gclid, "");
  assert.equal(blankRow.conversion_click_source, "");
  const csv = ads.googleAdsConversionsCsv(store.events);
  assert.match(csv, /lead-organico/);
  assert.equal(csv.includes("lead-sem-clique"), false);
  assert.match(csv, /GCLID-VISITANTE/);
  assert.equal(csv.includes("GCLID-ALHEIO"), false);
});

test("o mesmo lead conserva um event_id e leads diferentes permanecem distintos", async () => {
  const store = memory();
  const start = new Date("2026-10-08T15:00:00.000Z");
  const first = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-canonico",
    gclid: "GCLID-LEAD",
    property: { property_id: "nonstop:florida", name: "Flórida" }
  }), store.rest, start);
  const retry = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-outro-id",
    product: "agente_yincorp",
    gclid: "GCLID-LEAD",
    property: { property_id: "nonstop:florida", name: "Flórida" }
  }), store.rest, new Date(start.getTime() + 10 * 60 * 1000));
  const sameId = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-canonico",
    property: { property_id: "nonstop:florida" }
  }), store.rest, new Date(start.getTime() + ads.LEAD_LOGICAL_WINDOW_MS + 60000));
  assert.equal(first.body.duplicate, false);
  const canonical = store.events.find(item => item.event_id === "lead-canonico");
  assert.equal(canonical.gclid, "GCLID-LEAD");
  assert.equal(canonical.conversion_gclid, "GCLID-LEAD");
  assert.equal(canonical.conversion_click_source, "current_session");
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.event_id, "lead-canonico");
  assert.equal(sameId.body.duplicate, true);
  assert.equal(sameId.body.event_id, "lead-canonico");
  assert.equal(store.events.filter(item => item.event_name === "lead_created").length, 1);

  const second = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-outro-imovel",
    gclid: "GCLID-LEAD",
    property: { property_id: "nonstop:outro", name: "Outro" }
  }), store.rest, new Date(start.getTime() + 60000));
  assert.equal(second.body.duplicate, false);
  assert.equal(second.body.event_id, "lead-outro-imovel");
  assert.equal(store.events.filter(item => item.event_name === "lead_created").length, 2);

  const later = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-depois-da-janela",
    gclid: "GCLID-LEAD",
    property: { property_id: "nonstop:florida", name: "Flórida" }
  }), store.rest, new Date(start.getTime() + ads.LEAD_LOGICAL_WINDOW_MS + 60000));
  assert.equal(later.body.event_id, "lead-depois-da-janela");
  assert.equal(later.body.duplicate, false);

  const csv = ads.googleAdsConversionsCsv(store.events.filter(item => item.event_name === "lead_created"));
  assert.equal(csv.split("lead-canonico").length - 1, 1);
  assert.match(csv, /lead-outro-imovel/);
  assert.match(csv, /lead-depois-da-janela/);
  assert.match(csv, /"10","BRL"/);
  assert.equal(csv.includes("High Intent Buyer"), false);

  const conflict = await ads.recordAdsEvent(base({
    event_name: "lead_created",
    event_id: "lead-outro-imovel",
    visitor_id: "44444444-4444-4444-8444-444444444444",
    property: { property_id: "nonstop:novo" }
  }), store.rest, start);
  assert.equal(conflict.status, 409);
});

test("handoff sem clique na sessão recebe o último clique e preserva o UTM atual", async () => {
  const store = memory();
  await ads.recordAdsEvent(base({
    event_name: "ad_entry",
    session_id: "sessao-paga",
    gclid: "GCLID-HANDOFF",
    utm_source: "google",
    utm_campaign: "campanha-antiga"
  }), store.rest, new Date("2026-10-08T12:00:00.000Z"));
  const created = await ads.createHandoff(handoffBody({
    session_id: "sessao-organica",
    current_touch: { utm_source: "organic", gclid: "" }
  }), store.rest, new Date("2026-10-09T18:00:00.000Z"), enabled);
  assert.equal(created.status, 200);
  assert.equal(store.handoffs[0].context.attribution.gclid, "");
  assert.equal(store.handoffs[0].context.attribution.utm_source, "organic");
  assert.equal(store.handoffs[0].context.attribution.utm_campaign, "");
  assert.equal(store.handoffs[0].context.conversion_attribution.gclid, "GCLID-HANDOFF");
  assert.equal(store.handoffs[0].context.conversion_attribution.source, "prior_visitor");
  const handoffEvent = store.events.find(item => item.event_name === "agent_handoff_created");
  assert.equal(handoffEvent.gclid, "");
  assert.equal(handoffEvent.utm_source, "organic");
  assert.equal(handoffEvent.utm_campaign, "");
  assert.equal(handoffEvent.conversion_gclid, "GCLID-HANDOFF");
  assert.equal(handoffEvent.conversion_click_source, "prior_visitor");
  const handoffProfile = store.rpcCalls.find(item => item && item.event_name === "agent_handoff_created");
  assert.equal(handoffProfile.gclid, "");
  assert.equal(handoffProfile.utm_source, "organic");
});

test("sinais intermediários têm nome próprio e ficam fora do CSV de lead", () => {
  const signals = ads.GOOGLE_SIGNAL_CONVERSIONS;
  assert.deepEqual(Object.keys(signals).sort(), [
    "agent_opened",
    "high_intent_buyer",
    "property_view_multiple",
    "specialist_cta_opened"
  ]);
  assert.equal(signals.property_view, undefined);
  const names = new Set(Object.values(signals).map(item => item.name));
  names.add(ads.LEAD_CONVERSION_NAME);
  assert.equal(names.size, 5);
  const values = Object.values(signals).map(item => item.value);
  assert.equal(new Set(values).size, values.length);
  assert.equal(values.includes(ads.LEAD_CONVERSION_VALUE), false);
  const csv = ads.googleAdsConversionsCsv([
    { event_id: "s1", event_name: "high_intent_buyer", event_time: "2026-10-08T12:00:00.000Z", product: "ynteligencia", gclid: "G" },
    { event_id: "s2", event_name: "agent_opened", event_time: "2026-10-08T12:01:00.000Z", product: "agente_yincorp", gclid: "G" },
    { event_id: "s3", event_name: "specialist_cta_opened", event_time: "2026-10-08T12:02:00.000Z", product: "ynteligencia", gclid: "G" },
    { event_id: "s4", event_name: "property_view_multiple", event_time: "2026-10-08T12:03:00.000Z", product: "ynteligencia", gclid: "G" },
    { event_id: "s5", event_name: "property_view", event_time: "2026-10-08T12:04:00.000Z", product: "ynteligencia", gclid: "G" },
    { event_id: "lead-1", event_name: "lead_created", event_time: "2026-10-08T12:05:00.000Z", product: "ynteligencia", gclid: "G" }
  ]);
  assert.match(csv, /lead-1/);
  for (const id of ["s1", "s2", "s3", "s4", "s5"]) assert.equal(csv.includes(id), false, id);
  assert.equal(csv.includes("High Intent Buyer"), false);
  assert.equal(csv.includes("Agent Opened"), false);
});

test("o hit AW usa o event_id confirmado, o valor 10 e BRL", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /send_to':\s*'AW-18371236623\/1P2xCPmnzfccEI-mi7hE'/);
  assert.match(html, /transaction_id': conversionId/);
  assert.match(html, /value': 10/);
  assert.match(html, /currency': 'BRL'/);
  assert.equal(ads.LEAD_CONVERSION_VALUE, 10);
  assert.equal(ads.CONVERSION_CURRENCY, "BRL");
  assert.match(html, /if\(conversionId\)/);
  assert.match(html, /ynteligencia_lead_conversion_/);
  assert.equal((html.match(/AW-18371236623/g) || []).length, 1);
  const files = fs.readdirSync(path.join(__dirname, "api")).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
});

test("o claim reserva o lead e a exportação só fecha com confirmação", async () => {
  const { execFileSync, spawn } = require("node:child_process");
  const database = "google_ads_export_test";
  const upgrade = "google_ads_export_upgrade";
  const migration = path.join(__dirname, "supabase/google_ads_conversion_exports.sql");
  const psql = (db, sql) => execFileSync("psql", [
    "-d", db,
    "-v", "ON_ERROR_STOP=1",
    "-t", "-A",
    "-c", sql
  ], { encoding: "utf8" }).trim();
  const psqlAsync = (db, sql) => new Promise((resolve, reject) => {
    const child = spawn("psql", ["-d", db, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]);
    const out = [];
    const err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString("utf8") || Buffer.concat(out).toString("utf8")));
        return;
      }
      resolve(Buffer.concat(out).toString("utf8").trim());
    });
  });
  const recreate = name => {
    execFileSync("psql", ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `
      select pg_terminate_backend(pid) from pg_stat_activity
      where datname = '${name}' and pid <> pg_backend_pid()
    `], { stdio: "pipe" });
    execFileSync("psql", ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${name}`], { stdio: "pipe" });
    execFileSync("psql", ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${name}`], { stdio: "pipe" });
  };
  const ledgerState = eventId => psql(database, `
    select status || ':' || attempts::text || ':' || coalesce(exported_at::text, '') || ':' || last_error
    from public.google_ads_conversion_exports
    where event_id = '${eventId}'
  `);

  recreate(database);
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-c", `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      else
        alter role service_role bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
    end $$;
  `], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase/ads_events.sql")], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase/ads_lead_identity.sql")], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", migration], { stdio: "pipe" });

  psql(database, `
    insert into public.ads_events (event_id, event_name, event_time, product, visitor_id, session_id, gclid, gbraid, wbraid) values
      ('lead-antigo', 'lead_created', '2026-10-01T12:00:00Z', 'ynteligencia', 'v1', 's1', 'gclid-antigo', '', ''),
      ('lead-novo', 'lead_created', '2026-10-02T12:00:00Z', 'agente_yincorp', 'v1', 's2', '', 'gbraid-novo', ''),
      ('lead-vazio', 'lead_created', '2026-10-03T12:00:00Z', 'ynteligencia', 'v1', 's3', '', '', ''),
      ('high-1', 'high_intent_buyer', '2026-10-01T13:00:00Z', 'ynteligencia', 'v1', 's1', 'gclid-antigo', '', ''),
      ('view-1', 'property_view', '2026-10-01T11:00:00Z', 'ynteligencia', 'v1', 's1', 'gclid-antigo', '', '');
  `);
  const eventsBefore = psql(database, `
    select event_id || '|' || event_name || '|' || gclid || '|' || gbraid || '|' || wbraid || '|' || event_time::text
    from public.ads_events
    order by event_id
  `);

  assert.equal(psql(database, "select event_id from public.claim_google_lead_conversions(10)"), "lead-antigo\nlead-novo");
  assert.equal(psql(database, "select count(*) from public.claim_google_lead_conversions(10)"), "0");
  assert.equal(ledgerState("lead-antigo"), "pending:1::");
  assert.equal(ledgerState("lead-novo"), "pending:1::");
  assert.equal(psql(database, "select count(*) from public.google_ads_conversion_exports where event_id in ('high-1', 'view-1', 'lead-vazio')"), "0");
  assert.equal(psql(database, `
    select event_id || '|' || event_name || '|' || gclid || '|' || gbraid || '|' || wbraid || '|' || event_time::text
    from public.ads_events
    order by event_id
  `), eventsBefore);

  psql(database, `
    update public.google_ads_conversion_exports
    set claimed_at = now() - interval '16 minutes'
    where event_id = 'lead-antigo'
  `);
  assert.equal(psql(database, "select event_id from public.claim_google_lead_conversions(10)"), "lead-antigo");
  assert.equal(ledgerState("lead-antigo"), "pending:2::");
  assert.equal(psql(database, "select count(*) from public.claim_google_lead_conversions(10)"), "0");
  assert.equal(psql(database, "select count(*) from public.claim_google_lead_conversions(10, interval '0')"), "0");

  assert.equal(psql(database, "select event_id from public.confirm_google_lead_conversions(array['lead-antigo', 'inexistente'])"), "lead-antigo");
  assert.match(ledgerState("lead-antigo"), /^exported:2:.+:$/);
  const exportedAt = psql(database, "select exported_at::text from public.google_ads_conversion_exports where event_id = 'lead-antigo'");
  assert.equal(psql(database, "select event_id from public.confirm_google_lead_conversions(array['lead-antigo'])"), "lead-antigo");
  assert.equal(psql(database, "select exported_at::text from public.google_ads_conversion_exports where event_id = 'lead-antigo'"), exportedAt);
  psql(database, `
    update public.google_ads_conversion_exports
    set claimed_at = now() - interval '16 minutes'
    where event_id = 'lead-antigo'
  `);
  assert.equal(psql(database, "select count(*) from public.claim_google_lead_conversions(10)"), "0");
  assert.equal(psql(database, "select count(*) from public.google_ads_conversion_exports where event_id = 'inexistente'"), "0");

  const nasty = "ana@example.com 11999998888 conversa oi quero comprar nome Maria";
  assert.equal(psql(database, `select event_id from public.fail_google_lead_conversions(array['lead-novo', 'lead-antigo'], '${nasty}')`), "lead-novo");
  assert.equal(psql(database, "select last_error from public.google_ads_conversion_exports where event_id = 'lead-novo'"), "unknown");
  assert.equal(psql(database, "select count(*) from public.google_ads_conversion_exports where last_error ilike '%@%' or last_error ~ '[0-9]{8}' or last_error ilike '%conversa%' or last_error ilike '%maria%'"), "0");
  assert.equal(psql(database, "select status from public.google_ads_conversion_exports where event_id = 'lead-antigo'"), "exported");
  assert.equal(psql(database, "select event_id from public.claim_google_lead_conversions(10)"), "lead-novo");
  assert.equal(ledgerState("lead-novo"), "pending:2::");
  assert.equal(psql(database, "select count(*) from public.confirm_google_lead_conversions(array['lead-novo'])"), "1");
  assert.equal(psql(database, "select count(*) from public.fail_google_lead_conversions(array['lead-novo'], 'nao reabre')"), "0");
  assert.match(ledgerState("lead-novo"), /^exported:2:.+:$/);
  assert.equal(psql(database, "select count(*) from public.google_ads_conversion_exports where event_id = 'lead-novo'"), "1");

  let duplicate = "";
  try {
    psql(database, `
      insert into public.google_ads_conversion_exports (event_id, conversion_name, status)
      values ('lead-antigo', 'Lead Created', 'pending')
    `);
  } catch (error) {
    duplicate = String(error.stderr || error.message);
  }
  assert.match(duplicate, /duplicate key|unique/);

  const columns = psql(database, `
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'google_ads_conversion_exports'
    order by column_name
  `);
  assert.equal(columns, [
    "attempts",
    "claimed_at",
    "conversion_name",
    "created_at",
    "event_id",
    "exported_at",
    "last_error",
    "status"
  ].join("\n"));
  assert.equal(/nome|email|phone|telefone|whatsapp|summary|transcript|conversation/.test(columns), false);
  const eventColumns = psql(database, `
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'ads_events'
    order by column_name
  `);
  assert.equal(eventColumns.includes("claimed_at"), false);
  assert.equal(eventColumns.includes("exported_at"), false);
  assert.equal(eventColumns.includes("conversion_gclid"), true);
  assert.equal(eventColumns.includes("conversion_click_source"), true);
  assert.equal(psql(database, "select count(*) from pg_policies where tablename = 'google_ads_conversion_exports'"), "0");
  assert.equal(psql(database, `
    select relrowsecurity::text
    from pg_class
    where oid = 'public.google_ads_conversion_exports'::regclass
  `), "true");

  psql(database, `
    insert into public.ads_events (event_id, event_name, event_time, product, visitor_id, session_id, property_id, gclid) values
      ('lead-race-1', 'lead_created', '2026-10-05T12:00:00Z', 'ynteligencia', 'v1', 's5', 'imovel-race-1', 'gclid-race-1'),
      ('lead-race-2', 'lead_created', '2026-10-05T12:01:00Z', 'ynteligencia', 'v1', 's6', 'imovel-race-2', 'gclid-race-2');
  `);
  psql(database, `
    create or replace function public.test_delay_google_claim()
    returns trigger
    language plpgsql
    as $fn$
    begin
      perform pg_sleep(0.4);
      return new;
    end;
    $fn$;
    drop trigger if exists test_delay_google_claim on public.google_ads_conversion_exports;
    create trigger test_delay_google_claim
    before insert on public.google_ads_conversion_exports
    for each row execute function public.test_delay_google_claim();
  `);
  let raced;
  try {
    raced = await Promise.all([
      psqlAsync(database, "select event_id from public.claim_google_lead_conversions(10)"),
      psqlAsync(database, "select event_id from public.claim_google_lead_conversions(10)")
    ]);
  } finally {
    psql(database, `
      drop trigger if exists test_delay_google_claim on public.google_ads_conversion_exports;
      drop function if exists public.test_delay_google_claim();
    `);
  }
  const returned = raced.flatMap(text => text.split("\n").filter(Boolean)).sort();
  assert.deepEqual(returned, ["lead-race-1", "lead-race-2"]);
  assert.equal(ledgerState("lead-race-1"), "pending:1::");
  assert.equal(ledgerState("lead-race-2"), "pending:1::");

  psql(database, `
    insert into public.ads_events (event_id, event_name, event_time, product, visitor_id, session_id, gclid)
    values ('lead-svc', 'lead_created', '2026-10-04T12:00:00Z', 'ynteligencia', 'v1', 's4', 'gclid-svc')
  `);
  const asService = psql(database, `
    begin;
    set local role service_role;
    select event_id from public.claim_google_lead_conversions(10);
    select event_id from public.confirm_google_lead_conversions(array['lead-svc']::text[]);
    commit;
  `);
  assert.equal(asService.split("\n").filter(line => !["BEGIN", "SET", "COMMIT"].includes(line)).join("\n"), "lead-svc\nlead-svc");
  assert.match(ledgerState("lead-svc"), /^exported:1:.+:$/);

  for (const statement of [
    "select event_id from public.claim_google_lead_conversions(10)",
    "select event_id from public.confirm_google_lead_conversions(array['lead-svc']::text[])",
    "select event_id from public.fail_google_lead_conversions(array['lead-svc']::text[], 'anon')"
  ]) {
    let denied = "";
    try {
      psql(database, `
        begin;
        set local role anon;
        ${statement};
        commit;
      `);
    } catch (error) {
      denied = String(error.stderr || error.message);
    }
    assert.match(denied, /permission denied/);
  }

  psql(database, `
    insert into public.ads_events (event_id, event_name, event_time, product, visitor_id, session_id, property_id, gclid)
    values ('lead-code', 'lead_created', '2026-10-06T12:00:00Z', 'ynteligencia', 'v1', 's7', 'imovel-code', 'gclid-code')
  `);
  assert.equal(psql(database, "select event_id from public.claim_google_lead_conversions(10)"), "lead-code");
  assert.equal(psql(database, "select event_id from public.fail_google_lead_conversions(array['lead-code'], 'DOWNLOAD_FAILED')"), "lead-code");
  assert.equal(psql(database, "select last_error from public.google_ads_conversion_exports where event_id = 'lead-code'"), "download_failed");
  assert.equal(psql(database, "select event_id from public.claim_google_lead_conversions(10)"), "lead-code");
  assert.equal(psql(database, "select event_id from public.confirm_google_lead_conversions(array['lead-code'])"), "lead-code");

  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", migration], { stdio: "pipe" });
  assert.equal(psql(database, "select count(*) from public.claim_google_lead_conversions(10)"), "0");
  assert.equal(psql(database, "select count(*) from public.google_ads_conversion_exports"), "6");

  recreate(upgrade);
  execFileSync("psql", ["-d", upgrade, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase/ads_events.sql")], { stdio: "pipe" });
  execFileSync("psql", ["-d", upgrade, "-v", "ON_ERROR_STOP=1", "-c", `
    create table public.google_ads_conversion_exports (
      event_id text not null,
      conversion_name text not null,
      exported_at timestamptz,
      status text not null default 'exported',
      attempts integer not null default 1,
      last_error text not null default '',
      created_at timestamptz not null default now(),
      primary key (event_id, conversion_name),
      constraint google_ads_conversion_exports_status_check
        check (status in ('exported', 'failed')),
      constraint google_ads_conversion_exports_attempts_check
        check (attempts >= 1)
    );
    create index google_ads_conversion_exports_status_idx
      on public.google_ads_conversion_exports (conversion_name, status, exported_at);
    create function public.claim_google_lead_conversions(integer)
    returns integer language sql as $$ select 1 $$;
    insert into public.ads_events (event_id, event_name, event_time, product, visitor_id, session_id, gclid)
    values
      ('lead-ja-exportado', 'lead_created', '2026-10-01T12:00:00Z', 'ynteligencia', 'v1', 's1', 'gclid-velho'),
      ('lead-upgrade', 'lead_created', '2026-10-02T12:00:00Z', 'ynteligencia', 'v1', 's2', 'gclid-novo');
    insert into public.google_ads_conversion_exports (event_id, conversion_name, exported_at, status, attempts)
    values ('lead-ja-exportado', 'Lead Created', '2026-10-01T00:00:00Z', 'exported', 1);
  `], { stdio: "pipe" });
  execFileSync("psql", ["-d", upgrade, "-v", "ON_ERROR_STOP=1", "-f", migration], { stdio: "pipe" });
  execFileSync("psql", ["-d", upgrade, "-v", "ON_ERROR_STOP=1", "-f", migration], { stdio: "pipe" });
  assert.equal(psql(upgrade, `
    select (status = 'exported' and claimed_at = exported_at)::text
    from public.google_ads_conversion_exports
    where event_id = 'lead-ja-exportado'
  `), "true");
  assert.equal(psql(upgrade, "select event_id from public.claim_google_lead_conversions(10)"), "lead-upgrade");
  assert.equal(psql(upgrade, "select status from public.google_ads_conversion_exports where event_id = 'lead-upgrade'"), "pending");
  assert.equal(psql(upgrade, "select status from public.google_ads_conversion_exports where event_id = 'lead-ja-exportado'"), "exported");
});

test("a identidade do lead é atômica e o clique herdado não vira toque atual", async () => {
  const { execFileSync, spawn } = require("node:child_process");
  const buyer = require("./buyer-profile.js");
  const database = "ads_lead_identity_test";
  const visitorA = "11111111-1111-4111-8111-111111111111";
  const visitorB = "22222222-2222-4222-8222-222222222222";
  const psql = (db, sql) => execFileSync("psql", [
    "-d", db, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql
  ], { encoding: "utf8" }).trim();
  const psqlAsync = (db, sql) => new Promise((resolve, reject) => {
    const child = spawn("psql", ["-d", db, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]);
    const out = [];
    const err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) reject(new Error(Buffer.concat(err).toString("utf8") || Buffer.concat(out).toString("utf8")));
      else resolve(Buffer.concat(out).toString("utf8").trim());
    });
  });
  const leadRow = (eventId, visitorId, propertyId, time, product = "ynteligencia") => ({
    event_id: eventId,
    event_name: "lead_created",
    event_time: time,
    product,
    visitor_id: visitorId,
    session_id: `sessao-${eventId}`,
    property_id: propertyId,
    gclid: "",
    gbraid: "",
    wbraid: "",
    utm_source: "organic",
    conversion_gclid: "GCLID-HIST",
    conversion_gbraid: "",
    conversion_wbraid: "",
    conversion_click_source: "prior_visitor"
  });
  const claimSql = row => `select event_id || '|' || duplicate::text || '|' || conflict::text from public.record_ads_lead($json$${JSON.stringify(row)}$json$::jsonb)`;

  execFileSync("psql", ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = '${database}' and pid <> pg_backend_pid()
  `], { stdio: "pipe" });
  execFileSync("psql", ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `drop database if exists ${database}`], { stdio: "pipe" });
  execFileSync("psql", ["-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-c", `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      else
        alter role service_role bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
    end $$;
  `], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase/ads_events.sql")], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase/ads_lead_identity.sql")], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase/ads_lead_identity.sql")], { stdio: "pipe" });
  execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase/buyer_profiles.sql")], { stdio: "pipe" });

  psql(database, `
    create or replace function public.test_delay_lead_insert()
    returns trigger language plpgsql as $fn$
    begin
      perform pg_sleep(0.4);
      return new;
    end;
    $fn$;
    drop trigger if exists test_delay_lead_insert on public.ads_events;
    create trigger test_delay_lead_insert
    before insert on public.ads_events
    for each row when (new.event_name = 'lead_created')
    execute function public.test_delay_lead_insert();
  `);

  const sameTime = "2026-10-08T12:00:00.000Z";
  let same;
  let properties;
  let visitors;
  try {
    [same, properties, visitors] = await Promise.all([
      Promise.all([
        psqlAsync(database, claimSql(leadRow("lead-a", visitorA, "imovel-igual", sameTime))),
        psqlAsync(database, claimSql(leadRow("lead-b", visitorA, "imovel-igual", sameTime, "agente_yincorp")))
      ]),
      Promise.all([
        psqlAsync(database, claimSql(leadRow("lead-p1", visitorA, "imovel-1", sameTime))),
        psqlAsync(database, claimSql(leadRow("lead-p2", visitorA, "imovel-2", sameTime)))
      ]),
      Promise.all([
        psqlAsync(database, claimSql(leadRow("lead-v1", visitorA, "imovel-visitante", sameTime))),
        psqlAsync(database, claimSql(leadRow("lead-v2", visitorB, "imovel-visitante", sameTime)))
      ])
    ]);
  } finally {
    psql(database, `
      drop trigger if exists test_delay_lead_insert on public.ads_events;
      drop function if exists public.test_delay_lead_insert();
    `);
  }

  const parse = text => text.split("|");
  const sameRows = same.map(parse);
  assert.equal(sameRows[0][0], sameRows[1][0]);
  assert.deepEqual(sameRows.map(row => row[1]).sort(), ["false", "true"]);
  assert.deepEqual(sameRows.map(row => row[2]), ["false", "false"]);
  assert.equal(psql(database, `
    select count(*) from public.ads_events
    where event_name = 'lead_created' and visitor_id = '${visitorA}' and property_id = 'imovel-igual'
  `), "1");

  const propertyRows = properties.map(parse);
  assert.deepEqual(propertyRows.map(row => row[0]).sort(), ["lead-p1", "lead-p2"]);
  assert.deepEqual(propertyRows.map(row => row[1]), ["false", "false"]);
  assert.equal(psql(database, `
    select count(*) from public.ads_events
    where event_name = 'lead_created' and property_id in ('imovel-1', 'imovel-2')
  `), "2");

  const visitorRows = visitors.map(parse);
  assert.deepEqual(visitorRows.map(row => row[0]).sort(), ["lead-v1", "lead-v2"]);
  assert.deepEqual(visitorRows.map(row => row[1]), ["false", "false"]);

  const later = parse(psql(database, claimSql(leadRow(
    "lead-depois",
    visitorA,
    "imovel-igual",
    "2026-10-08T12:16:00.000Z"
  ))));
  assert.equal(later[0], "lead-depois");
  assert.equal(later[1], "false");
  assert.equal(psql(database, `
    select count(*) from public.ads_events
    where event_name = 'lead_created' and visitor_id = '${visitorA}' and property_id = 'imovel-igual'
  `), "2");

  const again = parse(psql(database, claimSql(leadRow("lead-a-de-novo", visitorA, "imovel-igual", sameTime))));
  assert.equal(again[1], "true");
  assert.equal(again[0], sameRows[0][0]);

  let blocked = "";
  try {
    psql(database, `
      insert into public.ads_events (event_id, event_name, event_time, product, visitor_id, session_id, property_id)
      values ('lead-direto', 'lead_created', '${sameTime}', 'ynteligencia', '${visitorA}', 's-direto', 'imovel-igual')
    `);
  } catch (error) {
    blocked = String(error.stderr || error.message);
  }
  assert.match(blocked, /ads_lead_duplicate/);

  const conflict = parse(psql(database, claimSql(leadRow(sameRows[0][0], visitorB, "imovel-outro", sameTime))));
  assert.equal(conflict[2], "true");

  const asService = psql(database, `
    begin;
    set local role service_role;
    select event_id from public.record_ads_lead($json$${JSON.stringify(leadRow("lead-svc-id", visitorA, "imovel-svc", sameTime))}$json$::jsonb);
    commit;
  `);
  assert.equal(asService.split("\n").filter(line => !["BEGIN", "SET", "COMMIT"].includes(line)).join("\n"), "lead-svc-id");

  let denied = "";
  try {
    psql(database, `
      begin;
      set local role anon;
      select event_id from public.record_ads_lead('{"event_name":"lead_created"}'::jsonb);
      commit;
    `);
  } catch (error) {
    denied = String(error.stderr || error.message);
  }
  assert.match(denied, /permission denied/);

  psql(database, `
    insert into public.ads_events (
      event_id, event_name, event_time, product, visitor_id, session_id,
      gclid, utm_source, utm_campaign, conversion_gclid, conversion_click_source
    ) values (
      'ad-retorno', 'ad_entry', '2026-10-08T12:00:00Z', 'ynteligencia', '${visitorA}', 'sessao-paga',
      'GCLID-OLD', 'google', 'campanha-antiga', 'GCLID-OLD', 'current_session'
    )
  `);
  assert.equal(psql(database, claimSql({
    event_id: "lead-retorno",
    event_name: "lead_created",
    event_time: "2026-10-09T15:00:00.000Z",
    product: "ynteligencia",
    visitor_id: visitorA,
    session_id: "sessao-organica",
    property_id: "imovel-retorno",
    gclid: "",
    utm_source: "organic",
    utm_campaign: "",
    conversion_gclid: "GCLID-OLD",
    conversion_gbraid: "",
    conversion_wbraid: "",
    conversion_click_source: "prior_visitor"
  })), "lead-retorno|false|false");
  assert.equal(psql(database, `
    select gclid || '|' || utm_source || '|' || utm_campaign || '|' || conversion_gclid || '|' || conversion_click_source
    from public.ads_events where event_id = 'lead-retorno'
  `), "|organic||GCLID-OLD|prior_visitor");

  const leadPayload = buyer.toApplyPayload({
    event_id: "lead-retorno",
    event_name: "lead_created",
    event_time: "2026-10-09T15:00:00.000Z",
    visitor_id: visitorA,
    session_id: "sessao-organica",
    product: "ynteligencia",
    gclid: "",
    utm_source: "organic",
    conversion_gclid: "GCLID-OLD",
    conversion_click_source: "prior_visitor"
  });
  assert.equal(leadPayload.gclid, "");
  assert.equal(leadPayload.utm_source, "organic");
  assert.equal(JSON.stringify(leadPayload).includes("GCLID-OLD"), false);

  const apply = payload => psql(database, `select public.apply_buyer_profile_event($json$${JSON.stringify(payload)}$json$::jsonb)`);
  apply(buyer.toApplyPayload({
    event_id: "ad-retorno",
    event_name: "ad_entry",
    event_time: "2026-10-08T12:00:00.000Z",
    visitor_id: visitorA,
    session_id: "sessao-paga",
    product: "ynteligencia",
    gclid: "GCLID-OLD",
    utm_source: "google",
    utm_campaign: "campanha-antiga"
  }));
  apply(leadPayload);
  const profile = JSON.parse(psql(database, `select public.get_buyer_profile('${visitorA}')`)).profile;
  assert.equal(profile.attribution.first_touch.gclid, "GCLID-OLD");
  assert.equal(profile.attribution.first_touch.utm_campaign, "campanha-antiga");
  assert.equal(profile.attribution.current_touch.gclid, "GCLID-OLD");
  assert.equal(profile.attribution.current_touch.utm_source, "organic");
  assert.equal(profile.attribution.current_touch.utm_campaign, "campanha-antiga");
  assert.equal(psql(database, `
    select attribution_field_times->'gclid'->>'id'
    from public.buyer_profiles where visitor_id = '${visitorA}'
  `), "ad-retorno");
  assert.equal(psql(database, `
    select attribution_field_times->'utm_source'->>'id'
    from public.buyer_profiles where visitor_id = '${visitorA}'
  `), "lead-retorno");
  assert.equal(psql(database, `
    select attribution_field_times->'utm_campaign'->>'id'
    from public.buyer_profiles where visitor_id = '${visitorA}'
  `), "ad-retorno");

  apply(buyer.toApplyPayload({
    event_id: "lead-sozinho",
    event_name: "lead_created",
    event_time: "2026-10-09T15:00:00.000Z",
    visitor_id: visitorB,
    session_id: "sessao-b",
    product: "agente_yincorp",
    gclid: "",
    utm_source: "organic",
    conversion_gclid: "GCLID-OLD"
  }));
  const alone = JSON.parse(psql(database, `select public.get_buyer_profile('${visitorB}')`)).profile;
  assert.equal(alone.attribution.current_touch.gclid, undefined);
  assert.equal(alone.attribution.current_touch.utm_source, "organic");
  assert.equal(alone.attribution.first_touch.gclid, undefined);
  assert.equal(alone.attribution.last_gclid, "");
});
