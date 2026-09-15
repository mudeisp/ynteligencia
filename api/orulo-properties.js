export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const clientId = process.env.ORULO_CLIENT_ID;
    const clientSecret = process.env.ORULO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        ok: false,
        error: "Credenciais da Órulo não configuradas"
      });
    }

    // =========================================================
    // 1. AUTENTICAÇÃO ÓRULO
    // =========================================================

    const tokenResponse = await fetch(
      "https://www.orulo.com.br/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials"
        }).toString()
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(502).json({
        ok: false,
        error: "Falha na autenticação com a Órulo"
      });
    }

    const accessToken = tokenData.access_token;

    // =========================================================
    // 2. BUSCA EMPREENDIMENTOS DE SÃO PAULO
    // =========================================================

    const params = new URLSearchParams({
      state: "SP",
      city: "São Paulo",
      results_per_page: "50",
      page: "1"
    });

    const buildingsResponse = await fetch(
      `https://www.orulo.com.br/api/v2/buildings?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const buildingsData = await buildingsResponse.json();

    if (!buildingsResponse.ok) {
      return res.status(502).json({
        ok: false,
        error: "Falha ao consultar empreendimentos na Órulo"
      });
    }

    const buildings = Array.isArray(buildingsData.buildings)
      ? buildingsData.buildings
      : [];

    // =========================================================
    // 3. NORMALIZA EMPREENDIMENTOS + TIPOLOGIAS
    // =========================================================

    const properties = [];

    for (const building of buildings) {
      try {
        const typologiesResponse = await fetch(
          `https://www.orulo.com.br/api/v2/buildings/${building.id}/typologies`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json"
            }
          }
        );

        if (!typologiesResponse.ok) {
          continue;
        }

        const typologiesData = await typologiesResponse.json();

        const typologies = Array.isArray(typologiesData.typologies)
          ? typologiesData.typologies
          : [];

        for (const typology of typologies) {
          // Não envia tipologia sem estoque
          if (
            typology.stock !== undefined &&
            typology.stock !== null &&
            Number(typology.stock) <= 0
          ) {
            continue;
          }

          const price =
            typology.discount_price ??
            typology.original_price ??
            building.min_price ??
            null;

          const image =
            building.default_image?.["1024x1024"] ||
            building.default_image?.["520x280"] ||
            building.default_image?.["2280x1800"] ||
            building.default_image?.["200x140"] ||
            null;

          properties.push({
            // Identidade Ynteligencia
            id: `orulo:${building.id}:${typology.id}`,
            source: "novos",

            // IDs originais
            building_id: String(building.id),
            typology_id: String(typology.id),

            // Produto
            name: building.name || "Empreendimento",
            type: typology.type || null,
            finality: building.finality || null,

            // MATCH
            value: price !== null ? Number(price) : null,
            private_area:
              typology.private_area !== undefined
                ? Number(typology.private_area)
                : null,

            bedrooms:
              typology.bedrooms !== undefined
                ? Number(typology.bedrooms)
                : null,

            bathrooms:
              typology.bathrooms !== undefined
                ? Number(typology.bathrooms)
                : null,

            suites:
              typology.suites !== undefined
                ? Number(typology.suites)
                : null,

            parking:
              typology.parking !== undefined
                ? Number(typology.parking)
                : null,

            stock:
              typology.stock !== undefined
                ? Number(typology.stock)
                : null,

            // Localização
            neighborhood: building.address?.area || null,
            city: building.address?.city || null,
            state: building.address?.state || null,

            address: building.address
              ? {
                  street_type: building.address.street_type || null,
                  street: building.address.street || null,
                  number: building.address.number || null,
                  zip_code: building.address.zip_code || null,
                  latitude: building.address.latitude ?? null,
                  longitude: building.address.longitude ?? null
                }
              : null,

            // Empreendimento
            status: building.status || null,
            stage: building.stage || null,
            developer: building.developer?.name || null,

            // Mídia
            image,

            // Dados adicionais
            reference: typology.reference || null,
            floor_reference: typology.floor_reference ?? null,
            section_reference: typology.section_reference || null,

            updated_at:
              typology.updated_at ||
              building.updated_at ||
              null
          });
        }
      } catch (error) {
        // Se um empreendimento individual falhar,
        // os demais continuam sendo processados.
        continue;
      }
    }

    // =========================================================
    // 4. RESPOSTA NORMALIZADA PARA O YNTELIGENCIA
    // =========================================================

    return res.status(200).json({
      ok: true,
      source: "orulo",
      market: "São Paulo",
      buildings_received: buildings.length,
      properties_generated: properties.length,
      properties
    });

  } catch (error) {
    console.error("ORULO_PROPERTIES_ERROR", error);

    return res.status(500).json({
      ok: false,
      error: "Erro interno ao processar catálogo Órulo"
    });
  }
}
