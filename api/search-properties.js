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
      process.env.SUPABASE_URL ||
      "https://wzaegidwtdjuhqchpdpd.supabase.co";

    const SUPABASE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_KEY) {
      return res.status(500).json({
        success: false,
        error: "Chave do Supabase não configurada"
      });
    }

    const body = req.body || {};

    const query = String(body.query || "").trim();

    const neighborhood =
      String(body.neighborhood || body.bairro || "")
        .trim();

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
      String(body.source || "novos")
        .trim()
        .toLowerCase();

    const limit = Math.min(
      Math.max(Number(body.limit) || 20, 1),
      50
    );

    const normalize = value =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    /*
      ========================================================
      BUSCA PRINCIPAL
      ========================================================

      Buscamos candidatos reais no Supabase.

      A filtragem final é feita no servidor para conseguirmos
      procurar também dentro do rawData vindo do Órulo.
    */

    const params = new URLSearchParams();

    params.set("active", "eq.true");

    if (source === "novos") {
      params.set("source", "eq.novos");
    } else if (source === "usados") {
      params.set("source", "eq.usados");
    }

    params.set("select", "*");

    /*
      Pegamos um conjunto de candidatos.

      Para a base atual funciona muito bem.
      Mais para frente, quando você colocar os 8 mil usados,
      vamos criar colunas normalizadas/indexadas e eliminar
      qualquer necessidade de varredura maior.
    */
    params.set("limit", "5000");

    const url =
      `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const data = await response
      .json()
      .catch(() => []);

    if (!response.ok) {
      console.error(
        "SEARCH_PROPERTIES_SUPABASE_ERROR",
        response.status,
        data
      );

      return res.status(502).json({
        success: false,
        error: "Falha ao consultar inventário"
      });
    }

    const inventory =
      Array.isArray(data) ? data : [];

    /*
      ========================================================
      HELPERS ÓRULO
      ========================================================
    */

    function rawOf(property) {
      return property?.rawData &&
        typeof property.rawData === "object"
        ? property.rawData
        : property?.raw_data &&
          typeof property.raw_data === "object"
        ? property.raw_data
        : {};
    }

    function buildingOf(property) {
      const raw = rawOf(property);

      return raw?.building &&
        typeof raw.building === "object"
        ? raw.building
        : {};
    }

    function typologyOf(property) {
      const raw = rawOf(property);

      return raw?.typology &&
        typeof raw.typology === "object"
        ? raw.typology
        : {};
    }

    function propertyName(property) {
      const raw = rawOf(property);
      const building = buildingOf(property);

      return (
        property?.name ||
        building?.name ||
        building?.commercial_name ||
        building?.title ||
        raw?.name ||
        raw?.title ||
        raw?.project_name ||
        raw?.development_name ||
        raw?.building_name ||
        ""
      );
    }

    function propertyNeighborhood(property) {
      const raw = rawOf(property);
      const building = buildingOf(property);

      return (
        property?.neighborhood ||
        building?.address?.neighborhood ||
        raw?.neighborhood ||
        ""
      );
    }

    function searchableText(property) {
      const raw = rawOf(property);
      const building = buildingOf(property);

      return normalize([
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
        building?.address?.city
      ]
        .filter(Boolean)
        .join(" "));
    }

    /*
      ========================================================
      FILTRAGEM
      ========================================================
    */

    const projectNormalized =
      normalize(project);

    const neighborhoodNormalized =
      normalize(neighborhood);

    const queryNormalized =
      normalize(query);

    let matches = inventory.filter(property => {
      if (!property) return false;

      const text =
        searchableText(property);

      /*
        Empreendimento
      */
      if (projectNormalized) {
        const projectTokens =
          projectNormalized
            .split(/\s+/)
            .filter(Boolean);

        if (
          !projectTokens.every(token =>
            text.includes(token)
          )
        ) {
          return false;
        }
      }

      /*
        Bairro
      */
      if (neighborhoodNormalized) {
        const neighborhoodTokens =
          neighborhoodNormalized
            .split(/\s+/)
            .filter(Boolean);

        if (
          !neighborhoodTokens.every(token =>
            text.includes(token)
          )
        ) {
          return false;
        }
      }

      /*
        Dormitórios
      */
      if (bedrooms) {
        const typology =
          typologyOf(property);

        const propertyBedrooms =
          Number(
            property?.bedrooms ||
            typology?.bedrooms ||
            0
          ) || 0;

        if (
          propertyBedrooms !== bedrooms
        ) {
          return false;
        }
      }

      /*
        Preço
      */
      const value =
        Number(property?.value) || 0;

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
        Busca textual livre
      */
      if (
        queryNormalized &&
        !projectNormalized &&
        !neighborhoodNormalized
      ) {
        const tokens =
          queryNormalized
            .split(/\s+/)
            .filter(token =>
              token.length >= 3
            );

        if (
          tokens.length &&
          !tokens.some(token =>
            text.includes(token)
          )
        ) {
          return false;
        }
      }

      return true;
    });

    /*
      Ordena por preço crescente como padrão.
    */
    matches.sort(
      (a, b) =>
        (Number(a?.value) || Infinity) -
        (Number(b?.value) || Infinity)
    );

    const total =
      matches.length;

    matches =
      matches.slice(0, limit);

    /*
      ========================================================
      RESPOSTA LIMPA
      ========================================================
    */

    const results =
      matches.map(property => {
        const raw =
          rawOf(property);

        const building =
          buildingOf(property);

        const typology =
          typologyOf(property);

        return {
          id:
            String(
              property?.id || ""
            ),

          building_id:
            String(
              raw?.building_id ||
              building?.id ||
              property?.building_id ||
              ""
            ),

          name:
            propertyName(property),

          neighborhood:
            propertyNeighborhood(property),

          city:
            property?.city ||
            building?.address?.city ||
            "São Paulo",

          value:
            Number(
              property?.value
            ) || 0,

          area:
            Number(
              property?.area ||
              typology?.private_area
            ) || 0,

          bedrooms:
            Number(
              property?.bedrooms ||
              typology?.bedrooms
            ) || 0,

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
            property?.source || "",

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
            building?.address || null
        };
      });

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
        total
      }
    );

    return res.status(200).json({
      success: true,

      filters: {
        query,
        project,
        neighborhood,
        bedrooms,
        min_price: minPrice,
        max_price: maxPrice,
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

    return res.status(500).json({
      success: false,
      error:
        "Erro interno na busca de imóveis"
    });
  }
}
