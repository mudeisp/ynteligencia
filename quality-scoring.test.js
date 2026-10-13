/*
  Quality Scoring V1.
  A parte em Postgres usa buyer_quality_test e não aponta para Production.
*/

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { execFileSync } = require("node:child_process");
const quality = require("./quality-scoring.js");
const ads = require("./ads-intelligence.js");

const visitor = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

function row(partial) {
  return {
    event_id: partial.event_id,
    event_name: partial.event_name,
    event_time: partial.event_time,
    visitor_id: partial.visitor_id || visitor,
    session_id: partial.session_id || "sessao-1",
    property_id: partial.property_id || "",
    property_neighborhood: partial.neighborhood || "",
    property_bedrooms: partial.bedrooms ?? null,
    property_price: partial.price ?? null,
    property_development: partial.development || "",
    property_name: partial.property_name || "",
    declared_neighborhood: partial.declared_neighborhood || "",
    declared_bedrooms: partial.declared_bedrooms ?? null,
    gclid: partial.gclid || "",
    gbraid: partial.gbraid || "",
    wbraid: partial.wbraid || "",
    conversion_gclid: partial.conversion_gclid || "",
    utm_source: partial.utm_source || "",
    metadata: partial.metadata || {}
  };
}

function scoresInRange(score) {
  for (const key of [
    "buyer_intent_score",
    "commercial_intent_score",
    "recurrence_score",
    "broker_tester_score",
    "data_confidence_score"
  ]) {
    assert.equal(Number.isInteger(score[key]), true, key);
    assert.ok(score[key] >= 0 && score[key] <= 100, `${key}=${score[key]}`);
  }
}

function day(index, hour = 12) {
  return `2026-10-${String(8 + index).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

test("session_start isolado fica com confiança baixa", () => {
  const score = quality.scoreVisitor([
    row({ event_id: "e1", event_name: "session_start", event_time: day(0) })
  ], visitor);
  scoresInRange(score);
  assert.ok(score.data_confidence_score < 40);
  assert.equal(score.buyer_class, "unknown");
  assert.equal(score.traffic_quality_class, "unknown");
  assert.equal(score.buyer_intent_score, 0);
});

test("um property_view não vira high intent e a IA sozinha também não", () => {
  const single = quality.scoreVisitor([
    row({
      event_id: "view-1",
      event_name: "property_view",
      event_time: day(0),
      property_id: "imovel-1",
      neighborhood: "Perdizes"
    })
  ], visitor);
  scoresInRange(single);
  assert.equal(single.buyer_class, "low_intent");
  assert.notEqual(single.buyer_class, "high_intent");
  assert.ok(single.buyer_intent_score < quality.CLASS_THRESHOLDS.exploring_buyer);
  const messages = [];
  for (let index = 0; index < 10; index += 1) {
    messages.push(row({
      event_id: `msg-${index}`,
      event_name: "ai_assistant_message",
      event_time: `2026-10-08T12:${String(index).padStart(2, "0")}:00.000Z`
    }));
  }
  const assistant = quality.scoreVisitor(messages, visitor);
  assert.notEqual(assistant.buyer_class, "high_intent");
  assert.ok(assistant.buyer_intent_score < quality.CLASS_THRESHOLDS.exploring_buyer);
});

test("retorno em quatro dias ao mesmo perfil sobe recorrência e buyer", () => {
  const events = [0, 1, 2, 3].map(index => row({
    event_id: `ret-${index}`,
    event_name: "property_view",
    event_time: day(index),
    session_id: `sessao-${index}`,
    property_id: "imovel-perdizes",
    neighborhood: "Perdizes",
    bedrooms: 2,
    price: 800000
  }));
  const score = quality.scoreVisitor(events, visitor);
  scoresInRange(score);
  assert.ok(score.recurrence_score >= 70);
  assert.ok(score.buyer_intent_score >= quality.CLASS_THRESHOLDS.engaged_buyer);
  assert.equal(score.buyer_class, "engaged");
  assert.ok(score.broker_tester_score < 50);
  assert.notEqual(score.traffic_quality_class, "likely_broker_or_tester");
});

test("IA, interesse e WhatsApp sobem a intenção comercial", () => {
  const score = quality.scoreVisitor([
    row({ event_id: "ia", event_name: "ai_assistant_message", event_time: day(0, 12) }),
    row({ event_id: "int", event_name: "property_interest", event_time: day(0, 13), property_id: "imovel-1" }),
    row({ event_id: "wa", event_name: "property_whatsapp_click", event_time: day(0, 14), property_id: "imovel-1" })
  ], visitor);
  scoresInRange(score);
  assert.ok(score.commercial_intent_score >= 60);
  assert.ok(score.commercial_intent_score > score.broker_tester_score);
});

test("lead_created classifica o visitante como lead", () => {
  const score = quality.scoreVisitor([
    row({
      event_id: "lead-1",
      event_name: "lead_created",
      event_time: day(0),
      property_id: "imovel-1",
      neighborhood: "Perdizes",
      gclid: "GCLID-REAL",
      utm_source: "google"
    })
  ], visitor);
  scoresInRange(score);
  assert.equal(score.buyer_class, "lead");
  assert.ok(score.buyer_intent_score >= 55);
  assert.ok(score.commercial_intent_score >= 70);
});

test("cem views num dia em muitos bairros sobem broker sem CTA", () => {
  const events = [];
  for (let index = 0; index < 100; index += 1) {
    const minute = index % 60;
    const hour = 12 + Math.floor(index / 60);
    events.push(row({
      event_id: `burst-${index}`,
      event_name: "property_view",
      event_time: `2026-10-08T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
      property_id: `imovel-${index}`,
      neighborhood: `bairro-${index % 15}`,
      bedrooms: (index % 4) + 1
    }));
  }
  const score = quality.scoreVisitor(events, visitor);
  scoresInRange(score);
  assert.ok(score.broker_tester_score >= 70);
  assert.equal(score.traffic_quality_class, "likely_broker_or_tester");
  assert.ok(score.recurrence_score < 40);
  assert.notEqual(score.buyer_class, "high_intent");
});

test("recorrente concentrado em dois bairros não vira broker", () => {
  const events = [];
  for (let index = 0; index < 30; index += 1) {
    events.push(row({
      event_id: `calm-${index}`,
      event_name: "property_view",
      event_time: day(index % 7, 12 + Math.floor(index / 7)),
      session_id: `sessao-${index % 7}`,
      property_id: index % 2 === 0 ? "imovel-a" : "imovel-b",
      neighborhood: index % 2 === 0 ? "Perdizes" : "Pompéia",
      bedrooms: 2,
      price: 900000
    }));
  }
  const score = quality.scoreVisitor(events, visitor);
  scoresInRange(score);
  assert.ok(score.distinct_days >= 7);
  assert.ok(score.recurrence_score >= 70);
  assert.ok(score.broker_tester_score < 50);
  assert.notEqual(score.traffic_quality_class, "likely_broker_or_tester");
  assert.equal(score.traffic_quality_class, "likely_buyer");
});

test("metadata.test aumenta forte o score de tester", () => {
  const plain = quality.scoreVisitor([
    row({ event_id: "s", event_name: "session_start", event_time: day(0) })
  ], visitor);
  const marked = quality.scoreVisitor([
    row({
      event_id: "s",
      event_name: "session_start",
      event_time: day(0),
      metadata: { test: true }
    })
  ], visitor);
  assert.ok(marked.broker_tester_score - plain.broker_tester_score >= 50);
  assert.ok(marked.score_breakdown.broker_tester.signals.some(item => item.name === "metadata_test"));
});

test("ID com TEST aumenta o score de tester", () => {
  const plain = quality.scoreVisitor([
    row({ event_id: "view-limpo", event_name: "property_view", event_time: day(0), property_id: "imovel-1" })
  ], visitor);
  const marked = quality.scoreVisitor([
    row({
      event_id: "TEST-view",
      event_name: "property_view",
      event_time: day(0),
      property_id: "imovel-1",
      gclid: "TEST-CLICK"
    })
  ], visitor);
  assert.ok(marked.broker_tester_score - plain.broker_tester_score >= 40);
  const names = marked.score_breakdown.broker_tester.signals.map(item => item.name);
  assert.equal(names.includes("test_identifier"), true);
  assert.equal(names.includes("test_click_id"), true);
});

test("muitos bairros, dormitórios e preços sem progressão sobem broker", () => {
  const events = [];
  const prices = [300000, 1500000, 5000000];
  for (let index = 0; index < 10; index += 1) {
    events.push(row({
      event_id: `mix-${index}`,
      event_name: "property_view",
      event_time: `2026-10-08T12:${String(index).padStart(2, "0")}:00.000Z`,
      property_id: `imovel-${index}`,
      neighborhood: `bairro-${index}`,
      bedrooms: (index % 4) + 1,
      price: prices[index % prices.length],
      development: `construtora-${index}`
    }));
  }
  const score = quality.scoreVisitor(events, visitor);
  scoresInRange(score);
  assert.ok(score.broker_tester_score >= 70);
  assert.equal(score.commercial_intent_score, 0);
});

test("renda alta isolada não muda broker", () => {
  const base = [
    row({ event_id: "v", event_name: "property_view", event_time: day(0), property_id: "imovel-1", neighborhood: "Moema", price: 4000000 })
  ];
  const rich = [
    row({
      event_id: "v",
      event_name: "property_view",
      event_time: day(0),
      property_id: "imovel-1",
      neighborhood: "Moema",
      price: 4000000,
      metadata: { income_percentile: 99, renda: "alta", household_income: "top" }
    })
  ];
  const left = quality.scoreVisitor(base, visitor);
  const right = quality.scoreVisitor(rich, visitor);
  assert.equal(right.broker_tester_score, left.broker_tester_score);
  assert.equal(right.buyer_intent_score, left.buyer_intent_score);
  assert.equal(right.traffic_quality_class, left.traffic_quality_class);
});

test("lead com varredura larga continua lead e fica mixed", () => {
  const events = [
    row({
      event_id: "lead-largo",
      event_name: "lead_created",
      event_time: "2026-10-08T18:00:00.000Z",
      property_id: "imovel-lead",
      neighborhood: "Perdizes",
      gclid: "GCLID-REAL"
    })
  ];
  for (let index = 0; index < 100; index += 1) {
    events.push(row({
      event_id: `wide-${index}`,
      event_name: "property_view",
      event_time: `2026-10-08T12:${String(index % 60).padStart(2, "0")}:${String(index % 50).padStart(2, "0")}.000Z`,
      property_id: `imovel-${index}`,
      neighborhood: `bairro-${index % 15}`,
      bedrooms: (index % 4) + 1
    }));
  }
  const score = quality.scoreVisitor(events, visitor);
  scoresInRange(score);
  assert.equal(score.buyer_class, "lead");
  assert.ok(score.broker_tester_score >= 70);
  assert.equal(score.traffic_quality_class, "mixed");
});

test("o mesmo conjunto de eventos gera o mesmo score", () => {
  const events = [
    row({ event_id: "a", event_name: "property_view", event_time: day(0), property_id: "imovel-1", neighborhood: "Pinheiros" }),
    row({ event_id: "b", event_name: "specialist_cta_opened", event_time: day(1), session_id: "sessao-2", property_id: "imovel-1" })
  ];
  assert.deepEqual(quality.scoreVisitor(events, visitor), quality.scoreVisitor(events.slice().reverse(), visitor));
});

test("o breakdown não carrega PII e a falha do score não apaga o evento", async () => {
  const score = quality.scoreVisitor([
    row({
      event_id: "pii",
      event_name: "property_view",
      event_time: day(0),
      property_id: "imovel-1",
      property_name: "Maria Silva",
      metadata: {
        email: "maria@example.com",
        phone: "11999998888",
        whatsapp: "5511999998888",
        conversation: "quero este imóvel"
      }
    })
  ], visitor);
  const packed = JSON.stringify(score);
  assert.equal(packed.includes("Maria Silva"), false);
  assert.equal(packed.includes("maria@example.com"), false);
  assert.equal(packed.includes("11999998888"), false);
  assert.equal(packed.includes("quero este imóvel"), false);

  const events = [];
  const rest = async (requestPath, options = {}) => {
    if (String(requestPath).split("?")[0] === "rpc/recompute_buyer_quality_score") {
      throw new Error("scoring down");
    }
    if ((options.method || "GET") === "POST" && requestPath.split("?")[0] === "ads_events") {
      events.push(options.body);
      return { ok: true, status: 201, data: null };
    }
    if (requestPath.split("?")[0] === "rpc/apply_buyer_profile_event") {
      return { ok: true, status: 200, data: { status: "applied" } };
    }
    if (requestPath.split("?")[0] === "rpc/record_ads_lead") {
      return { ok: false, status: 500, data: null };
    }
    if ((options.method || "GET") === "GET") return { ok: true, status: 200, data: [] };
    if ((options.method || "GET") === "POST") return { ok: true, status: 201, data: null };
    return { ok: true, status: 204, data: null };
  };
  const saved = await ads.recordAdsEvent({
    product: "ynteligencia",
    event_name: "property_view",
    visitor_id: visitor,
    session_id: "sessao-1",
    property: { property_id: "orulo:1", name: "Solar", neighborhood: "Perdizes" }
  }, rest, new Date("2026-10-08T12:00:00.000Z"));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.success, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_name, "property_view");
});

test("o recálculo acompanha o evento principal e não abre function nova", async () => {
  const calls = [];
  const rest = async (requestPath, options = {}) => {
    calls.push(requestPath.split("?")[0]);
    if ((options.method || "GET") === "GET") return { ok: true, status: 200, data: [] };
    if (requestPath.split("?")[0] === "rpc/apply_buyer_profile_event") {
      return { ok: true, status: 200, data: { status: "applied" } };
    }
    if (requestPath.split("?")[0] === "rpc/recompute_buyer_quality_score") {
      return { ok: true, status: 200, data: { status: "ok" } };
    }
    return { ok: true, status: 201, data: [{ event_id: "x", duplicate: false, conflict: false }] };
  };
  await ads.recordAdsEvent({
    product: "ynteligencia",
    event_name: "ad_entry",
    visitor_id: visitor,
    session_id: "sessao-1"
  }, rest, new Date("2026-10-08T12:00:00.000Z"));
  assert.equal(calls.includes("rpc/recompute_buyer_quality_score"), false);
  await ads.recordAdsEvent({
    product: "ynteligencia",
    event_name: "lead_created",
    visitor_id: visitor,
    session_id: "sessao-1",
    property: { property_id: "imovel-1" }
  }, rest, new Date("2026-10-08T12:05:00.000Z"));
  assert.equal(calls.includes("rpc/recompute_buyer_quality_score"), true);
  const files = fs.readdirSync(path.join(__dirname, "api")).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
});

function psql(database, sql) {
  return execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  }).trim();
}

function quote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function insertEvents(database, events) {
  if (!events.length) return;
  const values = events.map(event => `(
    ${quote(event.event_id)}, ${quote(event.event_name)}, ${quote(event.event_time)}::timestamptz,
    'ynteligencia', ${quote(event.visitor_id)}, ${quote(event.session_id)},
    ${quote(event.property_id)}, ${quote(event.property_neighborhood)},
    ${event.property_bedrooms == null ? "null" : Number(event.property_bedrooms)},
    ${event.property_price == null ? "null" : Number(event.property_price)},
    ${quote(event.property_development)}, ${quote(event.property_name)},
    ${quote(event.gclid)}, ${quote(event.gbraid)}, ${quote(event.wbraid)},
    ${quote(event.conversion_gclid)}, '', '',
    ${quote(event.utm_source)}, ${quote(event.declared_neighborhood)},
    ${event.declared_bedrooms == null ? "null" : Number(event.declared_bedrooms)},
    $json$${JSON.stringify(event.metadata)}$json$::jsonb
  )`).join(",");
  psql(database, `
    insert into public.ads_events (
      event_id, event_name, event_time, product, visitor_id, session_id,
      property_id, property_neighborhood, property_bedrooms, property_price,
      property_development, property_name,
      gclid, gbraid, wbraid, conversion_gclid, conversion_gbraid, conversion_wbraid,
      utm_source, declared_neighborhood, declared_bedrooms, metadata
    ) values ${values}
  `);
}

function assertMatchesSql(database, events, visitorId) {
  insertEvents(database, events);
  const expected = quality.scoreVisitor(events, visitorId);
  const stored = JSON.parse(psql(database, `select public.recompute_buyer_quality_score(${quote(visitorId)})`)).score;
  for (const key of [
    "buyer_intent_score",
    "commercial_intent_score",
    "recurrence_score",
    "broker_tester_score",
    "data_confidence_score",
    "buyer_class",
    "traffic_quality_class",
    "distinct_days",
    "session_count",
    "event_count",
    "property_count",
    "neighborhood_count"
  ]) {
    assert.equal(stored[key], expected[key], key);
  }
  assert.deepEqual(
    stored.score_breakdown.broker_tester.signals.map(item => item.name),
    expected.score_breakdown.broker_tester.signals.map(item => item.name)
  );
  const again = JSON.parse(psql(database, `select public.recompute_buyer_quality_score(${quote(visitorId)})`)).score;
  assert.equal(again.buyer_intent_score, stored.buyer_intent_score);
  assert.equal(again.broker_tester_score, stored.broker_tester_score);
  assert.equal(again.buyer_class, stored.buyer_class);
  assert.deepEqual(again.score_breakdown, stored.score_breakdown);
  return stored;
}

test("o Postgres repete os scores, isola o perfil e nega anon", () => {
  const database = "buyer_quality_test";
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
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
    end $$;
  `], { stdio: "pipe" });
  for (const file of ["ads_events.sql", "ads_lead_identity.sql", "buyer_profiles.sql", "buyer_quality_scores.sql", "buyer_quality_scores.sql"]) {
    execFileSync("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-f", path.join(__dirname, "supabase", file)], { stdio: "pipe" });
  }

  const quiet = assertMatchesSql(database, [
    row({ event_id: "pg-start", event_name: "session_start", event_time: day(0), visitor_id: visitor })
  ], visitor);
  assert.ok(quiet.data_confidence_score < 40);
  assert.equal(quiet.buyer_class, "unknown");

  const oneView = "33333333-3333-4333-8333-333333333333";
  const viewed = assertMatchesSql(database, [
    row({
      event_id: "pg-view",
      event_name: "property_view",
      event_time: day(0),
      visitor_id: oneView,
      property_id: "imovel-1",
      neighborhood: "Perdizes"
    })
  ], oneView);
  assert.equal(viewed.buyer_class, "low_intent");

  const returning = "44444444-4444-4444-8444-444444444444";
  const returned = assertMatchesSql(database, [0, 1, 2, 3].map(index => row({
    event_id: `pg-ret-${index}`,
    event_name: "property_view",
    event_time: day(index),
    visitor_id: returning,
    session_id: `sessao-${index}`,
    property_id: "imovel-perdizes",
    neighborhood: "Perdizes",
    bedrooms: 2,
    price: 800000
  })), returning);
  assert.ok(returned.recurrence_score >= 70);
  assert.equal(returned.buyer_class, "engaged");

  const commercialVisitor = "55555555-5555-4555-8555-555555555555";
  const commercial = assertMatchesSql(database, [
    row({ event_id: "pg-ia", event_name: "ai_assistant_message", event_time: day(0, 12), visitor_id: commercialVisitor }),
    row({ event_id: "pg-int", event_name: "property_interest", event_time: day(0, 13), visitor_id: commercialVisitor, property_id: "imovel-1" }),
    row({ event_id: "pg-wa", event_name: "property_whatsapp_click", event_time: day(0, 14), visitor_id: commercialVisitor, property_id: "imovel-1" })
  ], commercialVisitor);
  assert.ok(commercial.commercial_intent_score >= 60);

  const leadVisitor = "66666666-6666-4666-8666-666666666666";
  const lead = assertMatchesSql(database, [
    row({
      event_id: "pg-lead",
      event_name: "lead_created",
      event_time: day(0),
      visitor_id: leadVisitor,
      property_id: "imovel-1",
      gclid: "GCLID-REAL",
      utm_source: "google"
    })
  ], leadVisitor);
  assert.equal(lead.buyer_class, "lead");

  const burstVisitor = "77777777-7777-4777-8777-777777777777";
  const burst = [];
  for (let index = 0; index < 100; index += 1) {
    burst.push(row({
      event_id: `pg-burst-${index}`,
      event_name: "property_view",
      event_time: `2026-10-08T${String(12 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
      visitor_id: burstVisitor,
      property_id: `imovel-${index}`,
      neighborhood: `bairro-${index % 15}`,
      bedrooms: (index % 4) + 1
    }));
  }
  const suspected = assertMatchesSql(database, burst, burstVisitor);
  assert.ok(suspected.broker_tester_score >= 70);
  assert.equal(suspected.traffic_quality_class, "likely_broker_or_tester");

  const calmVisitor = "88888888-8888-4888-8888-888888888888";
  const calm = [];
  for (let index = 0; index < 30; index += 1) {
    calm.push(row({
      event_id: `pg-calm-${index}`,
      event_name: "property_view",
      event_time: day(index % 7, 12 + Math.floor(index / 7)),
      visitor_id: calmVisitor,
      session_id: `sessao-${index % 7}`,
      property_id: index % 2 === 0 ? "imovel-a" : "imovel-b",
      neighborhood: index % 2 === 0 ? "Perdizes" : "Pompéia",
      bedrooms: 2,
      price: 900000
    }));
  }
  const focused = assertMatchesSql(database, calm, calmVisitor);
  assert.ok(focused.broker_tester_score < 50);
  assert.equal(focused.traffic_quality_class, "likely_buyer");

  const synthetic = "99999999-9999-4999-8999-999999999999";
  const flagged = assertMatchesSql(database, [
    row({
      event_id: "pg-test-flag",
      event_name: "session_start",
      event_time: day(0),
      visitor_id: synthetic,
      metadata: { test: true, email: "maria@example.com", conversation: "quero este imóvel" }
    })
  ], synthetic);
  assert.ok(flagged.broker_tester_score >= 50);
  const storedText = JSON.stringify(flagged);
  assert.equal(storedText.includes("maria@example.com"), false);
  assert.equal(storedText.includes("quero este imóvel"), false);

  const named = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  insertEvents(database, [
    row({
      event_id: "pg-maria",
      event_name: "property_view",
      event_time: day(0),
      visitor_id: named,
      property_id: "imovel-1",
      property_name: "Maria Silva",
      metadata: { phone: "11999998888", whatsapp: "5511999998888", income_percentile: 99 }
    })
  ]);
  const withIncome = JSON.parse(psql(database, `select public.recompute_buyer_quality_score(${quote(named)})`)).score;
  const withoutIncome = quality.scoreVisitor([
    row({
      event_id: "pg-maria",
      event_name: "property_view",
      event_time: day(0),
      visitor_id: named,
      property_id: "imovel-1"
    })
  ], named);
  assert.equal(withIncome.broker_tester_score, withoutIncome.broker_tester_score);
  const incomeText = JSON.stringify(withIncome);
  assert.equal(incomeText.includes("Maria Silva"), false);
  assert.equal(incomeText.includes("11999998888"), false);
  assert.equal(incomeText.includes("5511999998888"), false);

  psql(database, `
    select public.apply_buyer_profile_event($json$${JSON.stringify({
      event_id: "pg-touch",
      event_name: "ad_entry",
      event_time: day(0),
      visitor_id: other,
      session_id: "sessao-touch",
      gclid: "GCLID-TOUCH",
      utm_source: "google",
      utm_campaign: "campanha-atual"
    })}$json$::jsonb)
  `);
  const before = JSON.parse(psql(database, `select public.get_buyer_profile(${quote(other)})`)).profile;
  insertEvents(database, [
    row({
      event_id: "pg-touch-view",
      event_name: "property_view",
      event_time: day(1),
      visitor_id: other,
      session_id: "sessao-depois",
      property_id: "imovel-2",
      neighborhood: "Pinheiros",
      conversion_gclid: "GCLID-HERDADO"
    })
  ]);
  psql(database, `select public.recompute_buyer_quality_score(${quote(other)})`);
  const after = JSON.parse(psql(database, `select public.get_buyer_profile(${quote(other)})`)).profile;
  assert.deepEqual(after.attribution.first_touch, before.attribution.first_touch);
  assert.deepEqual(after.attribution.current_touch, before.attribution.current_touch);
  assert.equal(after.attribution.first_touch.gclid, "GCLID-TOUCH");

  const asService = psql(database, `
    begin;
    set local role service_role;
    select status from (
      select public.recompute_buyer_quality_score(${quote(visitor)}) as result
    ) call, lateral (select result->>'status' as status) parsed;
    commit;
  `);
  assert.match(asService, /ok/);

  let denied = "";
  try {
    psql(database, `
      begin;
      set local role anon;
      select public.recompute_buyer_quality_score(${quote(visitor)});
      commit;
    `);
  } catch (error) {
    denied = String(error.stderr || error.message);
  }
  assert.match(denied, /permission denied/);

  const policies = psql(database, `
    select count(*) from pg_policies where tablename = 'buyer_quality_scores'
  `);
  assert.equal(policies, "0");
  const definer = psql(database, `
    select prosecdef::text
    from pg_proc
    where proname = 'recompute_buyer_quality_score'
  `);
  assert.equal(definer, "false");
});
