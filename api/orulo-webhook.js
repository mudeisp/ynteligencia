const SUPABASE_URL =
  "https://wzaegidwtdjuhqchpdpd.supabase.co";


// =========================================================
// HELPERS
// =========================================================

async function getOruloToken() {
  const clientId =
    process.env.ORULO_CLIENT_ID;

  const clientSecret =
    process.env.ORULO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "ORULO_CREDENTIALS_MISSING"
    );
  }

  const response = await fetch(
    "https://www.orulo.com.br/oauth/token",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
      }).toString()
    }
  );

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      `ORULO_AUTH_FAILED_${response.status}`
    );
  }

  return data.access_token;
}


// =========================================================
// SUPABASE HEADERS
// =========================================================

function getSupabaseHeaders(
  supabaseSecretKey,
  prefer = null
) {
  const headers = {
    apikey:
      supabaseSecretKey,

    Authorization:
      `Bearer ${supabaseSecretKey}`,

    "Content-Type":
      "application/json"
  };

  if (prefer) {
    headers.Prefer = prefer;
  }

  return headers;
}


// =========================================================
// BUSCA BUILDING
// =========================================================

async function getBuilding(
  buildingId,
  headers
) {
  const response = await fetch(
    `https://www.orulo.com.br/api/v2/buildings/${encodeURIComponent(
      String(buildingId)
    )}`,
    {
      headers
    }
  );

  if (!response.ok) {
    throw new Error(
      `BUILDING_FETCH_FAILED_${response.status}`
    );
  }

  const data =
    await response.json();

  const building =
    data?.building &&
    typeof data.building === "object"
      ? data.building
      : data;

  if (
    !building ||
    typeof building !== "object"
  ) {
    throw new Error(
      "INVALID_BUILDING_RESPONSE"
    );
  }

  return building;
}


// =========================================================
// BUSCA GALERIA
// =========================================================

async function getBuildingImages(
  buildingId,
  headers
) {
  try {
    const params =
      new URLSearchParams();

    params.append(
      "dimensions[]",
      "1024x1024"
    );

    const response = await fetch(
      `https://www.orulo.com.br/api/v2/buildings/${encodeURIComponent(
        String(buildingId)
      )}/images?${params.toString()}`,
      {
        headers
      }
    );

    if (!response.ok) {
      console.warn(
        "ORULO_WEBHOOK_IMAGES_HTTP_ERROR",
        buildingId,
        response.status
      );

      return [];
    }

    const data =
      await response.json();

    const images =
      Array.isArray(data.images)
        ? data.images
        : [];

    return images
      .map(
        (image) =>
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

  } catch (error) {
    console.warn(
      "ORULO_WEBHOOK_IMAGES_ERROR",
      buildingId,
      error
    );

    return [];
  }
}


// =========================================================
// BUSCA TIPOLOGIAS
// =========================================================

async function getTypologies(
  buildingId,
  headers
) {
  const response = await fetch(
    `https://www.orulo.com.br/api/v2/buildings/${encodeURIComponent(
      String(buildingId)
    )}/typologies`,
    {
      headers
    }
  );

  if (!response.ok) {
    throw new Error(
      `TYPOLOGIES_FETCH_FAILED_${response.status}`
    );
  }

  const data =
    await response.json();

  return Array.isArray(
    data.typologies
  )
    ? data.typologies
    : [];
}


// =========================================================
// NORMALIZAÇÃO
//
// Mantém a mesma estrutura do orulo-sync.js.
// =========================================================

function normalizeBuilding({
  building,
  buildingId,
  typologies,
  galleryImages
}) {
  const rows = [];

  const buildingFeatures =
    Array.isArray(
      building.building_features
    )
      ? building.building_features
      : Array.isArray(
          building.features
        )
        ? building.features
        : [];

  const unitFeatures =
    Array.isArray(
      building.unit_features
    )
      ? building.unit_features
      : [];

  for (const typology of typologies) {
    const stock =
      typology.stock !== undefined &&
      typology.stock !== null
        ? Number(typology.stock)
        : null;

    if (
      stock !== null &&
      stock <= 0
    ) {
      continue;
    }

    const externalId =
      `orulo:${buildingId}:${typology.id}`;

    const price =
      typology.discount_price ??
      typology.original_price ??
      building.min_price ??
      null;

    const imageUrl =
      galleryImages[0] ||
      building.default_image?.[
        "1024x1024"
      ] ||
      building.default_image?.[
        "520x280"
      ] ||
      building.default_image?.[
        "2280x1800"
      ] ||
      building.default_image?.[
        "200x140"
      ] ||
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

    const typologyUnitFeatures =
      unitFeatures.filter(
        (feature) => {
          const associatedTypologies =
            feature?.associations
              ?.typologies;

          if (
            !Array.isArray(
              associatedTypologies
            ) ||
            !associatedTypologies.length
          ) {
            return true;
          }

          return associatedTypologies
            .map(String)
            .includes(
              String(typology.id)
            );
        }
      );

    rows.push({
      external_id:
        externalId,

      source:
        "novos",

      title:
        titleParts.join(" | "),

      development_name:
        building.name ||
        null,

      neighborhood:
        building.address?.area ||
        null,

      city:
        building.address?.city ||
        "São Paulo",

      state:
        building.address?.state ||
        "SP",

      price:
        price !== null
          ? Number(price)
          : null,

      bedrooms:
        typology.bedrooms !==
        undefined
          ? Number(
              typology.bedrooms
            )
          : null,

      bathrooms:
        typology.bathrooms !==
        undefined
          ? Number(
              typology.bathrooms
            )
          : null,

      parking_spaces:
        typology.parking !==
        undefined
          ? Number(
              typology.parking
            )
          : null,

      area:
        typology.private_area !==
        undefined
          ? Number(
              typology.private_area
            )
          : null,

      image_url:
        imageUrl,

      property_url:
        building.orulo_url ||
        building.sharing_url ||
        building.webpage ||
        null,

      active:
        true,

      raw_data: {
        source:
          "orulo",

        building_id:
          String(buildingId),

        typology_id:
          String(typology.id),

        images:
          galleryImages,

        typology: {
          id:
            typology.id ??
            null,

          type:
            typology.type ??
            null,

          private_area:
            typology.private_area ??
            null,

          bedrooms:
            typology.bedrooms ??
            null,

          bathrooms:
            typology.bathrooms ??
            null,

          suites:
            typology.suites ??
            null,

          parking:
            typology.parking ??
            null,

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

        building: {
          id:
            building.id ??
            buildingId,

          name:
            building.name ??
            null,

          finality:
            building.finality ??
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

          developer:
            building.developer
              ?.name ??
            building.publisher
              ?.name ??
            null,

          developer_data:
            building.developer ??
            null,

          publisher:
            building.publisher
              ?.name ??
            null,

          description:
            building.description ??
            null,

          opening_date:
            building.opening_date ??
            null,

          launch_date:
            building.launch_date ??
            null,

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

          address:
            building.address ??
            null,

          images:
            galleryImages,

          building_features:
            buildingFeatures,

          features:
            buildingFeatures,

          unit_features:
            unitFeatures,

          webpage:
            building.webpage ??
            null,

          sharing_url:
            building.sharing_url ??
            null,

          orulo_url:
            building.orulo_url ??
            null,

          virtual_tour:
            building.virtual_tour ??
            null,

          videos:
            building.videos ??
            [],

          floor_plans:
            building.floor_plans ??
            [],

          files:
            building.files ??
            [],

          payment_conditions:
            building
              .payment_conditions ??
            [],

          opportunity:
            building.opportunity ??
            null,

          last_updated_pricetable_at:
            building
              .last_updated_pricetable_at ??
            null,

          updated_at:
            building.updated_at ??
            null
        }
      },

      updated_at:
        new Date().toISOString()
    });
  }

  return rows;
}


// =========================================================
// BUSCA REGISTROS EXISTENTES DESSE BUILDING
// =========================================================

async function getExistingBuildingRows(
  buildingId,
  supabaseSecretKey
) {
  const encodedBuildingId =
    encodeURIComponent(
      String(buildingId)
    );

  const endpoint =
    `${SUPABASE_URL}/rest/v1/properties` +
    `?select=external_id,active,raw_data` +
    `&source=eq.novos` +
    `&raw_data->>building_id=eq.${encodedBuildingId}`;

  const response =
    await fetch(
      endpoint,
      {
        method: "GET",

        headers:
          getSupabaseHeaders(
            supabaseSecretKey
          )
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    console.error(
      "SUPABASE_EXISTING_BUILDING_ERROR",
      response.status,
      text
    );

    throw new Error(
      `SUPABASE_EXISTING_BUILDING_FAILED_${response.status}`
    );
  }

  try {
    const data =
      JSON.parse(text);

    return Array.isArray(data)
      ? data
      : [];
  } catch {
    return [];
  }
}


// =========================================================
// UPSERT SELETIVO
// =========================================================

async function upsertBuildingRows(
  rows,
  supabaseSecretKey
) {
  if (!rows.length) {
    return [];
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/properties?on_conflict=external_id`,
      {
        method: "POST",

        headers:
          getSupabaseHeaders(
            supabaseSecretKey,
            "resolution=merge-duplicates,return=representation"
          ),

        body:
          JSON.stringify(rows)
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    console.error(
      "SUPABASE_WEBHOOK_UPSERT_ERROR",
      response.status,
      text
    );

    throw new Error(
      `SUPABASE_UPSERT_FAILED_${response.status}`
    );
  }

  try {
    const data =
      JSON.parse(text);

    return Array.isArray(data)
      ? data
      : [];
  } catch {
    return [];
  }
}


// =========================================================
// DESATIVA SOMENTE TIPOLOGIAS ANTIGAS DO BUILDING
// =========================================================

async function deactivateStaleRows(
  staleExternalIds,
  supabaseSecretKey
) {
  if (!staleExternalIds.length) {
    return [];
  }

  const affected = [];

  for (
    const externalId
    of staleExternalIds
  ) {
    const endpoint =
      `${SUPABASE_URL}/rest/v1/properties` +
      `?external_id=eq.${encodeURIComponent(
        externalId
      )}` +
      `&source=eq.novos`;

    const response =
      await fetch(
        endpoint,
        {
          method: "PATCH",

          headers:
            getSupabaseHeaders(
              supabaseSecretKey,
              "return=representation"
            ),

          body:
            JSON.stringify({
              active: false,

              updated_at:
                new Date()
                  .toISOString()
            })
        }
      );

    const text =
      await response.text();

    if (!response.ok) {
      console.error(
        "SUPABASE_STALE_DEACTIVATE_ERROR",
        externalId,
        response.status,
        text
      );

      throw new Error(
        `SUPABASE_STALE_DEACTIVATE_FAILED_${response.status}`
      );
    }

    try {
      const data =
        JSON.parse(text);

      if (Array.isArray(data)) {
        affected.push(...data);
      }
    } catch {
    }
  }

  return affected;
}


// =========================================================
// SOFT DELETE DE BUILDING
// =========================================================

async function softDeleteBuilding(
  buildingId,
  supabaseSecretKey
) {
  const buildingIdEncoded =
    encodeURIComponent(
      String(buildingId)
    );

  const endpoint =
    `${SUPABASE_URL}/rest/v1/properties` +
    `?source=eq.novos` +
    `&raw_data->>building_id=eq.${buildingIdEncoded}`;

  const response =
    await fetch(
      endpoint,
      {
        method: "PATCH",

        headers:
          getSupabaseHeaders(
            supabaseSecretKey,
            "return=representation"
          ),

        body:
          JSON.stringify({
            active: false,

            updated_at:
              new Date()
                .toISOString()
          })
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    console.error(
      "ORULO_WEBHOOK_REMOVE_ERROR",
      response.status,
      text
    );

    throw new Error(
      `SUPABASE_REMOVE_FAILED_${response.status}`
    );
  }

  try {
    const data =
      JSON.parse(text);

    return Array.isArray(data)
      ? data
      : [];
  } catch {
    return [];
  }
}


// =========================================================
// HANDLER
// =========================================================

export default async function handler(
  req,
  res
) {

  // =======================================================
  // DIAGNÓSTICO TEMPORÁRIO — EVENTO ÓRULO
  // =======================================================

  console.log(
    "ORULO_WEBHOOK_METHOD",
    req.method
  );

  console.log(
    "ORULO_WEBHOOK_HEADER_NAMES",
    Object.keys(req.headers || {})
  );

  console.log(
    "ORULO_WEBHOOK_BODY",
    JSON.stringify(req.body || {})
  );


  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  // =======================================================
  // 1. SOMENTE POST
  // =======================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    // =====================================================
    // 2. PAYLOAD
    // =====================================================

    const payload =
      req.body;

    if (
      !payload ||
      typeof payload !== "object"
    ) {
      return res.status(200).json({
        ok: true,
        received: false,
        processed: false,
        reason:
          "invalid_body"
      });
    }

    const eventName =
      payload.name ??
      null;

    const eventDate =
      payload.date ??
      null;

    const properties =
      payload.properties &&
      typeof payload.properties ===
        "object"
        ? payload.properties
        : {};

    const buildingId =
      properties.building_id ??
      null;

    const status =
      properties.status ??
      null;

    const clientId =
      properties.client_id ??
      null;

    console.log(
      "ORULO_WEBHOOK_RECEIVED",
      {
        eventName,
        eventDate,
        buildingId,
        status,
        clientId
      }
    );

    // =====================================================
    // 3. VALIDAÇÃO
    // =====================================================

    if (
      eventName !==
      "BUILDING_UPDATE"
    ) {
      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        reason:
          "unsupported_event"
      });
    }

    if (
      buildingId === null ||
      buildingId === undefined
    ) {
      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        reason:
          "missing_building_id"
      });
    }

    const supportedStatuses = [
      "active",
      "removed",
      "added_to_distribution",
      "excluded_from_distribution"
    ];

    if (
      !supportedStatuses.includes(
        status
      )
    ) {
      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        building_id:
          buildingId,
        status,
        reason:
          "unsupported_status"
      });
    }


    // =====================================================
    // 4. SUPABASE
    // =====================================================

    const supabaseSecretKey =
      process.env
        .SUPABASE_SECRET_KEY;

    if (!supabaseSecretKey) {
      console.error(
        "ORULO_WEBHOOK_SUPABASE_KEY_MISSING"
      );

      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        building_id:
          buildingId,
        status,
        reason:
          "supabase_not_configured"
      });
    }


    // =====================================================
    // 5. REMOVED
    // =====================================================

    if (
      status === "removed"
    ) {
      const affectedRows =
        await softDeleteBuilding(
          buildingId,
          supabaseSecretKey
        );

      console.log(
        "ORULO_WEBHOOK_REMOVED",
        {
          buildingId,

          affected:
            affectedRows.length
        }
      );

      return res.status(200).json({
        ok: true,
        received: true,
        processed: true,

        action:
          "soft_delete",

        building_id:
          buildingId,

        status,

        affected:
          affectedRows.length
      });
    }


    // =====================================================
    // 6. EXCLUDED_FROM_DISTRIBUTION
    // =====================================================

    if (
      status ===
      "excluded_from_distribution"
    ) {
      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,

        action:
          "distribution_exclusion_pending",

        building_id:
          buildingId,

        status,

        client_id:
          clientId
      });
    }


    // =====================================================
    // 7. ACTIVE / ADDED_TO_DISTRIBUTION
    // =====================================================

    if (
      status === "active" ||
      status ===
        "added_to_distribution"
    ) {
      const accessToken =
        await getOruloToken();

      const oruloHeaders = {
        Authorization:
          `Bearer ${accessToken}`,

        Accept:
          "application/json"
      };


      const building =
        await getBuilding(
          buildingId,
          oruloHeaders
        );


      const finality =
        String(
          building.finality || ""
        )
          .trim()
          .toLowerCase();

      if (
        finality !== "residencial"
      ) {
        console.log(
          "ORULO_WEBHOOK_NON_RESIDENTIAL",
          {
            buildingId,
            finality
          }
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,

          action:
            "ignored_non_residential",

          building_id:
            buildingId,

          status,

          building_name:
            building.name ??
            null,

          finality:
            building.finality ??
            null
        });
      }


      const [
        galleryImages,
        typologies
      ] = await Promise.all([
        getBuildingImages(
          buildingId,
          oruloHeaders
        ),

        getTypologies(
          buildingId,
          oruloHeaders
        )
      ]);


      const rows =
        normalizeBuilding({
          building,
          buildingId,
          typologies,
          galleryImages
        });


      if (!rows.length) {
        console.warn(
          "ORULO_WEBHOOK_NO_VALID_ROWS",
          {
            buildingId,

            typologiesReceived:
              typologies.length
          }
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,

          action:
            "no_valid_properties",

          building_id:
            buildingId,

          status,

          typologies_received:
            typologies.length,

          properties_generated:
            0
        });
      }


      const existingRows =
        await getExistingBuildingRows(
          buildingId,
          supabaseSecretKey
        );


      const incomingExternalIds =
        new Set(
          rows.map(
            (row) =>
              String(
                row.external_id
              )
          )
        );

      const staleExternalIds =
        existingRows
          .map(
            (row) =>
              row.external_id
          )
          .filter(Boolean)
          .map(String)
          .filter(
            (externalId) =>
              !incomingExternalIds.has(
                externalId
              )
          );


      const savedRows =
        await upsertBuildingRows(
          rows,
          supabaseSecretKey
        );


      const deactivatedRows =
        await deactivateStaleRows(
          staleExternalIds,
          supabaseSecretKey
        );


      console.log(
        "ORULO_WEBHOOK_ACTIVE_PROCESSED",
        {
          buildingId,

          buildingName:
            building.name,

          typologiesReceived:
            typologies.length,

          propertiesGenerated:
            rows.length,

          propertiesSaved:
            savedRows.length,

          staleFound:
            staleExternalIds.length,

          staleDeactivated:
            deactivatedRows.length
        }
      );


      return res.status(200).json({
        ok: true,
        received: true,
        processed: true,

        action:
          "building_upserted",

        building_id:
          buildingId,

        status,

        client_id:
          clientId,

        building: {
          id:
            building.id ??
            buildingId,

          name:
            building.name ??
            null,

          finality:
            building.finality ??
            null,

          neighborhood:
            building.address
              ?.area ??
            null,

          city:
            building.address
              ?.city ??
            null,

          state:
            building.address
              ?.state ??
            null
        },

        gallery_images:
          galleryImages.length,

        typologies_received:
          typologies.length,

        properties_generated:
          rows.length,

        existing_properties:
          existingRows.length,

        properties_saved:
          savedRows.length,

        stale_typologies_found:
          staleExternalIds.length,

        stale_typologies_deactivated:
          deactivatedRows.length,

        external_ids:
          rows.map(
            (row) =>
              row.external_id
          )
      });
    }


    // =====================================================
    // 8. FALLBACK
    // =====================================================

    return res.status(200).json({
      ok: true,
      received: true,
      processed: false,

      building_id:
        buildingId,

      status,

      client_id:
        clientId,

      reason:
        "no_action"
    });

  } catch (error) {
    console.error(
      "ORULO_WEBHOOK_FATAL",
      error
    );

    return res.status(200).json({
      ok: true,
      received: true,
      processed: false,

      reason:
        "internal_error",

      error:
        error?.message ||
        "unknown_error"
    });
  }
}
