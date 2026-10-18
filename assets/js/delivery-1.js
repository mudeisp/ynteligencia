// Delivery loader only: original feature bodies are in lazy/*.js. No API or tracking calls.
window.YntFeatureLoader=(()=>{
 const base=new URL('./',document.currentScript.src),pending=new Map(),loaded=new Set();
 return {markLoaded(name){loaded.add(name);},load(name){
  if(!['property-detail','legacy-ai-actions'].includes(name))return Promise.reject(new Error('Unknown feature'));
  if(pending.has(name))return pending.get(name);
  const task=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=new URL('lazy/'+name+'.js',base).href;
   script.onload=()=>{if(loaded.has(name))resolve();else{pending.delete(name);script.remove();reject(new Error('Feature unavailable: '+name));}};script.onerror=()=>{pending.delete(name);script.remove();reject(new Error('Feature unavailable: '+name));};
   document.head.appendChild(script);
  });pending.set(name,task);return task;
 }};
})();

;
// SOURCE: assets/js/legacy/ai-neighborhood-catalog.js
/*
  Camada canônica de bairros da Match IA.

  Não grava nada em properties. A coluna neighborhood continua como veio
  do Órulo e da Nonstop. Esta lista só decide o que a busca pede.

  alias
    Outra grafia do mesmo nome. Serve para acento e caixa.
    butanta e Butantã são o mesmo bairro.

  family_members
    Outros nomes que a busca curta deve incluir.
    Só Brooklin tem família hoje:
    Brooklin, Brooklin Paulista e Brooklin Novo.
    Pinheiros não inclui Alto de Pinheiros.
    Lapa não inclui Alto da Lapa.
    Perdizes não inclui Jardim das Perdizes.
    Belém não inclui Belém Novo nem Belém Velho.

  canonical_name
    Grafia que o ILIKE precisa acertar. O Postgres distingue acento,
    então a forma canônica é a que está gravada no estoque.
    Pompeia está sem acento no banco. Butantã está com acento.

  city / state
    Catálogo atual da Ynteligencia é São Paulo / SP.
    Santana também existe em Porto Alegre. O filtro de cidade
    segura esse homônimo.
*/

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.AiNeighborhoodCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CITY = "São Paulo";
  const STATE = "SP";

  function place(canonical, aliases, familyMembers) {
    return {
      canonical_name: canonical,
      aliases: aliases || [],
      family_members: familyMembers && familyMembers.length
        ? familyMembers
        : [canonical],
      city: CITY,
      state: STATE
    };
  }

  const NEIGHBORHOOD_CATALOG = [
    place("Perdizes"),
    place("Pompeia", ["Pompéia"]),
    place("Pinheiros"),
    place("Vila Madalena"),
    place("Lapa"),
    place("Alto da Lapa"),
    place("Barra Funda"),
    place("Butantã", ["Butanta"]),
    place("Jaguaré", ["Jaguare"]),
    place("Sumaré", ["Sumare"]),
    place("Vila Leopoldina"),
    place("Alto de Pinheiros"),
    place("Rio Pequeno"),
    place("Vila Sônia", ["Vila Sonia"]),
    place("Morumbi"),
    place("Moema"),
    place("Vila Mariana"),
    place("Chácara Klabin", ["Chacara Klabin"]),
    place("Brooklin", [], ["Brooklin", "Brooklin Paulista", "Brooklin Novo"]),
    place("Brooklin Paulista"),
    place("Brooklin Novo"),
    place("Campo Belo"),
    place("Saúde", ["Saude"]),
    place("Ipiranga"),
    place("Paraíso", ["Paraiso"]),
    place("Aclimação", ["Aclimacao"]),
    place("Jardins"),
    place("Jardim Paulista"),
    place("Itaim Bibi"),
    place("Vila Nova Conceição", ["Vila Nova Conceicao"]),
    place("Santo Amaro"),
    place("Campo Grande"),
    place("Vila Clementino"),
    place("Planalto Paulista"),
    place("Mirandópolis", ["Mirandopolis"]),
    place("Santana"),
    place("Tucuruvi"),
    place("Casa Verde"),
    place("Mandaqui"),
    place("Vila Guilherme"),
    place("Vila Maria"),
    place("Parada Inglesa"),
    place("Jardim São Paulo", ["Jardim Sao Paulo"]),
    place("Lauzane Paulista"),
    place("Limão", ["Limao"]),
    place("Freguesia do Ó", ["Freguesia do O"]),
    place("Tremembé", ["Tremembe"]),
    place("Jaçanã", ["Jacana"]),
    place("Tatuapé", ["Tatuape"]),
    place("Mooca"),
    place("Anália Franco", ["Analia Franco"]),
    place("Vila Prudente"),
    place("Penha"),
    place("Carrão", ["Carrao"]),
    place("Belém", ["Belem"]),
    place("Brás", ["Bras"]),
    place("Água Rasa", ["Agua Rasa"]),
    place("Vila Formosa"),
    place("Vila Matilde"),
    place("Itaquera"),
    place("Aricanduva"),
    place("Sapopemba"),
    place("São Mateus", ["Sao Mateus"])
  ];

  function normalizeNeighborhood(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function uniqueSpellings(values) {
    const seen = new Set();
    const result = [];

    for (const value of values) {
      const text = String(value || "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }

    return result;
  }

  function filterToken(value) {
    return String(value || "").trim().replace(/[(),"*]/g, "");
  }

  function searchNamesFor(entry) {
    if (entry.family_members.length > 1) {
      return uniqueSpellings(entry.family_members);
    }

    return uniqueSpellings([
      entry.canonical_name,
      ...entry.aliases
    ]);
  }

  function decorate(entry) {
    const searchNames = searchNamesFor(entry);

    return {
      canonical_name: entry.canonical_name,
      aliases: entry.aliases.slice(),
      family_members: entry.family_members.slice(),
      city: entry.city,
      state: entry.state,
      mode: entry.family_members.length > 1 ? "family" : "exact",
      search_names: searchNames
    };
  }

  function resolveNeighborhood(name) {
    const key = normalizeNeighborhood(name);
    if (!key) return null;

    let best = null;
    let bestLength = -1;

    for (const entry of NEIGHBORHOOD_CATALOG) {
      const candidates = [entry.canonical_name, ...entry.aliases];

      for (const candidate of candidates) {
        const candidateKey = normalizeNeighborhood(candidate);
        if (candidateKey !== key || candidateKey.length <= bestLength) continue;
        best = entry;
        bestLength = candidateKey.length;
      }
    }

    return best ? decorate(best) : null;
  }

  function propertyMatchesNeighborhood(property, resolved) {
    if (!property || !resolved) return false;

    const key = normalizeNeighborhood(property.neighborhood);
    if (!key) return false;

    const wanted = new Set(
      resolved.search_names.map(normalizeNeighborhood)
    );
    if (!wanted.has(key)) return false;
    if (normalizeNeighborhood(property.city) !== normalizeNeighborhood(resolved.city)) {
      return false;
    }
    if (normalizeNeighborhood(property.state) !== normalizeNeighborhood(resolved.state)) {
      return false;
    }

    return true;
  }

  function postgrestNeighborhoodFilters(resolved) {
    if (!resolved) return null;

    const names = (resolved.search_names.length
      ? resolved.search_names
      : [resolved.canonical_name]
    ).map(filterToken).filter(Boolean);
    const filters = {
      city: `eq.${filterToken(resolved.city)}`,
      state: `eq.${filterToken(resolved.state)}`
    };

    /*
      Aspas no parâmetro neighborhood=ilike."Nome" fazem o PostgREST
      devolver zero. Dentro de or= as aspas funcionam, mas o valor
      sem aspas também, e o URLSearchParams codifica o espaço.
    */
    if (names.length === 1) {
      filters.neighborhood = `ilike.${names[0]}`;
    } else {
      filters.or = `(${names
        .map(name => `neighborhood.ilike.${name}`)
        .join(",")})`;
    }

    return filters;
  }

  return {
    NEIGHBORHOOD_CATALOG,
    normalizeNeighborhood,
    resolveNeighborhood,
    propertyMatchesNeighborhood,
    postgrestNeighborhoodFilters
  };
});


;
// SOURCE: assets/js/legacy/ai-search-routing.js
/*
  Match IA · roteamento canônico de busca.

  Uma classificação e um extrator de bairro para o frontend.
  Não chama OpenAI, não pesquisa estoque e não altera UI.

  "quero comparar com outro" usa kind "alternatives" só como fallback.
  Isso NÃO é comparação real: não há leitura lado a lado de dois imóveis.
  preservePropertyForComparison pede ao chamador que mantenha o imóvel
  atual em memória para uma comparação futura.
*/

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.AiSearchRouting = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function aiNormalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function aiNormalizeMoneyNumber(raw) {
    let s = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");

    if (!s) return 0;

    if (s.includes(",") && s.includes(".")) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else if (s.includes(",")) {
      const parts = s.split(",");
      if (parts.length === 2 && parts[1].length <= 2) {
        s = parts[0].replace(/\./g, "") + "." + parts[1];
      } else {
        s = s.replace(/,/g, "");
      }
    } else if (s.includes(".")) {
      const parts = s.split(".");
      if (parts.length > 2) {
        s = s.replace(/\./g, "");
      } else if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
        s = parts[0] + parts[1];
      }
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function aiApplyMoneyUnit(value, unit) {
    let v = Number(value) || 0;
    const u = aiNormalizeText(unit || "");

    if (/\b(milhao|milhoes|mi)\b/.test(u)) {
      v *= 1000000;
    } else if (/\b(mil|k)\b/.test(u)) {
      v *= 1000;
    } else if (v > 0 && v < 10000) {
      v *= 1000;
    }

    return Math.round(v);
  }

  function aiOruloParseMoney(text) {
    const t = aiNormalizeText(text || "");
    const parse = (num, unit) => aiApplyMoneyUnit(aiNormalizeMoneyNumber(num), unit || "");

    let min = 0;
    let max = 0;
    let m;

    m = t.match(
      /(?:entre|de)\s*(?:r\$)?\s*([\d.,]+)\s*(milhoes|milhao|mil|mi|k)?\s*(?:a|e|-)\s*(?:r\$)?\s*([\d.,]+)\s*(milhoes|milhao|mil|mi|k)?/
    );
    if (m) {
      const sharedUnit = m[4] || m[2] || "";
      min = parse(m[1], m[2] || sharedUnit);
      max = parse(m[3], m[4] || sharedUnit);
      return { min, max };
    }

    m = t.match(
      /(?:ate|maximo|max|no maximo|teto de)\s*(?:r\$)?\s*([\d.,]+)\s*(milhoes|milhao|mil|mi|k)?/
    );
    if (m) {
      max = parse(m[1], m[2] || "");
    }

    m = t.match(
      /(?:a partir de|minimo|min|acima de|mais de)\s*(?:r\$)?\s*([\d.,]+)\s*(milhoes|milhao|mil|mi|k)?/
    );
    if (m) {
      min = parse(m[1], m[2] || "");
    }

    if (!min && !max) {
      m = t.match(
        /(?:r\$\s*)?([\d][\d.,]*)\s*(milhoes|milhao|mil|mi|k)?(?=\s|$)/
      );

      if (m) {
        const candidate = parse(m[1], m[2] || "");
        if (candidate >= 100000) {
          max = candidate;
        }
      }
    }

    return { min, max };
  }

  function aiExtractBedrooms(message) {
    const t = aiNormalizeText(message || "");
    const digit = t.match(
      /(\d+)\s*(?:dorm|dorms|dormitorio|dormitorios|quarto|quartos)\b/
    );
    if (digit) return Number(digit[1]) || 0;

    const words = {
      um: 1,
      uma: 1,
      dois: 2,
      duas: 2,
      tres: 3,
      quatro: 4,
      cinco: 5
    };
    const word = t.match(
      /\b(um|uma|dois|duas|tres|quatro|cinco)\s+(?:dorm|dorms|dormitorio|dormitorios|quarto|quartos)\b/
    );
    return word ? words[word[1]] || 0 : 0;
  }

  function aiExtractExplicitRegion(message) {
    const t = aiNormalizeText(message || "");

    if (/\b(zona oeste|regiao oeste|oeste)\b/.test(t)) return "oeste";
    if (/\b(zona sul|regiao sul|sul)\b/.test(t)) return "sul";
    if (/\b(zona norte|regiao norte|norte)\b/.test(t)) return "norte";
    if (/\b(zona leste|regiao leste|leste)\b/.test(t)) return "leste";

    return "";
  }

  /*
    Nome inteiro, com fronteira de palavra.
    O nome mais longo só vence quando a frase contém esse nome completo.
    Token solto e substring ("no", "em", "na", "vila") não escolhem bairro.
  */
  function aiCanonicalNeighborhood(message, knownNeighborhoods) {
    const t = aiNormalizeText(message || "");
    if (!t) return "";

    const names = [...new Set(
      (knownNeighborhoods || [])
        .map(name => String(name || "").trim())
        .filter(Boolean)
    )].sort((a, b) => {
      const lengthDelta = aiNormalizeText(b).length - aiNormalizeText(a).length;
      return lengthDelta || String(b).length - String(a).length;
    });

    const padded = ` ${t.replace(/[?!;:()"“”]/g, " ").replace(/\s+/g, " ").trim()} `;

    for (const name of names) {
      const key = aiNormalizeText(name);
      if (!key || key.length < 3) continue;
      if (t === key || padded.includes(` ${key} `)) {
        return name;
      }
    }

    return "";
  }

  function emptySearchState() {
    return {
      region: "",
      neighborhood: "",
      exactName: "",
      bedrooms: 0,
      minPrice: 0,
      maxPrice: 0,
      inventorySource: ""
    };
  }

  function aiExplicitInventorySource(message) {
    const text = aiNormalizeText(message).replace(/\bde novo\b/g, " ");
    const used = /\b(usados|usado)\b/.test(text);
    const fresh = /\b(lancamentos|lancamento|novos|novo)\b/.test(text);
    if (used && fresh) return "";
    if (used) return "usados";
    if (fresh) return "novos";
    return "";
  }

  function aiHasSearchContext(state) {
    if (!state) return false;

    return Boolean(
      state.hasProperty ||
      String(state.region || "").trim() ||
      String(state.neighborhood || "").trim() ||
      String(state.exactName || "").trim() ||
      Number(state.bedrooms) > 0 ||
      Number(state.minPrice) > 0 ||
      Number(state.maxPrice) > 0
    );
  }

  function sameNeighborhood(left, right) {
    const a = aiNormalizeText(left || "");
    const b = aiNormalizeText(right || "");
    return Boolean(a) && a === b;
  }

  function mentionsMoney(message) {
    const money = aiOruloParseMoney(message);
    return Boolean(money.min || money.max);
  }

  function isRestartPhrase(text) {
    return /\b(nova busca|outra busca|agora quero|agora procure|agora busca|outro bairro|outro empreendimento)\b/.test(text);
  }

  function isYouHavePhrase(text) {
    return /\b(voces tem|voce tem)\b/.test(text);
  }

  function isBareInventoryPrompt(text) {
    return /\b(tem lancamentos|tem lancamento|tem imoveis|tem imovel)\b/.test(text);
  }

  /*
    Fallback de "comparar com outro".
    Não compara fichas. Só pede outras opções e pede para guardar o imóvel.
  */
  function comparisonText(message) {
    return aiNormalizeText(message || "")
      .replace(/[?!;:()"“”]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function aiMatchExactName(term, names) {
    const wanted = aiNormalizeText(term || "");
    if (!wanted) return "";

    const sorted = [...new Set(
      (names || [])
        .map(name => String(name || "").trim())
        .filter(Boolean)
    )].sort((a, b) => aiNormalizeText(b).length - aiNormalizeText(a).length);

    for (const name of sorted) {
      if (aiNormalizeText(name) === wanted) return name;
    }

    return "";
  }

  function sideNeighborhood(term, neighborhoods) {
    const found = aiCanonicalNeighborhood(term, neighborhoods);
    if (!found) return "";

    const rest = aiNormalizeText(term)
      .replace(aiNormalizeText(found), " ")
      .replace(/\b(em|no|na|de|do|da|o|a|os|as)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return rest ? "" : found;
  }

  function resolveComparisonSide(term, neighborhoods, projects) {
    const neighborhood = sideNeighborhood(term, neighborhoods);
    if (neighborhood) {
      return {
        name: neighborhood,
        type: "neighborhood"
      };
    }

    const project = aiMatchExactName(term, projects);
    if (project) {
      return {
        name: project,
        type: "project"
      };
    }

    return {
      name: aiNormalizeText(term),
      type: "unknown"
    };
  }

  function aiExtractComparisonSides(message) {
    const text = comparisonText(message);
    if (!text) return null;

    const patterns = [
      /\b(?:comparar|compare)\s+(.+?)\s+com\s+(.+)$/,
      /^(.+?)\s+versus\s+(.+)$/,
      /^(.+?)\s+vs\s+(.+)$/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;

      const left = match[1].trim();
      const right = match[2].trim();
      if (!left || !right) continue;
      if (/^(outro|outra|outros|outras)$/.test(left)) continue;
      if (/^(outro|outra|outros|outras)$/.test(right)) continue;

      return { left, right };
    }

    return null;
  }

  function aiHasExplicitComparisonStructure(message) {
    return Boolean(aiExtractComparisonSides(message));
  }

  function comparisonTypeOf(left, right) {
    const types = [left.type, right.type].sort().join("+");
    if (left.type === "neighborhood" && right.type === "neighborhood") {
      return "neighborhoods";
    }
    if (types === "neighborhood+project") return "mixed";
    return "unresolved";
  }

  function aiExtractComparison(message, knownNeighborhoods, knownProjects) {
    const sides = aiExtractComparisonSides(message);
    if (!sides) return null;

    const compare_left = resolveComparisonSide(
      sides.left,
      knownNeighborhoods,
      knownProjects
    );
    const compare_right = resolveComparisonSide(
      sides.right,
      knownNeighborhoods,
      knownProjects
    );

    return {
      compare_left,
      compare_right,
      comparisonType: comparisonTypeOf(compare_left, compare_right),
      realComparison: false
    };
  }

  function aiTitleCaseWords(value) {
    return aiNormalizeText(value)
      .replace(/(^|\s|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }

  /*
    Não é nome de empreendimento.
    Número, tipologia, preço, verbo de busca e pontuação ficam de fora
    mesmo se algum cadastro repetir essas palavras.
  */
  function aiProjectDenied(name) {
    const denied = new Set([
      "um", "uma", "dois", "duas", "tres", "quatro", "cinco",
      "seis", "sete", "oito", "nove", "dez",
      "dorm", "dorms", "dormitorio", "dormitorios",
      "quarto", "quartos", "suite", "suites",
      "vaga", "vagas", "banheiro", "banheiros",
      "mil", "milhao", "milhoes", "reais", "preco", "valor",
      "ate", "acima", "abaixo", "entre",
      "tem", "existe", "quero", "busca", "buscar", "procura", "procurar",
      "mostra", "mostrar", "ver", "imovel", "imoveis", "apartamento",
      "lancamento", "lancamentos"
    ]);
    const tokens = aiNormalizeText(name || "").split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    return tokens.every(token => denied.has(token) || /^\d+$/.test(token));
  }

  /*
    Sufixos de cadastro. Não fazem parte do nome que o cliente fala.
    "Rooftop Perdizes - Breve Lançamento" corresponde a "Rooftop Perdizes".
  */
  function aiDevelopmentLabel(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+-\s+/)
      .filter(Boolean);

    while (parts.length > 1) {
      const tail = aiNormalizeText(parts[parts.length - 1]);
      if (
        tail !== "breve lancamento" &&
        tail !== "residencial" &&
        tail !== "comercial" &&
        tail !== "nr"
      ) {
        break;
      }
      parts.pop();
    }

    return parts.join(" - ").trim();
  }

  function aiMessageForProjectMatch(message) {
    return comparisonText(message)
      .replace(
        /(?:entre|de)\s*(?:r\$)?\s*[\d.,]+\s*(?:milhoes|milhao|mil|mi|k)?\s*(?:a|e|-)\s*(?:r\$)?\s*[\d.,]+\s*(?:milhoes|milhao|mil|mi|k)?/g,
        " "
      )
      .replace(
        /(?:ate|maximo|max|no maximo|teto de)\s*(?:r\$)?\s*[\d.,]+\s*(?:milhoes|milhao|mil|mi|k)?/g,
        " "
      )
      .replace(
        /(?:a partir de|minimo|min|acima de|mais de)\s*(?:r\$)?\s*[\d.,]+\s*(?:milhoes|milhao|mil|mi|k)?/g,
        " "
      )
      .replace(
        /(?:r\$\s*)[\d][\d.,]*\s*(?:milhoes|milhao|mil|mi|k)?/g,
        " "
      )
      .replace(
        /\b\d+\s*(?:dorm|dorms|dormitorio|dormitorios|quarto|quartos)\b/g,
        " "
      )
      .replace(
        /\b(?:um|uma|dois|duas|tres|quatro|cinco)\s+(?:dorm|dorms|dormitorio|dormitorios|quarto|quartos)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  function aiProjectCatalog(knownProjects) {
    const byCore = new Map();

    for (const name of knownProjects || []) {
      const label = aiDevelopmentLabel(name);
      const core = aiNormalizeText(label);
      if (!core || core.length < 3 || aiProjectDenied(core)) continue;
      if (!byCore.has(core)) byCore.set(core, label);
    }

    return [...byCore.entries()]
      .map(([core, label]) => ({ core, label }))
      .sort((a, b) => b.core.length - a.core.length);
  }

  function keepSpecificCores(hits) {
    return hits.filter(item =>
      !hits.some(other =>
        other.core !== item.core &&
        other.core.length > item.core.length &&
        other.core.startsWith(`${item.core} `)
      )
    );
  }

  /*
    1. O nome inteiro do empreendimento, já sem sufixo de cadastro.
    2. Prefixo claro ("Marka" → só um Marka, ou vários para desambiguar).
    Bairro puro não vira empreendimento.
    "em/no/na" continua separando nome curto e bairro.
  */
  function aiResolveKnownProjects(message, knownProjects, knownNeighborhoods) {
    const none = { status: "none", label: "", candidates: [] };
    const catalog = aiProjectCatalog(knownProjects);
    const text = aiMessageForProjectMatch(message);
    if (!text || !catalog.length) return none;

    const padded = ` ${text} `;
    const phraseHits = keepSpecificCores(
      catalog.filter(item => padded.includes(` ${item.core} `))
    );
    const neighborhoodKey = aiNormalizeText(
      aiCanonicalNeighborhood(text, knownNeighborhoods)
    );

    if (phraseHits.length === 1) {
      const core = phraseHits[0].core;
      if (neighborhoodKey && core === neighborhoodKey) return none;
      const neighborhoodInside = Boolean(
        neighborhoodKey &&
        ` ${core} `.includes(` ${neighborhoodKey} `)
      );
      return {
        status: !neighborhoodKey || neighborhoodInside ? "match" : "partial",
        label: phraseHits[0].label,
        candidates: [phraseHits[0].label]
      };
    }

    if (phraseHits.length > 1) {
      return {
        status: "ambiguous",
        label: "",
        candidates: phraseHits
          .map(item => item.label)
          .sort((a, b) => a.localeCompare(b, "pt"))
      };
    }

    const attempt = text
      .replace(
        /\b(quero|saber|sobre|tem|existe|ha|mostrar|mostra|ver|buscar|busca|procurar|procura|apartamento|apartamentos|imovel|imoveis|lancamento|lancamentos|empreendimento|empreendimentos|condominio|condominios|voce|voces|por|favor|o|a|os|as|um|uma|me|algum|alguma|uns|umas|com|para)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

    if (!attempt || attempt.length < 4 || aiProjectDenied(attempt)) return none;

    const attemptNeighborhood = aiNormalizeText(
      aiCanonicalNeighborhood(attempt, knownNeighborhoods)
    );
    if (attemptNeighborhood && attempt === attemptNeighborhood) return none;

    const prefixHits = catalog.filter(item =>
      item.core === attempt || item.core.startsWith(`${attempt} `)
    );

    if (prefixHits.length === 1) {
      const core = prefixHits[0].core;
      const neighborhoodInside = Boolean(
        neighborhoodKey &&
        neighborhoodKey !== core &&
        ` ${core} `.includes(` ${neighborhoodKey} `)
      );
      if (neighborhoodKey && !neighborhoodInside) {
        return {
          status: "partial",
          label: prefixHits[0].label,
          candidates: [prefixHits[0].label]
        };
      }
      return {
        status: "match",
        label: prefixHits[0].label,
        candidates: [prefixHits[0].label]
      };
    }

    if (prefixHits.length > 1) {
      return {
        status: "ambiguous",
        label: "",
        candidates: prefixHits
          .map(item => item.label)
          .sort((a, b) => a.localeCompare(b, "pt"))
      };
    }

    return none;
  }

  function aiProjectLookupToken(message, knownNeighborhoods) {
    const text = aiMessageForProjectMatch(message)
      .replace(
        /\b(quero|saber|sobre|tem|existe|ha|mostrar|mostra|ver|buscar|busca|procurar|procura|apartamento|apartamentos|imovel|imoveis|lancamento|lancamentos|empreendimento|empreendimentos|condominio|condominios|voce|voces|por|favor|o|a|os|as|um|uma|me|algum|alguma|uns|umas|com|para|em|no|na|nos|nas|de|do|da|dos|das)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

    if (!text || text.length < 4) return "";

    const neighborhood = aiNormalizeText(
      aiCanonicalNeighborhood(text, knownNeighborhoods)
    );
    if (neighborhood && text === neighborhood) return "";

    return text.split(" ").find(part => part.length >= 4) || "";
  }

  /*
    Empreendimento conhecido.
    Nome completo tem prioridade sobre um bairro que só faz parte dele.
    Vários empreendimentos não escolhem um ao acaso.
  */
  function aiMatchKnownProject(message, knownProjects) {
    const resolved = aiResolveKnownProjects(message, knownProjects, []);
    if (resolved.status === "match" || resolved.status === "partial") {
      return resolved.label;
    }
    return "";
  }

  function neighborhoodCatalog() {
    if (typeof require === "function") {
      try {
        return require("./ai-neighborhood-catalog.js");
      } catch (error) {
        return null;
      }
    }

    const globalRoot = typeof globalThis !== "undefined" ? globalThis : null;
    return globalRoot && globalRoot.AiNeighborhoodCatalog
      ? globalRoot.AiNeighborhoodCatalog
      : null;
  }

  /*
    O catálogo canônico decide família e grafia.
    Brooklin inclui Paulista e Novo.
    Butanta vira Butantã.
    Fora do catálogo, o prefixo do estoque ainda distingue
    um nome curto de uma forma qualificada.
  */
  function aiNeighborhoodScope(matchedName, knownNeighborhoods) {
    const catalog = neighborhoodCatalog();
    const resolved = catalog && catalog.resolveNeighborhood
      ? catalog.resolveNeighborhood(matchedName)
      : null;

    if (resolved) {
      return {
        mode: resolved.mode,
        names: resolved.search_names,
        canonical_name: resolved.canonical_name,
        city: resolved.city,
        state: resolved.state
      };
    }

    const matchedKey = aiNormalizeText(matchedName || "");
    if (!matchedKey) return { mode: "", names: [], canonical_name: "", city: "", state: "" };

    const entries = [];
    const seen = new Set();
    for (const name of knownNeighborhoods || []) {
      const key = aiNormalizeText(name || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push({
        name: String(name).trim(),
        key
      });
    }

    const isQualified = entries.some(entry =>
      entry.key !== matchedKey &&
      matchedKey.startsWith(`${entry.key} `)
    );
    const own = entries.find(entry => entry.key === matchedKey);
    const label = own ? own.name : String(matchedName).trim();

    if (isQualified) {
      return { mode: "exact", names: [label], canonical_name: label, city: "", state: "" };
    }

    const family = entries.filter(entry =>
      entry.key === matchedKey ||
      entry.key.startsWith(`${matchedKey} `)
    );

    if (family.length > 1) {
      return {
        mode: "family",
        names: family.map(entry => entry.name),
        canonical_name: label,
        city: "",
        state: ""
      };
    }

    return { mode: "exact", names: [label], canonical_name: label, city: "", state: "" };
  }

  function aiQueryTokens(value) {
    return aiNormalizeText(value || "")
      .replace(/[?!.,;:()"“”]/g, " ")
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token && !token.includes("?"));
  }

  /*
    Desambiguação só entre bairro conhecido e empreendimento conhecido.
    Não roda em "comparar X com Y", "vs" ou "versus".
  */
  function aiDetectProjectNeighborhoodAmbiguity(message, knownNeighborhoods, knownProjects) {
    if (aiHasExplicitComparisonStructure(message)) return null;

    const neighborhood = aiCanonicalNeighborhood(
      message,
      knownNeighborhoods
    );
    if (!neighborhood) return null;

    const resolved = aiResolveKnownProjects(
      message,
      knownProjects,
      knownNeighborhoods
    );
    if (resolved.status === "match" || resolved.status === "ambiguous") {
      return null;
    }

    const project = aiMatchKnownProject(message, knownProjects);
    if (!project) return null;
    if (aiNormalizeText(project) === aiNormalizeText(neighborhood)) return null;

    return {
      project,
      neighborhood
    };
  }

  function aiInventoryQueryPlan(message, knownNeighborhoods, knownProjects) {
    const turn = aiClassifySearchTurn(
      message,
      {},
      knownNeighborhoods,
      knownProjects
    );
    const resolvedProjects = aiResolveKnownProjects(
      message,
      knownProjects,
      knownNeighborhoods
    );
    const neighborhood = resolvedProjects.status === "match"
      ? ""
      : (aiCanonicalNeighborhood(message, knownNeighborhoods) || "");
    const project = resolvedProjects.status === "match"
      ? resolvedProjects.label
      : resolvedProjects.status === "ambiguous"
        ? ""
        : (aiMatchKnownProject(message, knownProjects) || "");
    const projectIsNeighborhood = Boolean(
      project &&
      neighborhood &&
      aiNormalizeText(project) === aiNormalizeText(neighborhood)
    );
    const recognizedProject = projectIsNeighborhood ? "" : project;
    const scope = neighborhood
      ? aiNeighborhoodScope(neighborhood, knownNeighborhoods)
      : { mode: "", names: [], canonical_name: "", city: "", state: "" };
    const query = neighborhood || recognizedProject
      ? ""
      : String(message || "").trim();

    return {
      kind: turn.kind,
      neighborhood: scope.canonical_name || neighborhood,
      neighborhoodMode: scope.mode,
      neighborhoods: scope.names,
      city: scope.city || "",
      state: scope.state || "",
      bedrooms: aiExtractBedrooms(message),
      project: recognizedProject,
      query,
      keepQueryText: query !== "",
      projectOptions: resolvedProjects.status === "ambiguous"
        ? resolvedProjects.candidates
        : [],
      ambiguity: resolvedProjects.status === "match"
        ? null
        : aiDetectProjectNeighborhoodAmbiguity(
        message,
        knownNeighborhoods,
        knownProjects
      )
    };
  }

  function isCompareWithAnotherPhrase(text) {
    return (
      /\b(comparar|compare|comparacao)\b[\s\S]{0,40}\b(outros|outras|outro|outra)\b/.test(text) ||
      /\b(outros|outras|outro|outra)\b[\s\S]{0,40}\b(comparar|compare|comparacao)\b/.test(text)
    );
  }

  function isAlternativesPhrase(text) {
    if (/\b(outro bairro|outro empreendimento|outros empreendimentos)\b/.test(text)) {
      return false;
    }

    return /\b(outra opcao|outras opcoes|mais opcoes|outro imovel|outros imoveis|me mostra outros?|me mostra outras|me mostre outros?|me mostre outras|mostra outros?|mostra outras|procura outro|procure outro|buscar outro|busca outro|ver outros?|quero outros?|quero outra|mais imoveis|tem outros?|tem outra|tem mais|algo parecido|outra alternativa|outras alternativas)\b/.test(text);
  }

  function isFollowUpPhrase(text) {
    return /\b(link|url|endereco|metragem|area|preco|valor|dormitorios|quartos|vagas|suite|varanda|detalhes|mais sobre|fale mais|esse|essa|desse|dessa|primeiro|segundo|terceiro|unidade|unidades|estoque|quantas|quantos|disponibilidade|disponiveis)\b/.test(text);
  }

  function baseTurn(partial) {
    return {
      kind: "refine",
      isNewSearch: false,
      reason: "refinement",
      realComparison: false,
      preservePropertyForComparison: false,
      keepQueryText: true,
      neighborhood: "",
      region: "",
      compare_left: null,
      compare_right: null,
      comparisonType: "",
      ...partial
    };
  }

  function aiClassifySearchTurn(message, context, knownNeighborhoods, knownProjects) {
    const text = aiNormalizeText(message || "");
    const state = { ...emptySearchState(), ...(context || {}) };
    const neighborhood = aiCanonicalNeighborhood(message, knownNeighborhoods);
    const region = neighborhood ? "" : aiExtractExplicitRegion(message);
    const active = aiHasSearchContext(state);
    const placeFields = {
      neighborhood,
      region
    };

    if (!text) {
      return baseTurn({
        kind: "vague",
        reason: "vague",
        keepQueryText: false
      });
    }

    const comparison = aiExtractComparison(
      message,
      knownNeighborhoods,
      knownProjects
    );

    if (comparison) {
      return baseTurn({
        kind: "comparison",
        reason: "comparison",
        /*
          Classificação apenas. Não há comparação lado a lado de imóveis.
        */
        realComparison: false,
        preservePropertyForComparison: true,
        keepQueryText: false,
        isNewSearch: false,
        neighborhood: "",
        region: "",
        compare_left: comparison.compare_left,
        compare_right: comparison.compare_right,
        comparisonType: comparison.comparisonType
      });
    }

    if (isCompareWithAnotherPhrase(text)) {
      return baseTurn({
        kind: "alternatives",
        reason: "alternatives",
        /*
          Fallback. Não é comparação real entre dois imóveis.
          O chamador deve preservar o imóvel atual.
        */
        realComparison: false,
        preservePropertyForComparison: true,
        keepQueryText: false,
        ...placeFields
      });
    }

    const development = aiResolveKnownProjects(
      message,
      knownProjects,
      knownNeighborhoods
    );

    if (development.status === "ambiguous") {
      return baseTurn({
        kind: "project_options",
        reason: "ambiguous_project",
        keepQueryText: false,
        isNewSearch: false,
        neighborhood: "",
        region: "",
        projectOptions: development.candidates
      });
    }

    if (development.status === "match") {
      return baseTurn({
        kind: "reset",
        isNewSearch: true,
        reason: "known_project",
        keepQueryText: false,
        neighborhood: "",
        region: "",
        project: development.label
      });
    }

    if (isRestartPhrase(text)) {
      return baseTurn({
        kind: "reset",
        isNewSearch: true,
        reason: "restart_phrase",
        keepQueryText: !isYouHavePhrase(text),
        ...placeFields
      });
    }

    if (isAlternativesPhrase(text)) {
      return baseTurn({
        kind: "alternatives",
        reason: "alternatives",
        realComparison: false,
        preservePropertyForComparison: false,
        keepQueryText: false,
        ...placeFields
      });
    }

    if (isYouHavePhrase(text) && !neighborhood && !region) {
      if (!active) {
        return baseTurn({
          kind: "vague",
          reason: "vague",
          keepQueryText: false,
          neighborhood: "",
          region: ""
        });
      }

      return baseTurn({
        kind: "refine",
        reason: "refinement",
        keepQueryText: false
      });
    }

    if (neighborhood) {
      if (sameNeighborhood(neighborhood, state.neighborhood)) {
        return baseTurn({
          kind: "refine",
          reason: "same_place",
          keepQueryText: false,
          neighborhood,
          region: ""
        });
      }

      return baseTurn({
        kind: "reset",
        isNewSearch: true,
        reason: "new_place",
        keepQueryText: false,
        neighborhood,
        region: ""
      });
    }

    if (region) {
      return baseTurn({
        kind: "reset",
        isNewSearch: true,
        reason: "new_place",
        neighborhood: "",
        region
      });
    }

    if (isBareInventoryPrompt(text)) {
      if (active) {
        return baseTurn({
          kind: "refine",
          reason: "refinement",
          keepQueryText: false
        });
      }

      return baseTurn({
        kind: "refine",
        reason: "refinement",
        keepQueryText: true
      });
    }

    if (aiExtractBedrooms(message) || mentionsMoney(message)) {
      return baseTurn({
        kind: "refine",
        reason: "refinement"
      });
    }

    if (aiMatchKnownProject(message, knownProjects)) {
      return baseTurn({
        kind: "refine",
        reason: "known_project",
        keepQueryText: false
      });
    }

    if (isFollowUpPhrase(text)) {
      return baseTurn({
        kind: "follow_up",
        reason: "follow_up"
      });
    }

    return baseTurn({
      kind: "refine",
      reason: "refinement"
    });
  }

  function aiIsRequestForAlternatives(message) {
    const text = aiNormalizeText(message || "");
    if (!text) return false;
    if (isCompareWithAnotherPhrase(text)) return true;
    return isAlternativesPhrase(text);
  }

  function aiNextSearchState(previous, message, knownNeighborhoods, knownProjects) {
    const prev = { ...emptySearchState(), ...(previous || {}) };
    const turn = aiClassifySearchTurn(
      message,
      prev,
      knownNeighborhoods,
      knownProjects
    );

    if (
      turn.kind === "vague" ||
      turn.kind === "follow_up" ||
      turn.kind === "comparison" ||
      turn.kind === "project_options"
    ) {
      return {
        turn,
        state: { ...prev }
      };
    }

    const state = turn.kind === "reset"
      ? emptySearchState()
      : { ...prev };

    if (turn.kind === "alternatives") {
      state.exactName = "";
    }

    if (turn.neighborhood) {
      const scope = aiNeighborhoodScope(turn.neighborhood, knownNeighborhoods);
      state.neighborhood = scope.canonical_name || turn.neighborhood;
      state.region = "";
    } else if (turn.region) {
      state.region = turn.region;
      state.neighborhood = "";
      state.exactName = "";
    } else if (turn.kind === "reset") {
      state.region = "";
      state.neighborhood = "";
      state.exactName = "";
    }

    const bedrooms = aiExtractBedrooms(message);
    const money = aiOruloParseMoney(message);

    if (bedrooms) {
      state.bedrooms = bedrooms;
    } else if (turn.kind === "reset") {
      state.bedrooms = 0;
    }

    if (money.min || money.max) {
      state.minPrice = money.min || 0;
      state.maxPrice = money.max || 0;
    } else if (turn.kind === "reset") {
      state.minPrice = 0;
      state.maxPrice = 0;
    }

    if (turn.project) {
      state.exactName = turn.project;
      state.neighborhood = "";
      state.region = "";
    }

    const explicitInventory = aiExplicitInventorySource(message);
    if (explicitInventory) {
      state.inventorySource = explicitInventory;
    } else if (turn.kind === "reset") {
      state.inventorySource = "";
    }

    return { turn, state };
  }

  return {
    aiNormalizeText,
    aiNormalizeMoneyNumber,
    aiApplyMoneyUnit,
    aiOruloParseMoney,
    aiExtractBedrooms,
    aiExtractExplicitRegion,
    aiCanonicalNeighborhood,
    aiClassifySearchTurn,
    aiIsRequestForAlternatives,
    aiNextSearchState,
    aiHasSearchContext,
    aiHasExplicitComparisonStructure,
    aiExtractComparison,
    aiMatchKnownProject,
    aiResolveKnownProjects,
    aiProjectLookupToken,
    aiNeighborhoodScope,
    aiExplicitInventorySource,
    aiQueryTokens,
    aiDetectProjectNeighborhoodAmbiguity,
    aiInventoryQueryPlan
  };
});


;
// SOURCE: assets/js/legacy/ai-commercial-intent.js
/*
  Match IA · intenção comercial e handoff.

  Decisão local, antes de estoque e OpenAI.
  Não abre lead. O lead continua no clique do botão, no formulário
  e na confirmação de /api/lead.
*/

(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.AiCommercialIntent = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SAFE_HANDOFF_REPLY =
    "Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";

  function aiCommercialNormalize(value) {
    return String(value ?? "")
      .replace(/[?!.,;:()"“”]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function detectCommercialIntent(message) {
    const text = aiCommercialNormalize(message);
    if (!text) return "";

    if (/\b(?:whatsapp|zap|wpp)\b/.test(text)) {
      return "whatsapp";
    }

    if (
      /\bfalar com (?:o |a |um |uma )?(?:alguem|pessoa|corretor|rafael|especialista|atendente|humano)\b/.test(text) ||
      /\batendimento humano\b/.test(text) ||
      /\b(?:quero|preciso|gostaria de) falar com\b/.test(text)
    ) {
      return "human";
    }

    if (/\b(?:agendar|marcar)\b/.test(text) && /\bvisita\b/.test(text)) {
      return "schedule";
    }

    if (
      /\b(?:quero visitar|posso visitar|gostaria de visitar|visitar o imovel|ver o imovel pessoalmente|visitar)\b/.test(text)
    ) {
      return "visit";
    }

    if (/\b(?:desconto|condicao comercial)\b/.test(text)) {
      return "discount";
    }

    if (
      /\b(?:negociar|negociacao|fazer proposta|aceita proposta|melhor preco|valor negociavel)\b/.test(text)
    ) {
      return "negotiation";
    }

    if (
      /\b(?:tem disponibilidade|ha disponibilidade|confirmar disponibilidade|esta disponivel|ainda esta disponivel|tem unidade disponivel|ainda tem essa unidade|essa unidade existe|disponibilidade)\b/.test(text)
    ) {
      return "availability";
    }

    if (
      /\b(?:tenho interesse|me interessei|estou interessado|estou interessada|quero esse imovel|quero esse|quero esta unidade|curti esse|gostei desse)\b/.test(text)
    ) {
      return "interest";
    }

    if (
      /\b(?:como faco para comprar|como comprar|como eu compro|como funciona a compra|como funciona compra)\b/.test(text)
    ) {
      return "purchase";
    }

    return "";
  }

  function hasCommercialTarget(context) {
    const count = Number(context?.resultCount) || 0;
    return Boolean(context?.hasProperty) || count === 1;
  }

  function asksForChoice(intent, context) {
    const count = Number(context?.resultCount) || 0;
    const target = hasCommercialTarget(context);
    const multiple = !target && count > 1;

    if (intent === "availability" && multiple) return true;
    if (intent === "interest" && !target) return true;
    if (intent === "purchase" && !target) return true;
    return false;
  }

  function choiceReply(intent, context) {
    const count = Number(context?.resultCount) || 0;

    if (intent === "availability") {
      return "Há mais de um imóvel na lista. Diga qual deles você quer consultar a disponibilidade, pelo nome ou pela posição.";
    }

    if (intent === "purchase") {
      return count > 1
        ? "Há mais de um imóvel na lista. Diga qual deles você quer comprar, pelo nome ou pela posição."
        : "Ainda não há um imóvel selecionado. Diga qual imóvel você quer comprar.";
    }

    return count > 1
      ? "Há mais de um imóvel na lista. Diga qual deles você quer, pelo nome ou pela posição."
      : "Ainda não há um imóvel selecionado. Diga qual imóvel você quer.";
  }

  function handoffReply(intent) {
    if (intent === "visit") {
      return "Posso encaminhar seu pedido de visita ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "schedule") {
      return "Posso encaminhar seu pedido de agendamento ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "availability") {
      return "A disponibilidade precisa ser confirmada pelo Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "negotiation") {
      return "A negociação é feita com o Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "discount") {
      return "Condições de desconto são confirmadas pelo Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "interest") {
      return "Posso encaminhar seu interesse neste imóvel ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    if (intent === "purchase") {
      return "A compra é acompanhada pelo Rafael. Posso encaminhar isso ao Rafael. Toque em Falar com Rafael para confirmar seus dados.";
    }

    return SAFE_HANDOFF_REPLY;
  }

  function emptyDecision() {
    return {
      handled: false,
      intent: "",
      shouldSearchInventory: false,
      shouldCallOpenAI: false,
      shouldOpenLead: false,
      showHandoff: false,
      needsPropertyChoice: false,
      reply: ""
    };
  }

  function aiResolveCommercialTurn(message, context) {
    const intent = detectCommercialIntent(message);
    if (!intent) return emptyDecision();

    const base = {
      handled: true,
      intent,
      shouldSearchInventory: false,
      shouldCallOpenAI: false,
      shouldOpenLead: false,
      showHandoff: false,
      needsPropertyChoice: false,
      reply: ""
    };

    if (asksForChoice(intent, context)) {
      return {
        ...base,
        needsPropertyChoice: true,
        showHandoff: false,
        reply: choiceReply(intent, context)
      };
    }

    return {
      ...base,
      showHandoff: true,
      reply: handoffReply(intent)
    };
  }

  function aiSanitizeHandoffPromise(value) {
    const text = String(value ?? "").trim();
    if (!text) return text;

    const normalized = aiCommercialNormalize(text);
    const claimsCompletedAction = [
      /\bencaminhei\b/,
      /\bencaminhado\b/,
      /\bencaminhamos\b/,
      /\bencaminho\b/,
      /\bavisei\b/,
      /\bavisamos\b/,
      /\bavisado\b/,
      /\bregistrei\b/,
      /\bregistramos\b/,
      /\bregistrado\b/,
      /\benviei\b/,
      /\benviamos\b/,
      /\benviad[oa]\b/,
      /\bpassei\b/,
      /\bpassamos\b/,
      /\bvisita foi agendada\b/,
      /\bvisita agendada\b/,
      /\bsolicitacao foi enviada\b/,
      /\bsolicitacao enviada\b/,
      /\bpedido enviado\b/,
      /\bja (?:encaminhei|avisei|registrei|enviei|passei)\b/,
      /\b(?:vou|irei|vamos) (?:encaminhar|enviar|passar|avisar|registrar)\b/
    ];

    if (claimsCompletedAction.some(pattern => pattern.test(normalized))) {
      return SAFE_HANDOFF_REPLY;
    }

    return text;
  }

  return {
    SAFE_HANDOFF_REPLY,
    aiCommercialNormalize,
    detectCommercialIntent,
    aiResolveCommercialTurn,
    aiSanitizeHandoffPromise
  };
});


;
// SOURCE: assets/js/domain/paid-click-experience.js
"use strict";

/*
  Paid Click Experience V1.
  Continues the intent delivered by paid traffic, asks for push only after
  value is perceived, and never treats a cache flag as push authority.
  No score, no ad write, no MATCH change.
*/

const PAID_CLICK_EXPERIENCE_VERSION = "paid-click-experience/1";
const PII_KEYS = new Set([
  "name", "email", "phone", "message", "document", "address",
  "nome", "telefone", "mensagem", "documento", "endereco"
]);
const TEXT_EVENT_KEYS = new Set([
  "event_name", "neighborhood", "region", "type", "search", "development", "origin"
]);
const NUMBER_EVENT_KEYS = new Set(["bedrooms", "min_price", "max_price", "new_option_count"]);

function cleanAdParam(value) {
  return String(value || "").replace(/[-_]+/g, " ").trim();
}

function formatPlaceName(value) {
  const lowercaseWords = new Set(["da", "das", "de", "do", "dos", "e"]);
  return cleanAdParam(value)
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => index > 0 && lowercaseWords.has(word)
      ? word
      : word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1))
    .join(" ");
}

function firstParam(params, names) {
  for (const name of names) {
    const value = params[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function readSearchParams(search) {
  const raw = typeof search === "string"
    ? Object.fromEntries(new URLSearchParams(search.startsWith("?") ? search.slice(1) : search))
    : (search || {});
  const mode = String(firstParam(raw, ["modo"]) || "").toLowerCase();
  const neighborhood = formatPlaceName(firstParam(raw, ["bairro", "neighborhood"]));
  const region = formatPlaceName(firstParam(raw, ["regiao", "region"]));
  const bedrooms = whole(firstParam(raw, ["dormitorios", "bedrooms"]));
  const minPrice = whole(firstParam(raw, ["valor_min", "min_price"]));
  const maxPrice = whole(firstParam(raw, ["valor_max", "max_price"]));
  const type = formatPlaceName(firstParam(raw, ["tipo", "type"]));
  const searchText = cleanAdParam(firstParam(raw, ["busca", "search"]));
  const development = formatPlaceName(firstParam(raw, ["empreendimento", "development"]));
  const directToResults = mode !== "explorar" && Boolean(
    neighborhood || region || bedrooms || minPrice || maxPrice || type || searchText || development
  );
  return {
    mode, neighborhood, region, bedrooms, minPrice, maxPrice, type,
    search: searchText, development, directToResults, asksAgain: false
  };
}

function compactMoney(value) {
  const amount = whole(value);
  if (!amount) return "";
  if (amount >= 1000000) {
    const millions = amount / 1000000;
    const text = Number.isInteger(millions)
      ? String(millions)
      : String(Math.round(millions * 10) / 10).replace(".", ",");
    return `R$${text} ${millions > 1 ? "milhões" : "milhão"}`;
  }
  if (amount >= 1000) return `R$${Math.round(amount / 1000)} mil`;
  return `R$${Math.round(amount)}`;
}

function placeTitle(intent) {
  const type = String(intent?.type || "").toLocaleLowerCase("pt-BR");
  let noun = "Apartamentos";
  if (type.startsWith("casa")) noun = "Casas";
  else if (type && !type.startsWith("apartamento")) noun = intent.type;
  if (intent?.neighborhood) return `${noun} em ${intent.neighborhood}`;
  if (intent?.region) return `${noun} em ${intent.region}`;
  if (intent?.development) return intent.development;
  if (intent?.search) return intent.search;
  if (intent?.type) return intent.type;
  return "Imóveis da sua busca";
}

function contextCopy(intent) {
  const source = intent || {};
  const parts = [];
  if (source.bedrooms) parts.push(source.bedrooms === 1 ? "1 dormitório" : `${source.bedrooms} dormitórios`);
  const minText = compactMoney(source.minPrice);
  const maxText = compactMoney(source.maxPrice);
  if (minText && maxText) parts.push(`de ${minText} a ${maxText}`);
  else if (maxText) parts.push(`até ${maxText}`);
  else if (minText) parts.push(`a partir de ${minText}`);
  return { title: placeTitle(source), subtitle: parts.join(" · ") };
}

function comparableText(value) {
  return cleanAdParam(value).toLocaleLowerCase("pt-BR");
}

function sameSearch(left, right) {
  if (!left || !right) return false;
  const textKeys = ["neighborhood", "region", "type", "search", "development"];
  const numberKeys = ["bedrooms", "minPrice", "maxPrice"];
  return textKeys.every(key => comparableText(left[key]) === comparableText(right[key]))
    && numberKeys.every(key => Number(left[key] || 0) === Number(right[key] || 0));
}

function subscriptionAuthority(input) {
  const source = input || {};
  if (source.sdkReady !== true) return "unknown";
  const optedIn = source.optedIn === true;
  const subscriptionId = String(source.subscriptionId || "").trim();
  return optedIn && subscriptionId ? "subscribed" : "not_subscribed";
}

function paidPushDecision(result) {
  if (!result || typeof result !== "object") return "subscription_unresolved";
  if (result.permission === "denied" || result.reason === "permission_denied") return "permission_denied";
  if (
    result.success === true &&
    result.permission === "granted" &&
    result.optedIn === true &&
    String(result.subscriptionId || "").trim() &&
    result.alertConfigured === true
  ) return "subscribed";
  return "subscription_unresolved";
}

function createExperience(input) {
  const source = input || {};
  let authority = source.subscriptionAuthority;
  if (!authority) authority = source.subscribed === true ? "subscribed" : "not_subscribed";
  const subscribed = authority === "subscribed";
  const authorityPending = authority === "unknown";
  const permissionDenied = source.permissionDenied === true;
  const dismissed = Boolean(source.sessionId) && source.dismissedSessionId === source.sessionId;
  const returning = sameSearch(source.remembered, source.intent);
  let phase = "A";
  if (subscribed) phase = "H";
  else if (permissionDenied) phase = "G";
  else if (dismissed) phase = "F";
  else if (returning) phase = "I";
  const newOptionCount = Number.isInteger(source.newOptionCount) && source.newOptionCount >= 0
    ? source.newOptionCount
    : null;
  return {
    phase,
    resultsShown: false,
    seenIds: [],
    propertiesSeen: 0,
    detailOpened: false,
    returnedToResults: false,
    refined: false,
    promptVisible: false,
    permissionPending: false,
    authorityPending,
    subscriptionAuthority: authority,
    subscriptionUnresolved: false,
    subscribed,
    permissionDenied,
    dismissed,
    justSubscribed: false,
    returning,
    newOptionCount,
    promptEligible: false,
    score: null,
    classification: null
  };
}

function valuePerceived(state) {
  if (!state.resultsShown || !state.returnedToResults) return false;
  return state.propertiesSeen >= 2;
}

function canPrompt(state) {
  return valuePerceived(state)
    && !state.subscribed
    && !state.permissionDenied
    && !state.dismissed
    && !state.promptVisible
    && !state.permissionPending
    && !state.authorityPending
    && !state.subscriptionUnresolved
    && (state.phase === "A" || state.phase === "I" || state.phase === "B");
}

function withPhase(state) {
  let phase = state.phase;
  if (state.subscribed) phase = state.justSubscribed ? "E" : "H";
  else if (state.permissionDenied) phase = "G";
  else if (state.dismissed) phase = "F";
  else if (state.subscriptionUnresolved) phase = "J";
  else if (state.permissionPending) phase = "D";
  else if (state.promptVisible) phase = "C";
  else if (valuePerceived(state)) phase = "B";
  else if (state.returning) phase = "I";
  else phase = "A";
  return {
    ...state,
    phase,
    promptEligible: canPrompt({ ...state, phase }),
    score: null,
    classification: null
  };
}

function reducePaidExperience(state, action) {
  const next = { ...state, seenIds: Array.isArray(state.seenIds) ? state.seenIds.slice() : [] };
  const type = action && action.type;
  if (type === "results_shown") next.resultsShown = true;
  if (type === "detail_opened") {
    next.detailOpened = true;
    next.returnedToResults = false;
    const id = String(action.propertyId || "");
    if (id && !next.seenIds.includes(id)) next.seenIds.push(id);
    next.propertiesSeen = next.seenIds.length;
  }
  if (type === "returned_to_results") next.returnedToResults = true;
  if (type === "refined") next.refined = true;
  if (type === "prompt_shown") next.promptVisible = true;
  if (type === "accept") {
    next.permissionPending = true;
    next.subscriptionUnresolved = false;
    next.promptVisible = false;
  }
  if (type === "subscribed") {
    next.subscribed = true;
    next.justSubscribed = true;
    next.subscriptionAuthority = "subscribed";
    next.authorityPending = false;
    next.subscriptionUnresolved = false;
    next.permissionPending = false;
    next.promptVisible = false;
  }
  if (type === "dismiss") {
    next.dismissed = true;
    next.promptVisible = false;
    next.permissionPending = false;
  }
  if (type === "permission_denied") {
    next.permissionDenied = true;
    next.permissionPending = false;
    next.subscriptionUnresolved = false;
    next.promptVisible = false;
  }
  if (type === "subscription_unresolved") {
    next.subscriptionUnresolved = true;
    next.permissionPending = false;
    next.promptVisible = false;
  }
  if (type === "subscription_reconciled") {
    const authority = action.authority || "unknown";
    next.subscriptionAuthority = authority;
    next.authorityPending = authority === "unknown";
    next.subscribed = authority === "subscribed";
    next.justSubscribed = false;
    if (authority === "subscribed") {
      next.permissionDenied = false;
      next.subscriptionUnresolved = false;
      next.permissionPending = false;
      next.promptVisible = false;
    }
  }
  return withPhase(next);
}

function evaluatePushPrompt(state, options) {
  const detailOpen = options?.detailOpen === true;
  return {
    visible: Boolean(state?.promptVisible) && !detailOpen,
    eligible: Boolean(state?.promptEligible) && !detailOpen
  };
}

function promptCopy() {
  return {
    headline: "Quer que eu te avise quando aparecer uma nova opção dentro desta busca?",
    primary: "SIM, QUERO SER AVISADO",
    secondary: "Agora não"
  };
}

function acceptanceCopy() {
  return "Pronto. Vou te avisar quando aparecer uma nova opção compatível com esta busca.";
}
function subscribedNote() { return "Alertas desta busca ativos"; }
function deniedNote() { return "Avisos desativados neste navegador."; }
function unresolvedNote() { return "Ainda não consegui confirmar o alerta. Você pode continuar navegando."; }

function memoryLine(state) {
  if (!state || !state.returning) return "";
  if (state.newOptionCount === null || state.newOptionCount === undefined) return "Continue de onde parou";
  if (state.newOptionCount === 1) return "Continue de onde parou · 1 opção nova";
  return `Continue de onde parou · ${state.newOptionCount} opções novas`;
}

function safeText(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (!text || text.length > 120) return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(text)) return undefined;
  if (/\b(?:https?:\/\/|www\.)/i.test(text)) return undefined;
  const digits = text.replace(/\D/g, "");
  if (/^[+\d\s().-]+$/.test(text) && digits.length >= 8) return undefined;
  return text;
}

function safeNumber(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  if (key === "bedrooms") return Number.isInteger(number) && number <= 20 ? number : undefined;
  if (key === "new_option_count") return Number.isInteger(number) && number <= 100000 ? number : undefined;
  return number <= 10000000000 ? number : undefined;
}

function sanitizeEvent(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const clean = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const key = String(rawKey).toLowerCase();
    if (PII_KEYS.has(key)) continue;
    if (TEXT_EVENT_KEYS.has(key)) {
      const sanitized = safeText(value);
      if (sanitized !== undefined) clean[rawKey] = sanitized;
      continue;
    }
    if (NUMBER_EVENT_KEYS.has(key)) {
      const sanitized = safeNumber(key, value);
      if (sanitized !== undefined) clean[rawKey] = sanitized;
    }
  }
  return clean;
}

const api = {
  PAID_CLICK_EXPERIENCE_VERSION,
  cleanAdParam,
  formatPlaceName,
  readSearchParams,
  contextCopy,
  sameSearch,
  subscriptionAuthority,
  paidPushDecision,
  createExperience,
  reducePaidExperience,
  evaluatePushPrompt,
  promptCopy,
  acceptanceCopy,
  subscribedNote,
  deniedNote,
  unresolvedNote,
  memoryLine,
  sanitizeEvent
};

if (typeof module === "object" && module.exports) module.exports = api;
const root = typeof globalThis !== "undefined" ? globalThis : window;
root.PaidClickExperience = api;


;
// SOURCE: assets/js/services/agent-property-handoff.js
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.YntPropertyHandoff=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const ENTRY_POINT="property.detail.manual_ai";
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ID=/^[A-Za-z0-9:_./-]{1,80}$/;
  const RETURN_ID=/^[A-Za-z0-9:_-]{1,80}$/;
  const ORIGINS=new Set(["https://app.yincorp.com.br","https://www.yincorp.com.br","https://yincorp.com.br"]);
  const record=value=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const choice=(value,allowed)=>allowed.includes(value)?value:null;
  function safeText(value,max=160){
    if(typeof value!=="string")return null;
    const text=value.trim();
    if(!text||text.length>max||/[\x00-\x1f\x7f@]|https?:|www\.|mailto:|tel:/i.test(text)||/(?:\+?\d[\d\s().-]*){10,}/.test(text)||/\b(?:gclid|gbraid|wbraid|first_touch|current_touch)\s*[:=]/i.test(text))return null;
    return text;
  }
  function safeId(value){
    if(typeof value!=="string"&&typeof value!=="number")return null;
    const id=String(value).trim();
    return ID.test(id)&&!UUID.test(id)&&!/https?:|www\./i.test(id)?id:null;
  }
  function number(value,max,integer=false){
    if(value==null||value===""||typeof value==="boolean")return null;
    const n=Number(value);
    return Number.isFinite(n)&&n>=0&&n<=max&&(!integer||Number.isInteger(n))?n:null;
  }
  function propertyReference(value){
    const p=record(value);
    const external=[p.external_id,p.id,p.property_id].map(safeId).find(Boolean)||null;
    const db=[p.db_id,p.id,p.property_id].find(id=>typeof id==="string"&&UUID.test(id))||null;
    if(!external&&!db)return null;
    return {external_id:external,db_id:db,
      inventory_source:choice(p.inventory_source,["novos","usados","todos"])||choice(p.source,["novos","usados"]),
      source:choice(p.source,["orulo","nonstop","novos","usados"]),
      name:safeText(p.name??p.property_name),neighborhood:safeText(p.neighborhood,80),city:safeText(p.city,80),
      bedrooms:number(p.bedrooms,30,true),price:number(p.value??p.price??p.property_value,1e12)};
  }
  function safeReturnUrl(value){
    if(typeof value!=="string"||value.length>500||/[\x00-\x20\x7f\\]/.test(value))return null;
    try{
      const url=new URL(value);
      if(!ORIGINS.has(url.origin)||url.username||url.password||url.port||url.pathname!=="/"||url.hash)return null;
      for(const [key,val]of url.searchParams){
        if(url.searchParams.getAll(key).length!==1)return null;
        if(key==="imovel"){if(!RETURN_ID.test(val))return null;}
        else if(key==="vid"){if(!UUID.test(val))return null;}
        else return null;
      }
      return url.toString();
    }catch{return null;}
  }
  function propertyReturnUrl(property,visitorId,origin){
    const url=new URL("/",ORIGINS.has(origin)?origin:"https://app.yincorp.com.br");
    const id=property.external_id??property.db_id;
    if(id&&RETURN_ID.test(id))url.searchParams.set("imovel",id);
    url.searchParams.set("vid",visitorId);
    return safeReturnUrl(url.toString());
  }
  // Paid intent is a signal only. No inferred buyer preferences or attribution IDs.
  function paidContext(value){return record(value).isPaid===true?{isPaid:true,intent:null}:undefined;}
  function parseEnvelope(value){
    const r=record(value),context=record(r.context);
    if(r.version!==1||r.kind!=="property"||r.entryPoint!==ENTRY_POINT||
      ![r.visitorId,r.sessionId,r.transitionId].every(id=>typeof id==="string"&&UUID.test(id)))return null;
    const received=record(context.currentProperty);
    if((received.external_id!=null&&safeId(received.external_id)!==received.external_id)||
      (received.db_id!=null&&(typeof received.db_id!=="string"||!UUID.test(received.db_id))))return null;
    const p=propertyReference({external_id:received.external_id,db_id:received.db_id,inventory_source:received.inventory_source,
      source:received.source,name:received.name,neighborhood:received.neighborhood,city:received.city,
      bedrooms:received.bedrooms,price:received.price});
    const returnUrl=safeReturnUrl(r.returnUrl);
    if(!p||!returnUrl)return null;
    const envelope={version:1,kind:"property",entryPoint:ENTRY_POINT,visitorId:r.visitorId,sessionId:r.sessionId,
      transitionId:r.transitionId,returnUrl,context:{currentProperty:p}};
    const paid=paidContext(r.paidContext);
    if(paid)envelope.paidContext=paid;
    return envelope;
  }
  function transitionId(crypto){
    if(crypto&&typeof crypto.randomUUID==="function")return crypto.randomUUID();
    if(!crypto||typeof crypto.getRandomValues!=="function")return null;
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
    return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  }
  function buildEnvelope(property,input){
    const p=propertyReference(property),options=record(input);
    if(!p)return null;
    return parseEnvelope({version:1,kind:"property",entryPoint:ENTRY_POINT,visitorId:options.visitorId,
      sessionId:options.sessionId,transitionId:transitionId(options.crypto),
      returnUrl:propertyReturnUrl(p,options.visitorId,options.origin),context:{currentProperty:p},
      paidContext:options.isPaid?{isPaid:true}:undefined});
  }
  return {ENTRY_POINT,safeText,propertyReference,safeReturnUrl,parseEnvelope,buildEnvelope};
});
