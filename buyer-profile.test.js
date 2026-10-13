/*
  Estes testes aplicam supabase/buyer_profiles.sql num Postgres local
  chamado buyer_profile_test. Duas conexões psql provam a concorrência.
  Não apontam para Production.
*/

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { execFile, execFileSync } = require("node:child_process");
const buyer = require("./buyer-profile.js");

const visitor = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const bulkVisitor = "44444444-4444-4444-8444-444444444444";
const sessionVisitor = "55555555-5555-4555-8555-555555555555";

function psql(sql) {
  return new Promise((resolve, reject) => {
    execFile("psql", [
      "-d", "buyer_profile_test",
      "-v", "ON_ERROR_STOP=1",
      "-t", "-A",
      "-c", sql
    ], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(0, 1200)));
      else resolve(String(stdout || "").trim());
    });
  });
}

async function apply(event) {
  const payload = {
    visitor_id: visitor,
    session_id: "session-1",
    event_time: "2026-10-08T12:00:00.000Z",
    ...event
  };
  const raw = await psql(
    `select public.apply_buyer_profile_event($json$${JSON.stringify(payload)}$json$::jsonb)`
  );
  return JSON.parse(raw);
}

async function read(visitorId = visitor) {
  const raw = await psql(`select public.get_buyer_profile('${visitorId}')`);
  return JSON.parse(raw).profile;
}

async function reset() {
  await psql(`truncate table
    public.buyer_profile_sessions,
    public.buyer_profile_properties,
    public.buyer_profile_events,
    public.buyer_profiles`);
}

test.before(() => {
  execFileSync("psql", [
    "-d", "buyer_profile_test",
    "-v", "ON_ERROR_STOP=1",
    "-f", path.join(__dirname, "supabase/buyer_profiles.sql")
  ], { stdio: "pipe" });
});

test.beforeEach(reset);

test("duas views concorrentes levam o contador de 5 para 7", async () => {
  for (let index = 1; index <= 5; index += 1) {
    const seeded = await apply({
      event_id: `seed-${index}`,
      event_name: "property_view",
      event_time: `2026-10-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      property_id: `seed-${index}`
    });
    assert.equal(seeded.status, "applied");
  }
  const [first, second] = await Promise.all([
    apply({
      event_id: "concurrent-a",
      event_name: "property_view",
      event_time: "2026-10-08T12:00:00.000Z",
      property_id: "orulo:a"
    }),
    apply({
      event_id: "concurrent-b",
      event_name: "property_view",
      event_time: "2026-10-08T12:00:01.000Z",
      property_id: "orulo:b"
    })
  ]);
  assert.equal(first.status, "applied");
  assert.equal(second.status, "applied");
  const profile = await read();
  assert.equal(profile.behavior.total_property_views, 7);
  assert.equal(profile.behavior.unique_properties_viewed, 7);

  await Promise.all(Array.from({ length: 8 }, (_, index) => apply({
    visitor_id: other,
    event_id: `parallel-${index}`,
    event_name: "property_view",
    event_time: `2026-10-09T12:00:0${index}.000Z`,
    session_id: "parallel",
    property_id: `parallel-${index}`
  })));
  const parallel = await read(other);
  assert.equal(parallel.behavior.total_property_views, 8);
});

test("retry em outra conexão não incrementa e payload diferente é ignorado", async () => {
  const original = await apply({
    event_id: "same-event",
    event_name: "ai_search",
    intent: undefined,
    neighborhood: "Perdizes",
    bedrooms: 2,
    max_price: 900000
  });
  assert.equal(original.profile.behavior.total_ai_searches, 1);
  const retry = await apply({
    event_id: "same-event",
    event_name: "ai_search",
    neighborhood: "Moema",
    bedrooms: 4,
    max_price: 2000000,
    utm_campaign: "maria@example.com"
  });
  assert.equal(retry.status, "already_applied");
  const profile = await read();
  assert.equal(profile.behavior.total_ai_searches, 1);
  assert.deepEqual(profile.preferences.neighborhoods, ["Perdizes"]);
  assert.equal(profile.preferences.max_price, 900000);
  assert.equal(JSON.stringify(profile).includes("maria@example.com"), false);
  assert.equal(JSON.stringify(profile).includes("Moema"), false);
});

test("imóvel e sessão antigos continuam únicos depois de centenas de eventos", async () => {
  await psql(`
    do $$
    declare i integer;
    begin
      for i in 1..201 loop
        perform public.apply_buyer_profile_event(jsonb_build_object(
          'event_id', 'bulk-' || i,
          'event_name', 'property_view',
          'event_time', '2026-06-01T00:00:00Z',
          'visitor_id', '${bulkVisitor}',
          'session_id', 'bulk-session',
          'property_id', 'prop-' || i
        ));
      end loop;
      for i in 1..81 loop
        perform public.apply_buyer_profile_event(jsonb_build_object(
          'event_id', 'sess-' || i,
          'event_name', 'ad_entry',
          'event_time', '2026-07-01T00:00:00Z',
          'visitor_id', '${sessionVisitor}',
          'session_id', 'session-' || i,
          'utm_source', 'google'
        ));
      end loop;
    end $$;
  `);
  const repeatProperty = await apply({
    visitor_id: bulkVisitor,
    event_id: "bulk-repeat",
    event_name: "property_view",
    event_time: "2026-12-01T00:00:00.000Z",
    session_id: "bulk-session",
    property_id: "prop-1"
  });
  assert.equal(repeatProperty.profile.behavior.total_property_views, 202);
  assert.equal(repeatProperty.profile.behavior.unique_properties_viewed, 201);
  assert.equal(repeatProperty.profile.behavior.total_sessions, 1);

  const repeatSession = await apply({
    visitor_id: sessionVisitor,
    event_id: "sess-repeat",
    event_name: "ad_entry",
    event_time: "2026-12-01T00:00:00.000Z",
    session_id: "session-1",
    utm_source: "google"
  });
  assert.equal(repeatSession.profile.behavior.total_sessions, 81);
});

test("lead concorrente com busca ou visão permanece lead", async () => {
  const [lead, search] = await Promise.all([
    apply({
      event_id: "lead-race",
      event_name: "lead_created",
      event_time: "2026-10-08T12:00:00.000Z",
      buyer_id: "22222222-2222-4222-8222-222222222222",
      metadata: { buyer_id: "22222222-2222-4222-8222-222222222222", lead_id: "22222222-2222-4222-8222-222222222222" }
    }),
    apply({
      event_id: "search-race",
      event_name: "ai_search",
      event_time: "2026-10-08T12:00:01.000Z",
      neighborhood: "Perdizes",
      bedrooms: 2
    })
  ]);
  assert.equal(lead.status, "applied");
  assert.equal(search.status, "applied");
  assert.equal((await read()).stage, "lead");
  assert.equal((await read()).buyer_id, null);

  await reset();
  await Promise.all([
    apply({
      event_id: "lead-2",
      event_name: "lead_created",
      event_time: "2026-10-08T11:00:00.000Z"
    }),
    apply({
      event_id: "view-2",
      event_name: "property_view",
      event_time: "2026-10-08T12:00:00.000Z",
      property_id: "orulo:9",
      property_neighborhood: "Moema"
    })
  ]);
  const profile = await read();
  assert.equal(profile.stage, "lead");
  assert.equal(profile.behavior.total_leads, 1);
  assert.equal(profile.behavior.total_property_views, 1);
  assert.deepEqual(profile.preferences.neighborhoods, []);
});

test("evento antigo não regride toque, atividade, imóvel nem busca", async () => {
  await apply({
    event_id: "new-touch",
    event_name: "ad_entry",
    event_time: "2026-10-08T15:00:00.000Z",
    gclid: "ABC",
    utm_source: "google",
    utm_campaign: "campanha-x"
  });
  await apply({
    event_id: "new-search",
    event_name: "ai_search",
    event_time: "2026-10-08T16:00:00.000Z",
    neighborhood: "Pinheiros",
    bedrooms: 3,
    max_price: 1200000
  });
  await apply({
    event_id: "new-view",
    event_name: "property_view",
    event_time: "2026-10-08T17:00:00.000Z",
    property_id: "orulo:new",
    property_name: "Novo",
    property_neighborhood: "Pinheiros"
  });
  await apply({
    event_id: "old-touch",
    event_name: "ad_entry",
    event_time: "2026-10-08T10:00:00.000Z",
    session_id: "old",
    gclid: "OTHER",
    utm_source: "meta",
    utm_campaign: "antiga"
  });
  await apply({
    event_id: "old-search",
    event_name: "ai_search",
    event_time: "2026-10-08T09:00:00.000Z",
    session_id: "old",
    neighborhood: "Lapa",
    max_price: 100
  });
  await apply({
    event_id: "old-view",
    event_name: "property_view",
    event_time: "2026-10-08T08:00:00.000Z",
    session_id: "old",
    property_id: "orulo:old",
    property_name: "Antigo",
    property_neighborhood: "Lapa"
  });
  const profile = await read();
  assert.equal(profile.attribution.current_touch.gclid, "ABC");
  assert.equal(profile.attribution.current_touch.utm_campaign, "campanha-x");
  assert.equal(profile.attribution.current_touch.utm_source, "google");
  assert.equal(profile.attribution.last_gclid, "ABC");
  assert.equal(profile.behavior.last_activity_type, "property_view");
  assert.equal(profile.last_activity_at, "2026-10-08T17:00:00+00:00");
  assert.equal(profile.behavior.last_property.property_id, "orulo:new");
  assert.equal(profile.behavior.last_property.name, "Novo");
  assert.equal(profile.behavior.last_search_summary.includes("Pinheiros"), true);
  assert.equal(profile.preferences.max_price, 1200000);
  assert.equal(profile.preferences.neighborhoods.includes("Lapa"), true);
});

test("toque parcial não apaga gclid nem campanha e o primeiro toque parcial permanece", async () => {
  await apply({
    event_id: "first-medium",
    event_name: "ad_entry",
    event_time: "2026-10-08T12:00:00.000Z",
    utm_medium: "cpc"
  });
  await apply({
    event_id: "later-rich",
    event_name: "ad_entry",
    event_time: "2026-10-08T13:00:00.000Z",
    session_id: "later",
    gclid: "ABC",
    utm_source: "google",
    utm_campaign: "campanha-x"
  });
  await apply({
    event_id: "partial-current",
    event_name: "ad_entry",
    event_time: "2026-10-08T14:00:00.000Z",
    session_id: "later",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "",
    gclid: "   "
  });
  const profile = await read();
  assert.deepEqual(profile.attribution.first_touch, { utm_medium: "cpc" });
  assert.equal(profile.attribution.current_touch.gclid, "ABC");
  assert.equal(profile.attribution.current_touch.utm_campaign, "campanha-x");
  assert.equal(profile.attribution.current_touch.utm_source, "google");
  assert.equal(profile.attribution.current_touch.utm_medium, "cpc");
  assert.equal(profile.attribution.last_gclid, "ABC");
  assert.equal(profile.attribution.last_utm_campaign, "campanha-x");
});

test("atribuição com email, telefone ou WhatsApp não entra no perfil", async () => {
  const applied = await apply({
    event_id: "pii-touch",
    event_name: "ad_entry",
    gclid: "CLICK-OK",
    utm_campaign: "promo maria@example.com",
    utm_term: "11988887777",
    utm_content: "whatsapp 11999998888"
  });
  const serialized = JSON.stringify(applied.profile);
  assert.equal(serialized.includes("maria@example.com"), false);
  assert.equal(serialized.includes("11988887777"), false);
  assert.equal(serialized.includes("11999998888"), false);
  assert.equal(serialized.includes("whatsapp"), false);
  assert.equal(applied.profile.attribution.current_touch.gclid, "CLICK-OK");
  assert.equal(applied.profile.attribution.current_touch.utm_campaign, undefined);
  assert.equal(applied.profile.attribution.last_utm_campaign, "");
});

test("buyer_id público é ignorado", async () => {
  const applied = await apply({
    event_id: "lead-public",
    event_name: "lead_created",
    buyer_id: "22222222-2222-4222-8222-222222222222",
    metadata: {
      buyer_id: "22222222-2222-4222-8222-222222222222",
      lead_id: "33333333-3333-4333-8333-333333333333",
      email: "maria@example.com",
      phone: "11988887777",
      nome: "Maria"
    }
  });
  assert.equal(applied.profile.buyer_id, null);
  assert.equal(applied.profile.stage, "lead");
  const serialized = JSON.stringify(applied.profile);
  assert.equal(serialized.includes("maria@example.com"), false);
  assert.equal(serialized.includes("Maria"), false);
  assert.equal(buyer.toApplyPayload({
    event_id: "x",
    event_name: "lead_created",
    visitor_id: visitor,
    buyer_id: "22222222-2222-4222-8222-222222222222",
    metadata: { lead_id: "33333333-3333-4333-8333-333333333333", email: "maria@example.com" }
  }).buyer_id, undefined);
});

test("online fora de ordem e backfill ordenado produzem o mesmo perfil", async () => {
  const person = "66666666-6666-4666-8666-666666666666";
  const events = [
    {
      event_id: "a",
      event_name: "ad_entry",
      event_time: "2026-10-08T12:00:00.000Z",
      visitor_id: person,
      session_id: "early",
      gclid: "ABC",
      utm_source: "google",
      utm_campaign: "campanha-x",
      neighborhood: "Perdizes",
      bedrooms: 2,
      max_price: 900000,
      inventory_source: "novos"
    },
    {
      event_id: "e",
      event_name: "property_view",
      event_time: "2026-10-08T12:01:00.000Z",
      visitor_id: person,
      session_id: "early",
      property_id: "orulo:1",
      property_name: "Solar",
      property_neighborhood: "Perdizes"
    },
    {
      event_id: "b",
      event_name: "ad_entry",
      event_time: "2026-10-08T12:02:00.000Z",
      visitor_id: person,
      session_id: "late",
      utm_source: "google",
      utm_medium: "cpc"
    },
    {
      event_id: "c",
      event_name: "ai_search",
      event_time: "2026-10-08T12:03:00.000Z",
      visitor_id: person,
      session_id: "late",
      neighborhood: "Pinheiros",
      bedrooms: 3,
      min_price: 500000,
      max_price: 0
    },
    {
      event_id: "d",
      event_name: "property_view",
      event_time: "2026-10-08T12:04:00.000Z",
      visitor_id: person,
      session_id: "late",
      property_id: "orulo:2",
      property_name: "Vista",
      property_neighborhood: "Lapa"
    },
    {
      event_id: "f",
      event_name: "lead_created",
      event_time: "2026-10-08T12:05:00.000Z",
      visitor_id: person,
      session_id: "late",
      buyer_id: "22222222-2222-4222-8222-222222222222",
      metadata: { email: "maria@example.com", nome: "Maria" }
    }
  ];
  const sorted = events.slice().sort((left, right) => {
    const time = left.event_time.localeCompare(right.event_time);
    return time === 0 ? left.event_id.localeCompare(right.event_id) : time;
  });
  for (const event of sorted.slice().reverse()) {
    assert.equal((await apply(event)).status, "applied");
  }
  const online = await read(person);
  await reset();
  for (const event of sorted) {
    assert.equal((await apply(event)).status, "applied");
  }
  const backfill = await read(person);
  assert.deepEqual(online, backfill);
  assert.equal(backfill.stage, "lead");
  assert.equal(backfill.buyer_id, null);
  assert.equal(backfill.attribution.first_touch.gclid, "ABC");
  assert.equal(backfill.attribution.current_touch.utm_medium, "cpc");
  assert.equal(backfill.attribution.current_touch.gclid, "ABC");
  assert.equal(backfill.behavior.total_property_views, 2);
  assert.equal(backfill.behavior.unique_properties_viewed, 2);
  assert.equal(backfill.behavior.total_sessions, 2);
  assert.equal(backfill.preferences.max_price, 900000);
  assert.equal(backfill.preferences.min_price, 500000);
  assert.deepEqual(backfill.preferences.neighborhoods, ["Perdizes", "Pinheiros"]);
  assert.equal(JSON.stringify(backfill).includes("maria@example.com"), false);
});

test("visitor inválido e evento desconhecido não gravam", async () => {
  const missing = await apply({ event_id: "bad", event_name: "ad_entry", visitor_id: "nao-uuid" });
  assert.equal(missing.status, "rejected");
  const unknown = await apply({ event_id: "unknown", event_name: "high_intent_buyer" });
  assert.equal(unknown.status, "rejected");
  const count = await psql("select count(*) from public.buyer_profiles");
  assert.equal(count, "0");
  const ledger = await psql("select count(*) from public.buyer_profile_events");
  assert.equal(ledger, "0");
});

test("online e a linha de ads_events produzem as mesmas preferences", async () => {
  const ads = require("./ads-intelligence.js");
  const onlineVisitor = "77777777-7777-4777-8777-777777777777";
  const backfillVisitor = "88888888-8888-4888-8888-888888888888";
  const store = memoryAds();
  const recorded = await ads.recordAdsEvent({
    product: "ynteligencia",
    event_id: "evt-1",
    event_name: "ad_entry",
    event_time: "2026-10-08T12:00:00.000Z",
    visitor_id: onlineVisitor,
    session_id: "canonical",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "campanha-x",
    intent: {
      neighborhood: "Perdizes",
      city: "São Paulo",
      state: "SP",
      region: "Oeste",
      property_type: "apartamento",
      purpose: "comprar",
      max_price: 900000
    },
    metadata: {
      email: "maria@example.com",
      lead_summary: "segredo",
      transcript: "oi",
      note: "origem",
      canonical_preference: { city: "Hacker", name: "Maria" }
    }
  }, store.rest, new Date("2026-10-08T12:00:00.000Z"));
  assert.equal(recorded.status, 200);
  await ads.recordAdsEvent({
    product: "ynteligencia",
    event_id: "evt-2",
    event_name: "ai_search",
    event_time: "2026-10-08T12:05:00.000Z",
    visitor_id: onlineVisitor,
    session_id: "canonical",
    intent: {
      neighborhood: "Pinheiros",
      city: "Campinas",
      state: "SP",
      region: "Leste",
      propertyType: "casa",
      finality: "investir",
      min_price: 500000
    }
  }, store.rest, new Date("2026-10-08T12:05:00.000Z"));
  await ads.recordAdsEvent({
    product: "ynteligencia",
    event_id: "evt-3",
    event_name: "ai_search",
    event_time: "2026-10-08T12:06:00.000Z",
    visitor_id: onlineVisitor,
    session_id: "canonical",
    intent: {
      city: '{"name":"Maria","lead_summary":"segredo"}',
      purpose: '{"transcript":"oi"}'
    }
  }, store.rest, new Date("2026-10-08T12:06:00.000Z"));

  const profileEvents = store.events.filter(row => buyer.PROFILE_EVENTS.has(row.event_name));
  assert.equal(profileEvents.length, 3);
  assert.deepEqual(store.events[0].metadata.canonical_preference, {
    city: "São Paulo",
    state: "SP",
    region: "Oeste",
    property_type: "apartamento",
    purpose: "comprar"
  });
  assert.equal(store.events[0].metadata.note, "origem");
  assert.equal(store.events[0].metadata.email, undefined);
  assert.equal(store.events[0].preference, undefined);
  assert.equal(store.events[0].intent, undefined);
  assert.equal(JSON.stringify(store.events[0]).includes("maria@example.com"), false);
  assert.equal(JSON.stringify(store.events[0]).includes("Hacker"), false);
  assert.equal(store.events[2].metadata.canonical_preference, undefined);
  assert.equal(JSON.stringify(store.events[2]).includes("Maria"), false);

  for (const row of profileEvents) {
    const onlinePayload = store.rpcCalls.find(call => call.event_id === row.event_id);
    const reconstructed = buyer.toApplyPayload(JSON.parse(JSON.stringify(row)));
    assert.deepEqual(onlinePayload, reconstructed);
  }

  for (const payload of store.rpcCalls) {
    assert.equal((await apply({ ...payload, visitor_id: onlineVisitor })).status, "applied");
  }
  const online = await read(onlineVisitor);
  await reset();
  const reconstructed = profileEvents
    .map(row => buyer.toApplyPayload(JSON.parse(JSON.stringify(row))))
    .sort((left, right) => {
      const time = String(left.event_time).localeCompare(String(right.event_time));
      return time === 0 ? String(left.event_id).localeCompare(String(right.event_id)) : time;
    })
    .reverse();
  for (const payload of reconstructed) {
    assert.equal((await apply({ ...payload, visitor_id: backfillVisitor })).status, "applied");
  }
  const backfill = await read(backfillVisitor);
  assert.deepEqual(online.preferences, backfill.preferences);
  assert.equal(online.preferences.city, "Campinas");
  assert.equal(online.preferences.state, "SP");
  assert.equal(online.preferences.purpose, "investir");
  assert.equal(online.preferences.min_price, 500000);
  assert.equal(online.preferences.max_price, 900000);
  assert.deepEqual(online.preferences.regions, ["Leste", "Oeste"]);
  assert.deepEqual(online.preferences.neighborhoods, ["Perdizes", "Pinheiros"]);
  assert.deepEqual(online.preferences.property_types, ["apartamento", "casa"]);
  assert.equal(JSON.stringify(online.preferences).includes("Maria"), false);
});

test("troca de imóvel não herda nome nem bairro", async () => {
  async function project(visitorId, events) {
    for (const event of events) {
      const applied = await apply({
        visitor_id: visitorId,
        event_name: "property_view",
        session_id: "imovel",
        ...event,
        event_id: `${visitorId.slice(-4)}-${event.event_id}`
      });
      assert.equal(applied.status, "applied");
    }
    return (await read(visitorId)).behavior.last_property;
  }

  const complete = {
    event_id: "evt-a",
    event_time: "2026-10-08T12:00:00.000Z",
    property_id: "A",
    property_name: "Astorga",
    property_neighborhood: "Perdizes"
  };
  const incomplete = {
    event_id: "evt-b",
    event_time: "2026-10-08T12:01:00.000Z",
    property_id: "B",
    property_name: null,
    property_neighborhood: null
  };
  const expectedB = { property_id: "B", name: null, neighborhood: null };
  const expectedA = { property_id: "A", name: "Astorga", neighborhood: "Perdizes" };
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111111", [complete, incomplete]), expectedB);
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111112", [incomplete, complete]), expectedB);

  const earlyIncomplete = { ...incomplete, event_time: "2026-10-08T11:00:00.000Z" };
  const laterComplete = { ...complete, event_time: "2026-10-08T12:02:00.000Z" };
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111113", [earlyIncomplete, laterComplete]), expectedA);
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111114", [laterComplete, earlyIncomplete]), expectedA);

  const tiedComplete = { ...complete, event_id: "evt-a", event_time: "2026-10-08T12:03:00.000Z" };
  const tiedIncomplete = { ...incomplete, event_id: "evt-z", event_time: "2026-10-08T12:03:00.000Z" };
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111115", [tiedComplete, tiedIncomplete]), expectedB);
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111116", [tiedIncomplete, tiedComplete]), expectedB);

  const tiedWinner = { ...complete, event_id: "evt-z", event_time: "2026-10-08T12:04:00.000Z" };
  const tiedLoser = { ...incomplete, event_id: "evt-m", event_time: "2026-10-08T12:04:00.000Z" };
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111117", [tiedLoser, tiedWinner]), expectedA);
  assert.deepEqual(await project("12111111-1111-4111-8111-111111111118", [tiedWinner, tiedLoser]), expectedA);

  assert.deepEqual(await project("12111111-1111-4111-8111-111111111119", [
    complete,
    {
      event_id: "evt-same",
      event_time: "2026-10-08T12:05:00.000Z",
      property_id: "A",
      property_name: "",
      property_neighborhood: "   "
    }
  ]), expectedA);
});

test("atribuição rejeita JSON, lead e sentinelas sem apagar toque válido", async () => {
  await apply({
    event_id: "touch-valid",
    event_name: "ad_entry",
    gclid: "CLICK-OK",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "campanha-x"
  });
  await apply({
    event_id: "touch-json",
    event_name: "ad_entry",
    event_time: "2026-10-08T13:00:00.000Z",
    gclid: '{"name":"Maria"}',
    gbraid: '{"lead_summary":"quer comprar"}',
    wbraid: '{"transcript":"oi, quero visitar"}',
    utm_source: "whatsapp",
    utm_medium: '["phone","11999998888"]',
    utm_campaign: "lead_summary: segredo\ntranscript: oi",
    utm_term: "maria@example.com",
    utm_content: "11988887777"
  });
  await apply({
    event_id: "touch-more-json",
    event_name: "ad_entry",
    event_time: "2026-10-08T13:01:00.000Z",
    gclid: "C".repeat(250),
    gbraid: '{"message":"oi"}',
    wbraid: '{"messages":["oi"]}',
    utm_source: '{\\"name\\":\\"Maria\\"}',
    utm_term: '{"conversation":"oi"}',
    utm_content: '{"contact":"11999998888"}'
  });
  const profile = await read();
  const touch = profile.attribution.current_touch;
  assert.equal(touch.gclid, "CLICK-OK");
  assert.equal(touch.utm_source, "google");
  assert.equal(touch.utm_medium, "cpc");
  assert.equal(touch.utm_campaign, "campanha-x");
  assert.equal(touch.gbraid, undefined);
  assert.equal(touch.wbraid, undefined);
  assert.equal(touch.utm_term, undefined);
  assert.equal(touch.utm_content, undefined);
  assert.equal(profile.attribution.last_gclid, "CLICK-OK");
  assert.equal(profile.attribution.last_utm_campaign, "campanha-x");
  const serialized = JSON.stringify(profile);
  assert.equal(serialized.includes("Maria"), false);
  assert.equal(serialized.includes("lead_summary"), false);
  assert.equal(serialized.includes("transcript"), false);
  assert.equal(serialized.includes("maria@example.com"), false);
  assert.equal(serialized.includes("11988887777"), false);
  assert.equal(serialized.includes("11999998888"), false);
  assert.equal(serialized.includes("whatsapp"), false);
  assert.equal(serialized.includes("conversation"), false);

  const medium = "13111111-1111-4111-8111-111111111111";
  await apply({
    visitor_id: medium,
    event_id: "medium-email",
    event_name: "ad_entry",
    utm_medium: "email",
    utm_source: "newsletter",
    utm_campaign: "campanha-x",
    gclid: "CLICK-OK"
  });
  const kept = await read(medium);
  assert.equal(kept.attribution.current_touch.utm_medium, "email");
  assert.equal(kept.attribution.current_touch.gclid, "CLICK-OK");
  assert.equal(kept.attribution.current_touch.utm_campaign, "campanha-x");
});

test("zero e sentinelas não substituem gclid nem campanha", async () => {
  await apply({
    event_id: "touch-abc",
    event_name: "ad_entry",
    gclid: "ABC",
    utm_campaign: "campanha-x",
    utm_source: "google"
  });
  await apply({
    event_id: "touch-zero",
    event_name: "ad_entry",
    event_time: "2026-10-08T14:00:00.000Z",
    gclid: 0,
    utm_campaign: "0",
    utm_source: false,
    utm_medium: "null",
    utm_term: "undefined",
    utm_content: "   ",
    gbraid: "0",
    wbraid: 0
  });
  const profile = await read();
  assert.equal(profile.attribution.current_touch.gclid, "ABC");
  assert.equal(profile.attribution.current_touch.utm_campaign, "campanha-x");
  assert.equal(profile.attribution.current_touch.utm_source, "google");
  assert.equal(profile.attribution.current_touch.utm_medium, undefined);
  assert.equal(profile.attribution.current_touch.utm_term, undefined);
  assert.equal(profile.attribution.last_gclid, "ABC");
  assert.equal(profile.attribution.last_utm_campaign, "campanha-x");
});

function memoryAds() {
  const events = [];
  const visitors = [];
  const rpcCalls = [];
  const rest = async (requestPath, options = {}) => {
    const method = options.method || "GET";
    const [table, query = ""] = requestPath.split("?");
    const params = new URLSearchParams(query);
    const decode = value => value ? decodeURIComponent(value.replace(/^eq\./, "")) : "";
    if (method === "POST" && table === "ads_events") {
      events.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "POST" && table === "ads_visitors") {
      visitors.push({ ...options.body });
      return { ok: true, status: 201, data: null };
    }
    if (method === "PATCH" && table === "ads_visitors") {
      const id = decode(params.get("visitor_id"));
      const row = visitors.find(item => item.visitor_id === id);
      Object.assign(row, options.body);
      return { ok: true, status: 204, data: null };
    }
    if (method === "GET" && table === "ads_events") {
      let rows = events.slice();
      const visitorId = decode(params.get("visitor_id"));
      const sessionId = decode(params.get("session_id"));
      const name = decode(params.get("event_name"));
      if (visitorId) rows = rows.filter(row => row.visitor_id === visitorId);
      if (sessionId) rows = rows.filter(row => row.session_id === sessionId);
      if (name) rows = rows.filter(row => row.event_name === name);
      const descending = String(params.get("order") || "").endsWith("desc");
      rows.sort((left, right) => descending
        ? String(right.event_time).localeCompare(String(left.event_time))
        : String(left.event_time).localeCompare(String(right.event_time)));
      rows = rows.slice(0, Number(params.get("limit")) || rows.length);
      const select = params.get("select");
      if (select && select !== "*") {
        rows = rows.map(row => Object.fromEntries(select.split(",").map(key => [key, row[key]])));
      }
      return { ok: true, status: 200, data: rows };
    }
    if (method === "GET" && table === "ads_visitors") {
      const id = decode(params.get("visitor_id"));
      return { ok: true, status: 200, data: visitors.filter(row => row.visitor_id === id) };
    }
    if (method === "POST" && table === "rpc/apply_buyer_profile_event") {
      rpcCalls.push(options.body && options.body.p_event);
      return { ok: true, status: 200, data: { status: "applied" } };
    }
    return { ok: false, status: 404, data: null };
  };
  return { events, visitors, rpcCalls, rest };
}

test("a projeção não cria function nova em /api e o backfill usa a RPC", () => {
  const files = fs.readdirSync(path.join(__dirname, "api")).filter(name => name.endsWith(".js"));
  assert.equal(files.length, 12);
  const script = fs.readFileSync(path.join(__dirname, "scripts/backfill-buyer-profiles.js"), "utf8");
  assert.equal(script.includes("rpc/apply_buyer_profile_event"), true);
  assert.equal(script.includes("toApplyPayload"), true);
  assert.equal(script.includes("stage ="), false);
});
