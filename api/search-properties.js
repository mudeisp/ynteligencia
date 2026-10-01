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
      process.env.SUPABASE_URL ||
      "https://wzaegidwtdjuhqchpdpd.supabase.co";

    const SUPABASE_KEY =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY;

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
        body.source ||
        "novos"
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

    const normalize = value =>
      String(value || "")
        .normalize("NFD")
        .replace(
          /[\u0300-\u036f]/g,
          ""
        )
        .toLowerCase()
        .trim();

    /*
      ========================================================
      CONSULTA PAGINADA AO SUPABASE
      ========================================================

      Supabase/PostgREST normalmente limita uma resposta
      a 1000 registros.

      Portanto buscamos:

      0-999
      1000-1999
      2000-2999
      ...

      até acabar o inventário.
    */

    const PAGE_SIZE = 1000;

    /*
      Proteção.

      50 páginas = até 50.000 imóveis.
      Muito acima do estoque que você pretende usar agora.
    */
    const MAX_PAGES = 50;

    async function fetchInventoryPage(
      start,
      end
    ) {
      const params =
        new URLSearchParams();

      params.set(
        "active",
        "eq.true"
      );

      if (source === "novos") {
        params.set(
          "source",
          "eq.novos"
        );
      } else if (
        source === "usados"
      ) {
        params.set(
          "source",
          "eq.usados"
        );
      }

      params.set(
        "select",
        "*"
      );

      /*
        Ordenação estável é importante
        para paginação.
      */
      params.set(
        "order",
        "id.asc"
      );

      const url =
        `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`;

      const response =
        await fetch(
          url,
          {
            method: "GET",

            headers: {
              apikey:
                SUPABASE_KEY,

              Authorization:
                `Bearer ${SUPABASE_KEY}`,

              "Content-Type":
                "application/json",

              /*
                Range é o que permite escapar
                do limite padrão de 1000.
              */
              Range:
                `${start}-${end}`
            }
          }
        );

      const data =
        await response
          .json()
          .catch(() => []);

      if (!response.ok) {
        console.error(
          "SEARCH_PROPERTIES_PAGE_ERROR",
          {
            status:
              response.status,

            start,
            end,

            data
          }
        );

        throw new Error(
          "Falha ao consultar inventário"
        );
      }

      return Array.isArray(data)
        ? data
        : [];
    }

    /*
      Carrega todas as páginas.
    */

    let inventory = [];

    for (
      let page = 0;
      page < MAX_PAGES;
      page++
    ) {
      const start =
        page * PAGE_SIZE;

      const end =
        start +
        PAGE_SIZE -
        1;

      const rows =
        await fetchInventoryPage(
          start,
          end
        );

      inventory.push(
        ...rows
      );

      /*
        Quando vier menos de 1000,
        acabou o inventário.
      */
      if (
        rows.length <
        PAGE_SIZE
      ) {
        break;
      }
    }

    /*
      ========================================================
      HELPERS ÓRULO
      ========================================================
    */

    function rawOf(
      property
    ) {
      if (
        property?.rawData &&
        typeof property.rawData ===
          "object"
      ) {
        return property.rawData;
      }

      if (
        property?.raw_data &&
        typeof property.raw_data ===
          "object"
      ) {
        return property.raw_data;
      }

      return {};
    }

    function buildingOf(
      property
    ) {
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

    function typologyOf(
      property
    ) {
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

    function propertyName(
      property
    ) {
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

    function propertyValue(
      property
    ) {
      const typology =
        typologyOf(property);

      return (
        Number(
          property?.value
        ) ||
        Number(
          typology
            ?.discount_price
        ) ||
        Number(
          typology
            ?.original_price
        ) ||
        0
      );
    }

    function searchableText(
      property
    ) {
      const raw =
        rawOf(property);

      const building =
        buildingOf(property);

      const typology =
        typologyOf(property);

      return normalize(
        [
          /*
            Dados normalizados
          */
          property?.name,
          property?.neighborhood,
          property?.address,
          property?.description,

          /*
            Raw principal
          */
          raw?.name,
          raw?.title,
          raw?.project_name,
          raw?.development_name,
          raw?.building_name,

          /*
            Building Órulo
          */
          building?.name,
          building?.title,
          building?.commercial_name,
          building?.development_name,
          building?.description,

          /*
            Endereço
          */
          building
            ?.address
            ?.neighborhood,

          building
            ?.address
            ?.street,

          building
            ?.address
            ?.city,

          /*
            Tipologia
          */
          typology?.name,
          typology?.type
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    /*
      ========================================================
      FILTROS
      ========================================================
    */

    const projectNormalized =
      normalize(project);

    const neighborhoodNormalized =
      normalize(
        neighborhood
      );

    const queryNormalized =
      normalize(query);

    /*
      Palavras genéricas não ajudam
      na busca textual livre.
    */

    const stopWords =
      new Set([
        "voce",
        "voces",
        "tem",
        "tenho",
        "quero",
        "procuro",

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
        "acima",
        "entre",

        "mil",
        "milhao",
        "milhoes",

        "reais",
        "para",
        "por",
        "com",

        "uma",
        "um"
      ]);

    const queryTokens =
      queryNormalized
        .split(/\s+/)
        .map(
          token =>
            token.trim()
        )
        .filter(
          token =>
            token.length >= 3 &&
            !stopWords.has(
              token
            ) &&
            !/^\d/.test(
              token
            )
        );

    /*
      ========================================================
      BUSCA
      ========================================================
    */

    let matches =
      inventory.filter(
        property => {
          if (!property) {
            return false;
          }

          const text =
            searchableText(
              property
            );

          /*
            EMPREENDIMENTO
          */

          if (
            projectNormalized
          ) {
            const tokens =
              projectNormalized
                .split(/\s+/)
                .filter(Boolean);

            if (
              !tokens.every(
                token =>
                  text.includes(
                    token
                  )
              )
            ) {
              return false;
            }
          }

          /*
            BAIRRO
          */

          if (
            neighborhoodNormalized
          ) {
            const tokens =
              neighborhoodNormalized
                .split(/\s+/)
                .filter(Boolean);

            if (
              !tokens.every(
                token =>
                  text.includes(
                    token
                  )
              )
            ) {
              return false;
            }
          }

          /*
            DORMITÓRIOS
          */

          if (bedrooms) {
            const typology =
              typologyOf(
                property
              );

            const propertyBedrooms =
              Number(
                property
                  ?.bedrooms ||
                typology
                  ?.bedrooms ||
                0
              ) || 0;

            if (
              propertyBedrooms !==
              bedrooms
            ) {
              return false;
            }
          }

          /*
            PREÇO
          */

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

          /*
            BUSCA LIVRE

            Importante para consultas como:

            Upper Brooklin
            Well Perdizes
            Brooklin
            Cyrela
          */

          if (
            queryNormalized &&
            !projectNormalized &&
            !neighborhoodNormalized
          ) {
            /*
              Pelo menos um token relevante
              precisa aparecer.
            */

            if (
              queryTokens.length &&
              !queryTokens.some(
                token =>
                  text.includes(
                    token
                  )
              )
            ) {
              return false;
            }
          }

          return true;
        }
      );

    /*
      ========================================================
      RANKING
      ========================================================

      Primeiro imóveis cujo nome contém
      mais palavras pesquisadas.

      Depois menor preço.
    */

    function relevanceScore(
      property
    ) {
      if (
        !queryTokens.length
      ) {
        return 0;
      }

      const text =
        searchableText(
          property
        );

      return queryTokens
        .reduce(
          (
            score,
            token
          ) =>
            score +
            (
              text.includes(
                token
              )
                ? 1
                : 0
            ),
          0
        );
    }

    matches.sort(
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

    const total =
      matches.length;

    matches =
      matches.slice(
        0,
        resultLimit
      );

    /*
      ========================================================
      RESPOSTA
      ========================================================
    */

    const results =
      matches.map(
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
                property
                  ?.suites ||
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
              building
                ?.address ||
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
      "SEARCH_PROPERTIES",
      {
        query,
        project,
        neighborhood,
        bedrooms,
        minPrice,
        maxPrice,
        source,

        inventory_count:
          inventory.length,

        total,

        pages_loaded:
          Math.ceil(
            inventory.length /
            PAGE_SIZE
          )
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

        inventory_count:
          inventory.length,

        total,

        matches:
          results
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
