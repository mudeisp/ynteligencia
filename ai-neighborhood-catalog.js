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
