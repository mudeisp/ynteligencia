const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const visitor = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const windowFrom = "2026-10-13T00:00:00.000Z";
const windowTo = "2026-10-14T00:00:00.000Z";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function invoke(handler, req) {
  return new Promise(resolve => {
    const res = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ code: this.statusCode, body, headers: this.headers }); },
      end(payload) { resolve({ code: this.statusCode, body: payload, headers: this.headers }); }
    };
    Promise.resolve(handler(req, res)).catch(error => resolve({ error }));
  });
}

function collectKeys(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach(item => collectKeys(item, found));
    return found;
  }
  for (const [key, item] of Object.entries(value)) {
    found.push(key);
    collectKeys(item, found);
  }
  return found;
}

function tableOf(url) {
  return new URL(String(url)).pathname.replace(/^\/rest\/v1\//, "").split("?")[0];
}

function withServer(env, fetchImpl, fn) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return fetchImpl(url, options, calls);
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(() => {
      global.fetch = original;
      for (const key of Object.keys(previous)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

function serverEnv(extra = {}) {
  return {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-test",
    MIA_READ_TOKEN: "mia-secret",
    MIA_READ_TOKEN_PREVIOUS: undefined,
    ADS_EXPORT_TOKEN: "export-secret",
    ...extra
  };
}

function miaRequest(query = {}, headers = { authorization: "Bearer mia-secret" }) {
  return {
    method: "GET",
    query: { action: "mia-read", from: windowFrom, to: windowTo, ...query },
    headers
  };
}

function eventRow(overrides = {}) {
  return {
    event_id: "evt-1",
    event_name: "property_view",
    event_time: "2026-10-13T18:00:00.000Z",
    product: "ynteligencia",
    visitor_id: visitor,
    session_id: "sess-1",
    gclid: "gclid-real",
    gbraid: "",
    wbraid: "",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "lancamento-outubro",
    utm_term: "moema",
    utm_content: "anuncio",
    declared_neighborhood: "Moema",
    declared_development: "",
    declared_bedrooms: 3,
    declared_min_price: null,
    declared_max_price: 1500000,
    declared_inventory_source: "novos",
    property_id: "imovel-1",
    property_name: "Maria Silva Residencial",
    property_neighborhood: "Moema",
    property_development: "",
    property_bedrooms: 3,
    property_price: 1400000,
    property_inventory_source: "novos",
    observed_neighborhood: "",
    observed_bedrooms: null,
    observed_price_min: null,
    observed_price_max: null,
    observed_confidence: 0,
    conversion_gclid: "",
    conversion_gbraid: "",
    conversion_wbraid: "",
    conversion_click_source: "",
    metadata: {
      email: "ana@example.com",
      nome: "Ana",
      telefone: "11999998888",
      cpf: "12345678901",
      lead_summary: "quer o imóvel",
      transcript: "conversa secreta",
      whatsapp: "11988887777",
      notes: "nota interna",
      address: "Rua Secreta 10",
      derived: false,
      reasons: ["Maria Silva", "busca_valida_e_dois_imoveis"],
      canonical_preference: {
        city: "São Paulo",
        state: "SP",
        region: "Sul",
        property_type: "apartamento",
        purpose: "morar",
        email: "ana@example.com",
        secret: "segredo"
      }
    },
    ...overrides
  };
}

let handler;
let mia;

test.before(async () => {
  mia = await import("./mia-read.js");
  ({ default: handler } = await import("./api/ads.js"));
});

test("a allow-list da query não pede nome, breakdown nem metadata livre", () => {
  assert.equal(mia.EVENT_COLUMNS.includes("property_name"), false);
  assert.equal(mia.EVENT_COLUMNS.includes("metadata"), true);
  assert.equal(mia.VISITOR_COLUMNS.includes("session_id"), false);
  assert.equal(mia.VISITOR_COLUMNS.includes("utm_medium"), false);
  assert.equal(mia.PROFILE_COLUMNS.includes("last_search_summary"), false);
  assert.equal(mia.PROFILE_COLUMNS.includes("last_property_name"), false);
  assert.equal(mia.QUALITY_COLUMNS.includes("score_breakdown"), false);
  assert.equal(mia.SCHEMA_VERSION, "mia-ads-read/1");
});

test("a janela padrão é 24 horas e acima de 7 dias é rejeitada", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const defaults = mia.parseMiaReadQuery({}, now);
  assert.equal(defaults.ok, true);
  assert.equal(defaults.limit, 100);
  assert.equal(defaults.from, "2026-10-13T12:00:00.000Z");
  assert.equal(defaults.to, "2026-10-14T12:00:00.000Z");

  const exact = mia.parseMiaReadQuery({
    from: "2026-10-07T12:00:00.000Z",
    to: "2026-10-14T12:00:00.000Z"
  }, now);
  assert.equal(exact.ok, true);

  const wide = mia.parseMiaReadQuery({
    from: "2026-10-07T11:59:59.999Z",
    to: "2026-10-14T12:00:00.000Z"
  }, now);
  assert.equal(wide.ok, false);
  assert.equal(wide.error, "Janela maior que 7 dias");
  assert.equal(mia.parseMiaReadQuery({ limit: "201" }).ok, false);
  assert.equal(mia.parseMiaReadQuery({ limit: "200" }).limit, 200);
  assert.equal(mia.parseMiaReadQuery({ cursor: "%%%" }).ok, false);
});

test("o cursor pede a ordem event_time e event_id sem fallback de conversão", () => {
  const cursor = mia.encodeCursor({
    event_time: "2026-10-13T18:00:00.000Z",
    event_id: "b"
  });
  const decoded = mia.decodeCursor(cursor);
  assert.equal(decoded.event_id, "b");
  const path = decodeURIComponent(mia.eventsPath({
    from: windowFrom,
    to: windowTo,
    limit: 2,
    cursor: decoded
  }));
  assert.match(path, /order=event_time\.asc,event_id\.asc/);
  assert.match(path, /limit=3/);
  assert.match(path, /event_time\.gt\."2026-10-13T18:00:00\.000Z"/);
  assert.match(path, /event_time\.eq\."2026-10-13T18:00:00\.000Z"/);
  assert.match(path, /event_id\.gt\.b/);
  assert.equal(path.includes("property_name"), false);

  const dotted = mia.eventsPath({
    from: windowFrom,
    to: windowTo,
    limit: 1,
    cursor: { event_time: windowFrom, event_id: "evt.1" }
  });
  assert.match(decodeURIComponent(dotted), /event_id\.gt\."evt\.1"/);
  assert.equal(mia.scoresPath([visitor]).includes("score_breakdown"), false);
  assert.equal(mia.profilesPath([visitor]).includes("last_search_summary"), false);
});

test("auth válida lê a página sem PII e sem flag de high intent", async () => {
  await withServer(serverEnv(), (url) => {
    const table = tableOf(url);
    if (table === "ads_events") return jsonResponse([eventRow()]);
    if (table === "ads_visitors") {
      return jsonResponse([{
        visitor_id: visitor,
        first_seen: "2026-10-13T18:00:00.000Z",
        last_seen: "2026-10-13T18:05:00.000Z",
        first_product: "ynteligencia",
        last_product: "ynteligencia",
        first_gclid: "gclid-real",
        first_gbraid: "",
        first_wbraid: "",
        last_gclid: "gclid-real",
        last_gbraid: "",
        last_wbraid: "",
        first_utm_source: "google",
        first_utm_campaign: "lancamento-outubro",
        last_utm_source: "google",
        last_utm_campaign: "lancamento-outubro",
        first_declared_intent: { neighborhood: "Moema", bedrooms: 3, email: "ana@example.com" },
        current_declared_intent: { neighborhood: "Moema", bedrooms: 3 },
        observed_intent: null,
        observed_confidence: 0
      }]);
    }
    if (table === "buyer_profiles") return jsonResponse([]);
    if (table === "buyer_quality_scores") return jsonResponse([]);
    return jsonResponse({ message: "inesperado" }, 500);
  }, async calls => {
    const result = await invoke(handler, miaRequest());
    assert.equal(result.code, 200);
    assert.equal(result.headers["Cache-Control"], "no-store");
    assert.equal(result.headers["Content-Type"], "application/json; charset=utf-8");
    assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
    assert.deepEqual(Object.keys(result.body).sort(), [
      "events",
      "generated_at",
      "page",
      "schema_version",
      "source",
      "visitors"
    ]);
    assert.equal(result.body.schema_version, "mia-ads-read/1");
    assert.deepEqual(result.body.source.tables, [
      "ads_events",
      "ads_visitors",
      "buyer_profiles",
      "buyer_quality_scores"
    ]);
    assert.equal(result.body.page.limit, 100);
    assert.equal(result.body.page.has_more, false);
    assert.equal(result.body.page.next_cursor, null);
    assert.equal(calls.length, 4);
    const event = result.body.events[0];
    assert.equal(event.gclid, "gclid-real");
    assert.equal(event.conversion_attribution.gclid, "");
    assert.equal(event.conversion_attribution.source, "");
    assert.deepEqual(event.reasons, ["busca_valida_e_dois_imoveis"]);
    assert.equal(event.derived, false);
    assert.deepEqual(event.canonical_preference, {
      city: "São Paulo",
      state: "SP",
      region: "Sul",
      property_type: "apartamento",
      purpose: "morar"
    });
    assert.equal(Object.hasOwn(event, "metadata"), false);
    assert.equal(Object.hasOwn(event, "property_name"), false);
    assert.equal(Object.hasOwn(result.body.visitors[0], "session_id"), false);
    assert.equal(Object.hasOwn(result.body.visitors[0], "high_intent"), false);
    assert.equal(result.body.visitors[0].profile, null);
    assert.equal(result.body.visitors[0].quality, null);
    assert.deepEqual(Object.keys(result.body.visitors[0].utm.first).sort(), [
      "utm_campaign",
      "utm_source"
    ]);
    assert.equal(Object.hasOwn(result.body.visitors[0].declared_intent.first, "email"), false);
    const dumped = JSON.stringify(result.body);
    for (const secret of [
      "ana@example.com",
      "Maria Silva",
      "11999998888",
      "12345678901",
      "conversa secreta",
      "nota interna",
      "quer o imóvel",
      "segredo",
      "Rua Secreta"
    ]) {
      assert.equal(dumped.includes(secret), false, secret);
    }
    for (const key of [
      "property_name",
      "score_breakdown",
      "lead_id",
      "campaign_id",
      "metadata",
      "high_intent",
      "lead_summary",
      "transcript"
    ]) {
      assert.equal(collectKeys(result.body).includes(key), false, key);
    }
  });
});

test("token ausente, token errado e ADS_EXPORT_TOKEN não abrem a leitura", async () => {
  await withServer(serverEnv({ MIA_READ_TOKEN: undefined }), () => jsonResponse([]), async calls => {
    const missing = await invoke(handler, miaRequest({}, { authorization: "Bearer export-secret" }));
    assert.equal(missing.code, 503);
    assert.equal(missing.body.error, "MIA_READ_TOKEN não configurado");
    assert.equal(calls.length, 0);
  });

  await withServer(serverEnv(), () => jsonResponse([]), async calls => {
    const wrong = await invoke(handler, miaRequest({}, { authorization: "Bearer outro" }));
    assert.equal(wrong.code, 401);
    assert.equal(wrong.body.error, "Não autorizado");
    const exported = await invoke(handler, miaRequest({}, { authorization: "Bearer export-secret" }));
    assert.equal(exported.code, 401);
    const absent = await invoke(handler, miaRequest({}, {}));
    assert.equal(absent.code, 401);
    assert.equal(calls.length, 0);
  });
});

test("o token anterior autentica durante a rotação e o método errado responde 405", async () => {
  await withServer(serverEnv({ MIA_READ_TOKEN_PREVIOUS: "mia-anterior" }), (url) => {
    if (tableOf(url) === "ads_events") return jsonResponse([]);
    return jsonResponse([]);
  }, async () => {
    const rotated = await invoke(handler, miaRequest({}, { authorization: "Bearer mia-anterior" }));
    assert.equal(rotated.code, 200);
    assert.deepEqual(rotated.body.events, []);
    assert.deepEqual(rotated.body.visitors, []);
    const posted = await invoke(handler, {
      method: "POST",
      query: { action: "mia-read" },
      headers: { authorization: "Bearer mia-secret" },
      body: {}
    });
    assert.equal(posted.code, 405);
    assert.equal(posted.body.error, "Method not allowed");
  });
});

test("limit acima de 200 e janela acima de 7 dias não consultam o storage", async () => {
  await withServer(serverEnv(), () => jsonResponse([]), async calls => {
    const limit = await invoke(handler, miaRequest({ limit: "201" }));
    assert.equal(limit.code, 400);
    assert.equal(limit.body.error, "limit inválido");
    const wide = await invoke(handler, miaRequest({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-14T00:00:00.000Z"
    }));
    assert.equal(wide.code, 400);
    assert.equal(wide.body.error, "Janela maior que 7 dias");
    const cursor = await invoke(handler, miaRequest({ cursor: "nao-e-cursor" }));
    assert.equal(cursor.code, 400);
    assert.equal(cursor.body.error, "cursor inválido");
    assert.equal(calls.length, 0);
  });
});

test("limit 200 pede 201 linhas e a paginação segue event_time mais event_id", async () => {
  const rows = [
    eventRow({ event_id: "a", event_time: "2026-10-13T18:00:00.000Z", metadata: {} }),
    eventRow({ event_id: "b", event_time: "2026-10-13T18:00:00.000Z", metadata: {} }),
    eventRow({ event_id: "c", event_time: "2026-10-13T19:00:00.000Z", metadata: {} })
  ];
  await withServer(serverEnv(), (url) => {
    const parsed = new URL(String(url));
    const table = tableOf(url);
    if (table !== "ads_events") return jsonResponse([]);
    if (parsed.searchParams.get("order") !== "event_time.asc,event_id.asc") {
      return jsonResponse({ message: "ordem ausente" }, 500);
    }
    const select = parsed.searchParams.get("select").split(",");
    if (select.includes("property_name")) return jsonResponse({ message: "coluna indevida" }, 500);
    let list = rows.slice().sort((left, right) => {
      const compared = Date.parse(left.event_time) - Date.parse(right.event_time);
      if (compared) return compared;
      return left.event_id < right.event_id ? -1 : 1;
    });
    const or = parsed.searchParams.get("or") || "";
    const same = or.match(/event_time\.eq\."([^"]+)"/);
    const id = or.match(/event_id\.gt\.([A-Za-z0-9_-]+)/);
    if (same && id) {
      list = list.filter(row =>
        Date.parse(row.event_time) > Date.parse(same[1]) ||
        (row.event_time === same[1] && row.event_id > id[1])
      );
    }
    const limit = Number(parsed.searchParams.get("limit"));
    return jsonResponse(list.slice(0, limit));
  }, async calls => {
    const capped = await invoke(handler, miaRequest({ limit: "200" }));
    assert.equal(capped.code, 200);
    const firstUrl = new URL(calls[0].url);
    assert.equal(firstUrl.searchParams.get("limit"), "201");

    calls.length = 0;
    const first = await invoke(handler, miaRequest({ limit: "2" }));
    assert.equal(first.code, 200);
    assert.deepEqual(first.body.events.map(item => item.event_id), ["a", "b"]);
    assert.equal(first.body.page.has_more, true);
    const cursor = mia.decodeCursor(first.body.page.next_cursor);
    assert.equal(cursor.event_id, "b");
    assert.equal(cursor.event_time, "2026-10-13T18:00:00.000Z");

    const second = await invoke(handler, miaRequest({
      limit: "2",
      cursor: first.body.page.next_cursor
    }));
    assert.equal(second.code, 200);
    assert.deepEqual(second.body.events.map(item => item.event_id), ["c"]);
    assert.equal(second.body.page.has_more, false);
    assert.equal(second.body.page.next_cursor, null);
    const secondEvents = calls.map(call => call.url).filter(url => tableOf(url) === "ads_events");
    assert.match(decodeURIComponent(secondEvents.at(-1)), /event_id\.gt\.b/);
  });
});

test("profile e quality ausentes ficam nulos e buyer_class não vira evento", async () => {
  const highIntent = eventRow({
    event_id: "evt-high",
    event_name: "high_intent_buyer",
    metadata: {
      derived: true,
      reasons: ["busca_imovel_e_cta"],
      email: "ana@example.com",
      nome: "Ana"
    }
  });
  const lead = eventRow({
    event_id: "evt-lead",
    event_name: "lead_created",
    event_time: "2026-10-13T18:10:00.000Z",
    visitor_id: other,
    gclid: "gclid-sessao",
    conversion_gclid: "gclid-conversao",
    conversion_click_source: "prior_visitor",
    metadata: {}
  });
  await withServer(serverEnv(), (url) => {
    const table = tableOf(url);
    if (table === "ads_events") return jsonResponse([highIntent, lead]);
    if (table === "ads_visitors") {
      return jsonResponse([{
        visitor_id: visitor,
        first_seen: "2026-10-13T18:00:00.000Z",
        last_seen: "2026-10-13T18:10:00.000Z",
        first_product: "ynteligencia",
        last_product: "ynteligencia",
        first_gclid: "",
        first_gbraid: "",
        first_wbraid: "",
        last_gclid: "",
        last_gbraid: "",
        last_wbraid: "",
        first_utm_source: "",
        first_utm_campaign: "",
        last_utm_source: "",
        last_utm_campaign: "",
        first_declared_intent: null,
        current_declared_intent: null,
        observed_intent: null,
        observed_confidence: 0
      }]);
    }
    if (table === "buyer_profiles") {
      return jsonResponse([{
        visitor_id: visitor,
        buyer_id: "buyer-1",
        stage: "exploring",
        city: "São Paulo",
        state: "SP",
        regions: [],
        neighborhoods: ["Moema"],
        property_types: [],
        bedrooms_min: 3,
        bedrooms_max: 3,
        min_price: null,
        max_price: 1500000,
        inventory_sources: ["novos"],
        purpose: "",
        total_sessions: 1,
        total_property_views: 2,
        unique_properties_viewed: 2,
        total_ai_searches: 1,
        total_agent_opens: 0,
        total_leads: 0,
        last_property_id: "imovel-1",
        last_property_name: "Maria Silva Residencial",
        last_property_neighborhood: "Moema",
        last_search_summary: "quer o imóvel",
        property_name: "Maria Silva Residencial",
        email: "ana@example.com",
        observed_neighborhoods: ["Moema"],
        first_touch: { gclid: "gclid-real", email: "ana@example.com" },
        current_touch: { utm_source: "google", utm_medium: "cpc", utm_campaign: "lancamento-outubro" },
        last_gclid: "gclid-real",
        last_utm_source: "google",
        last_utm_medium: "cpc",
        last_utm_campaign: "lancamento-outubro",
        first_seen_at: "2026-10-13T18:00:00.000Z",
        last_seen_at: "2026-10-13T18:10:00.000Z"
      }]);
    }
    if (table === "buyer_quality_scores") {
      return jsonResponse([{
        visitor_id: visitor,
        buyer_intent_score: 72,
        commercial_intent_score: 48,
        recurrence_score: 10,
        broker_tester_score: 0,
        data_confidence_score: 46,
        buyer_class: "high_intent",
        traffic_quality_class: "likely_buyer",
        score_breakdown: { email: "ana@example.com", note: "score-secret" },
        first_event_at: "2026-10-13T18:00:00.000Z",
        last_event_at: "2026-10-13T18:10:00.000Z",
        distinct_days: 1,
        session_count: 1,
        event_count: 2,
        property_count: 1,
        neighborhood_count: 1,
        updated_at: "2026-10-13T18:10:00.400Z"
      }]);
    }
    return jsonResponse({ message: "inesperado" }, 500);
  }, async () => {
    const result = await invoke(handler, miaRequest());
    assert.equal(result.code, 200);
    const byId = Object.fromEntries(result.body.visitors.map(item => [item.visitor_id, item]));
    assert.equal(byId[visitor].quality.buyer_class, "high_intent");
    assert.equal(Object.hasOwn(byId[visitor].quality, "score_breakdown"), false);
    assert.equal(byId[visitor].profile.buyer_id, "buyer-1");
    assert.equal(byId[visitor].profile.behavior.last_property.property_id, "imovel-1");
    assert.equal(Object.hasOwn(byId[visitor].profile.behavior.last_property, "name"), false);
    assert.deepEqual(byId[visitor].profile.attribution.first_touch, { gclid: "gclid-real" });
    assert.equal(byId[other].profile, null);
    assert.equal(byId[other].quality, null);
    assert.equal(byId[other].first_seen, null);
    assert.deepEqual(result.body.events.map(item => item.event_name), [
      "high_intent_buyer",
      "lead_created"
    ]);
    assert.equal(result.body.events[0].derived, true);
    assert.deepEqual(result.body.events[0].reasons, ["busca_imovel_e_cta"]);
    assert.equal(result.body.events[1].event_id, "evt-lead");
    assert.equal(result.body.events[1].gclid, "gclid-sessao");
    assert.equal(result.body.events[1].conversion_attribution.gclid, "gclid-conversao");
    assert.equal(result.body.events[1].conversion_attribution.source, "prior_visitor");
    assert.equal(Object.hasOwn(byId[visitor], "high_intent"), false);
    assert.equal(collectKeys(result.body).includes("lead_id"), false);
    const dumped = JSON.stringify(result.body);
    assert.equal(dumped.includes("ana@example.com"), false);
    assert.equal(dumped.includes("Maria Silva"), false);
    assert.equal(dumped.includes("quer o imóvel"), false);
    assert.equal(dumped.includes("score-secret"), false);
    assert.equal(result.body.events.some(item => item.event_name === "high_intent" && item.buyer_class), false);
  });
});

test("buyer_class high_intent não cria evento high_intent_buyer", async () => {
  await withServer(serverEnv(), (url) => {
    const table = tableOf(url);
    if (table === "ads_events") return jsonResponse([eventRow({ metadata: {} })]);
    if (table === "buyer_quality_scores") {
      return jsonResponse([{
        visitor_id: visitor,
        buyer_intent_score: 80,
        commercial_intent_score: 50,
        recurrence_score: 0,
        broker_tester_score: 0,
        data_confidence_score: 40,
        buyer_class: "high_intent",
        traffic_quality_class: "likely_buyer",
        first_event_at: "2026-10-13T18:00:00.000Z",
        last_event_at: "2026-10-13T18:00:00.000Z",
        distinct_days: 1,
        session_count: 1,
        event_count: 1,
        property_count: 1,
        neighborhood_count: 1,
        updated_at: "2026-10-13T18:00:00.000Z"
      }]);
    }
    return jsonResponse([]);
  }, async () => {
    const result = await invoke(handler, miaRequest());
    assert.equal(result.code, 200);
    assert.deepEqual(result.body.events.map(item => item.event_name), ["property_view"]);
    assert.equal(result.body.visitors[0].quality.buyer_class, "high_intent");
    assert.equal(Object.hasOwn(result.body.visitors[0], "high_intent"), false);
  });
});

test("falha de storage e supabase ausente não vazam SQL", async () => {
  await withServer(serverEnv(), () => jsonResponse({
    message: "relation public.ads_events does not exist",
    hint: "select * from ads_events"
  }, 500), async () => {
    const failed = await invoke(handler, miaRequest());
    assert.equal(failed.code, 502);
    assert.equal(failed.body.error, "Não foi possível ler os eventos de anúncio");
    assert.equal(JSON.stringify(failed.body).includes("select"), false);
    assert.equal(JSON.stringify(failed.body).includes("ads_events"), false);
  });

  await withServer(serverEnv({
    SUPABASE_URL: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined
  }), () => jsonResponse([]), async calls => {
    const missing = await invoke(handler, miaRequest());
    assert.equal(missing.code, 503);
    assert.match(missing.body.error, /Supabase/);
    assert.equal(calls.length, 0);
  });
});

test("feed, intent-feed, sheet e google-conversions continuam nos próprios contratos", async () => {
  await withServer(serverEnv(), (url) => {
    const href = String(url);
    if (href.includes("claim_google_lead_conversions")) return jsonResponse([]);
    return jsonResponse([]);
  }, async calls => {
    const feed = await invoke(handler, { method: "GET", query: { action: "feed" }, headers: {} });
    assert.equal(feed.code, 200);
    assert.equal(feed.body.success, true);
    assert.ok(Array.isArray(feed.body.items));

    const intent = await invoke(handler, { method: "GET", query: { action: "intent-feed" }, headers: {} });
    assert.equal(intent.code, 200);
    assert.equal(intent.body.success, true);
    assert.equal(intent.body.development_urls_emitted, false);

    const sheetWithMia = await invoke(handler, {
      method: "GET",
      query: { action: "sheet" },
      headers: { authorization: "Bearer mia-secret" }
    });
    assert.equal(sheetWithMia.code, 401);

    const sheet = await invoke(handler, {
      method: "GET",
      query: { action: "sheet" },
      headers: { authorization: "Bearer export-secret" }
    });
    assert.equal(sheet.code, 200);
    assert.match(String(sheet.body), /event_time/);

    const conversionsWithMia = await invoke(handler, {
      method: "GET",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer mia-secret" }
    });
    assert.equal(conversionsWithMia.code, 401);

    const reserved = await invoke(handler, {
      method: "GET",
      query: { action: "google-conversions" },
      headers: { authorization: "Bearer export-secret" }
    });
    assert.equal(reserved.code, 200);
    assert.match(calls.map(call => call.url).join("\n"), /claim_google_lead_conversions/);

    const blocked = await invoke(handler, {
      method: "POST",
      query: { action: "event" },
      headers: { origin: "https://exemplo.com" },
      body: { product: "ynteligencia", event_name: "ad_entry" }
    });
    assert.equal(blocked.code, 403);

    const unknown = await invoke(handler, {
      method: "GET",
      query: { action: "outra" },
      headers: {}
    });
    assert.equal(unknown.code, 404);
  });
});

test("token unicode com o mesmo tamanho em caracteres não derruba a autenticação", async () => {
  const store = await import("./ads-store.js");
  const previousExport = process.env.ADS_EXPORT_TOKEN;
  process.env.ADS_EXPORT_TOKEN = "bbbb";
  try {
    assert.equal(store.authorizedExport({
      headers: { authorization: "Bearer ábbb" }
    }), false);
    assert.equal(store.authorizedExport({
      headers: { authorization: "Bearer bbbb" }
    }), true);
  } finally {
    if (previousExport === undefined) delete process.env.ADS_EXPORT_TOKEN;
    else process.env.ADS_EXPORT_TOKEN = previousExport;
  }

  await withServer(serverEnv({
    MIA_READ_TOKEN: "aaaa",
    MIA_READ_TOKEN_PREVIOUS: "cccc"
  }), () => jsonResponse([]), async calls => {
    const current = await invoke(handler, miaRequest({}, { authorization: "Bearer áaaa" }));
    assert.equal(current.error, undefined);
    assert.equal(current.code, 401);
    const previous = await invoke(handler, miaRequest({}, { authorization: "Bearer áccc" }));
    assert.equal(previous.error, undefined);
    assert.equal(previous.code, 401);
    assert.equal(calls.length, 0);
  });
});

test("pii dentro de campos textuais permitidos não sai na resposta", () => {
  const event = mia.projectEvent({
    event_id: "evt-pii-valor",
    event_name: "property_view",
    event_time: "2026-10-13T18:00:00.000Z",
    product: "ynteligencia",
    visitor_id: visitor,
    session_id: "sess-1",
    gclid: "EAIaIQobChMI-click",
    gbraid: "",
    wbraid: "",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "12345678",
    utm_term: "moema",
    utm_content: "ana@example.com",
    declared_neighborhood: "ana@example.com",
    declared_development: "11999999999",
    declared_inventory_source: "novos",
    property_id: "orulo-astorga",
    property_neighborhood: "Moema",
    property_development: "(11) 98888-7777",
    observed_neighborhood: "123.456.789-09",
    conversion_gclid: "EAIa-conversao",
    conversion_gbraid: "",
    conversion_wbraid: "",
    conversion_click_source: ""
  });
  const profile = mia.projectProfile({
    visitor_id: visitor,
    buyer_id: "buyer-1",
    stage: "exploring",
    city: "São Paulo",
    state: "SP",
    regions: [],
    neighborhoods: ["11988887777", "Moema"],
    property_types: ["apartamento"],
    purpose: "morar",
    last_property_id: "orulo-astorga",
    last_property_neighborhood: "Moema",
    observed_neighborhoods: ["Moema"],
    first_touch: {
      gclid: "EAIaIQobChMI-click",
      utm_term: "ana@example.com",
      utm_campaign: "12345678"
    },
    current_touch: { utm_source: "wa.me/5511999999999" },
    last_gclid: "EAIaIQobChMI-click",
    last_utm_source: "google",
    last_utm_medium: "cpc",
    last_utm_campaign: "12345678",
    first_seen_at: "2026-10-13T18:00:00.000Z",
    last_seen_at: "2026-10-13T18:00:00.000Z"
  });
  assert.equal(event.declared_neighborhood, "");
  assert.equal(event.declared_development, "");
  assert.equal(event.utm_content, "");
  assert.equal(event.property_development, "");
  assert.equal(event.observed_neighborhood, "");
  assert.equal(event.utm_campaign, "12345678");
  assert.equal(event.gclid, "EAIaIQobChMI-click");
  assert.equal(event.conversion_attribution.gclid, "EAIa-conversao");
  assert.equal(event.property_id, "orulo-astorga");
  assert.equal(event.visitor_id, visitor);
  assert.equal(event.property_neighborhood, "Moema");
  assert.deepEqual(profile.preferences.neighborhoods, ["Moema"]);
  assert.equal(profile.buyer_id, "buyer-1");
  assert.deepEqual(profile.attribution.first_touch, {
    gclid: "EAIaIQobChMI-click",
    utm_campaign: "12345678"
  });
  assert.deepEqual(profile.attribution.current_touch, {});
  const dumped = JSON.stringify({ event, profile });
  for (const secret of [
    "ana@example.com",
    "11999999999",
    "11988887777",
    "98888-7777",
    "123.456.789-09",
    "wa.me"
  ]) {
    assert.equal(dumped.includes(secret), false, secret);
  }
});

test("a função de anúncios continua sendo um único arquivo", () => {
  const files = fs.readdirSync(path.join(__dirname, "api")).filter(name => name.endsWith(".js"));
  assert.equal(files.filter(name => name.startsWith("ads")).join(), "ads.js");
  assert.equal(files.length, 12);
  const sql = fs.readdirSync(path.join(__dirname, "supabase"));
  assert.equal(sql.includes("mia_read.sql"), false);
});
