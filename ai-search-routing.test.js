const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const routing = require("./ai-search-routing.js");

function loadNeighborhoods() {
  const html = fs.readFileSync(
    path.join(__dirname, "index.html"),
    "utf8"
  );
  const match = html.match(/const REGION_MAP=(\{[\s\S]*?\n\});/);
  assert.ok(match, "REGION_MAP precisa existir em index.html");
  const regionMap = eval(`(${match[1]})`);
  return [
    ...new Set(Object.values(regionMap).flat()),
    "Brooklin Paulista",
    "Brooklin Novo"
  ];
}

const names = loadNeighborhoods();
const norm = routing.aiNormalizeText;

const moema = {
  region: "",
  neighborhood: "Moema",
  exactName: "",
  bedrooms: 3,
  minPrice: 0,
  maxPrice: 1500000
};

const empty = {
  region: "",
  neighborhood: "",
  exactName: "",
  bedrooms: 0,
  minPrice: 0,
  maxPrice: 0
};

function place(state) {
  return norm(state.neighborhood);
}

function apply(message, context = moema) {
  return routing.aiNextSearchState(context, message, names);
}

test("bairro canônico ignora substring e preposição", () => {
  assert.equal(norm(routing.aiCanonicalNeighborhood("no Brooklin", names)), "brooklin");
  assert.equal(norm(routing.aiCanonicalNeighborhood("agora 2 dorms no Brooklin", names)), "brooklin");
  assert.equal(norm(routing.aiCanonicalNeighborhood("na Vila Mariana", names)), "vila mariana");
  assert.equal(norm(routing.aiCanonicalNeighborhood("em Perdizes", names)), "perdizes");
  assert.equal(norm(routing.aiCanonicalNeighborhood("tem lançamentos em Perdizes?", names)), "perdizes");
  assert.equal(norm(routing.aiCanonicalNeighborhood("tem alguma coisa em Santana?", names)), "santana");
  assert.equal(norm(routing.aiCanonicalNeighborhood("tem algo em Belém?", names)), "belem");
  assert.equal(norm(routing.aiCanonicalNeighborhood("tem em Anália Franco?", names)), "analia franco");
  assert.equal(norm(routing.aiCanonicalNeighborhood("agora quero Brooklin", names)), "brooklin");
  assert.equal(
    norm(routing.aiCanonicalNeighborhood("Brooklin Paulista", names)),
    "brooklin paulista"
  );
  assert.equal(routing.aiCanonicalNeighborhood("2 dorms", names), "");
  assert.equal(routing.aiCanonicalNeighborhood("até 900 mil", names), "");
  assert.equal(routing.aiCanonicalNeighborhood("me mostra outros", names), "");
});

test("matriz de roteamento com contexto Moema, 3 dormitórios e teto de 1,5 milhão", () => {
  const rows = [
    {
      phrase: "agora quero Brooklin",
      kind: "reset",
      neighborhood: "brooklin",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "tem lançamentos em Perdizes?",
      kind: "reset",
      neighborhood: "perdizes",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "no Brooklin",
      kind: "reset",
      neighborhood: "brooklin",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "em Perdizes",
      kind: "reset",
      neighborhood: "perdizes",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "quero outro bairro",
      kind: "reset",
      neighborhood: "",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "2 dorms",
      kind: "refine",
      neighborhood: "moema",
      bedrooms: 2,
      maxPrice: 1500000
    },
    {
      phrase: "até 900 mil",
      kind: "refine",
      neighborhood: "moema",
      bedrooms: 3,
      maxPrice: 900000
    },
    {
      phrase: "agora 2 dorms no Brooklin",
      kind: "reset",
      neighborhood: "brooklin",
      bedrooms: 2,
      maxPrice: 0
    },
    {
      phrase: "tem Well em Perdizes?",
      kind: "reset",
      neighborhood: "perdizes",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "quero comparar com outro",
      kind: "alternatives",
      neighborhood: "moema",
      bedrooms: 3,
      maxPrice: 1500000,
      realComparison: false,
      preservePropertyForComparison: true
    },
    {
      phrase: "tem alguma coisa em Santana?",
      kind: "reset",
      neighborhood: "santana",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "tem algo em Belém?",
      kind: "reset",
      neighborhood: "belem",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "tem em Anália Franco?",
      kind: "reset",
      neighborhood: "analia franco",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "na Vila Mariana",
      kind: "reset",
      neighborhood: "vila mariana",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "me mostra outros",
      kind: "alternatives",
      neighborhood: "moema",
      bedrooms: 3,
      maxPrice: 1500000
    },
    {
      phrase: "nova busca",
      kind: "reset",
      neighborhood: "",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "zona oeste",
      kind: "reset",
      region: "oeste",
      neighborhood: "",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "agora busca",
      kind: "reset",
      neighborhood: "",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "vocês tem",
      kind: "refine",
      neighborhood: "moema",
      bedrooms: 3,
      maxPrice: 1500000,
      keepQueryText: false
    },
    {
      phrase: "qual o preço em Brooklin",
      kind: "reset",
      neighborhood: "brooklin",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "qual o preço no Brooklin",
      kind: "reset",
      neighborhood: "brooklin",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "mais opções no Brooklin",
      kind: "alternatives",
      neighborhood: "brooklin",
      bedrooms: 3,
      maxPrice: 1500000
    },
    {
      phrase: "em Vila Mariana",
      kind: "reset",
      neighborhood: "vila mariana",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "Brooklin Paulista",
      kind: "reset",
      neighborhood: "brooklin paulista",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "Pinheiros 3 dormitórios até 2 milhões",
      kind: "reset",
      neighborhood: "pinheiros",
      bedrooms: 3,
      maxPrice: 2000000
    },
    {
      phrase: "tem imóvel em Moema",
      kind: "refine",
      reason: "same_place",
      neighborhood: "moema",
      bedrooms: 3,
      maxPrice: 1500000,
      keepQueryText: false
    },
    {
      phrase: "procurar em Tatuapé",
      kind: "reset",
      neighborhood: "tatuape",
      bedrooms: 0,
      maxPrice: 0
    },
    {
      phrase: "o link",
      kind: "follow_up",
      neighborhood: "moema",
      bedrooms: 3,
      maxPrice: 1500000
    },
    {
      phrase: "quero outro",
      kind: "alternatives",
      neighborhood: "moema",
      bedrooms: 3,
      maxPrice: 1500000
    },
    {
      phrase: "me mostra outro no Brooklin",
      kind: "alternatives",
      neighborhood: "brooklin",
      bedrooms: 3,
      maxPrice: 1500000
    }
  ];

  assert.ok(rows.length >= 25);

  for (const row of rows) {
    const applied = apply(row.phrase);
    assert.equal(applied.turn.kind, row.kind, row.phrase);
    assert.equal(place(applied.state), row.neighborhood, row.phrase);
    assert.equal(applied.state.bedrooms, row.bedrooms, row.phrase);
    assert.equal(applied.state.maxPrice, row.maxPrice, row.phrase);
    if (row.region) {
      assert.equal(applied.state.region, row.region, row.phrase);
    }
    if (row.reason) {
      assert.equal(applied.turn.reason, row.reason, row.phrase);
    }
    if (row.keepQueryText === false) {
      assert.equal(applied.turn.keepQueryText, false, row.phrase);
    }
    if (row.realComparison === false) {
      assert.equal(applied.turn.realComparison, false, row.phrase);
    }
    if (row.preservePropertyForComparison === true) {
      assert.equal(applied.turn.preservePropertyForComparison, true, row.phrase);
    }
    assert.equal(applied.turn.isNewSearch, row.kind === "reset", row.phrase);
  }
});

test("tem imóvel no mesmo bairro refina e em outro bairro zera", () => {
  const same = apply("tem imóvel em Moema");
  assert.equal(same.turn.kind, "refine");
  assert.equal(same.turn.reason, "same_place");
  assert.equal(place(same.state), "moema");
  assert.equal(same.state.bedrooms, 3);
  assert.equal(same.state.maxPrice, 1500000);

  const other = apply("tem imóvel em Pinheiros");
  assert.equal(other.turn.kind, "reset");
  assert.equal(other.turn.reason, "new_place");
  assert.equal(place(other.state), "pinheiros");
  assert.equal(other.state.bedrooms, 0);
  assert.equal(other.state.maxPrice, 0);
});

test("vocês tem e você tem sem contexto ficam vagos e não pesquisam", () => {
  for (const phrase of ["vocês tem", "você tem", "voces tem"]) {
    const applied = apply(phrase, empty);
    assert.equal(applied.turn.kind, "vague", phrase);
    assert.equal(applied.turn.keepQueryText, false, phrase);
    assert.equal(applied.turn.isNewSearch, false, phrase);
    assert.deepEqual(
      {
        region: applied.state.region,
        neighborhood: applied.state.neighborhood,
        exactName: applied.state.exactName,
        bedrooms: applied.state.bedrooms,
        minPrice: applied.state.minPrice,
        maxPrice: applied.state.maxPrice
      },
      empty,
      phrase
    );
  }
});

test("vocês tem com contexto mantém o filtro ativo", () => {
  const applied = apply("você tem", moema);
  assert.equal(applied.turn.kind, "refine");
  assert.equal(applied.turn.keepQueryText, false);
  assert.equal(place(applied.state), "moema");
  assert.equal(applied.state.bedrooms, 3);
  assert.equal(applied.state.maxPrice, 1500000);
});

test("comparar com outro não é comparação real e não apaga o bairro ativo", () => {
  const applied = apply("quero comparar com outro");
  assert.equal(applied.turn.kind, "alternatives");
  assert.equal(applied.turn.realComparison, false);
  assert.equal(applied.turn.preservePropertyForComparison, true);
  assert.equal(place(applied.state), "moema");
  assert.equal(applied.state.exactName, "");
});

test("plural outros entra em alternativas", () => {
  assert.equal(routing.aiIsRequestForAlternatives("me mostra outros"), true);
  assert.equal(routing.aiIsRequestForAlternatives("me mostra outro"), true);
  assert.equal(
    routing.aiClassifySearchTurn("me mostra outros", moema, names).kind,
    "alternatives"
  );
  assert.equal(
    routing.aiIsRequestForAlternatives("quero outro bairro"),
    false
  );
});

test("comparar X com Y classifica os dois lados e não vira desambiguação", () => {
  const projects = ["Well"];

  function sides(phrase) {
    const turn = routing.aiClassifySearchTurn(phrase, moema, names, projects);
    return {
      kind: turn.kind,
      realComparison: turn.realComparison,
      comparisonType: turn.comparisonType,
      left: {
        name: norm(turn.compare_left?.name),
        type: turn.compare_left?.type
      },
      right: {
        name: norm(turn.compare_right?.name),
        type: turn.compare_right?.type
      },
      ambiguity: routing.aiDetectProjectNeighborhoodAmbiguity(phrase, names)
    };
  }

  for (const phrase of [
    "comparar Brooklin com Perdizes",
    "comparar Brooklin com perdizes",
    "compare Brooklin com Perdizes",
    "Brooklin vs Perdizes",
    "Brooklin versus Perdizes"
  ]) {
    const found = sides(phrase);
    assert.equal(found.kind, "comparison", phrase);
    assert.equal(found.realComparison, false, phrase);
    assert.equal(found.comparisonType, "neighborhoods", phrase);
    assert.deepEqual(found.left, { name: "brooklin", type: "neighborhood" }, phrase);
    assert.deepEqual(found.right, { name: "perdizes", type: "neighborhood" }, phrase);
    assert.equal(found.ambiguity, null, phrase);

    const applied = apply(phrase);
    assert.equal(place(applied.state), "moema", phrase);
    assert.equal(applied.state.bedrooms, 3, phrase);
    assert.equal(applied.state.maxPrice, 1500000, phrase);
  }

  const wellRight = sides("comparar Well com Perdizes");
  assert.equal(wellRight.kind, "comparison");
  assert.equal(wellRight.realComparison, false);
  assert.equal(wellRight.comparisonType, "mixed");
  assert.deepEqual(wellRight.left, { name: "well", type: "project" });
  assert.deepEqual(wellRight.right, { name: "perdizes", type: "neighborhood" });
  assert.equal(wellRight.ambiguity, null);

  const wellLeft = sides("comparar Perdizes com Well");
  assert.equal(wellLeft.kind, "comparison");
  assert.equal(wellLeft.realComparison, false);
  assert.equal(wellLeft.comparisonType, "mixed");
  assert.deepEqual(wellLeft.left, { name: "perdizes", type: "neighborhood" });
  assert.deepEqual(wellLeft.right, { name: "well", type: "project" });
  assert.equal(wellLeft.ambiguity, null);
});

test("tem Well em Perdizes continua ambíguo e Brooklin isolado segue a regra atual", () => {
  const ambiguity = routing.aiDetectProjectNeighborhoodAmbiguity(
    "tem Well em Perdizes?",
    names,
    ["Well"]
  );
  assert.ok(ambiguity);
  assert.equal(norm(ambiguity.neighborhood), "perdizes");
  assert.equal(norm(ambiguity.project), "well");
  assert.equal(
    routing.aiDetectProjectNeighborhoodAmbiguity(
      "tem Well em Perdizes?",
      names,
      []
    ),
    null
  );
  assert.equal(
    routing.aiExtractComparison("tem Well em Perdizes?", names, ["Well"]),
    null
  );
  assert.notEqual(
    routing.aiClassifySearchTurn("tem Well em Perdizes?", moema, names, ["Well"]).kind,
    "comparison"
  );

  const alone = apply("Brooklin");
  assert.equal(alone.turn.kind, "reset");
  assert.equal(place(alone.state), "brooklin");
  assert.equal(alone.turn.compare_left, null);
  assert.equal(alone.turn.realComparison, false);
  assert.equal(
    routing.aiDetectProjectNeighborhoodAmbiguity("Brooklin", names),
    null
  );
});

test("index.html delega aos canônicos e não usa mais substring de bairro", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "index.html"),
    "utf8"
  );

  assert.match(html, /src="ai-search-routing\.js"/);
  assert.match(html, /function aiClassifySearchTurn\(/);
  assert.match(html, /function aiCanonicalNeighborhood\(/);
  assert.match(html, /AiSearchRouting\.aiClassifySearchTurn\(/);
  assert.match(html, /AiSearchRouting\.aiCanonicalNeighborhood\(/);
  assert.match(html, /AiSearchRouting\.aiNextSearchState\(/);
  assert.match(html, /AiSearchRouting\.aiMatchKnownProject\(/);
  assert.match(html, /AiSearchRouting\.aiNeighborhoodScope\(/);
  assert.match(html, /neighborhoodMode:/);
  assert.match(html, /preservePropertyForComparison/);
  assert.match(html, /Não é comparação real/);
  assert.doesNotMatch(html, /key\.includes\(mt\)/);
  assert.doesNotMatch(html, /em pompeia\|em vila\|em moema/);
  assert.doesNotMatch(html, /brooklin paulista",\s*"brooklin"/);
});

function includesName(list, expected) {
  return list.some(name => norm(name) === expected);
}

test("matriz de bairro, dormitório e empreendimento conhecido", () => {
  const projects = ["Well"];

  function plan(phrase) {
    return routing.aiInventoryQueryPlan(phrase, names, projects);
  }

  const neighborhoodQueries = [
    "tem Perdizes?",
    "Perdizes?",
    "tem Brooklin?",
    "tem Brooklin",
    "Brooklin",
    "imóveis no Brooklin",
    "apartamento em Brooklin",
    "tem lançamento em Perdizes?",
    "tem Moema?",
    "quero Perdizes",
    "2 dorms no Brooklin",
    "tem 3 dormitórios no Brooklin?"
  ];

  for (const phrase of neighborhoodQueries) {
    const result = plan(phrase);
    assert.equal(result.query, "", phrase);
    assert.equal(result.project, "", phrase);
    assert.equal(result.ambiguity, null, phrase);
    assert.ok(result.neighborhood, phrase);
    for (const token of routing.aiQueryTokens(phrase)) {
      assert.equal(token.includes("?"), false, phrase);
    }
  }

  assert.equal(norm(plan("tem Perdizes?").neighborhood), "perdizes");
  assert.equal(plan("tem Perdizes?").neighborhoodMode, "exact");
  assert.equal(norm(plan("quero Perdizes").neighborhood), "perdizes");
  assert.equal(norm(plan("tem Moema?").neighborhood), "moema");

  const brooklin = plan("tem Brooklin?");
  assert.equal(norm(brooklin.neighborhood), "brooklin");
  assert.equal(brooklin.neighborhoodMode, "family");
  assert.equal(includesName(brooklin.neighborhoods, "brooklin"), true);
  assert.equal(includesName(brooklin.neighborhoods, "brooklin paulista"), true);
  assert.equal(includesName(brooklin.neighborhoods, "brooklin novo"), true);
  assert.equal(plan("tem Brooklin").neighborhoodMode, "family");
  assert.equal(plan("Brooklin").neighborhoodMode, "family");

  for (const phrase of ["Brooklin Paulista", "no Brooklin Paulista", "brooklin paulista 2 dorms"]) {
    const result = plan(phrase);
    assert.equal(norm(result.neighborhood), "brooklin paulista", phrase);
    assert.equal(result.neighborhoodMode, "exact", phrase);
    assert.equal(result.query, "", phrase);
    assert.equal(result.ambiguity, null, phrase);
    assert.deepEqual(result.neighborhoods.map(norm), ["brooklin paulista"]);
  }

  const novo = plan("Brooklin Novo");
  assert.equal(norm(novo.neighborhood), "brooklin novo");
  assert.equal(novo.neighborhoodMode, "exact");
  assert.deepEqual(novo.neighborhoods.map(norm), ["brooklin novo"]);

  assert.equal(plan("tem Brooklin dois dorms").bedrooms, 2);
  assert.equal(plan("tem Brooklin dois dorms").ambiguity, null);
  assert.equal(plan("dois dormitórios em Perdizes").bedrooms, 2);
  assert.equal(norm(plan("dois dormitórios em Perdizes").neighborhood), "perdizes");
  assert.equal(plan("quatro quartos em Perdizes").bedrooms, 4);
  assert.equal(plan("2 dorms no Brooklin").bedrooms, 2);
  assert.equal(plan("brooklin paulista 2 dorms").bedrooms, 2);
  assert.equal(plan("tem 3 dormitórios no Brooklin?").bedrooms, 3);

  assert.equal(
    routing.aiDetectProjectNeighborhoodAmbiguity(
      "tem Brooklin dois dorms",
      names,
      ["Dois Dorms", "Well"]
    ),
    null
  );
  assert.equal(
    routing.aiDetectProjectNeighborhoodAmbiguity(
      "dois dormitórios em Perdizes",
      names,
      ["Dois Dormitorios"]
    ),
    null
  );

  const wellPlace = plan("tem Well em Perdizes?");
  assert.ok(wellPlace.ambiguity);
  assert.equal(norm(wellPlace.ambiguity.project), "well");
  assert.equal(norm(wellPlace.ambiguity.neighborhood), "perdizes");

  const wellOnly = plan("tem o Well?");
  assert.equal(wellOnly.ambiguity, null);
  assert.equal(norm(wellOnly.project), "well");
  assert.equal(wellOnly.query, "");
  assert.equal(wellOnly.neighborhood, "");

  const wellMissing = routing.aiInventoryQueryPlan("tem o Well?", names, []);
  assert.equal(wellMissing.project, "");
  assert.equal(wellMissing.ambiguity, null);

  for (const phrase of ["perdizes?", "brooklin?", "moema?"]) {
    assert.equal(
      routing.aiQueryTokens(`tem ${phrase}`).some(token => token.includes("?")),
      false
    );
  }

  const compare = routing.aiClassifySearchTurn(
    "comparar Brooklin com Perdizes",
    {},
    names,
    projects
  );
  assert.equal(compare.kind, "comparison");
  assert.equal(compare.realComparison, false);
  assert.equal(
    routing.aiDetectProjectNeighborhoodAmbiguity(
      "comparar Brooklin com Perdizes",
      names,
      projects
    ),
    null
  );

  const versus = routing.aiClassifySearchTurn(
    "Brooklin vs Perdizes",
    {},
    names,
    projects
  );
  assert.equal(versus.kind, "comparison");
  assert.equal(versus.realComparison, false);

  const another = routing.aiClassifySearchTurn(
    "comparar Brooklin com outro",
    moema,
    names,
    projects
  );
  assert.equal(another.kind, "alternatives");
  assert.equal(another.realComparison, false);
  assert.equal(another.preservePropertyForComparison, true);
  assert.equal(
    routing.aiDetectProjectNeighborhoodAmbiguity(
      "comparar Brooklin com outro",
      names,
      projects
    ),
    null
  );

  const api = fs.readFileSync(
    path.join(__dirname, "api/search-properties.js"),
    "utf8"
  );
  const tokensStart = api.indexOf("function queryTokens");
  const tokensBody = api.slice(tokensStart, api.indexOf("function rawOf"));
  assert.equal(tokensBody.includes('.replace(/[?!.,;:()'), true);
  assert.equal(tokensBody.includes('token.includes("?")'), true);
  assert.equal(api.includes('neighborhoodMode === "family"'), true);
  assert.equal(api.includes("key.startsWith(`${familyRoot} `)"), true);
});

test("nome de empreendimento vem antes do bairro que faz parte do nome", () => {
  const projects = [
    "Marka Perdizes",
    "Marka Cantídio",
    "Marka Curuçá",
    "Marka Tucuruvi",
    "Marka Unik",
    "Marka Vila Ré",
    "Well Perdizes - NR",
    "Well Perdizes - Residencial",
    "Well Home",
    "Rooftop Perdizes - Breve Lançamento",
    "Upper Brooklin",
    "Nurban Venâncio - Residencial - Breve Lançamento",
    "Welconx Pinheiros - Residencial",
    "Welconx Perdizes"
  ];

  function route(phrase) {
    return routing.aiNextSearchState({}, phrase, names, projects);
  }

  const marka = route("Marka Perdizes");
  assert.equal(marka.turn.reason, "known_project");
  assert.equal(marka.state.exactName, "Marka Perdizes");
  assert.equal(marka.state.neighborhood, "");

  const markaPrice = route("Marka Perdizes até 900 mil");
  assert.equal(markaPrice.state.exactName, "Marka Perdizes");
  assert.equal(markaPrice.state.neighborhood, "");
  assert.equal(markaPrice.state.maxPrice, 900000);

  const well = route("Well Perdizes");
  assert.equal(well.state.exactName, "Well Perdizes");
  assert.equal(well.state.neighborhood, "");

  const rooftop = route("Rooftop Perdizes");
  assert.equal(rooftop.state.exactName, "Rooftop Perdizes");
  assert.equal(rooftop.state.neighborhood, "");

  const upper = route("Upper Brooklin");
  assert.equal(upper.state.exactName, "Upper Brooklin");
  assert.equal(upper.state.neighborhood, "");

  const nurban = route("Nurban Venâncio");
  assert.equal(nurban.state.exactName, "Nurban Venâncio");

  const welconx = route("Welconx Pinheiros");
  assert.equal(welconx.state.exactName, "Welconx Pinheiros");
  assert.equal(welconx.state.neighborhood, "");

  const short = route("Marka");
  assert.equal(short.turn.kind, "project_options");
  assert.equal(short.state.exactName, "");
  assert.equal(short.state.neighborhood, "");
  assert.equal(short.turn.projectOptions.includes("Marka Perdizes"), true);
  assert.equal(short.turn.projectOptions.includes("Marka Cantídio"), true);
  assert.equal(new Set(short.turn.projectOptions).size, short.turn.projectOptions.length);

  const perdizes = route("Perdizes");
  assert.equal(perdizes.state.neighborhood, "Perdizes");
  assert.equal(perdizes.state.exactName, "");

  const dorms = route("Perdizes 2 dormitórios");
  assert.equal(dorms.state.neighborhood, "Perdizes");
  assert.equal(dorms.state.exactName, "");
  assert.equal(dorms.state.bedrooms, 2);

  const pinheiros = route("Pinheiros até 800 mil");
  assert.equal(pinheiros.state.neighborhood, "Pinheiros");
  assert.equal(pinheiros.state.exactName, "");
  assert.equal(pinheiros.state.maxPrice, 800000);

  const apartment = route("apartamento em Perdizes até 900 mil");
  assert.equal(apartment.state.neighborhood, "Perdizes");
  assert.equal(apartment.state.exactName, "");
  assert.equal(apartment.state.maxPrice, 900000);

  assert.equal(routing.aiProjectLookupToken("Perdizes", names), "");
  assert.equal(routing.aiProjectLookupToken("Perdizes 2 dormitórios", names), "");
  assert.equal(routing.aiProjectLookupToken("Pinheiros até 800 mil", names), "");
  assert.equal(routing.aiProjectLookupToken("apartamento em Perdizes até 900 mil", names), "");
  assert.equal(routing.aiProjectLookupToken("Marka Perdizes", names), "marka");
});
