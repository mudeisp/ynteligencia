const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://wzaegidwtdjuhqchpdpd.supabase.co";


// =========================================================
// HELPERS
// =========================================================

function clean(value) {
  return String(value ?? "").trim();
}


function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function arr(value) {
  return Array.isArray(value)
    ? value
    : [];
}


function normalizeType(type) {
  const t =
    clean(type).toUpperCase();

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

  return (
    map[t] ||
    clean(type).toLowerCase()
  );
}


function firstImage(property) {
  const mediaImages =
    arr(
      property?.media?.images
    );

  if (mediaImages.length) {
    const first =
      mediaImages[0];

    if (
      typeof first === "string"
    ) {
      return first;
    }

    return (
      first?.url ||
      first?.src ||
      first?.original ||
      null
    );
  }


  const images =
    arr(
      property?.images
    );

  if (images.length) {
    const first =
      images[0];

    if (
      typeof first === "string"
    ) {
      return first;
    }

    return (
      first?.url ||
      first?.src ||
      null
    );
  }


  return (
    property?.condo
      ?.media
      ?.images
      ?.[0]
      ?.url ||
    null
  );
}


// =========================================================
// NORMALIZA IMÓVEL NONSTOP PARA properties
// =========================================================

function normalizeProperty(property) {

  const id =
    clean(
      property?.id ||
      property?._id ||
      property?.base36Id ||
      property?.code
    );


  if (!id) {
    throw new Error(
      "Imóvel Nonstop sem ID"
    );
  }


  const availableFor =
    arr(
      property?.availableFor
    );


  const transactionStatus =
    clean(
      property?.transactionStatus
    ).toUpperCase();


  let active = true;


  if (
    availableFor.includes(
      "INDISPONIVEL"
    ) ||
    [
      "VENDIDO",
      "ALUGADO",
      "INATIVO"
    ].includes(
      transactionStatus
    )
  ) {
    active = false;
  }


  const address =
    property?.address || {};


  const mediaImages =
    arr(
      property?.media?.images
    )
      .map(item => {

        if (
          typeof item ===
          "string"
        ) {
          return item;
        }

        return (
          item?.url ||
          item?.src ||
          item?.original ||
          null
        );

      })
      .filter(Boolean);


  const floorPlans =
    arr(
      property?.media?.floorPlans
    );


  const promotionalFiles =
    arr(
      property?.media
        ?.promotionalFiles
    );


  const videos =
    arr(
      property?.media?.videos
    );


  const tours =
    arr(
      property?.media?.tours
    );


  const salePrice =
    num(
      property?.values?.sale ??
      property?.salePrice ??
      property?.price ??
      property?.valor ??
      null
    );


  const privateArea =
    num(
      property?.areas?.private ??
      property?.privateArea ??
      property?.area ??
      null
    );


  const totalArea =
    num(
      property?.areas?.total ??
      property?.totalArea ??
      null
    );


  const bedrooms =
    num(
      property?.rooms ??
      property?.bedrooms ??
      property?.dormitories ??
      null
    );


  const bathrooms =
    num(
      property?.baths ??
      property?.bathrooms ??
      null
    );


  const parkingSpaces =
    Array.isArray(
      property?.parkingLots
    )
      ? property
          .parkingLots
          .length
      : num(
          property
            ?.parkingSpaces ??
          property?.parking ??
          null
        );


  const base36Id =
    clean(
      property?.base36Id
    );


  const propertyUrl =
    base36Id
      ? `https://www.usenonstop.com/imovel/${encodeURIComponent(base36Id)}`
      : null;


  return {

    external_id:
      `nonstop:${id}`,


    source:
      "usados",


    title:
      clean(
        property?.title ||
        property?.name ||
        `${normalizeType(property?.type)} em ${address?.area || address?.neighborhood || ""}`
      ),


    development_name:
      clean(
        property?.condo?.name ||
        property?.condominium
          ?.name ||
        ""
      ) || null,


    neighborhood:
      clean(
        address?.area ||
        address?.neighborhood ||
        property?.neighborhood ||
        ""
      ) || null,


    city:
      clean(
        address?.city ||
        property?.city ||
        ""
      ) || null,


    state:
      clean(
        address?.state ||
        property?.state ||
        ""
      ) || null,


    price:
      salePrice,


    bedrooms,


    bathrooms,


    parking_spaces:
      parkingSpaces,


    area:
      privateArea ??
      totalArea,


    image_url:
      firstImage(
        property
      ),


    property_url:
      propertyUrl,


    active,


    raw_data: {

      source:
        "nonstop",


      provider:
        "nonstop",


      nonstop_id:
        id,


      base36_id:
        base36Id,


      type:
        property?.type ??
        null,


      normalized_type:
        normalizeType(
          property?.type
        ),


      use:
        property?.use ??
        null,


      status:
        property?.status ??
        null,


      transaction_status:
        property
          ?.transactionStatus ??
        null,


      available_for:
        availableFor,


      suites:
        property?.suites ??
        null,


      floor:
        property?.floor ??
        null,


      face:
        property?.face ??
        null,


      parking_lots:
        property?.parkingLots ??
        [],


      values:
        property?.values ??
        {},


      fees:
        property?.fees ??
        {},


      areas:
        property?.areas ??
        {},


      address:
        property?.address ??
        {},


      description:
        property?.description ??
        "",


      features:
        property?.features ??
        [],


      layout:
        property?.layout ??
        null,


      condo:
        property?.condo ??
        property?.condominium ??
        null,


      images:
        mediaImages,


      floor_plans:
        floorPlans,


      promotional_files:
        promotionalFiles,


      videos,


      tours,


      user:
        property?.user ??
        null,


      shared_mgmt_user:
        property
          ?.sharedMgmtUser ??
        null,


      year_of_construction:
        property
          ?.yearOfConstruction ??
        null,


      created_at:
        property?.createdAt ??
        null,


      updated_at:
        property?.updatedAt ??
        null

    },


    updated_at:
      new Date()
        .toISOString()

  };

}


// =========================================================
// SUPABASE
// =========================================================

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

    headers.Prefer =
      prefer;

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
          JSON.stringify(
            [row]
          )

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

    return JSON.parse(
      text
    );

  } catch {

    return [];

  }

}


async function deactivateProperty(
  id,
  supabaseKey
) {

  if (!id) {
    return;
  }


  const externalId =
    `nonstop:${id}`;


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
              new Date()
                .toISOString()

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


// =========================================================
// EXTRAI IMÓVEIS DO JSON
// =========================================================

function extractProperties(
  data
) {

  if (
    Array.isArray(data)
  ) {
    return data;
  }


  const candidates = [

    data?.properties,

    data?.imoveis,

    data?.items,

    data?.results,

    data?.data,

    data?.data?.properties,

    data?.data?.imoveis,

    data?.data?.items,

    data?.data?.results

  ];


  for (
    const candidate of
    candidates
  ) {

    if (
      Array.isArray(
        candidate
      )
    ) {

      return candidate;

    }

  }


  return [];

}


function extractTotal(
  data,
  fallback = 0
) {

  const candidates = [

    data?.total,

    data?.totalCount,

    data?.count,

    data?.pagination?.total,

    data?.meta?.total,

    data?.data?.total,

    data?.data?.totalCount

  ];


  for (
    const value of
    candidates
  ) {

    const n =
      Number(value);


    if (
      Number.isFinite(n)
    ) {

      return n;

    }

  }


  return fallback;

}


// =========================================================
// CONSULTA API NONSTOP
// =========================================================

async function fetchNonstopPage(
  token,
  currentPage = 1,
  perPage = 50
) {

  /*
    Sem filtro de venda por enquanto.
    Primeiro queremos enxergar o estoque real liberado
    para esta integração.
  */

  const params =
    new URLSearchParams({

      currentPage:
        String(
          currentPage
        ),


      perPage:
        String(
          perPage
        )

    });


  const url =
    `https://www.usenonstop.com/api/unstable/imoveis/todos?${params.toString()}`;


  const response =
    await fetch(

      url,

      {

        method:
          "GET",


        headers: {

          Authorization:
            `Bearer ${token}`,


          Accept:
            "application/json"

        }

      }

    );


  const text =
    await response.text();


  let data;


  try {

    data =
      JSON.parse(
        text
      );

  } catch {

    data = {

      raw:
        text

    };

  }


  if (!response.ok) {

    throw new Error(

      `Nonstop API ${response.status}: ${text.slice(0, 2000)}`

    );

  }


  const properties =
    extractProperties(
      data
    );


  const total =
    extractTotal(
      data,
      properties.length
    );


  return {

    url,


    status:
      response.status,


    data,


    properties,


    total

  };

}


// =========================================================
// SYNC DE UMA PÁGINA
// =========================================================

async function syncPage(
  token,
  supabaseKey,
  page = 1
) {

  const PER_PAGE =
    50;


  const result =
    await fetchNonstopPage(

      token,

      page,

      PER_PAGE

    );


  const saved =
    [];


  const errors =
    [];


  for (
    const property of
    result.properties
  ) {

    try {

      const row =
        normalizeProperty(
          property
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

          property?._id ||

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


// =========================================================
// TOKEN DO WEBHOOK
// =========================================================

function getIncomingWebhookToken(
  req
) {

  const authorization =
    clean(
      req.headers?.authorization
    );


  if (
    authorization
      .toLowerCase()
      .startsWith(
        "bearer "
      )
  ) {

    return clean(
      authorization.slice(
        7
      )
    );

  }


  return clean(

    req.headers?.[
      "x-webhook-token"
    ] ||

    req.headers?.[
      "x-api-key"
    ] ||

    req.headers?.token ||

    req.query?.token ||

    req.body?.token ||

    ""

  );

}


// =========================================================
// HANDLER
// =========================================================

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  const nonstopToken =
    process.env
      .NONSTOP_API_TOKEN;


  const webhookToken =
    process.env
      .NONSTOP_WEBHOOK_TOKEN;


  const supabaseKey =

    process.env
      .SUPABASE_SECRET_KEY ||

    process.env
      .SUPABASE_SERVICE_ROLE_KEY;


  // =====================================================
  // TESTE DAS VARIÁVEIS
  // =====================================================

  if (
    req.method === "GET" &&
    req.query?.action ===
      "envcheck"
  ) {

    return res
      .status(200)
      .json({

        ok:
          true,


        has_api_token:
          Boolean(
            nonstopToken
          ),


        has_webhook_token:
          Boolean(
            webhookToken
          ),


        has_supabase_key:
          Boolean(
            supabaseKey
          )

      });

  }


  // =====================================================
  // PRECISAMOS DO TOKEN DE API PARA DEBUG / SYNC
  // =====================================================

  if (
    !nonstopToken
  ) {

    return res
      .status(500)
      .json({

        ok:
          false,


        error:
          "NONSTOP_API_TOKEN ausente"

      });

  }


  try {

    // ===================================================
    // DEBUG
    //
    // NÃO GRAVA NADA.
    //
    // /api/nonstop-webhook?action=debug&page=1
    // ===================================================

    if (
      req.method === "GET" &&
      req.query?.action ===
        "debug"
    ) {

      const page =
        Math.max(

          1,

          Number(
            req.query?.page ||
            1
          ) || 1

        );


      const result =
        await fetchNonstopPage(

          nonstopToken,

          page,

          10

        );


      return res
        .status(200)
        .json({

          ok:
            true,


          mode:
            "debug",


          request_url:
            result.url,


          nonstop_status:
            result.status,


          extracted_count:
            result.properties
              .length,


          detected_total:
            result.total,


          response_keys:

            result.data &&
            typeof result.data ===
              "object"

              ? Object.keys(
                  result.data
                )

              : [],


          raw_response:
            result.data

        });

    }


    // ===================================================
    // SYNC
    //
    // GRAVA UMA PÁGINA NO SUPABASE
    //
    // /api/nonstop-webhook?action=sync&page=1
    // ===================================================

    if (
      req.method === "GET" &&
      req.query?.action ===
        "sync"
    ) {

      if (!supabaseKey) {

        return res
          .status(500)
          .json({

            ok:
              false,


            error:
              "SUPABASE_SECRET_KEY ausente"

          });

      }


      const page =
        Math.max(

          1,

          Number(
            req.query?.page ||
            1
          ) || 1

        );


      const result =
        await syncPage(

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


    // ===================================================
    // A PARTIR DAQUI É WEBHOOK
    // ===================================================

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


    // ===================================================
    // VALIDAÇÃO DO TOKEN DO WEBHOOK
    // ===================================================

    if (!webhookToken) {

      return res
        .status(500)
        .json({

          ok:
            false,


          error:
            "NONSTOP_WEBHOOK_TOKEN ausente"

        });

    }


    const incomingToken =
      getIncomingWebhookToken(
        req
      );


    if (
      !incomingToken ||
      incomingToken !==
        webhookToken
    ) {

      console.warn(
        "NONSTOP_WEBHOOK_UNAUTHORIZED"
      );


      return res
        .status(401)
        .json({

          ok:
            false,


          error:
            "Webhook não autorizado"

        });

    }


    if (!supabaseKey) {

      return res
        .status(500)
        .json({

          ok:
            false,


          error:
            "SUPABASE_SECRET_KEY ausente"

        });

    }


    // ===================================================
    // PAYLOAD
    // ===================================================

    const payload =
      req.body || {};


    const event =
      clean(
        payload?.event ||
        payload?.type
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

          payload?.property
            ?.base36Id ||

          payload?.base36Id ||

          null

      }

    );


    // ===================================================
    // CRIAÇÃO / ATUALIZAÇÃO
    // ===================================================

    if (

      event ===
        "publication:create" ||

      event ===
        "property:update"

    ) {

      const property =
        payload?.property ||
        payload?.data?.property ||
        null;


      if (!property) {

        return res
          .status(400)
          .json({

            ok:
              false,


            error:
              "Webhook recebido sem property"

          });

      }


      const row =
        normalizeProperty(
          property
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


    // ===================================================
    // EXCLUSÃO / DESPUBLICAÇÃO
    // ===================================================

    if (

      event ===
        "publication:delete" ||

      event ===
        "property:delete"

    ) {

      const propertyId =
        clean(

          payload?.propertyId ||

          payload?.property?.id ||

          payload?.data
            ?.propertyId ||

          payload?.data
            ?.property?.id ||

          ""

        );


      if (propertyId) {

        await deactivateProperty(

          propertyId,

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
            propertyId ||
            null

        });

    }


    // ===================================================
    // EVENTO AINDA NÃO MAPEADO
    // ===================================================

    console.info(

      "NONSTOP_EVENT_IGNORED",

      event

    );


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
