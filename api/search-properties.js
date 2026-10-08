import { createRequire } from "module";

const require = createRequire(import.meta.url);
const neighborhoodCatalog = require("../ai-neighborhood-catalog.js");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL;

    const SUPABASE_KEY =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL) {
      return res.status(500).json({
        success: false,
        error: "SUPABASE_URL não configurada"
      });
    }

    if (!SUPABASE_KEY) {
      return res.status(500).json({
        success: false,
        error: "Chave do Supabase não configurada"
      });
    }

    const body = req.body || {};

    const query =
      String(body.query || "").trim();

    const neighborhood =
      String(
        body.neighborhood ||
        body.bairro ||
        ""
      ).trim();

    const project =
      String(
        body.project ||
        body.empreendimento ||
        body.name ||
        ""
      ).trim();

    const bedrooms =
      Number(
        body.bedrooms ||
        body.dormitorios ||
        0
      ) || 0;

    const minPrice =
      Number(
        body.min_price ||
        body.valor_min ||
        0
      ) || 0;

    const maxPrice =
      Number(
        body.max_price ||
        body.valor_max ||
        0
      ) || 0;

    const source =
      String(
        body.source || "novos"
      )
        .trim()
        .toLowerCase();

    const resultLimit =
      Math.min(
        Math.max(
          Number(body.limit) || 20,
          1
        ),
        50
      );

    function normalize(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    }

    const STOP_WORDS =
      new Set([
        "voce",
        "voces",
        "tem",
        "tenho",
        "quero",
        "procuro",
        "procura",
        "procurando",
        "imovel",
        "imoveis",
        "apartamento",
        "apartamentos",
        "lancamento",
        "lancamentos",
        "novo",
        "novos",
        "usado",
        "usados",
        "dorm",
        "dorms",
        "dormitorio",
        "dormitorios",
        "quarto",
        "quartos",
        "ate",
        "entre",
        "acima",
        "abaixo",
        "mil",
        "milhao",
        "milhoes",
        "reais",
        "com",
        "para",
        "por",
        "uma",
        "um",
        "de",
        "do",
        "da",
        "no",
        "na",
        "em"
      ]);

    function queryTokens(value) {
      return normalize(value)
        .replace(/[?!.,;:()"“”]/g, " ")
        .split(/\s+/)
        .map(token => token.trim())
        .filter(
          token =>
            token.length >= 3 &&
            !token.includes("?") &&
            !STOP_WORDS.has(token) &&
            !/^\d/.test(token)
        );
    }

    function rawOf(property) {
      if (
        property?.raw_data &&
        typeof property.raw_data === "object"
      ) {
        return property.raw_data;
      }

      if (
        property?.rawData &&
        typeof property.rawData === "object"
      ) {
        return property.rawData;
      }

      return {};
    }

    function buildingOf(property) {
      const raw = rawOf(property);

      return (
        raw?.building &&
        typeof raw.building === "object"
      )
        ? raw.building
        : {};
    }

    function typologyOf(property) {
      const raw = rawOf(property);

      return (
        raw?.typology &&
        typeof raw.typology === "object"
      )
        ? raw.typology
        : {};
    }

    function propertyName(property) {
      const raw =
        rawOf(property);

      const building =
        buildingOf(property);

      return (
        property?.development_name ||
        property?.title ||
        building?.name ||
        building?.commercial_name ||
        building?.title ||
        raw?.name ||
        raw?.title ||
        ""
      );
    }

    function propertyNeighborhood(property) {
      const raw =
        rawOf(property);

      const building =
        buildingOf(property);

      return (
        property?.neighborhood ||
        building?.address?.area ||
        building?.address?.neighborhood ||
        raw?.neighborhood ||
        ""
      );
    }

    function propertyCity(property) {
      const raw = rawOf(property);
      const building = buildingOf(property);

      return (
        property?.city ||
        building?.address?.city ||
        raw?.city ||
        ""
      );
    }

    function propertyState(property) {
      const raw = rawOf(property);
      const building = buildingOf(property);

      return (
        property?.state ||
        building?.address?.state ||
        raw?.state ||
        ""
      );
    }

    function propertyValue(property) {
      const typology =
        typologyOf(property);

      return (
        Number(property?.price) ||
        Number(typology?.discount_price) ||
        Number(typology?.original_price) ||
        0
      );
    }

    function propertyBedrooms(property) {
      const typology =
        typologyOf(property);

      return (
        Number(property?.bedrooms) ||
        Number(typology?.bedrooms) ||
        0
      );
    }

    function searchableText(property) {
      const raw =
        rawOf(property);

      const building =
        buildingOf(property);

      const typology =
        typologyOf(property);

      return normalize(
        [
          property?.title,
          property?.development_name,
          property?.neighborhood,
          property?.city,

          raw?.name,
          raw?.title,
          raw?.project_name,
          raw?.development_name,
          raw?.building_name,

          building?.name,
          building?.title,
          building?.commercial_name,
          building?.development_name,
          building?.description,

          building?.address?.area,
          building?.address?.neighborhood,
          building?.address?.street,
          building?.address?.city,

          typology?.name,
          typology?.type
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    async function requestSupabase(params) {
      const url =
        `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`;

      const response =
        await fetch(url, {
          method: "GET",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization:
              `Bearer ${SUPABASE_KEY}`,
            "Content-Type":
              "application/json"
          }
        });

      const data =
        await response
          .json()
          .catch(() => []);

      if (!response.ok) {
        console.error(
          "SEARCH_PROPERTIES_SUPABASE_ERROR",
          response.status,
          data
        );

        throw {
          status:
            response.status,
          data
        };
      }

      return Array.isArray(data)
        ? data
        : [];
    }

    function uniqueNeighborhoods(values) {
      const seen = new Set();
      const result = [];

      for (const value of values) {
        const text = String(value || "").trim();
        const key = normalize(text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(text);
      }

      return result;
    }

    function quoteFilter(value) {
      return `"${String(value).replace(/"/g, "")}"`;
    }

    const neighborhoodMode =
      body.neighborhoodMode === "family"
        ? "family"
        : "exact";

    const wantedNeighborhoods = uniqueNeighborhoods([
      ...(Array.isArray(body.neighborhoods)
        ? body.neighborhoods
        : []),
      neighborhood
    ]);

    const resolvedNeighborhood = neighborhoodCatalog.resolveNeighborhood(
      neighborhood || wantedNeighborhoods[0] || ""
    );

    function createBaseParams() {
      const params =
        new URLSearchParams();

      params.set(
        "select",
        "*"
      );

      params.set(
        "active",
        "eq.true"
      );

      if (source === "novos") {
        params.set(
          "source",
          "eq.novos"
        );
      }

      if (source === "usados") {
        params.set(
          "source",
          "eq.usados"
        );
      }

      if (resolvedNeighborhood) {
        const filters = neighborhoodCatalog.postgrestNeighborhoodFilters(
          resolvedNeighborhood
        );

        if (filters.neighborhood) {
          params.set("neighborhood", filters.neighborhood);
        }

        if (filters.or) {
          params.set("or", filters.or);
        }

        params.set("city", filters.city);
        params.set("state", filters.state);
      } else if (neighborhoodMode === "family" && neighborhood) {
        const familyRoot = String(neighborhood).replace(/["*,()]/g, "");
        const familyNames = wantedNeighborhoods.length
          ? wantedNeighborhoods
          : [neighborhood];
        const familyFilters = [
          ...familyNames.map(
            name => `neighborhood.ilike.${quoteFilter(name)}`
          ),
          `neighborhood.ilike.${quoteFilter(`${familyRoot}*`)}`
        ];

        params.set(
          "or",
          `(${familyFilters.join(",")})`
        );
      } else if (wantedNeighborhoods.length === 1) {
        params.set(
          "neighborhood",
          `ilike.${quoteFilter(wantedNeighborhoods[0])}`
        );
      } else if (wantedNeighborhoods.length > 1) {
        params.set(
          "or",
          `(${wantedNeighborhoods
            .map(name => `neighborhood.ilike.${quoteFilter(name)}`)
            .join(",")})`
        );
      }

      if (bedrooms) {
        params.set(
          "bedrooms",
          `eq.${bedrooms}`
        );
      }

      if (minPrice) {
        params.append(
          "price",
          `gte.${minPrice}`
        );
      }

      if (maxPrice) {
        params.append(
          "price",
          `lte.${maxPrice}`
        );
      }

      return params;
    }

    const searchText =
      project ||
      query ||
      "";

    const tokens =
      queryTokens(searchText);

    let candidates = [];

    /*
      Busca rápida direto nas colunas reais:
      development_name
      title
      neighborhood
    */
    if (
      !neighborhood &&
      tokens.length
    ) {
      const params =
        createBaseParams();

      const strongestToken =
        tokens[0]
          .replace(/,/g, "")
          .replace(/[()]/g, "");

      params.set(
        "or",
        `(` +
          `development_name.ilike.*${strongestToken}*,` +
          `title.ilike.*${strongestToken}*,` +
          `neighborhood.ilike.*${strongestToken}*` +
        `)`
      );

      params.set(
        "limit",
        "200"
      );

      candidates =
        await requestSupabase(
          params
        );
    } else {
      const params =
        createBaseParams();

      params.set(
        "limit",
        "200"
      );

      candidates =
        await requestSupabase(
          params
        );
    }

    /*
      Fallback:
      se não achou nas colunas normalizadas,
      procura no raw_data.
    */
    if (
      candidates.length === 0 &&
      tokens.length
    ) {
      const PAGE_SIZE =
        1000;

      const MAX_PAGES =
        20;

      const fallbackMatches =
        [];

      for (
        let page = 0;
        page < MAX_PAGES;
        page++
      ) {
        const params =
          createBaseParams();

        params.set(
          "order",
          "external_id.asc"
        );

        const url =
          `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`;

        const start =
          page * PAGE_SIZE;

        const end =
          start +
          PAGE_SIZE -
          1;

        const response =
          await fetch(
            url,
            {
              headers: {
                apikey:
                  SUPABASE_KEY,

                Authorization:
                  `Bearer ${SUPABASE_KEY}`,

                "Content-Type":
                  "application/json",

                Range:
                  `${start}-${end}`
              }
            }
          );

        const rows =
          await response
            .json()
            .catch(() => []);

        if (!response.ok) {
          console.error(
            "SEARCH_PROPERTIES_FALLBACK_ERROR",
            response.status,
            rows
          );

          break;
        }

        if (
          !Array.isArray(rows) ||
          rows.length === 0
        ) {
          break;
        }

        for (
          const property of rows
        ) {
          const text =
            searchableText(
              property
            );

          if (
            tokens.every(
              token =>
                text.includes(
                  token
                )
            )
          ) {
            fallbackMatches.push(
              property
            );
          }

          if (
            fallbackMatches.length >=
            Math.max(
              resultLimit * 3,
              30
            )
          ) {
            break;
          }
        }

        if (
          fallbackMatches.length >=
          Math.max(
            resultLimit * 3,
            30
          )
        ) {
          break;
        }

        if (
          rows.length <
          PAGE_SIZE
        ) {
          break;
        }
      }

      candidates =
        fallbackMatches;
    }

    const projectTokens =
      project
        ? queryTokens(project)
        : [];

    const finalTokens =
      projectTokens.length
        ? projectTokens
        : tokens;

    if (
      finalTokens.length
    ) {
      candidates =
        candidates.filter(
          property => {
            const text =
              searchableText(
                property
              );

            return finalTokens.every(
              token =>
                text.includes(
                  token
                )
            );
          }
        );
    }

    if (resolvedNeighborhood) {
      candidates = candidates.filter(property =>
        neighborhoodCatalog.propertyMatchesNeighborhood(
          {
            neighborhood: propertyNeighborhood(property),
            city: propertyCity(property),
            state: propertyState(property)
          },
          resolvedNeighborhood
        )
      );
    } else if (neighborhood || wantedNeighborhoods.length) {
      const familyRoot = normalize(neighborhood);
      const wanted = new Set(
        wantedNeighborhoods.map(name => normalize(name))
      );

      candidates = candidates.filter(property => {
        const key = normalize(propertyNeighborhood(property));
        if (!key) return false;

        if (neighborhoodMode === "family" && familyRoot) {
          return key === familyRoot || key.startsWith(`${familyRoot} `);
        }

        return wanted.has(key);
      });
    }

    if (bedrooms) {
      candidates =
        candidates.filter(
          property =>
            propertyBedrooms(
              property
            ) === bedrooms
        );
    }

    if (
      minPrice ||
      maxPrice
    ) {
      candidates =
        candidates.filter(
          property => {
            const value =
              propertyValue(
                property
              );

            if (
              minPrice &&
              value < minPrice
            ) {
              return false;
            }

            if (
              maxPrice &&
              value > maxPrice
            ) {
              return false;
            }

            return true;
          }
        );
    }

    function relevanceScore(
      property
    ) {
      if (
        !finalTokens.length
      ) {
        return 0;
      }

      const text =
        searchableText(
          property
        );

      const name =
        normalize(
          propertyName(
            property
          )
        );

      let score = 0;

      for (
        const token of
        finalTokens
      ) {
        if (
          name.includes(
            token
          )
        ) {
          score += 10;
        } else if (
          text.includes(
            token
          )
        ) {
          score += 2;
        }
      }

      const normalizedSearch =
        normalize(
          project ||
          query
        );

      if (
        normalizedSearch &&
        name.includes(
          normalizedSearch
        )
      ) {
        score += 50;
      }

      return score;
    }

    candidates.sort(
      (a, b) => {
        const scoreA =
          relevanceScore(a);

        const scoreB =
          relevanceScore(b);

        if (
          scoreA !== scoreB
        ) {
          return (
            scoreB -
            scoreA
          );
        }

        return (
          propertyValue(a) ||
          Infinity
        ) -
        (
          propertyValue(b) ||
          Infinity
        );
      }
    );

    const seen =
      new Set();

    candidates =
      candidates.filter(
        property => {
          const id =
            String(
              property?.external_id ||
              ""
            );

          if (!id) {
            return true;
          }

          if (
            seen.has(id)
          ) {
            return false;
          }

          seen.add(id);

          return true;
        }
      );

    const total =
      candidates.length;

    const matches =
      candidates
        .slice(
          0,
          resultLimit
        )
        .map(
          property => {
            const raw =
              rawOf(
                property
              );

            const building =
              buildingOf(
                property
              );

            const typology =
              typologyOf(
                property
              );

            return {
              id:
                String(
                  property?.external_id ||
                  ""
                ),

              building_id:
                String(
                  raw?.building_id ||
                  building?.id ||
                  ""
                ),

              name:
                propertyName(
                  property
                ),

              neighborhood:
                propertyNeighborhood(
                  property
                ),

              city:
                property?.city ||
                building?.address?.city ||
                "São Paulo",

              value:
                propertyValue(
                  property
                ),

              area:
                Number(
                  property?.area ||
                  typology?.private_area
                ) || 0,

              bedrooms:
                propertyBedrooms(
                  property
                ),

              bathrooms:
                Number(
                  property?.bathrooms ||
                  typology?.bathrooms
                ) || 0,

              suites:
                Number(
                  typology?.suites
                ) || 0,

              parking:
                Number(
                  property?.parking_spaces ||
                  typology?.parking
                ) || 0,

              stock:
                Number(
                  typology?.stock
                ) || 0,

              source:
                property?.source ||
                "",

              status:
                building?.stage ||
                building?.status ||
                "",

              developer:
                building?.developer ||
                building?.publisher ||
                "",

              image_url:
                property?.image_url ||
                null,

              property_url:
                property?.property_url ||
                null,

              address:
                building?.address ||
                null
            };
          }
        );

    console.log(
      "SEARCH_PROPERTIES_RESULT",
      {
        query,
        project,
        neighborhood,
        bedrooms,
        minPrice,
        maxPrice,
        source,
        total,
        returned:
          matches.length,
        first_matches:
          matches
            .slice(0, 5)
            .map(item => ({
              name:
                item.name,
              neighborhood:
                item.neighborhood,
              value:
                item.value
            }))
      }
    );

    return res
      .status(200)
      .json({
        success: true,

        filters: {
          query,
          project,
          neighborhood,
          bedrooms,
          min_price:
            minPrice,
          max_price:
            maxPrice,
          source
        },

        total,

        matches
      });

  } catch (error) {
    console.error(
      "SEARCH_PROPERTIES_FATAL",
      error
    );

    if (
      error &&
      typeof error === "object" &&
      error.data
    ) {
      return res
        .status(502)
        .json({
          success: false,
          error:
            "Falha ao consultar inventário",
          details:
            error.data
        });
    }

    return res
      .status(500)
      .json({
        success: false,
        error:
          "Erro interno na busca de imóveis",
        details:
          String(
            error?.message ||
            error
          )
      });
  }
}
