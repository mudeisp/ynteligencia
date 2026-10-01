export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    /*
      ========================================================
      CONFIGURAÇÃO
      ========================================================
    */

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

    /*
      ========================================================
      ENTRADA
      ========================================================
    */

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

    /*
      ========================================================
      NORMALIZAÇÃO
      ========================================================
    */

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
        .split(/\s+/)
        .map(token => token.trim())
        .filter(
          token =>
            token.length >= 3 &&
            !STOP_WORDS.has(token) &&
            !/^\d/.test(token)
        );
    }

    /*
      ========================================================
      HELPERS DO ÓRULO
      ========================================================
    */

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
      const raw =
        rawOf(property);

      if (
        raw?.building &&
        typeof raw.building === "object"
      ) {
        return raw.building;
      }

      return {};
    }

    function typologyOf(property) {
      const raw =
        rawOf(property);

      if (
        raw?.typology &&
        typeof raw.typology === "object"
      ) {
        return raw.typology;
      }

      return {};
    }

    function propertyName(property) {
      const raw =
        rawOf(property);

      const building =
        buildingOf(property);

      return (
        property?.name ||
        building?.name ||
        building?.commercial_name ||
        building?.title ||
        building?.development_name ||
        raw?.name ||
        raw?.title ||
        raw?.project_name ||
        raw?.development_name ||
        raw?.building_name ||
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
        building?.address?.neighborhood ||
        raw?.neighborhood ||
        ""
      );
    }

    function propertyValue(property) {
      const typology =
        typologyOf(property);

      return (
        Number(property?.value) ||
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
          property?.name,
          property?.neighborhood,
          property?.address,
          property?.description,

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

    /*
      ========================================================
      REQUEST AO SUPABASE
      ========================================================
    */

    async function requestSupabase(params) {
      const url =
        `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`;

      const response =
        await fetch(url, {
          method: "GET",

          headers: {
            apikey:
              SUPABASE_KEY,

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

    /*
      ========================================================
      FILTROS BASE
      ========================================================
    */

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

      if (neighborhood) {
        params.set(
          "neighborhood",
          `ilike.*${neighborhood}*`
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
          "value",
          `gte.${minPrice}`
        );
      }

      if (maxPrice) {
        params.append(
          "value",
          `lte.${maxPrice}`
        );
      }

      return params;
    }

    /*
      ========================================================
      BUSCA RÁPIDA
      ========================================================
    */

    const searchText =
      project ||
      query ||
      "";

    const tokens =
      queryTokens(searchText);

    let candidates = [];

    /*
      Caso haja texto como:

      Upper Brooklin
      Well Perdizes
      Brooklin
      Cyrela

      usamos o primeiro termo relevante
      para reduzir drasticamente o universo.
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

      /*
        SINTAXE CORRETA DO POSTGREST:

        or=(campo.operador.valor,campo.operador.valor)
      */

      params.set(
        "or",
        `(` +
          `name.ilike.*${strongestToken}*,` +
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
      /*
        Busca estruturada:
        bairro, dormitórios, preço etc.
      */

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
      ========================================================
      FALLBACK PARA raw_data DO ÓRULO
      ========================================================

      Se não achamos nada em name/neighborhood,
      pode acontecer de o nome existir somente
      dentro do JSON do Órulo.

      Nesse caso fazemos uma busca paginada,
      mas SOMENTE como fallback.
    */

    if (
      candidates.length === 0 &&
      tokens.length
    ) {
      console.log(
        "SEARCH_PROPERTIES_RAW_FALLBACK",
        {
          query,
          tokens
        }
      );

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
          "id.asc"
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

          /*
            Já temos candidatos suficientes.
          */

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

    /*
      ========================================================
      FILTRO FINO
      ========================================================
    */

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

    /*
      Dormitórios novamente,
      incluindo raw_data.
    */

    if (bedrooms) {
      candidates =
        candidates.filter(
          property =>
            propertyBedrooms(
              property
            ) === bedrooms
        );
    }

    /*
      Preço novamente,
      incluindo preço da tipologia.
    */

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

    /*
      ========================================================
      RANKING
      ========================================================
    */

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

      /*
        Nome completo exato ganha prioridade.
      */

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

    /*
      ========================================================
      REMOVE DUPLICADOS
      ========================================================
    */

    const seen =
      new Set();

    candidates =
      candidates.filter(
        property => {
          const id =
            String(
              property?.id ||
              property
                ?.building_id ||
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

    /*
      ========================================================
      RESPOSTA
      ========================================================
    */

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
                  property?.id ||
                  ""
                ),

              building_id:
                String(
                  raw?.building_id ||
                  building?.id ||
                  property
                    ?.building_id ||
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
                building
                  ?.address
                  ?.city ||
                "São Paulo",

              value:
                propertyValue(
                  property
                ),

              area:
                Number(
                  property?.area ||
                  typology
                    ?.private_area
                ) || 0,

              bedrooms:
                propertyBedrooms(
                  property
                ),

              suites:
                Number(
                  property?.suites ||
                  typology?.suites
                ) || 0,

              parking:
                Number(
                  property?.parking ||
                  typology?.parking
                ) || 0,

              stock:
                Number(
                  property?.stock ||
                  typology?.stock
                ) || 0,

              source:
                property?.source ||
                "",

              status:
                property?.status ||
                building?.stage ||
                building?.status ||
                "",

              developer:
                building?.developer ||
                building?.publisher ||
                "",

              address:
                building?.address ||
                null
            };
          }
        );

    /*
      ========================================================
      LOG
      ========================================================
    */

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

        candidate_count:
          candidates.length,

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

    /*
      ========================================================
      RETURN
      ========================================================
    */

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

    /*
      Quando requestSupabase lança
      o objeto com status/data.
    */

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
