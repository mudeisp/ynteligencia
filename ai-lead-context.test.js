const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadHelpers() {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const narrative = html.match(/function aiBuildLeadNarrative\(facts\)\{[\s\S]*?\n\}/);
  const select = html.match(/function aiSelectLeadProperty\(fallback, opened\)\{[\s\S]*?\n\}/);
  const synthetic = html.match(/function aiSyntheticPropertyId\(id\)\{[\s\S]*?\n\}/);
  assert.ok(narrative && select && synthetic);
  const aiSyntheticPropertyId = new Function(`${synthetic[0]}; return aiSyntheticPropertyId;`)();
  const aiSelectLeadProperty = new Function(
    "aiSyntheticPropertyId",
    `${select[0]}; return aiSelectLeadProperty;`
  )(aiSyntheticPropertyId);
  const aiBuildLeadNarrative = new Function(`${narrative[0]}; return aiBuildLeadNarrative;`)();
  return { html, aiBuildLeadNarrative, aiSelectLeadProperty };
}

test("resumo usa só fatos da busca e dos imóveis abertos", () => {
  const { aiBuildLeadNarrative } = loadHelpers();
  const summary = aiBuildLeadNarrative({
    neighborhood: "Perdizes",
    development: "",
    maxPriceLabel: "R$ 900.000",
    minPriceLabel: "",
    bedrooms: 2,
    opened: [
      { id: "orulo:1", name: "Marka Perdizes" },
      { id: "orulo:2", name: "Marka Perdizes" }
    ],
    askedContact: true
  });

  assert.equal(
    summary,
    "Cliente busca imóvel em Perdizes, até R$ 900.000, 2 dormitórios. Demonstrou interesse no Marka Perdizes e abriu 2 unidades no modal. Pediu contato com especialista."
  );
  assert.equal(summary.includes("200 opções"), false);
});

test("property_id principal é o imóvel do CTA e os outros ficam de fora desse campo", () => {
  const { aiSelectLeadProperty } = loadHelpers();
  const opened = [
    { id: "nonstop:usado", name: "Usado" },
    { id: "orulo:novo", name: "Novo" }
  ];
  const fromModal = aiSelectLeadProperty({ id: "orulo:novo", name: "Novo" }, opened);
  assert.equal(fromModal.primary.id, "orulo:novo");
  assert.deepEqual(fromModal.others.map(item => item.id), ["nonstop:usado"]);

  const fromChat = aiSelectLeadProperty({ id: "match-ia-orulo", name: "Busca" }, opened);
  assert.equal(fromChat.primary.id, "orulo:novo");
  assert.deepEqual(fromChat.others.map(item => item.id), ["nonstop:usado"]);
});

test("o formulário reutiliza /api/lead, sessão e visitante existentes", () => {
  const { html } = loadHelpers();
  assert.match(html, /fetch\(\s*"\/api\/lead"/);
  assert.match(html, /session_id:\s*YNTELIGENCIA_SESSION_ID/);
  assert.match(html, /visitor_id:\s*YNTELIGENCIA_VISITOR_ID/);
  assert.match(html, /ai_lead_submitted/);
  assert.match(html, /ai_lead_success/);
  assert.match(html, /ai_lead_error/);
  assert.match(html, /window\.location\.href=\s*whatsappUrl/);
  const submit = html.indexOf('fetch(\n              "/api/lead"');
  const persisted = html.indexOf("if(!leadPersisted)", submit);
  const whatsapp = html.indexOf("window.location.href=", submit);
  const failure = html.indexOf("Não foi possível enviar agora", submit);
  const guard = html.indexOf('dataset.sending="true"');
  assert.ok(guard > 0 && guard < submit);
  assert.ok(submit > 0 && persisted > submit && whatsapp > persisted && failure > whatsapp);
});

test("api/lead grava o resumo no Supabase e na observação do Praedium", async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : null
    });
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ ok: true })
    };
  };

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.PRAEDIUM_WEBHOOK_URL = "https://praedium.test/hook";
  delete process.env.RESEND_API_KEY;
  delete process.env.META_CAPI_TOKEN;

  const { default: handler } = await import(`./api/lead.js?test=${Date.now()}`);
  const summary = "Cliente busca imóvel em Perdizes, até R$ 900.000, 2 dormitórios. Pediu contato com especialista.";
  const payload = await new Promise((resolve, reject) => {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve(body); },
      end() { resolve({ statusCode: this.statusCode }); }
    };
    Promise.resolve(handler({
      method: "POST",
      headers: { origin: "https://app.yincorp.com.br" },
      body: {
        nome: "Ana Teste",
        telefone: "11999999999",
        email: "ana@example.com",
        property_id: "orulo:76171:118181",
        property_name: "Marka Perdizes",
        neighborhood: "Perdizes",
        property_value: 799000,
        bedrooms: 2,
        inventory_source: "novos",
        session_id: "session-atual",
        visitor_id: "11111111-1111-4111-8111-111111111111",
        gclid: "gclid-teste",
        lead_summary: summary,
        ai_context: {
          search: { neighborhood: "Perdizes", max_price: 900000, bedrooms: 2 },
          opened: [{ id: "orulo:76171:118181" }],
          message_count: 4
        }
      }
    }, res)).catch(reject);
  });

  global.fetch = original;
  const praedium = calls.find(call => call.url.includes("praedium.test"));
  const supabase = calls.find(call => call.url.includes("/rest/v1/leads"));

  assert.equal(payload.success, true);
  assert.equal(payload.praedium, false);
  assert.equal(payload.supabase, true);
  assert.equal(praedium, undefined);
  assert.equal(supabase.body.notes, summary);
  assert.equal(supabase.body.session_id, "session-atual");
  assert.equal(supabase.body.metadata.lead_summary, summary);
  assert.equal(supabase.body.metadata.visitor_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(supabase.body.metadata.ai_context.search.neighborhood, "Perdizes");
  assert.equal(supabase.body.metadata.property.id, "orulo:76171:118181");
  assert.equal(supabase.body.metadata.attribution.gclid, "gclid-teste");
});

test("falha do armazenamento não confirma o lead", async () => {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => "falhou",
    json: async () => ({ ok: false })
  });
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.PRAEDIUM_WEBHOOK_URL = "https://praedium.test/hook";
  delete process.env.META_CAPI_TOKEN;
  delete process.env.RESEND_API_KEY;

  const { default: handler } = await import(`./api/lead.js?fail=${Date.now()}`);
  const payload = await new Promise((resolve, reject) => {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve(body); }
    };
    Promise.resolve(handler({
      method: "POST",
      headers: { origin: "https://app.yincorp.com.br" },
      body: {
        nome: "Ana Teste",
        telefone: "11999999999",
        lead_summary: "Resumo"
      }
    }, res)).catch(reject);
  });

  global.fetch = original;
  assert.equal(payload.success, false);
  assert.equal(payload.praedium, false);
  assert.equal(payload.supabase, false);
  assert.equal(payload.email_sent, false);
  assert.equal(payload.email_status, "missing_api_key");
});

async function postLead(body, headers = {}) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : null
    });
    const failEmail = String(url).includes("api.resend.com") && body.__failEmail;
    const failSupabase = String(url).includes("/rest/v1/leads") && body.__failSupabase;
    if (failEmail || failSupabase) {
      return { ok: false, status: 500, text: async () => "falhou", json: async () => ({}) };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => ({ id: "email" }) };
  };
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.PRAEDIUM_WEBHOOK_URL = "https://praedium.test/hook";
  process.env.RESEND_API_KEY = "re_test_key_not_secret";
  delete process.env.META_CAPI_TOKEN;
  const { default: handler } = await import(`./api/lead.js?case=${Date.now()}-${Math.random()}`);
  const payload = await new Promise((resolve, reject) => {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(value) { resolve(value); }
    };
    const requestBody = { ...body };
    delete requestBody.__failEmail;
    delete requestBody.__failSupabase;
    Promise.resolve(handler({
      method: "POST",
      headers: { origin: "https://app.yincorp.com.br", ...headers },
      body: requestBody
    }, res)).catch(reject);
  });
  global.fetch = original;
  return { payload, calls };
}

test("valor 0.1 permanece bruto e o e-mail mostra valor sob consulta", async () => {
  const { payload, calls } = await postLead({
    nome: "TESTE YNTELIGENCIA V2",
    telefone: "11900000000",
    email: "teste.ynteligencia.v2@yincorp.com.br",
    origem: "ynteligencia",
    property_id: "orulo:76171:118182",
    property_name: "Rooftop Perdizes",
    neighborhood: "Perdizes",
    property_value: 0.1,
    bedrooms: 2,
    inventory_source: "novos",
    mensagem: "Imóvel: Rooftop Perdizes | Valor: 0.1 | MATCH: 0%",
    lead_summary: "Cliente busca lançamento em Perdizes.",
    ai_context: { search: { neighborhood: "Perdizes", bedrooms: 2 }, opened: [] }
  });
  const email = calls.find(call => call.url.includes("api.resend.com"));
  const supabase = calls.find(call => call.url.includes("/rest/v1/leads"));
  assert.equal(payload.success, true);
  assert.equal(payload.email_sent, true);
  assert.equal(payload.praedium, false);
  assert.equal(supabase.body.metadata.property.value, 0.1);
  assert.match(email.body.html, /Valor sob consulta/);
  assert.equal(email.body.html.includes("0.1"), false);
  assert.equal(email.body.html.includes("R$ 0"), false);
  assert.match(email.body.subject, /Novo lead Match IA — Perdizes/);
  assert.equal(email.body.from, "Ynteligencia <leads@yincorp.com.br>");
  assert.deepEqual(email.body.to, ["contato.yincorp@gmail.com"]);
});

test("preço real usa o formato BRL do projeto", async () => {
  const { calls } = await postLead({
    nome: "Ana",
    telefone: "11999999999",
    origem: "ynteligencia",
    property_value: 500000,
    property_name: "Today Pompéia",
    mensagem: "Valor: 500000"
  });
  const email = calls.find(call => call.url.includes("api.resend.com"));
  assert.match(email.body.html, /R\$\s*500\.000/);
  assert.match(email.body.html, /Valor sob consulta|R\$\s*500\.000/);
});

test("landing page continua enviando ao Praedium", async () => {
  const { payload, calls } = await postLead({
    nome: "LP",
    telefone: "11988887777",
    origem: "landing_pinheiros",
    property_name: "Empreendimento LP"
  });
  assert.equal(payload.success, true);
  assert.equal(payload.praedium, true);
  assert.equal(calls.some(call => call.url.includes("praedium.test")), true);
});

test("supabase gravado e resend com falha ainda é sucesso da V2", async () => {
  const { payload } = await postLead({
    nome: "Ana",
    telefone: "11999999999",
    origem: "ynteligencia",
    __failEmail: true
  });
  assert.equal(payload.success, true);
  assert.equal(payload.supabase, true);
  assert.equal(payload.email_sent, false);
  assert.equal(payload.email_status, "provider_rejected");
});

test("resend ok sem supabase não é captura segura", async () => {
  const { payload } = await postLead({
    nome: "Ana",
    telefone: "11999999999",
    origem: "ynteligencia",
    __failSupabase: true
  });
  assert.equal(payload.success, true);
  assert.equal(payload.supabase, false);
  assert.equal(payload.email_sent, true);
  assert.equal(payload.praedium, false);
});

test("supabase e resend com falha recusam o lead da V2", async () => {
  const { payload } = await postLead({
    nome: "Ana",
    telefone: "11999999999",
    origem: "ynteligencia",
    __failSupabase: true,
    __failEmail: true
  });
  assert.equal(payload.success, false);
  assert.equal(payload.supabase, false);
  assert.equal(payload.email_sent, false);
  assert.equal(payload.email_status, "provider_rejected");
  assert.equal(payload.praedium, false);
});

test("e-mail separa a origem da busca da origem do imóvel", async () => {
  const { calls } = await postLead({
    nome: "Ana",
    telefone: "11999999999",
    origem: "ynteligencia",
    neighborhood: "Perdizes",
    property_name: "Today Pompéia",
    property_id: "nonstop:1",
    property_value: 500000,
    inventory_source: "usados",
    ai_context: {
      search: {
        neighborhood: "Perdizes",
        development: "",
        min_price: 0,
        max_price: 800000,
        bedrooms: 2,
        inventory: "usados"
      },
      opened: [
        { id: "nonstop:2", name: "Outro", value: 0.1, neighborhood: "Perdizes", bedrooms: 1, source: "novos" }
      ]
    }
  });
  const email = calls.find(call => call.url.includes("api.resend.com"));
  assert.match(email.body.html, /Outros imóveis abertos/);
  assert.match(email.body.html, /Valor sob consulta/);
  assert.match(email.body.html, /R\$\s*500\.000/);
  assert.equal(email.body.html.includes("0.1"), false);
  assert.equal(email.body.html.includes("{"), false);
});

test("origens do lead", async () => {
  async function statusFor(origin) {
    delete process.env.RESEND_API_KEY;
    const { default: handler } = await import(`./api/lead.js?origin=${Date.now()}-${Math.random()}`);
    return new Promise((resolve, reject) => {
      const res = {
        setHeader() {},
        status(code) { this.statusCode = code; return this; },
        json(body) { resolve({ code: this.statusCode, body }); }
      };
      Promise.resolve(handler({
        method: "POST",
        headers: { origin },
        body: { nome: "x" }
      }, res)).catch(reject);
    });
  }

  process.env.VERCEL_URL = "ynteligencia-git-cursor-ai-lead-context-e302-rafael-8f11.vercel.app";
  process.env.VERCEL_BRANCH_URL = "ynteligencia-git-cursor-ai-lead-context-e302-rafael-8f11.vercel.app";
  const app = await statusFor("https://app.yincorp.com.br");
  const preview = await statusFor("https://ynteligencia-git-cursor-ai-lead-context-e302-rafael-8f11.vercel.app");
  const random = await statusFor("https://exemplo.com");
  const other = await statusFor("https://outro-projeto.vercel.app");
  assert.equal(app.code, 400);
  assert.equal(preview.code, 400);
  assert.equal(random.code, 403);
  assert.equal(other.code, 403);
});
