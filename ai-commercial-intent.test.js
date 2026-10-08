const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const commercial = require("./ai-commercial-intent.js");

const property = {
  hasProperty: true,
  resultCount: 1,
  propertyName: "Well"
};

const noResults = {
  hasProperty: false,
  resultCount: 0,
  propertyName: ""
};

const multiple = {
  hasProperty: false,
  resultCount: 4,
  propertyName: ""
};

const single = {
  hasProperty: true,
  resultCount: 1,
  propertyName: "Well"
};

const contexts = {
  property,
  noResults,
  multiple,
  single
};

const phrases = [
  ["quero visitar", "visit"],
  ["quero visitar amanhã", "visit"],
  ["quero agendar uma visita", "schedule"],
  ["agendar uma visita", "schedule"],
  ["tem disponibilidade?", "availability"],
  ["quero negociar", "negotiation"],
  ["consigo desconto?", "discount"],
  ["consegue desconto?", "discount"],
  ["quero falar com alguém", "human"],
  ["quero falar com o Rafael", "human"],
  ["falar com o Rafael", "human"],
  ["pode me chamar no WhatsApp?", "whatsapp"],
  ["quero esse imóvel", "interest"],
  ["tenho interesse", "interest"],
  ["como faço para comprar?", "purchase"]
];

function expectsHandoff(intent, contextName) {
  if (
    intent === "human" ||
    intent === "whatsapp" ||
    intent === "visit" ||
    intent === "schedule" ||
    intent === "negotiation" ||
    intent === "discount"
  ) {
    return true;
  }

  if (intent === "availability") {
    return contextName !== "multiple";
  }

  return contextName === "property" || contextName === "single";
}

function assertSafeReply(reply) {
  const text = commercial.aiCommercialNormalize(reply);
  const forbidden = [
    /\bencaminhei\b/,
    /\bencaminhado\b/,
    /\bencaminho\b/,
    /\bavisei\b/,
    /\bregistrei\b/,
    /\benviei\b/,
    /\benviad[oa]\b/,
    /\bpassei\b/,
    /\bvisita foi agendada\b/,
    /\bvisita agendada\b/,
    /\bsolicitacao foi enviada\b/,
    /\bsolicitacao enviada\b/,
    /\bpedido enviado\b/,
    /\b(?:vou|irei) (?:encaminhar|enviar|passar)\b/
  ];

  for (const pattern of forbidden) {
    assert.equal(pattern.test(text), false, reply);
  }
}

test("matriz da auditoria resolve intenção comercial sem estoque, lead ou OpenAI", () => {
  for (const [message, intent] of phrases) {
    for (const [contextName, context] of Object.entries(contexts)) {
      const turn = commercial.aiResolveCommercialTurn(message, context);
      const handoff = expectsHandoff(intent, contextName);

      assert.equal(turn.handled, true, `${message} / ${contextName}`);
      assert.equal(turn.intent, intent, `${message} / ${contextName}`);
      assert.equal(turn.shouldSearchInventory, false, `${message} / ${contextName}`);
      assert.equal(turn.shouldCallOpenAI, false, `${message} / ${contextName}`);
      assert.equal(turn.shouldOpenLead, false, `${message} / ${contextName}`);
      assert.equal(turn.showHandoff, handoff, `${message} / ${contextName}`);
      assert.equal(turn.needsPropertyChoice, !handoff, `${message} / ${contextName}`);
      assert.ok(turn.reply, `${message} / ${contextName}`);
      assertSafeReply(turn.reply);

      if (handoff) {
        assert.match(turn.reply, /Posso encaminhar/);
        assert.match(turn.reply, /Toque em Falar com Rafael/);
      } else {
        assert.match(turn.reply, /Diga qual/);
        assert.doesNotMatch(turn.reply, /Toque em Falar com Rafael/);
      }
    }
  }
});

test("frases comerciais resolvíveis não pedem /api/search-properties", () => {
  for (const [message] of phrases) {
    for (const context of Object.values(contexts)) {
      const turn = commercial.aiResolveCommercialTurn(message, context);
      assert.equal(turn.handled, true);
      assert.equal(turn.shouldSearchInventory, false);
      assert.equal(turn.searchEndpoint || null, null);
    }
  }
});

test("busca e follow-up comuns continuam fora da intenção comercial", () => {
  for (const message of [
    "tem imóvel em Moema",
    "me mostra outros",
    "qual o preço?",
    "até 900 mil",
    "quero comparar com outro"
  ]) {
    const turn = commercial.aiResolveCommercialTurn(message, noResults);
    assert.equal(turn.handled, false, message);
    assert.equal(turn.showHandoff, false, message);
    assert.equal(turn.shouldOpenLead, false, message);
  }
});

test("aiSanitizeHandoffPromise bloqueia confirmação antecipada e preserva a oferta", () => {
  const blocked = [
    "Já encaminhei para o Rafael.",
    "Encaminhei sua visita.",
    "Avisei o Rafael.",
    "Registrei seu pedido.",
    "Enviei sua solicitação.",
    "Passei para o corretor.",
    "Sua visita foi agendada.",
    "Sua solicitação foi enviada.",
    "Vou encaminhar para o Rafael.",
    "Irei enviar sua solicitação.",
    "Pedido enviado ao Rafael."
  ];

  for (const message of blocked) {
    const safe = commercial.aiSanitizeHandoffPromise(message);
    assert.equal(safe, commercial.SAFE_HANDOFF_REPLY);
    assertSafeReply(safe);
  }

  const offer = commercial.SAFE_HANDOFF_REPLY;
  assert.equal(commercial.aiSanitizeHandoffPromise(offer), offer);
});

test("index.html decide a intenção comercial antes da busca e esconde o handoff", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const start = html.indexOf("async function sendAiAssistantMessage");
  const end = html.indexOf("function yntIsPaidDirectPropertyEntry");
  const body = html.slice(start, end);

  const commercialAt = body.indexOf("aiResolveCommercialTurn");
  const searchAt = body.indexOf("searchPropertiesForAi(");
  const assistantAt = body.indexOf('"/api/assistant"');

  assert.ok(commercialAt > 0);
  assert.ok(searchAt > commercialAt);
  assert.ok(assistantAt > commercialAt);
  assert.match(html, /src="ai-commercial-intent\.js"/);
  assert.match(html, /AiCommercialIntent\.aiResolveCommercialTurn\(/);
  assert.match(html, /AiCommercialIntent\.aiSanitizeHandoffPromise\(/);
  assert.match(html, /function aiSetHumanHandoffVisible\(/);
  assert.match(html, /\.ai-human-handoff\{display:none/);
  assert.match(html, /\.ai-human-handoff\.is-visible,\.ai-human-handoff\.visible\{display:block\}/);
  assert.match(html, /id="aiHumanHandoff"[^>]*hidden/);
  assert.match(html, /Pedido enviado ao Rafael\./);
  assert.doesNotMatch(html, /Dados confirmados\. Abrindo o WhatsApp/);
  assert.doesNotMatch(body, /eu encaminho sua solicitação/);
  assert.doesNotMatch(
    html.slice(html.indexOf("function openHomeAiSearch"), html.indexOf("function openAiAssistant")),
    /classList\.add\("visible"\)/
  );
});
