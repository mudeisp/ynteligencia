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
