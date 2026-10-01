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
        body.source ||
        "novos"
      )
        .trim()
        .toLowerCase();

    const limit =
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
        .replace(
          /[\u0300-\u036f]/g,
          ""
        )
        .toLowerCase()
        .trim();
    }

    /*
      Retira palavras que não ajudam
      a encontrar um empreendimento/bairro.
    */
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
      MONTA CONSULTA SUPABASE
      ========================================================
    */

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

    /*
      Bairro estruturado.
    */

    if (neighborhood) {
      params.set(
        "neighborhood",
        `ilike.*${neighborhood}*`
      );
    }

    /*
      Dormitórios.
    */

    if (bedrooms) {
      params.set(
        "bedrooms",
        `eq.${bedrooms}`
      );
    }

    /*
      Preços.
    */

    if (minPrice) {
      params.set(
        "value",
        `gte.${minPrice}`
      );
    }

    /*
      PostgREST não permite repetir a mesma chave
      value duas vezes usando URLSearchParams.set.
      Então preço máximo entra depois via append.
    */

    if (maxPrice) {
      if (minPrice) {
        params.append(
          "value",
          `lte.${maxPrice}`
        );
      } else {
        params.set(
          "value",
          `lte.${maxPrice}`
        );
      }
    }

    /*
      ========================================================
      BUSCA POR EMPREENDIMENTO / TEXTO
      ========================================================

      O ponto importante:
      não carregamos 1.000 / 5.000 imóveis.

      Procuramos diretamente pelos campos indexáveis
      da tabela.
    */

    let searchValue =
      project ||
      query ||
      "";

    const tokens =
      queryTokens(
        searchValue
      );

    /*
      Para "Upper Brooklin", procuramos:

      name contém Upper
      OU neighborhood contém Upper
      OU description contém Upper

      Depois fazemos ranking com todos os tokens.
    */

    if (
      !neighborhood &&
      tokens.length
    ) {
      const strongestToken =
        tokens[0];

      const escaped =
        strongestToken
          .replace(/,/g, "");

      params.set(
        "or",
        [
          `name.ilike.*${escaped}*`,
          `neighborhood.ilike.*${escaped}*`,
          `description.ilike.*${escaped}*`
        ].join(",")
      );
    }

    /*
      Traz apenas um conjunto pequeno de candidatos.
    */

    params.set(
      "limit",
      "100"
    );

    params.set(
      "order",
      "value.asc.nullslast"
    );

    const url =
      `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`;

    console.log(
      "SEARCH_PROPERTIES_QUERY",
      {
        query,
        project,
        neighborhood,
        bedrooms,
        minPrice,
        maxPrice,
        source,
        tokens
      }
    );

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
              "application/json"
          }
        }
      );

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

      return res
        .status(502)
        .json({
          success: false,

          error:
            "Falha ao consultar inventário",

          details:
            data
        });
    }

    let candidates =
      Array.isArray(data)
        ? data
        : [];

    /*
      ========================================================
      HELPERS DO RAW ÓRULO
      ========================================================
    */

    function rawOf(property) {
      if (
        property?.raw_data &&
        typeof property.raw_data ===
          "object"
      ) {
        return property.raw_data;
      }

      if (
        property?.rawData &&
        typeof property.rawData ===
          "object"
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
        typeof raw.building ===
          "object"
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
        typeof raw.typology ===
          "object"
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

    function propertyNeighborhood(
      property
    ) {
      const raw =
        rawOf(property);

      const building =
        buildingOf(property);

      return (
        property?.neighborhood ||
        building
          ?.address
          ?.neighborhood ||
        raw?.neighborhood ||
        ""
      );
    }

    function propertyValue(property) {
      const typology =
        typologyOf(property);

      return (
        Number(
          property?.value
        ) ||
        Number(
          typology?.discount_price
        ) ||
        Number(
          typology?.original_price
        ) ||
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
          property?.description,
          property?.address,

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

          building
            ?.address
            ?.neighborhood,

          building
            ?.address
            ?.street,

          building
            ?.address
            ?.city,

          typology?.name,
          typology?.type
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    /*
      ========================================================
      FILTRO FINO NOS CANDIDATOS
      ========================================================
    */

    if (tokens.length) {
      candidates =
        candidates.filter(
          property => {
            const text =
              searchableText(
                property
              );

            /*
              Todos os tokens relevantes precisam
              aparecer em algum lugar.

              Ex:
              Upper Brooklin
              → upper + brooklin
            */
            return tokens.every(
              token =>
                text.includes(
                  token
                )
            );
          }
        );
    }

    /*
      Caso project tenha sido passado explicitamente.
    */

    if (project) {
      const projectTokens =
        queryTokens(project);

      candidates =
        candidates.filter(
          property => {
            const text =
              searchableText(
                property
              );

            return projectTokens.every(
              token =>
                text.includes(
                  token
                )
            );
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
      const text =
        searchableText(
          property
        );

      let score = 0;

      const name =
        normalize(
          propertyName(
            property
          )
        );

      for (
        const token of tokens
      ) {
        if (
          name.includes(token)
        ) {
          score += 5;
        } else if (
          text.includes(token)
        ) {
          score += 1;
        }
      }

      return score;
    }

    candidates.sort(
      (a, b) => {
        const scoreDiff =
          relevanceScore(b) -
          relevanceScore(a);

        if (scoreDiff !== 0) {
          return scoreDiff;
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

    const total =
      candidates.length;

    const matches =
      candidates
        .slice(
          0,
          limit
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
                Number(
                  property
                    ?.bedrooms ||
                  typology
                    ?.bedrooms
                ) || 0,

              suites:
                Number(
                  property?.suites ||
                  typology
                    ?.suites
                ) || 0,

              parking:
                Number(
                  property
                    ?.parking ||
                  typology
                    ?.parking
                ) || 0,

              stock:
                Number(
                  property?.stock ||
                  typology
                    ?.stock
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
                building
                  ?.developer ||
                building
                  ?.publisher ||
                "",

              address:
                building?.address ||
                null
            };
          }
        );

    console.log(
      "SEARCH_PROPERTIES_RESULT",
      {
        candidate_count:
          data?.length || 0,

        total,

        returned:
          matches.length,

        first_matches:
          matches
            .slice(0, 3)
            .map(
              item =>
                item.name
            )
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

        candidate_count:
          Array.isArray(data)
            ? data.length
            : 0,

        total,

        matches
      });

  } catch (error) {
    console.error(
      "SEARCH_PROPERTIES_FATAL",
      error
    );

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
