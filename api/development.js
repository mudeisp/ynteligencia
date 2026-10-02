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

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueObjects(items, keyFn) {
  const map = new Map();

  for (const item of items || []) {
    if (!item) continue;

    const key = keyFn(item);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

function safeObject(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : {};
}

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function getRaw(row) {
  return safeObject(
    row?.raw_data ||
    row?.rawData
  );
}

function getBuilding(row) {
  return safeObject(
    getRaw(row)?.building
  );
}

function getTypology(row) {
  return safeObject(
    getRaw(row)?.typology
  );
}

function normalizeImageList(
  rows,
  building
) {
  const all = [];

  for (const row of rows) {
    const raw =
      getRaw(row);

    for (
      const image of
      safeArray(raw.images)
    ) {
      if (
        typeof image === "string" &&
        image.trim()
      ) {
        all.push(
          image.trim()
        );
      }
    }
  }

  for (
    const image of
    safeArray(
      building.images
    )
  ) {
    if (
      typeof image === "string" &&
      image.trim()
    ) {
      all.push(
        image.trim()
      );
    }
  }

  return uniq(all);
}

function normalizeSimpleArray(
  value
) {
  return safeArray(value)
    .filter(Boolean);
}

function normalizeFeatures(
  value
) {
  return safeArray(value)
    .map(item => {
      if (
        typeof item === "string"
      ) {
        return {
          name: item
        };
      }

      if (
        item &&
        typeof item === "object"
      ) {
        return item;
      }

      return null;
    })
    .filter(Boolean);
}

function normalizeFloorPlans(
  value
) {
  return safeArray(value)
    .map(
      (
        item,
        index
      ) => {
        if (
          typeof item === "string"
        ) {
          return {
            id:
              `floorplan-${index + 1}`,

            name:
              `Planta ${index + 1}`,

            url:
              item
          };
        }

        if (
          !item ||
          typeof item !== "object"
        ) {
          return null;
        }

        const url =
          item.url ||
          item.image_url ||
          item.image ||
          item.src ||
          item.file_url ||
          item.original ||
          item["1024x1024"] ||
          item["2280x1800"] ||
          null;

        const area =
          num(
            item.area ??
            item.private_area ??
            item.usable_area ??
            item.total_area ??
            null
          );

        return {
          id:
            clean(
              item.id ??
              item.floorplan_id ??
              item.typology_id ??
              `floorplan-${index + 1}`
            ),

          name:
            clean(
              item.name ??
              item.title ??
              item.label ??
              (
                area
                  ? `Planta ${area.toLocaleString("pt-BR")} m²`
                  : `Planta ${index + 1}`
              )
            ),

          area,

          bedrooms:
            num(
              item.bedrooms ??
              item.rooms ??
              null
            ),

          suites:
            num(
              item.suites ??
              null
            ),

          parking:
            num(
              item.parking ??
              item.parking_spaces ??
              null
            ),

          url:
            clean(url),

          raw:
            item
        };
      }
    )
    .filter(Boolean);
}

function normalizeVideos(
  value
) {
  return safeArray(value)
    .map(
      (
        item,
        index
      ) => {
        if (
          typeof item === "string"
        ) {
          return {
            id:
              `video-${index + 1}`,

            title:
              `Vídeo ${index + 1}`,

            url:
              item
          };
        }

        if (
          !item ||
          typeof item !== "object"
        ) {
          return null;
        }

        return {
          id:
            clean(
              item.id ??
              `video-${index + 1}`
            ),

          title:
            clean(
              item.title ??
              item.name ??
              `Vídeo ${index + 1}`
            ),

          url:
            clean(
              item.url ??
              item.video_url ??
              item.embed_url ??
              item.src ??
              ""
            ),

          thumbnail:
            clean(
              item.thumbnail ??
              item.thumbnail_url ??
              item.image ??
              ""
            ),

          raw:
            item
        };
      }
    )
    .filter(Boolean);
}

function normalizeFiles(
  value
) {
  return safeArray(value)
    .map(
      (
        item,
        index
      ) => {
        if (
          typeof item === "string"
        ) {
          return {
            id:
              `file-${index + 1}`,

            name:
              `Arquivo ${index + 1}`,

            url:
              item
          };
        }

        if (
          !item ||
          typeof item !== "object"
        ) {
          return null;
        }

        return {
          id:
            clean(
              item.id ??
              `file-${index + 1}`
            ),

          name:
            clean(
              item.name ??
              item.title ??
              item.filename ??
              `Arquivo ${index + 1}`
            ),

          type:
            clean(
              item.type ??
              item.kind ??
              item.category ??
              ""
            ),

          url:
            clean(
              item.url ??
              item.file_url ??
              item.download_url ??
              item.src ??
              ""
            ),

          raw:
            item
        };
      }
    )
    .filter(Boolean);
}

function buildTypology(
  row
) {
  const raw =
    getRaw(row);

  const typology =
    getTypology(row);

  const stock =
    num(
      typology.stock ??
      row.stock ??
      null
    );

  return {
    id:
      clean(
        typology.id ??
        raw.typology_id ??
        row.external_id ??
        ""
      ),

    property_id:
      clean(
        row.external_id ??
        ""
      ),

    type:
      clean(
        typology.type ??
        row.property_type ??
        ""
      ),

    area:
      num(
        typology.private_area ??
        row.area ??
        null
      ),

    bedrooms:
      num(
        typology.bedrooms ??
        row.bedrooms ??
        null
      ),

    bathrooms:
      num(
        typology.bathrooms ??
        row.bathrooms ??
        null
      ),

    suites:
      num(
        typology.suites ??
        row.suites ??
        null
      ),

    parking:
      num(
        typology.parking ??
        row.parking_spaces ??
        row.parking ??
        null
      ),

    stock,

    price:
      num(
        typology.discount_price ??
        typology.original_price ??
        row.price ??
        null
      ),

    original_price:
      num(
        typology.original_price ??
        row.price ??
        null
      ),

    discount_price:
      num(
        typology.discount_price ??
        null
      ),

    reference:
      clean(
        typology.reference ??
        ""
      ),

    floor_reference:
      clean(
        typology.floor_reference ??
        ""
      ),

    section_reference:
      clean(
        typology.section_reference ??
        ""
      ),

    features:
      normalizeFeatures(
        typology.features
      ),

    updated_at:
      clean(
        typology.updated_at ??
        row.updated_at ??
        ""
      ),

    raw:
      typology
  };
}

function statsFromTypologies(
  typologies
) {
  const areas =
    typologies
      .map(
        item =>
          num(item.area)
      )
      .filter(
        value =>
          value !== null &&
          value > 0
      );

  const prices =
    typologies
      .map(
        item =>
          num(item.price)
      )
      .filter(
        value =>
          value !== null &&
          value > 0
      );

  const bedrooms =
    uniq(
      typologies
        .map(
          item =>
            num(
              item.bedrooms
            )
        )
        .filter(
          value =>
            value !== null
        )
    )
      .sort(
        (a, b) =>
          a - b
      );

  const stocks =
    typologies
      .map(
        item =>
          num(item.stock)
      )
      .filter(
        value =>
          value !== null &&
          value >= 0
      );

  return {
    typologies_count:
      typologies.length,

    min_area:
      areas.length
        ? Math.min(
            ...areas
          )
        : null,

    max_area:
      areas.length
        ? Math.max(
            ...areas
          )
        : null,

    min_price:
      prices.length
        ? Math.min(
            ...prices
          )
        : null,

    max_price:
      prices.length
        ? Math.max(
            ...prices
          )
        : null,

    bedrooms,

    total_stock:
      stocks.length
        ? stocks.reduce(
            (
              sum,
              value
            ) =>
              sum +
              value,
            0
          )
        : null
  };
}

async function querySupabase({
  buildingId,
  developmentName,
  supabaseKey
}) {
  const params =
    new URLSearchParams();

  params.set(
    "select",
    "*"
  );

  params.set(
    "source",
    "eq.novos"
  );

  params.set(
    "active",
    "eq.true"
  );

  params.set(
    "limit",
    "500"
  );

  if (buildingId) {
    params.set(
      "raw_data->>building_id",
      `eq.${buildingId}`
    );
  } else if (
    developmentName
  ) {
    params.set(
      "development_name",
      `ilike.*${developmentName}*`
    );
  }

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`,
      {
        headers: {
          apikey:
            supabaseKey,

          Authorization:
            `Bearer ${supabaseKey}`,

          "Content-Type":
            "application/json"
        }
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => []
      );

  if (!response.ok) {
    console.error(
      "DEVELOPMENT_SUPABASE_ERROR",
      response.status,
      data
    );

    throw new Error(
      "Falha ao consultar o empreendimento"
    );
  }

  return Array.isArray(data)
    ? data
    : [];
}

export default async function handler(
  req,
  res
) {
  if (
    ![
      "GET",
      "POST"
    ].includes(
      req.method
    )
  ) {
    return res
      .status(405)
      .json({
        success: false,
        error:
          "Method not allowed"
      });
  }

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  try {
    const supabaseKey =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY;

    if (!supabaseKey) {
      return res
        .status(500)
        .json({
          success: false,
          error:
            "Chave do Supabase não configurada"
        });
    }

    const body =
      req.method === "POST"
        ? req.body || {}
        : {};

    const buildingId =
      clean(
        req.query?.id ??
        req.query?.building_id ??
        body.id ??
        body.building_id ??
        ""
      );

    const developmentName =
      clean(
        req.query?.name ??
        req.query?.development ??
        req.query?.development_name ??
        body.name ??
        body.development ??
        body.development_name ??
        ""
      );

    if (
      !buildingId &&
      !developmentName
    ) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Informe id/building_id ou development_name"
        });
    }

    const rows =
      await querySupabase({
        buildingId,
        developmentName,
        supabaseKey
      });

    if (
      !rows.length
    ) {
      return res
        .status(404)
        .json({
          success: false,
          error:
            "Empreendimento não encontrado"
        });
    }

    /*
      Se a busca foi por nome e encontrou mais de um building,
      escolhemos o grupo com mais tipologias.
    */
    const groups =
      new Map();

    for (
      const row of
      rows
    ) {
      const raw =
        getRaw(row);

      const building =
        getBuilding(row);

      const id =
        clean(
          raw.building_id ??
          building.id ??
          ""
        );

      const key =
        id ||
        clean(
          row.development_name ??
          building.name ??
          row.title ??
          ""
        );

      if (!key) {
        continue;
      }

      if (
        !groups.has(
          key
        )
      ) {
        groups.set(
          key,
          []
        );
      }

      groups
        .get(key)
        .push(row);
    }

    const groupEntries =
      [
        ...groups.entries()
      ]
        .sort(
          (
            a,
            b
          ) =>
            b[1].length -
            a[1].length
        );

    const [
      resolvedGroupKey,
      developmentRows
    ] =
      groupEntries[0] ||
      [
        "",
        rows
      ];

    const firstRow =
      developmentRows[0];

    const raw =
      getRaw(firstRow);

    const building =
      getBuilding(
        firstRow
      );

    const resolvedBuildingId =
      clean(
        raw.building_id ??
        building.id ??
        buildingId ??
        resolvedGroupKey
      );

    const typologies =
      uniqueObjects(
        developmentRows.map(
          buildTypology
        ),
        item =>
          item.id ||
          item.property_id
      )
        .sort(
          (
            a,
            b
          ) => {
            const areaA =
              num(a.area) ??
              999999;

            const areaB =
              num(b.area) ??
              999999;

            if (
              areaA !== areaB
            ) {
              return (
                areaA -
                areaB
              );
            }

            const priceA =
              num(
                a.price
              ) ??
              999999999;

            const priceB =
              num(
                b.price
              ) ??
              999999999;

            return (
              priceA -
              priceB
            );
          }
        );

    const images =
      normalizeImageList(
        developmentRows,
        building
      );

    const floorPlans =
      normalizeFloorPlans(
        building.floor_plans
      );

    const videos =
      normalizeVideos(
        building.videos
      );

    const files =
      normalizeFiles(
        building.files
      );

    const buildingFeatures =
      normalizeFeatures(
        building.building_features ??
        building.features
      );

    const unitFeatures =
      normalizeFeatures(
        building.unit_features
      );

    const summary =
      statsFromTypologies(
        typologies
      );

    const address =
      safeObject(
        building.address
      );

    /*
      URLs externas da Órulo não são devolvidas.
      A Ynteligencia usa os dados e sua própria interface.
    */
    const response = {
      success: true,

      development: {
        id:
          resolvedBuildingId,

        name:
          clean(
            building.name ??
            firstRow.development_name ??
            firstRow.title ??
            ""
          ),

        finality:
          clean(
            building.finality ??
            ""
          ),

        status:
          clean(
            building.status ??
            ""
          ),

        stage:
          clean(
            building.stage ??
            ""
          ),

        type:
          clean(
            building.type ??
            ""
          ),

        description:
          clean(
            building.description ??
            ""
          ),

        developer:
          clean(
            building.developer ??
            ""
          ),

        publisher:
          clean(
            building.publisher ??
            ""
          ),

        launch_date:
          clean(
            building.launch_date ??
            ""
          ),

        opening_date:
          clean(
            building.opening_date ??
            ""
          ),

        total_units:
          num(
            building.total_units
          ),

        number_of_towers:
          num(
            building.number_of_towers
          ),

        number_of_floors:
          num(
            building.number_of_floors
          ),

        apts_per_floor:
          num(
            building.apts_per_floor
          ),

        total_area:
          num(
            building.total_area
          ),

        floor_area:
          num(
            building.floor_area
          ),

        building_stock:
          num(
            building.stock
          ),

        min_price:
          num(
            building.min_price
          ),

        address,

        neighborhood:
          clean(
            firstRow.neighborhood ??
            address.area ??
            address.neighborhood ??
            ""
          ),

        city:
          clean(
            firstRow.city ??
            address.city ??
            "São Paulo"
          ),

        state:
          clean(
            firstRow.state ??
            address.state ??
            "SP"
          ),

        updated_at:
          clean(
            building.updated_at ??
            firstRow.updated_at ??
            ""
          ),

        last_updated_pricetable_at:
          clean(
            building.last_updated_pricetable_at ??
            ""
          )
      },

      summary,

      media: {
        images,

        videos,

        virtual_tour:
          clean(
            building.virtual_tour ??
            ""
          ),

        floor_plans:
          floorPlans,

        files
      },

      features: {
        building:
          buildingFeatures,

        units:
          unitFeatures
      },

      commercial: {
        payment_conditions:
          normalizeSimpleArray(
            building.payment_conditions
          ),

        opportunity:
          building.opportunity ??
          null
      },

      typologies,

      meta: {
        source:
          "novos",

        provider:
          "orulo",

        rows_found:
          developmentRows.length,

        groups_found:
          groupEntries.length,

        queried_by:
          buildingId
            ? "building_id"
            : "development_name"
      }
    };

    return res
      .status(200)
      .json(
        response
      );

  } catch (error) {
    console.error(
      "DEVELOPMENT_API_FATAL",
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        error:
          error?.message ||
          "Erro interno ao carregar empreendimento"
      });
  }
}
