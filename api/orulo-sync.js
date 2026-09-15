const SUPABASE_URL = "https://wzaegidwtdjuhqchpdpd.supabase.co";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const oruloClientId = process.env.ORULO_CLIENT_ID;
    const oruloClientSecret = process.env.ORULO_CLIENT_SECRET;
    const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

    if (!oruloClientId || !oruloClientSecret || !supabaseSecretKey) {
      return res.status(500).json({
        ok: false,
        error: "Variáveis de ambiente ausentes"
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
          client_id: oruloClientId,
          client_secret: oruloClientSecret,
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
    // 2. BUSCA EMPREENDIMENTOS
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
        error: "Falha ao consultar catálogo Órulo"
      });
    }

    const buildings = Array.isArray(buildingsData.buildings)
      ? buildingsData.buildings
      : [];

    // =========================================================
    // 3. BUSCA TIPOLOGIAS E NORMALIZA
    // =========================================================

    const rows = [];

    for (const building of buildings) {
      try {// Ynteligencia trabalha somente com imóveis residenciais
const finality = String(building.finality || "")
  .trim()
  .toLowerCase();

if (finality !== "residencial") {
  continue;
}
        const typologiesResponse = await fetch(
          `https://www.orulo.com.br/api/v2/buildings/${building.id}/typologies`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json"
            }
          }
        );

        if (!typologiesResponse.ok) continue;

        const typologiesData = await typologiesResponse.json();

        const typologies = Array.isArray(typologiesData.typologies)
          ? typologiesData.typologies
          : [];

        for (const typology of typologies) {
          const stock =
            typology.stock !== undefined && typology.stock !== null
              ? Number(typology.stock)
              : null;

          // Não cadastramos produto sem estoque.
          if (stock !== null && stock <= 0) continue;

          const externalId =
            `orulo:${building.id}:${typology.id}`;

          const price =
            typology.discount_price ??
            typology.original_price ??
            building.min_price ??
            null;

          const imageUrl =
            building.default_image?.["1024x1024"] ||
            building.default_image?.["520x280"] ||
            building.default_image?.["2280x1800"] ||
            building.default_image?.["200x140"] ||
            null;

          const titleParts = [
            building.name,
            typology.private_area
              ? `${typology.private_area} m²`
              : null,
            typology.bedrooms !== undefined
              ? `${typology.bedrooms} dorm`
              : null
          ].filter(Boolean);

          rows.push({
            external_id: externalId,
            source: "novos",

            title: titleParts.join(" | "),
            development_name: building.name || null,

            neighborhood: building.address?.area || null,
            city: building.address?.city || "São Paulo",
            state: building.address?.state || "SP",

            price:
              price !== null
                ? Number(price)
                : null,

            bedrooms:
              typology.bedrooms !== undefined
                ? Number(typology.bedrooms)
                : null,

            bathrooms:
              typology.bathrooms !== undefined
                ? Number(typology.bathrooms)
                : null,

            parking_spaces:
              typology.parking !== undefined
                ? Number(typology.parking)
                : null,

            area:
              typology.private_area !== undefined
                ? Number(typology.private_area)
                : null,

            image_url: imageUrl,

            property_url:
              building.orulo_url || null,

            active: true,

            raw_data: {
              source: "orulo",
              building_id: String(building.id),
              typology_id: String(typology.id),

              typology: {
                type: typology.type ?? null,
                suites: typology.suites ?? null,
                stock,
                original_price:
                  typology.original_price ?? null,
                discount_price:
                  typology.discount_price ?? null,
                reference:
                  typology.reference ?? null,
                floor_reference:
                  typology.floor_reference ?? null,
                section_reference:
                  typology.section_reference ?? null,
                updated_at:
                  typology.updated_at ?? null
              },

              building: {
                finality: building.finality ?? null,
                status: building.status ?? null,
                stage: building.stage ?? null,
                developer:
                  building.developer?.name ?? null,

                address: building.address ?? null,

                features:
                  building.features ?? [],

                opportunity:
                  building.opportunity ?? null,

                updated_at:
                  building.updated_at ?? null
              }
            },

            updated_at: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(
          "ORULO_TYPOLOGY_ERROR",
          building.id,
          error
        );
      }
    }

    if (!rows.length) {
      return res.status(502).json({
        ok: false,
        error: "Nenhuma tipologia válida foi encontrada"
      });
    }

    // =========================================================
    // 4. UPSERT NO SUPABASE
    // external_id já possui UNIQUE INDEX
    // =========================================================

    const supabaseResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?on_conflict=external_id`,
      {
        method: "POST",

        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
          "Content-Type": "application/json",

          Prefer:
            "resolution=merge-duplicates,return=representation"
        },

        body: JSON.stringify(rows)
      }
    );

    const supabaseText = await supabaseResponse.text();

    if (!supabaseResponse.ok) {
      console.error(
        "SUPABASE_SYNC_ERROR",
        supabaseResponse.status,
        supabaseText
      );

      return res.status(502).json({
        ok: false,
        error: "Falha ao gravar catálogo no Supabase",
        status: supabaseResponse.status,
        details: supabaseText
      });
    }

    let savedRows = [];

    try {
      savedRows = JSON.parse(supabaseText);
    } catch {
      savedRows = [];
    }

    // =========================================================
    // 5. RESULTADO
    // =========================================================

    return res.status(200).json({
      ok: true,

      message:
        "Catálogo Órulo sincronizado com o Supabase",

      buildings_received:
        buildings.length,

      properties_processed:
        rows.length,

      properties_saved:
        Array.isArray(savedRows)
          ? savedRows.length
          : rows.length,

      source: "novos",

      synced_at:
        new Date().toISOString()
    });

  } catch (error) {
    console.error("ORULO_SYNC_FATAL", error);

    return res.status(500).json({
      ok: false,
      error: "Erro interno durante sincronização Órulo"
    });
  }
}
