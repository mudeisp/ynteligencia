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

    const oruloHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };

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
        headers: oruloHeaders
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
    // 3. DETALHES + FOTOS + TIPOLOGIAS + NORMALIZAÇÃO
    // =========================================================

    const rows = [];

    let residentialBuildings = 0;
    let buildingDetailsLoaded = 0;
    let buildingDetailsFailed = 0;
    let galleriesLoaded = 0;

    for (const buildingSummary of buildings) {
      try {
        // =====================================================
        // 3.1 FILTRO RESIDENCIAL
        // =====================================================

        const summaryFinality = String(
          buildingSummary.finality || ""
        )
          .trim()
          .toLowerCase();

        if (summaryFinality !== "residencial") {
          continue;
        }

        residentialBuildings++;

        // =====================================================
        // 3.2 DETALHE COMPLETO DO EMPREENDIMENTO
        // =====================================================
        //
        // A listagem /buildings é resumida.
        // Aqui buscamos /buildings/{id} para obter a ficha
        // completa do empreendimento.
        //
        // Se o endpoint de detalhe falhar por algum motivo,
        // mantemos o buildingSummary como fallback para não
        // quebrar o catálogo.
        // =====================================================

        let building = buildingSummary;

        try {
          const detailResponse = await fetch(
            `https://www.orulo.com.br/api/v2/buildings/${buildingSummary.id}`,
            {
              headers: oruloHeaders
            }
          );

          if (detailResponse.ok) {
            const detailData = await detailResponse.json();

            const detailedBuilding =
              detailData?.building &&
              typeof detailData.building === "object"
                ? detailData.building
                : detailData;

            if (
              detailedBuilding &&
              typeof detailedBuilding === "object"
            ) {
              building = {
                ...buildingSummary,
                ...detailedBuilding
              };

              buildingDetailsLoaded++;
            }
          } else {
            buildingDetailsFailed++;

            console.warn(
              "ORULO_BUILDING_DETAIL_HTTP_ERROR",
              buildingSummary.id,
              detailResponse.status
            );
          }
        } catch (detailError) {
          buildingDetailsFailed++;

          console.warn(
            "ORULO_BUILDING_DETAIL_ERROR",
            buildingSummary.id,
            detailError
          );
        }

        // Segurança adicional:
        // depois do detalhe, confirmamos novamente a finalidade.
        const finality = String(
          building.finality ||
          buildingSummary.finality ||
          ""
        )
          .trim()
          .toLowerCase();

        if (finality !== "residencial") {
          continue;
        }

        // =====================================================
        // 3.3 GALERIA DE FOTOS
        // =====================================================

        let galleryImages = [];

        try {
          const imagesParams = new URLSearchParams();

          imagesParams.append(
            "dimensions[]",
            "1024x1024"
          );

          const imagesResponse = await fetch(
            `https://www.orulo.com.br/api/v2/buildings/${buildingSummary.id}/images?${imagesParams.toString()}`,
            {
              headers: oruloHeaders
            }
          );

          if (imagesResponse.ok) {
            const imagesData =
              await imagesResponse.json();

            const oruloImages =
              Array.isArray(imagesData.images)
                ? imagesData.images
                : [];

            galleryImages = oruloImages
              .map((image) =>
                image?.["1024x1024"] ||
                image?.["2280x1800"] ||
                image?.["520x280"] ||
                image?.["200x140"] ||
                image?.url ||
                null
              )
              .filter(Boolean)
              .filter(
                (url, index, array) =>
                  array.indexOf(url) === index
              )
              .slice(0, 8);

            if (galleryImages.length) {
              galleriesLoaded++;
            }
          } else {
            console.warn(
              "ORULO_IMAGES_HTTP_ERROR",
              buildingSummary.id,
              imagesResponse.status
            );
          }
        } catch (imageError) {
          console.warn(
            "ORULO_IMAGES_ERROR",
            buildingSummary.id,
            imageError
          );
        }

        // =====================================================
        // 3.4 TIPOLOGIAS
        // =====================================================

        const typologiesResponse = await fetch(
          `https://www.orulo.com.br/api/v2/buildings/${buildingSummary.id}/typologies`,
          {
            headers: oruloHeaders
          }
        );

        if (!typologiesResponse.ok) {
          console.warn(
            "ORULO_TYPOLOGIES_HTTP_ERROR",
            buildingSummary.id,
            typologiesResponse.status
          );

          continue;
        }

        const typologiesData =
          await typologiesResponse.json();

        const typologies =
          Array.isArray(typologiesData.typologies)
            ? typologiesData.typologies
            : [];

        // =====================================================
        // 3.5 CARACTERÍSTICAS DO EMPREENDIMENTO
        // =====================================================

        const buildingFeatures =
          Array.isArray(building.building_features)
            ? building.building_features
            : Array.isArray(building.features)
              ? building.features
              : [];

        const unitFeatures =
          Array.isArray(building.unit_features)
            ? building.unit_features
            : [];

        // =====================================================
        // 3.6 NORMALIZA CADA TIPOLOGIA
        // =====================================================

        for (const typology of typologies) {
          const stock =
            typology.stock !== undefined &&
            typology.stock !== null
              ? Number(typology.stock)
              : null;

          // Não cadastramos produto sem estoque.
          if (stock !== null && stock <= 0) {
            continue;
          }

          const externalId =
            `orulo:${buildingSummary.id}:${typology.id}`;

          const price =
            typology.discount_price ??
            typology.original_price ??
            building.min_price ??
            buildingSummary.min_price ??
            null;

          // ===================================================
          // CAPA
          // ===================================================

          const imageUrl =
            galleryImages[0] ||
            building.default_image?.["1024x1024"] ||
            building.default_image?.["520x280"] ||
            building.default_image?.["2280x1800"] ||
            building.default_image?.["200x140"] ||
            buildingSummary.default_image?.["1024x1024"] ||
            buildingSummary.default_image?.["520x280"] ||
            buildingSummary.default_image?.["2280x1800"] ||
            buildingSummary.default_image?.["200x140"] ||
            null;

          // ===================================================
          // TÍTULO
          // ===================================================

          const titleParts = [
            building.name ||
              buildingSummary.name,

            typology.private_area
              ? `${typology.private_area} m²`
              : null,

            typology.bedrooms !== undefined
              ? `${typology.bedrooms} dorm`
              : null
          ].filter(Boolean);

          // ===================================================
          // FEATURES DA UNIDADE ASSOCIADAS À TIPOLOGIA
          // ===================================================

          const typologyUnitFeatures =
            unitFeatures.filter((feature) => {
              const associatedTypologies =
                feature?.associations?.typologies;

              if (
                !Array.isArray(associatedTypologies) ||
                !associatedTypologies.length
              ) {
                return true;
              }

              return associatedTypologies
                .map(String)
                .includes(String(typology.id));
            });

          // ===================================================
          // SALVA PROPERTY
          // ===================================================

          rows.push({
            external_id: externalId,

            source: "novos",

            title:
              titleParts.join(" | "),

            development_name:
              building.name ||
              buildingSummary.name ||
              null,

            neighborhood:
              building.address?.area ||
              buildingSummary.address?.area ||
              null,

            city:
              building.address?.city ||
              buildingSummary.address?.city ||
              "São Paulo",

            state:
              building.address?.state ||
              buildingSummary.address?.state ||
              "SP",

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

            image_url:
              imageUrl,

            property_url:
              building.orulo_url ||
              building.sharing_url ||
              building.webpage ||
              buildingSummary.orulo_url ||
              null,

            active: true,

            // =================================================
            // RAW DATA COMPLETO
            // =================================================

            raw_data: {
              source: "orulo",

              building_id:
                String(buildingSummary.id),

              typology_id:
                String(typology.id),

              // ===============================================
              // GALERIA
              // ===============================================

              images:
                galleryImages,

              // ===============================================
              // TIPOLOGIA / UNIDADE
              // ===============================================

              typology: {
                id:
                  typology.id ?? null,

                type:
                  typology.type ?? null,

                private_area:
                  typology.private_area ?? null,

                bedrooms:
                  typology.bedrooms ?? null,

                bathrooms:
                  typology.bathrooms ?? null,

                suites:
                  typology.suites ?? null,

                parking:
                  typology.parking ?? null,

                stock,

                original_price:
                  typology.original_price ??
                  null,

                discount_price:
                  typology.discount_price ??
                  null,

                reference:
                  typology.reference ??
                  null,

                floor_reference:
                  typology.floor_reference ??
                  null,

                section_reference:
                  typology.section_reference ??
                  null,

                features:
                  typologyUnitFeatures,

                updated_at:
                  typology.updated_at ??
                  null
              },

              // ===============================================
              // EMPREENDIMENTO / FICHA TÉCNICA
              // ===============================================

              building: {
                id:
                  building.id ??
                  buildingSummary.id ??
                  null,

                name:
                  building.name ??
                  buildingSummary.name ??
                  null,

                finality:
                  building.finality ??
                  buildingSummary.finality ??
                  null,

                status:
                  building.status ??
                  null,

                stage:
                  building.stage ??
                  null,

                type:
                  building.type ??
                  null,

                // ---------------------------------------------
                // INCORPORADORA
                // ---------------------------------------------

                developer:
                  building.developer?.name ??
                  building.publisher?.name ??
                  null,

                developer_data:
                  building.developer ??
                  null,

                publisher:
                  building.publisher?.name ??
                  null,

                // ---------------------------------------------
                // DESCRIÇÃO
                // ---------------------------------------------

                description:
                  building.description ??
                  null,

                // ---------------------------------------------
                // DATAS
                // opening_date = entrega
                // ---------------------------------------------

                opening_date:
                  building.opening_date ??
                  null,

                launch_date:
                  building.launch_date ??
                  null,

                // ---------------------------------------------
                // FICHA TÉCNICA
                // ---------------------------------------------

                total_units:
                  building.total_units ??
                  null,

                number_of_towers:
                  building.number_of_towers ??
                  null,

                number_of_floors:
                  building.number_of_floors ??
                  null,

                apts_per_floor:
                  building.apts_per_floor ??
                  null,

                total_area:
                  building.total_area ??
                  null,

                floor_area:
                  building.floor_area ??
                  null,

                min_price:
                  building.min_price ??
                  null,

                stock:
                  building.stock ??
                  null,

                // ---------------------------------------------
                // ENDEREÇO
                // ---------------------------------------------

                address:
                  building.address ??
                  buildingSummary.address ??
                  null,

                // ---------------------------------------------
                // FOTOS
                // ---------------------------------------------

                images:
                  galleryImages,

                // ---------------------------------------------
                // CARACTERÍSTICAS CONDOMINIAIS
                // ---------------------------------------------

                building_features:
                  buildingFeatures,

                // Compatibilidade com versão anterior
                features:
                  buildingFeatures,

                // ---------------------------------------------
                // CARACTERÍSTICAS DAS UNIDADES
                // ---------------------------------------------

                unit_features:
                  unitFeatures,

                // ---------------------------------------------
                // MÍDIA / LINKS
                // ---------------------------------------------

                webpage:
                  building.webpage ??
                  null,

                sharing_url:
                  building.sharing_url ??
                  null,

                orulo_url:
                  building.orulo_url ??
                  buildingSummary.orulo_url ??
                  null,

                virtual_tour:
                  building.virtual_tour ??
                  null,

                videos:
                  building.videos ??
                  [],

                // Se o detalhe já retornar plantas,
                // preservamos os metadados aqui.
                floor_plans:
                  building.floor_plans ??
                  [],

                // Arquivos que eventualmente vierem no detalhe.
                files:
                  building.files ??
                  [],

                // ---------------------------------------------
                // COMERCIAL
                // ---------------------------------------------

                payment_conditions:
                  building.payment_conditions ??
                  [],

                opportunity:
                  building.opportunity ??
                  null,

                last_updated_pricetable_at:
                  building.last_updated_pricetable_at ??
                  null,

                // ---------------------------------------------
                // CONTROLE
                // ---------------------------------------------

                updated_at:
                  building.updated_at ??
                  null
              }
            },

            updated_at:
              new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(
          "ORULO_BUILDING_PROCESS_ERROR",
          buildingSummary.id,
          error
        );
      }
    }

    // =========================================================
    // 4. VALIDAÇÃO
    // =========================================================

    if (!rows.length) {
      return res.status(502).json({
        ok: false,
        error:
          "Nenhuma tipologia válida foi encontrada"
      });
    }

    // =========================================================
    // 5. DESATIVA CATÁLOGO ÓRULO ANTERIOR
    // =========================================================
    //
    // Mantemos exatamente a estratégia já aprovada:
    //
    // 1. desativa todos os source=novos
    // 2. upsert abaixo reativa os produtos válidos atuais
    //
    // =========================================================

    const deactivateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?source=eq.novos`,
      {
        method: "PATCH",

        headers: {
          apikey:
            supabaseSecretKey,

          Authorization:
            `Bearer ${supabaseSecretKey}`,

          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body: JSON.stringify({
          active: false,
          updated_at:
            new Date().toISOString()
        })
      }
    );

    if (!deactivateResponse.ok) {
      const deactivateError =
        await deactivateResponse.text();

      console.error(
        "SUPABASE_DEACTIVATE_ERROR",
        deactivateResponse.status,
        deactivateError
      );

      return res.status(502).json({
        ok: false,
        error:
          "Falha ao desativar catálogo Órulo anterior",
        status:
          deactivateResponse.status
      });
    }

    // =========================================================
    // 6. UPSERT NO SUPABASE
    // =========================================================

    const supabaseResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?on_conflict=external_id`,
      {
        method: "POST",

        headers: {
          apikey:
            supabaseSecretKey,

          Authorization:
            `Bearer ${supabaseSecretKey}`,

          "Content-Type":
            "application/json",

          Prefer:
            "resolution=merge-duplicates,return=representation"
        },

        body:
          JSON.stringify(rows)
      }
    );

    const supabaseText =
      await supabaseResponse.text();

    if (!supabaseResponse.ok) {
      console.error(
        "SUPABASE_SYNC_ERROR",
        supabaseResponse.status,
        supabaseText
      );

      return res.status(502).json({
        ok: false,
        error:
          "Falha ao gravar catálogo no Supabase",
        status:
          supabaseResponse.status,
        details:
          supabaseText
      });
    }

    let savedRows = [];

    try {
      savedRows =
        JSON.parse(supabaseText);
    } catch {
      savedRows = [];
    }

    // =========================================================
    // 7. RESULTADO
    // =========================================================

    return res.status(200).json({
      ok: true,

      message:
        "Catálogo Órulo enriquecido e sincronizado com o Supabase",

      buildings_received:
        buildings.length,

      residential_buildings:
        residentialBuildings,

      building_details_loaded:
        buildingDetailsLoaded,

      building_details_failed:
        buildingDetailsFailed,

      galleries_loaded:
        galleriesLoaded,

      properties_processed:
        rows.length,

      properties_saved:
        Array.isArray(savedRows)
          ? savedRows.length
          : rows.length,

      source:
        "novos",

      synced_at:
        new Date().toISOString()
    });

  } catch (error) {
    console.error(
      "ORULO_SYNC_FATAL",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        "Erro interno durante sincronização Órulo"
    });
  }
}
