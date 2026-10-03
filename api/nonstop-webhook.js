const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://wzaegidwtdjuhqchpdpd.supabase.co";

function clean(value) {
  return String(value ?? "").trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function firstImage(property) {
  return (
    property?.media?.images?.[0]?.url ||
    property?.condo?.media?.images?.[0]?.url ||
    null
  );
}

function normalizeType(type) {
  const t = clean(type).toUpperCase();

  const map = {
    APARTAMENTO_TIPO: "apartamento",
    APARTAMENTO_GARDEN: "apartamento",
    COBERTURA: "apartamento",
    DUPLEX: "apartamento",
    TRIPLEX: "apartamento",
    STUDIO: "studio",
    KITNET: "studio",
    LOFT: "studio",
    FLAT: "apartamento",
    CASA_TIPO: "casa",
    CASA_DE_VILA: "casa",
    CASA_EM_CONDOMINIO: "casa",
    SOBRADO: "casa",
    TERRENO_RESIDENCIAL: "terreno",
    TERRENO_RESIDENCIAL_EM_CONDOMINIO: "terreno"
  };

  return map[t] || clean(type).toLowerCase();
}

function normalizeProperty(property) {
  const id =
    clean(
      property?.id ||
      property?.base36Id
    );

  if (!id) {
    throw new Error("Imóvel sem ID");
  }

  const availableFor =
    arr(property?.availableFor);

  const active =
    availableFor.includes("VENDA") &&
    !availableFor.includes("INDISPONIVEL") &&
    !["VENDIDO", "ALUGADO"].includes(
      clean(property?.transactionStatus).toUpperCase()
    );

  const address =
    property?.address || {};

  const images =
    arr(property?.media?.images)
      .map(x => x?.url)
      .filter(Boolean);

  const floorPlans =
    arr(property?.media?.floorPlans);

  const promotionalFiles =
    arr(property?.media?.promotionalFiles);

  const videos =
    arr(property?.media?.videos);

  const tours =
    arr(property?.media?.tours);

  const propertyUrl =
    property?.base36Id
      ? `https://www.usenonstop.com/imovel/${encodeURIComponent(property.base36Id)}`
      : null;

  return {
    external_id:
      `nonstop:${id}`,

    source:
      "usados",

    title:
      clean(
        property?.title ||
        `${normalizeType(property?.type)} em ${address?.area || ""}`
      ),

    development_name:
      clean(
        property?.condo?.name || ""
      ) || null,

    neighborhood:
      clean(address?.area) || null,

    city:
      clean(address?.city) || null,

    state:
      clean(address?.state) || null,

    price:
      num(
        property?.values?.sale
      ),

    bedrooms:
      num(
        property?.rooms
      ),

    bathrooms:
      num(
        property?.baths
      ),

    parking_spaces:
      arr(property?.parkingLots).length,

    area:
      num(
        property?.areas?.private ??
        property?.areas?.total ??
        null
      ),

    image_url:
      firstImage(property),

    property_url:
      propertyUrl,

    active,

    raw_data: {
      source:
        "nonstop",

      provider:
        "nonstop",

      nonstop_id:
        clean(property?.id),

      base36_id:
        clean(property?.base36Id),

      use:
        property?.use ?? null,

      type:
        property?.type ?? null,

      normalized_type:
        normalizeType(
          property?.type
        ),

      status:
        property?.status ?? null,

      transaction_status:
        property?.transactionStatus ?? null,

      available_for:
        availableFor,

      suites:
        property?.suites ?? null,

      floor:
        property?.floor ?? null,

      face:
        property?.face ?? null,

      parking_lots:
        property?.parkingLots ?? [],

      values:
        property?.values ?? {},

      fees:
        property?.fees ?? {},

      areas:
        property?.areas ?? {},

      year_of_construction:
        property?.yearOfConstruction ?? null,

      address:
        property?.address ?? {},

      description:
        property?.description ?? "",

      features:
        property?.features ?? [],

      layout:
        property?.layout ?? null,

      condo:
        property?.condo ?? null,

      images,

      floor_plans:
        floorPlans,

      promotional_files:
        promotionalFiles,

      videos,

      tours,

      user:
        property?.user ?? null,

      shared_mgmt_user:
        property?.sharedMgmtUser ?? null,

      updated_at:
        property?.updatedAt ?? null,

      created_at:
        property?.createdAt ?? null
    },

    updated_at:
      new Date().toISOString()
  };
}

function supabaseHeaders(
  key,
  prefer = null
) {
  const headers = {
    apikey:
      key,

    Authorization:
      `Bearer ${key}`,

    "Content-Type":
      "application/json"
  };

  if (prefer) {
    headers.Prefer = prefer;
  }

  return headers;
}

async function upsertProperty(
  row,
  supabaseKey
) {
  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/properties?on_conflict=external_id`,
      {
        method:
          "POST",

        headers:
          supabaseHeaders(
            supabaseKey,
            "resolution=merge-duplicates,return=representation"
          ),

        body:
          JSON.stringify([row])
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase upsert ${response.status}: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function deactivateProperty(
  id,
  supabaseKey
) {
  const candidates = [
    `nonstop:${id}`,
    id
  ];

  for (
    const externalId of
    candidates
  ) {
    const response =
      await fetch(
        `${SUPABASE_URL}/rest/v1/properties?external_id=eq.${encodeURIComponent(externalId)}`,
        {
          method:
            "PATCH",

          headers:
            supabaseHeaders(
              supabaseKey,
              "return=minimal"
            ),

          body:
            JSON.stringify({
              active:
                false,

              updated_at:
                new Date().toISOString()
            })
        }
      );

    if (!response.ok) {
      const text =
        await response.text();

      console.warn(
        "NONSTOP_DEACTIVATE_FAILED",
        externalId,
        response.status,
        text
      );
    }
  }
}

async function fetchNonstopPage(
  token,
  currentPage = 1,
  perPage = 50
) {
  const params =
    new URLSearchParams({
      availableFor:
        "VENDA",

      currentPage:
        String(currentPage),

      perPage:
        String(perPage),

      sortBy:
        "_id",

      sortOrder:
        "1"
    });

  const response =
    await fetch(
      `https://www.usenonstop.com/api/unstable/imoveis/todos?${params.toString()}`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json"
        }
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    throw new Error(
      `Nonstop API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return {
    properties:
      Array.isArray(data?.properties)
        ? data.properties
        : [],

    total:
      Number(
        data?.total || 0
      )
  };
}

async function syncInitial(
  token,
  supabaseKey,
  page = 1
) {
  const PER_PAGE = 50;

  const result =
    await fetchNonstopPage(
      token,
      page,
      PER_PAGE
    );

  const saved = [];
  const errors = [];

  for (
    const property of
    result.properties
  ) {
    try {
      /*
        A listagem pode ser CardProperty.
        Se não vier informação suficiente,
        busca o imóvel completo pelo base36Id.
      */
      let full =
        property;

      const base36Id =
        clean(
          property?.base36Id
        );

      if (
        base36Id &&
        (
          !property?.media ||
          !property?.address ||
          !property?.values
        )
      ) {
        const detailResponse =
          await fetch(
            `https://www.usenonstop.com/api/unstable/imoveis/${encodeURIComponent(base36Id)}`,
            {
              headers: {
                Authorization:
                  `Bearer ${token}`,

                Accept:
                  "application/json"
              }
            }
          );

        if (
          detailResponse.ok
        ) {
          const detail =
            await detailResponse.json();

          if (detail) {
            full = detail;
          }
        }
      }

      const row =
        normalizeProperty(
          full
        );

      await upsertProperty(
        row,
        supabaseKey
      );

      saved.push(
        row.external_id
      );

    } catch (error) {
      errors.push({
        id:
          property?.id ||
          property?.base36Id ||
          null,

        error:
          error?.message ||
          String(error)
      });
    }
  }

  const totalPages =
    result.total > 0
      ? Math.ceil(
          result.total /
          PER_PAGE
        )
      : null;

  return {
    page,

    per_page:
      PER_PAGE,

    received:
      result.properties.length,

    saved:
      saved.length,

    errors,

    total:
      result.total,

    total_pages:
      totalPages,

    next_page:
      totalPages &&
      page < totalPages
        ? page + 1
        : null
  };
}

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  const nonstopToken =
    process.env.NONSTOP_API_TOKEN;

  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !nonstopToken ||
    !supabaseKey
  ) {
    return res
      .status(500)
      .json({
        ok:
          false,

        error:
          "NONSTOP_API_TOKEN ou SUPABASE_SECRET_KEY ausente"
      });
  }

  try {

    // =====================================================
    // CARGA INICIAL
    // GET /api/nonstop-webhook?action=sync&page=1
    // =====================================================

    if (
      req.method === "GET" &&
      req.query?.action === "sync"
    ) {
      const page =
        Math.max(
          1,
          Number(
            req.query?.page || 1
          ) || 1
        );

      const result =
        await syncInitial(
          nonstopToken,
          supabaseKey,
          page
        );

      return res
        .status(200)
        .json({
          ok:
            true,

          mode:
            "sync",

          ...result
        });
    }

    // =====================================================
    // WEBHOOK
    // =====================================================

    if (
      req.method !== "POST"
    ) {
      return res
        .status(405)
        .json({
          ok:
            false,

          error:
            "Method not allowed"
        });
    }

    const payload =
      req.body || {};

    const event =
      clean(
        payload?.event
      );

    console.info(
      "NONSTOP_WEBHOOK_RECEIVED",
      {
        event,
        property_id:
          payload?.property?.id ||
          payload?.propertyId ||
          null,

        base36_id:
          payload?.property?.base36Id ||
          payload?.base36Id ||
          null
      }
    );

    // -----------------------------------------------------
    // CRIA / ATUALIZA
    // -----------------------------------------------------

    if (
      event ===
        "publication:create" ||
      event ===
        "property:update"
    ) {
      if (
        !payload?.property
      ) {
        return res
          .status(400)
          .json({
            ok:
              false,

            error:
              "Webhook sem property"
          });
      }

      const row =
        normalizeProperty(
          payload.property
        );

      await upsertProperty(
        row,
        supabaseKey
      );

      return res
        .status(200)
        .json({
          ok:
            true,

          event,

          action:
            "upsert",

          external_id:
            row.external_id
        });
    }

    // -----------------------------------------------------
    // REMOVE PUBLICAÇÃO / EXCLUI
    // -----------------------------------------------------

    if (
      event ===
        "publication:delete" ||
      event ===
        "property:delete"
    ) {
      const propertyId =
        clean(
          payload?.propertyId
        );

      const base36Id =
        clean(
          payload?.base36Id
        );

      if (propertyId) {
        await deactivateProperty(
          propertyId,
          supabaseKey
        );
      }

      if (base36Id) {
        await deactivateProperty(
          base36Id,
          supabaseKey
        );
      }

      return res
        .status(200)
        .json({
          ok:
            true,

          event,

          action:
            "deactivate",

          property_id:
            propertyId || null,

          base36_id:
            base36Id || null
        });
    }

    return res
      .status(200)
      .json({
        ok:
          true,

        ignored:
          true,

        event
      });

  } catch (error) {
    console.error(
      "NONSTOP_FATAL",
      error
    );

    return res
      .status(500)
      .json({
        ok:
          false,

        error:
          error?.message ||
          String(error)
      });
  }
}
