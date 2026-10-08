const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadHtmlHelpers() {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const display = html.match(/function aiDisplayPrice\(value\)\{[\s\S]*?\n\}/);
  const select = html.match(/function aiSelectableSearchCards\(assistantProperties, searchMatches\)\{[\s\S]*?\n\}/);
  assert.ok(display);
  assert.ok(select);
  const money = value => `R$ ${value}`;
  const aiDisplayPrice = new Function(
    "money",
    `${display[0]}\nreturn aiDisplayPrice;`
  )(money);
  const aiSelectableSearchCards = new Function(
    `${select[0]}\nreturn aiSelectableSearchCards;`
  )();
  return { html, aiDisplayPrice, aiSelectableSearchCards };
}

test("preço zero não vira R$ 0 na apresentação", () => {
  const { aiDisplayPrice } = loadHtmlHelpers();
  for (const value of [0, 0.1, null, undefined, "0", "", "0.0"]) {
    assert.equal(aiDisplayPrice(value), "Preço sob consulta");
  }
  assert.equal(aiDisplayPrice(799000), "R$ 799000");
});

test("cards só usam imóveis do resultado real e limitam a cinco", () => {
  const { aiSelectableSearchCards } = loadHtmlHelpers();
  const matches = [1, 2, 3, 4, 5, 6].map(n => ({
    id: `p${n}`,
    name: `Imóvel ${n}`,
    source: n % 2 ? "novos" : "usados",
    value: n === 2 ? 0 : 500000
  }));
  const assistant = [
    { id: "inventado", name: "Não existe", source: "novos" },
    { name: "Sem id", source: "usados" },
    ...matches
  ];
  const selected = aiSelectableSearchCards(assistant, matches);
  assert.deepEqual(selected.cards.map(item => item.id), ["p1", "p2", "p3", "p4", "p5"]);
  assert.equal(selected.cards[1].value, 0);
  assert.deepEqual(selected.skipped.map(item => item.property_id), ["inventado", ""]);
  assert.equal(selected.skipped[0].nome, "Não existe");
  assert.equal(selected.skipped[0].origem, "novos");
});

test("a interface reutiliza showPhotoModal e não abre link externo", () => {
  const { html } = loadHtmlHelpers();
  assert.match(html, /function openAiInventoryDetails\(property\)/);
  assert.match(html, /showPhotoModal\(String\(registered\.id\)\)/);
  assert.match(html, /registerAiFoundProperty\(known\)/);
  assert.match(html, /button\.textContent="Ver detalhes"/);
  const cardStart = html.indexOf("function appendAiPropertyCards");
  const cardEnd = html.indexOf("let aiResumeChatAfterDetail", cardStart);
  const cards = html.slice(cardStart, cardEnd);
  assert.equal(cards.includes("window.open"), false);
  assert.equal(cards.includes("orulo.com.br"), false);
  assert.match(html, /aiResumeChatAfterDetail/);
});

test("a assistente devolve no máximo cinco imóveis reais e não anuncia o total bruto", async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key";
  const { default: handler } = await import("./api/assistant.js");
  const matches = Array.from({ length: 8 }, (_, index) => ({
    id: `ext-${index + 1}`,
    building_id: `b-${index + 1}`,
    name: `Empreendimento ${index + 1}`,
    neighborhood: "Perdizes",
    city: "São Paulo",
    value: index === 0 ? 0 : 640000 + index,
    bedrooms: 2,
    area: 48,
    source: index % 2 ? "usados" : "novos"
  }));

  const payload = await new Promise((resolve, reject) => {
    const res = {
      setHeader() {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve(body);
      }
    };
    Promise.resolve(handler({
      method: "POST",
      body: {
        message: "perdizes",
        mode: "search",
        history: [],
        property: {},
        inventory: {
          inventory_ready: true,
          recognized_filters: true,
          total: 200,
          query: { neighborhood: "Perdizes", bedrooms: 0 },
          matches
        }
      }
    }, res)).catch(reject);
  });

  assert.equal(payload.success, true);
  assert.equal(payload.reply.includes("200"), false);
  assert.equal(payload.reply.includes("Encontrei várias opções em Perdizes"), true);
  assert.equal(payload.properties.length, 5);
  assert.deepEqual(
    payload.properties.map(item => item.id),
    matches.slice(0, 5).map(item => item.id)
  );
  assert.equal(payload.properties[0].property_id, payload.properties[0].id);
  assert.equal(payload.properties[0].value, 0);
  assert.equal(payload.properties[0].source, "novos");
  assert.equal(payload.properties[1].source, "usados");
});
