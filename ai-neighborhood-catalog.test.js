const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("./ai-neighborhood-catalog.js");
const routing = require("./ai-search-routing.js");

const names = [
  "perdizes",
  "brooklin",
  "brooklin paulista",
  "butanta",
  "butantã",
  "saude",
  "saúde",
  "belem",
  "belém",
  "tatuape",
  "tatuapé",
  "chacara klabin",
  "chácara klabin",
  "santana",
  "pompeia",
  "pompéia",
  "pinheiros",
  "alto de pinheiros",
  "lapa",
  "alto da lapa",
  "vila mariana",
  "moema"
];

function kept(input, fixtures, bedrooms) {
  const resolved = catalog.resolveNeighborhood(input);
  return fixtures.filter(property =>
    catalog.propertyMatchesNeighborhood(property, resolved)
    && (bedrooms == null || property.bedrooms === bedrooms)
  );
}

test("Perdizes continua exato e não leva Jardim das Perdizes", () => {
  const resolved = catalog.resolveNeighborhood("Perdizes");
  assert.equal(resolved.canonical_name, "Perdizes");
  assert.equal(resolved.mode, "exact");
  assert.deepEqual(resolved.search_names, ["Perdizes"]);
  assert.equal(resolved.city, "São Paulo");
  assert.equal(resolved.state, "SP");

  const fixtures = [
    { neighborhood: "Perdizes", city: "São Paulo", state: "SP", bedrooms: 2 },
    { neighborhood: "Perdizes", city: "São Paulo", state: "SP", bedrooms: 3 },
    { neighborhood: "Jardim das Perdizes", city: "São Paulo", state: "SP", bedrooms: 2 }
  ];

  const all = kept("Perdizes", fixtures);
  assert.equal(all.length, 2);
  assert.equal(kept("Perdizes", fixtures, 2).length, 1);
  assert.equal(kept("perdizes", fixtures, 2)[0].bedrooms, 2);

  const plan = routing.aiInventoryQueryPlan("tem Perdizes 2 dorms", names, []);
  assert.equal(plan.neighborhood, "Perdizes");
  assert.equal(plan.neighborhoodMode, "exact");
  assert.equal(plan.bedrooms, 2);
  assert.deepEqual(plan.neighborhoods, ["Perdizes"]);
  assert.equal(plan.city, "São Paulo");
  assert.equal(plan.state, "SP");
});

test("Brooklin é família e Brooklin Paulista continua exato", () => {
  const family = catalog.resolveNeighborhood("Brooklin");
  assert.equal(family.mode, "family");
  assert.deepEqual(family.family_members, [
    "Brooklin",
    "Brooklin Paulista",
    "Brooklin Novo"
  ]);
  assert.deepEqual(family.search_names, family.family_members);

  const filters = catalog.postgrestNeighborhoodFilters(family);
  assert.equal(filters.neighborhood, undefined);
  assert.equal(filters.or.includes("*"), false);
  assert.equal(filters.or.includes("Brooklin Paulista"), true);
  assert.equal(filters.or.includes("Brooklin Novo"), true);
  assert.equal(filters.city, "eq.São Paulo");
  assert.equal(filters.state, "eq.SP");
  assert.equal(filters.or.includes('"'), false);

  const exact = catalog.resolveNeighborhood("Brooklin Paulista");
  assert.equal(exact.mode, "exact");
  assert.deepEqual(exact.search_names, ["Brooklin Paulista"]);
  assert.equal(exact.canonical_name, "Brooklin Paulista");

  const fixtures = [
    { neighborhood: "Brooklin", city: "São Paulo", state: "SP" },
    { neighborhood: "Brooklin Paulista", city: "São Paulo", state: "SP" },
    { neighborhood: "Brooklin Novo", city: "São Paulo", state: "SP" },
    { neighborhood: "Brooklin Velho", city: "São Paulo", state: "SP" }
  ];

  assert.equal(kept("Brooklin", fixtures).length, 3);
  assert.deepEqual(
    kept("Brooklin Paulista", fixtures).map(row => row.neighborhood),
    ["Brooklin Paulista"]
  );

  const plan = routing.aiInventoryQueryPlan("tem Brooklin", names, []);
  assert.equal(plan.neighborhoodMode, "family");
  assert.equal(plan.city, "São Paulo");
  const paulista = routing.aiInventoryQueryPlan("Brooklin Paulista", names, []);
  assert.equal(paulista.neighborhoodMode, "exact");
  assert.deepEqual(paulista.neighborhoods, ["Brooklin Paulista"]);
});

test("alias de acento usa a grafia gravada no banco", () => {
  const cases = [
    ["Butanta", "Butantã", "Butantã"],
    ["Butantã", "Butantã", "Butantã"],
    ["Saude", "Saúde", "Saúde"],
    ["Saúde", "Saúde", "Saúde"],
    ["Belem", "Belém", "Belém"],
    ["Belém", "Belém", "Belém"],
    ["Tatuape", "Tatuapé", "Tatuapé"],
    ["Tatuapé", "Tatuapé", "Tatuapé"],
    ["Chacara Klabin", "Chácara Klabin", "Chácara Klabin"],
    ["Chácara Klabin", "Chácara Klabin", "Chácara Klabin"],
    ["Pompeia", "Pompeia", "Pompeia"],
    ["Pompéia", "Pompeia", "Pompeia"]
  ];

  for (const [input, canonical, stored] of cases) {
    const resolved = catalog.resolveNeighborhood(input);
    assert.equal(resolved.mode, "exact", input);
    assert.equal(resolved.canonical_name, canonical, input);
    assert.equal(resolved.city, "São Paulo", input);
    assert.equal(resolved.state, "SP", input);
    assert.equal(
      resolved.search_names.some(name => name === stored || name === canonical),
      true,
      input
    );

    const matched = kept(input, [
      { neighborhood: stored, city: "São Paulo", state: "SP" },
      { neighborhood: "Jardim das Perdizes", city: "São Paulo", state: "SP" }
    ]);
    assert.equal(matched.length, 1, input);
    assert.equal(matched[0].neighborhood, stored, input);
  }

  const butanta = catalog.postgrestNeighborhoodFilters(
    catalog.resolveNeighborhood("butanta")
  );
  assert.equal(butanta.or.includes("neighborhood.ilike.Butantã"), true);
  assert.equal(butanta.or.includes("*"), false);
  assert.equal(butanta.or.includes('"'), false);

  const saude = catalog.postgrestNeighborhoodFilters(
    catalog.resolveNeighborhood("saude")
  );
  assert.equal(saude.or.includes("neighborhood.ilike.Saúde"), true);

  const belem = catalog.resolveNeighborhood("belem");
  const belemRows = kept("Belem", [
    { neighborhood: "Belém", city: "São Paulo", state: "SP" },
    { neighborhood: "Belém Novo", city: "Porto Alegre", state: "RS" },
    { neighborhood: "Belém Velho", city: "Porto Alegre", state: "RS" }
  ]);
  assert.deepEqual(belemRows.map(row => row.neighborhood), ["Belém"]);
  assert.equal(belem.mode, "exact");
});

test("Santana fica em São Paulo e não traz Porto Alegre", () => {
  const resolved = catalog.resolveNeighborhood("Santana");
  assert.equal(resolved.canonical_name, "Santana");
  assert.equal(resolved.mode, "exact");
  assert.equal(resolved.city, "São Paulo");
  assert.equal(resolved.state, "SP");

  const filters = catalog.postgrestNeighborhoodFilters(resolved);
  assert.equal(filters.neighborhood, "ilike.Santana");
  assert.equal(filters.city, "eq.São Paulo");
  assert.equal(filters.state, "eq.SP");

  const matched = kept("Santana", [
    { neighborhood: "Santana", city: "São Paulo", state: "SP" },
    { neighborhood: "Santana", city: "Porto Alegre", state: "RS" },
    { neighborhood: "Santana", city: "São Paulo", state: "RJ" }
  ]);

  assert.equal(matched.length, 1);
  assert.equal(matched[0].city, "São Paulo");
  assert.equal(matched[0].state, "SP");
});

test("nomes parecidos não viram família", () => {
  assert.deepEqual(catalog.resolveNeighborhood("Pinheiros").search_names, ["Pinheiros"]);
  assert.deepEqual(
    catalog.resolveNeighborhood("Alto de Pinheiros").search_names,
    ["Alto de Pinheiros"]
  );
  assert.deepEqual(catalog.resolveNeighborhood("Lapa").search_names, ["Lapa"]);
  assert.deepEqual(
    catalog.resolveNeighborhood("Alto da Lapa").search_names,
    ["Alto da Lapa"]
  );
  assert.deepEqual(
    catalog.resolveNeighborhood("Vila Mariana").search_names,
    ["Vila Mariana"]
  );
  assert.deepEqual(catalog.resolveNeighborhood("Moema").search_names, ["Moema"]);

  const pinheiros = kept("Pinheiros", [
    { neighborhood: "Pinheiros", city: "São Paulo", state: "SP" },
    { neighborhood: "Alto de Pinheiros", city: "São Paulo", state: "SP" }
  ]);
  assert.deepEqual(pinheiros.map(row => row.neighborhood), ["Pinheiros"]);
});

test("index e a API usam o catálogo em vez da primeira grafia do REGION_MAP", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const api = fs.readFileSync(path.join(__dirname, "api/search-properties.js"), "utf8");

  assert.match(html, /src="ai-neighborhood-catalog\.js"/);
  assert.match(html, /neighborhoodScope\.canonical_name/);
  assert.match(html, /city: neighborhoodScope/);
  assert.match(html, /state: neighborhoodScope/);
  assert.match(api, /resolveNeighborhood\(/);
  assert.match(api, /postgrestNeighborhoodFilters\(/);
  assert.match(api, /propertyMatchesNeighborhood\(/);
  assert.match(api, /import neighborhoodCatalog from "\.\.\/ai-neighborhood-catalog\.js"/);
  assert.equal(api.includes("createRequire"), false);
  assert.equal(api.includes("import.meta.url"), false);
  assert.equal(api.includes("params.set(\"city\", filters.city)"), true);
  assert.equal(api.includes("params.set(\"state\", filters.state)"), true);
});

test("search-properties carrega e o GET chega no handler", async () => {
  const mod = await import("./api/search-properties.js");
  assert.equal(typeof mod.default, "function");

  let status = 0;
  let body = null;
  const res = {
    setHeader() {},
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return payload;
    }
  };

  await mod.default({ method: "GET", body: {} }, res);
  assert.equal(status, 405);
  assert.equal(body.success, false);
  assert.equal(body.error, "Method not allowed");
});

test("erro HTTP vira texto e falha técnica não abre handoff", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const helper = html.match(/function aiApiErrorText\(error, fallback\)\{[\s\S]*?\n\}/);
  assert.ok(helper, "aiApiErrorText precisa estar no index");
  const aiApiErrorText = new Function(`${helper[0]}; return aiApiErrorText;`)();

  assert.equal(aiApiErrorText("SUPABASE_URL não configurada", "fallback"), "SUPABASE_URL não configurada");
  assert.equal(
    aiApiErrorText({ code: "500", message: "A server error has occurred" }, "fallback"),
    "A server error has occurred"
  );
  assert.equal(aiApiErrorText({ code: "500" }, "Não foi possível consultar o estoque agora."), "Não foi possível consultar o estoque agora.");

  const marker = "Não consegui consultar os imóveis agora. Tente novamente em alguns instantes.";
  const markerAt = html.indexOf(marker);
  assert.ok(markerAt > 0);
  const catchStart = html.lastIndexOf("}catch(error){", markerAt);
  const catchBlock = html.slice(catchStart, html.indexOf("}finally{", markerAt));
  assert.match(catchBlock, /Não consegui consultar os imóveis agora\. Tente novamente em alguns instantes\./);
  assert.equal(catchBlock.includes("aiSetHumanHandoffVisible"), false);
  assert.match(catchBlock, /console\.error\(\s*"MATCH_IA_ERROR"/);
  assert.equal(catchBlock.includes("Falar com Rafael"), false);

  let handoffVisible = false;
  let commercial = { handled: false, showHandoff: false };
  let shown = "";
  const data = { error: { code: "500", message: "A server error has occurred" } };
  try {
    if (data?.success !== true) {
      throw new Error(aiApiErrorText(data?.error, "Não foi possível consultar o estoque agora."));
    }
  } catch (error) {
    shown = "Não consegui consultar os imóveis agora. Tente novamente em alguns instantes.";
    console.error("MATCH_IA_ERROR", error.message);
  }
  assert.equal(shown, "Não consegui consultar os imóveis agora. Tente novamente em alguns instantes.");
  assert.equal(handoffVisible, false);
  assert.equal(commercial.showHandoff, false);
});
