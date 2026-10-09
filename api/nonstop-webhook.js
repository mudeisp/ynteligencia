import inventoryCoordinates from "../inventory-coordinates.js";

const {
  coordinatesFromNonstopProperty,
  deactivationPatch
} = inventoryCoordinates;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://wzaegidwtdjuhqchpdpd.supabase.co";


// =========================================================
// CONFIG
// =========================================================

const NONSTOP_BASE_URL =
  "https://www.usenonstop.com/api/unstable/imoveis/todos";

const OPERATION =
  "VENDA";

const PER_PAGE =
  50;


// =========================================================
// HELPERS
// =========================================================

function clean(value) {
  return String(value ?? "").trim();
}


function num(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function arr(value) {
  return Array.isArray(value)
    ? value
    : [];
}


function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


// =========================================================
// TIPO DE IMÓVEL
// =========================================================

function normalizeType(type) {

  const t =
    clean(type).toUpperCase();


  const map = {

    APARTAMENTO_TIPO:
      "apartamento",

    APARTAMENTO_GARDEN:
      "apartamento",

    COBERTURA:
      "apartamento",

    DUPLEX:
      "apartamento",

    TRIPLEX:
      "apartamento",

    STUDIO:
      "studio",

    KITNET:
      "studio",

    LOFT:
      "studio",

    FLAT:
      "apartamento",

    CASA_TIPO:
      "casa",

    CASA_DE_VILA:
      "casa",

    CASA_EM_CONDOMINIO:
      "casa",

    SOBRADO:
      "casa",

    TERRENO_RESIDENCIAL:
      "terreno",

    TERRENO_RESIDENCIAL_EM_CONDOMINIO:
      "terreno"

  };


  return (
    map[t] ||
    clean(type).toLowerCase()
  );
}


// =========================================================
// FOTO PRINCIPAL
// =========================================================

function firstImage(property) {

  /*
    A Nonstop pode devolver foto principal diretamente
    em property.image.
  */

  if (
    typeof property?.image ===
      "string" &&
    clean(property.image)
  ) {

    return clean(
      property.image
    );

  }


  const mediaImages =
    arr(
      property?.media?.images
    );


  if (mediaImages.length) {

    const first =
      mediaImages[0];


    if (
      typeof first ===
      "string"
    ) {

      return clean(first);

    }


    return clean(

      first?.url ||

      first?.src ||

      first?.original ||

      ""

    ) || null;

  }


  const images =
    arr(
      property?.images
    );


  if (images.length) {

    const first =
      images[0];


    if (
      typeof first ===
      "string"
    ) {

      return clean(first);

    }


    return clean(

      first?.url ||

      first?.src ||

      ""

    ) || null;

  }


  return (

    clean(

      property?.condo
        ?.media
        ?.images
        ?.[0]
        ?.url

    ) ||

    null

  );

}


// =========================================================
// TODAS AS FOTOS
// =========================================================

function extractImages(property) {

  const results =
    [];


  if (
    typeof property?.image ===
      "string" &&
    clean(property.image)
  ) {

    results.push(
      clean(property.image)
    );

  }


  for (
    const item of
    arr(
      property?.media?.images
    )
  ) {

    if (
      typeof item ===
      "string"
    ) {

      if (clean(item)) {
        results.push(
          clean(item)
        );
      }

      continue;

    }


    const url =
      clean(

        item?.url ||

        item?.src ||

        item?.original ||

        ""

      );


    if (url) {

      results.push(url);

    }

  }


  for (
    const item of
    arr(
      property?.images
    )
  ) {

    if (
      typeof item ===
      "string"
    ) {

      if (clean(item)) {
        results.push(
          clean(item)
        );
      }

      continue;

    }


    const url =
      clean(

        item?.url ||

        item?.src ||

        ""

      );


    if (url) {

      results.push(url);

    }

  }


  return [
    ...new Set(
      results
    )
  ];

}


// =========================================================
// NORMALIZA NONSTOP → PROPERTIES
// =========================================================

export function normalizeProperty(
  property
) {

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


  const address =
    property?.address || {};


  const availableFor =
    arr(
      property?.availableFor
    );


  const transactionStatus =
    clean(
      property
        ?.transactionStatus
    ).toUpperCase();


  let active =
    true;


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

    active =
      false;

  }


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

          property
            ?.parking ??

          null

        );


  const images =
    extractImages(
      property
    );


  const floorPlans =
    arr(
      property
        ?.media
        ?.floorPlans
    );


  const promotionalFiles =
    arr(
      property
        ?.media
        ?.promotionalFiles
    );


  const videos =
    arr(
      property
        ?.media
        ?.videos
    );


  const tours =
    arr(
      property
        ?.media
        ?.tours
    );


  const base36Id =
    clean(
      property?.base36Id
    );


  const propertyUrl =
    base36Id

      ? `https://www.usenonstop.com/imovel/${encodeURIComponent(base36Id)}`

      : (
          clean(
            property?.url
          ) || null
        );


  return {

    external_id:
      `nonstop:${id}`,


    source:
      "usados",


    title:
      clean(

        property?.title ||

        property?.name ||

        `${normalizeType(
          property?.type
        )} em ${
          address?.area ||
          address?.neighborhood ||
          ""
        }`

      ),


    development_name:
      clean(

        property
          ?.condo
          ?.name ||

        property
          ?.condominium
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


    ...coordinatesFromNonstopProperty(
      property
    ),


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


      operation:
        "VENDA",


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


      sale_price:
        salePrice,


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


      images,


      floor_plans:
        floorPlans,


      promotional_files:
        promotionalFiles,


      videos,


      tours,


      year_of_construction:
        property
          ?.yearOfConstruction ??
        null,


      user:
        property?.user ??
        null,


      shared_mgmt_user:
        property
          ?.sharedMgmtUser ??
        null,


      created_at:
        property?.createdAt ??
        null,


      provider_updated_at:
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


// =========================================================
// BATCH UPSERT
// =========================================================

async function upsertBatch(
  rows,
  supabaseKey
) {

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {

    return {
      saved:
        0
    };

  }


  const response =
    await fetch(

      `${SUPABASE_URL}/rest/v1/properties?on_conflict=external_id`,

      {

        method:
          "POST",


        headers:
          supabaseHeaders(

            supabaseKey,

            "resolution=merge-duplicates,return=minimal"

          ),


        body:
          JSON.stringify(
            rows
          )

      }

    );


  const text =
    await response.text();


  if (!response.ok) {

    throw new Error(

      `Supabase batch ${response.status}: ${text.slice(0, 2000)}`

    );

  }


  return {

    saved:
      rows.length

  };

}


// =========================================================
// FALLBACK INDIVIDUAL
// =========================================================

async function upsertIndividual(
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

            "resolution=merge-duplicates,return=minimal"

          ),


        body:
          JSON.stringify(
            [row]
          )

      }

    );


  if (!response.ok) {

    const text =
      await response.text();


    throw new Error(

      `Supabase ${response.status}: ${text.slice(0, 1000)}`

    );

  }

}


// =========================================================
// DESATIVA
// =========================================================

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
          JSON.stringify(
            deactivationPatch()
          )

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
// EXTRAI LISTA DA NONSTOP
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
// BUSCA PÁGINA NONSTOP
// =========================================================

async function fetchNonstopPage(
  token,
  page = 1,
  perPage = PER_PAGE
) {

  const params =
    new URLSearchParams({

      currentPage:
        String(page),


      perPage:
        String(perPage),


      availableFor:
        OPERATION

    });


  const url =
    `${NONSTOP_BASE_URL}?${params.toString()}`;


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
      JSON.parse(text);

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

    page,


    url,


    properties,


    total

  };

}


// =========================================================
// NORMALIZA UMA PÁGINA
// =========================================================

function normalizePage(
  properties
) {

  const rows =
    [];


  const errors =
    [];


  for (
    const property of
    properties
  ) {

    try {

      rows.push(
        normalizeProperty(
          property
        )
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


  return {

    rows,

    errors

  };

}


// =========================================================
// SALVA COM FALLBACK
// =========================================================

async function saveRows(
  rows,
  supabaseKey
) {

  if (!rows.length) {

    return {

      saved:
        0,

      errors:
        []

    };

  }


  try {

    await upsertBatch(

      rows,

      supabaseKey

    );


    return {

      saved:
        rows.length,

      errors:
        []

    };


  } catch (batchError) {

    console.warn(

      "NONSTOP_BATCH_FAILED_FALLBACK",

      batchError?.message

    );


    let saved =
      0;


    const errors =
      [];


    for (
      const row of
      rows
    ) {

      try {

        await upsertIndividual(

          row,

          supabaseKey

        );


        saved +=
          1;


      } catch (error) {

        errors.push({

          external_id:
            row.external_id,


          error:
            error?.message ||
            String(error)

        });

      }

    }


    return {

      saved,

      errors

    };

  }

}


// =========================================================
// SYNC UMA PÁGINA
// =========================================================

async function syncOnePage(
  token,
  supabaseKey,
  page
) {

  const result =
    await fetchNonstopPage(

      token,

      page,

      PER_PAGE

    );


  const normalized =
    normalizePage(

      result.properties

    );


  const saveResult =
    await saveRows(

      normalized.rows,

      supabaseKey

    );


  const totalPages =
    result.total > 0

      ? Math.ceil(
          result.total /
          PER_PAGE
        )

      : null;


  return {

    page,


    received:
      result.properties
        .length,


    normalized:
      normalized.rows
        .length,


    saved:
      saveResult.saved,


    errors: [

      ...normalized.errors,

      ...saveResult.errors

    ],


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
// SYNC BATCH
// =========================================================

async function syncBatch(
  token,
  supabaseKey,
  startPage,
  numberOfPages
) {

  const MAX_PAGES =
    10;


  const pagesToRun =
    Math.min(

      Math.max(
        1,
        numberOfPages
      ),

      MAX_PAGES

    );


  const details =
    [];


  let received =
    0;


  let saved =
    0;


  let errors =
    [];


  let detectedTotal =
    null;


  let detectedTotalPages =
    null;


  for (
    let i = 0;
    i < pagesToRun;
    i++
  ) {

    const page =
      startPage + i;


    /*
      Se já sabemos que acabaram as páginas,
      não continua.
    */

    if (

      detectedTotalPages &&

      page >
        detectedTotalPages

    ) {

      break;

    }


    console.info(

      "NONSTOP_BATCH_PAGE_START",

      page

    );


    const result =
      await syncOnePage(

        token,

        supabaseKey,

        page

      );


    detectedTotal =
      result.total;


    detectedTotalPages =
      result.total_pages;


    received +=
      result.received;


    saved +=
      result.saved;


    errors = [

      ...errors,

      ...result.errors

    ];


    details.push({

      page:
        result.page,


      received:
        result.received,


      saved:
        result.saved,


      errors:
        result.errors.length

    });


    console.info(

      "NONSTOP_BATCH_PAGE_DONE",

      {

        page,

        received:
          result.received,

        saved:
          result.saved,

        errors:
          result.errors.length

      }

    );


    /*
      Pequeno intervalo para não pressionar a API.
    */

    await sleep(150);

  }


  const lastPage =
    details.length

      ? details[
          details.length - 1
        ].page

      : startPage;


  const nextStart =

    detectedTotalPages &&

    lastPage <
      detectedTotalPages

      ? lastPage + 1

      : null;


  return {

    operation:
      OPERATION,


    start_page:
      startPage,


    pages_requested:
      pagesToRun,


    pages_processed:
      details.length,


    received,


    saved,


    error_count:
      errors.length,


    errors:
      errors.slice(
        0,
        50
      ),


    total:
      detectedTotal,


    total_pages:
      detectedTotalPages,


    last_page:
      lastPage,


    next_start:
      nextStart,


    details

  };

}


// =========================================================
// TOKEN WEBHOOK
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
  // ENV CHECK
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


        operation:
          OPERATION,


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


  if (!nonstopToken) {

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


          operation:
            OPERATION,


          page,


          extracted_count:
            result.properties
              .length,


          detected_total:
            result.total,


          total_pages:
            Math.ceil(
              result.total /
              PER_PAGE
            ),


          sample:
            result.properties
              .slice(0, 2)

        });

    }


    // ===================================================
    // SYNC DE UMA PÁGINA
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
        await syncOnePage(

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


          operation:
            OPERATION,


          ...result

        });

    }


    // ===================================================
    // SYNC EM LOTE
    //
    // Exemplo:
    //
    // ?action=sync-batch&start=1&pages=5
    // ===================================================

    if (

      req.method === "GET" &&

      req.query?.action ===
        "sync-batch"

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


      const start =
        Math.max(

          1,

          Number(
            req.query?.start ||
            1
          ) || 1

        );


      const pages =
        Math.min(

          10,

          Math.max(

            1,

            Number(
              req.query?.pages ||
              5
            ) || 5

          )

        );


      const result =
        await syncBatch(

          nonstopToken,

          supabaseKey,

          start,

          pages

        );


      return res
        .status(200)
        .json({

          ok:
            true,


          mode:
            "sync-batch",


          ...result

        });

    }


    // ===================================================
    // WEBHOOK
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

          payload
            ?.property
            ?.id ||

          payload
            ?.propertyId ||

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

        payload
          ?.data
          ?.property ||

        null;


      if (!property) {

        return res
          .status(400)
          .json({

            ok:
              false,


            error:
              "Webhook sem property"

          });

      }


      /*
        Como só queremos venda,
        ignora imóvel exclusivamente de locação.
      */

      const availableFor =
        arr(
          property?.availableFor
        );


      if (

        availableFor.length &&

        !availableFor.includes(
          "VENDA"
        )

      ) {

        return res
          .status(200)
          .json({

            ok:
              true,


            ignored:
              true,


            reason:
              "Imóvel não disponível para venda",


            event

          });

      }


      const row =
        normalizeProperty(
          property
        );


      await upsertIndividual(

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

          payload
            ?.property
            ?.id ||

          payload
            ?.data
            ?.propertyId ||

          payload
            ?.data
            ?.property
            ?.id ||

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
    // EVENTO NÃO MAPEADO
    // ===================================================

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
