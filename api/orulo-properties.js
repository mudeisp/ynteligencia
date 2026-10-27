function bearerToken(req) {
  const authorization = String(req.headers?.authorization || "");
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

function isAuthorized(req) {
  const expectedToken = process.env.MIA_READ_TOKEN;
  const suppliedToken = bearerToken(req);
  return Boolean(expectedToken && suppliedToken && suppliedToken === expectedToken);
}

async function getOruloAccessToken(clientId, clientSecret) {
  const tokenResponse = await fetch("https://www.orulo.com.br/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials"
    }).toString()
  });

  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    const error = new Error("Falha na autenticação com a Órulo");
    error.statusCode = 502;
    throw error;
  }
  return tokenData.access_token;
}

function floorPlanDimensions() {
  const dimensions = new URLSearchParams();
  dimensions.append("dimensions[]", "520x280");
  dimensions.append("dimensions[]", "1024x1024");
  dimensions.append("dimensions[]", "2280x1800");
  return dimensions;
}

function sanitizeFloorPlans(plansData) {
  const floorPlans = Array.isArray(plansData?.floor_plans) ? plansData.floor_plans : [];
  return floorPlans.map((plan) => ({
    id: plan?.id ?? null,
    type: plan?.type ?? null,
    description: plan?.description ?? null,
    associations: plan?.associations ?? null,
    "520x280": plan?.["520x280"] ?? null,
    "1024x1024": plan?.["1024x1024"] ?? null,
    "2280x1800": plan?.["2280x1800"] ?? null,
    image_url:
      plan?.["2280x1800"] ||
      plan?.["1024x1024"] ||
      plan?.["520x280"] ||
      plan?.image_url ||
      plan?.url ||
      null
  }));
}

function mergeFloorPlans(basePlans, enrichedPlans) {
  const base = Array.isArray(basePlans) ? basePlans : [];
  const enriched = Array.isArray(enrichedPlans) ? enrichedPlans : [];
  const enrichedById = new Map(
    enriched
      .filter((plan) => plan?.id !== undefined && plan?.id !== null)
      .map((plan) => [String(plan.id), plan])
  );
  const merged = [];
  const seen = new Set();

  for (const plan of base) {
    const key = plan?.id !== undefined && plan?.id !== null ? String(plan.id) : null;
    const extra = key ? enrichedById.get(key) : null;
    merged.push(extra ? { ...plan, ...extra } : plan);
    if (key) seen.add(key);
  }

  for (const plan of enriched) {
    const key = plan?.id !== undefined && plan?.id !== null ? String(plan.id) : null;
    if (!key || !seen.has(key)) merged.push(plan);
  }

  return merged;
}

async function fetchFloorPlans(buildingId, oruloHeaders) {
  const plansResponse = await fetch(
    `https://www.orulo.com.br/api/v2/buildings/${buildingId}/floor_plans?${floorPlanDimensions().toString()}`,
    { headers: oruloHeaders }
  );
  const plansData = await plansResponse.json().catch(() => ({}));
  return { response: plansResponse, data: plansData, plans: sanitizeFloorPlans(plansData) };
}

async function backfillBuildingFloorPlans({ buildingId, oruloHeaders }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { status: 500, body: { ok: false, error: "Credenciais Supabase não configuradas" } };
  }

  const result = await fetchFloorPlans(buildingId, oruloHeaders);
  if (result.response.status === 404) {
    return {
      status: 200,
      body: { ok: true, mode: "floor_plans_backfill", building_id: buildingId, skipped: "orulo_404", rows_changed: 0 }
    };
  }
  if (!result.response.ok) {
    return {
      status: 502,
      body: {
        ok: false,
        error: "Falha ao consultar plantas na Órulo",
        status: result.response.status,
        building_id: buildingId
      }
    };
  }

  const plans = result.plans;
  if (!plans.length) {
    return {
      status: 200,
      body: { ok: true, mode: "floor_plans_backfill", building_id: buildingId, skipped: "no_plans", plans: 0, rows_changed: 0 }
    };
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };
  const listUrl = new URL("/rest/v1/properties", supabaseUrl);
  listUrl.searchParams.set("select", "external_id,raw_data");
  listUrl.searchParams.set("source", "eq.novos");
  listUrl.searchParams.set("active", "eq.true");
  listUrl.searchParams.set("state", "eq.ES");
  listUrl.searchParams.set("raw_data->>building_id", `eq.${buildingId}`);

  const listResponse = await fetch(listUrl, { headers });
  const rows = await listResponse.json().catch(() => []);
  if (!listResponse.ok || !Array.isArray(rows)) {
    return { status: 502, body: { ok: false, error: "Falha ao listar linhas do Supabase", building_id: buildingId } };
  }

  let rowsChanged = 0;
  for (const row of rows) {
    const rawData = row?.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};
    const building = rawData?.building && typeof rawData.building === "object" ? rawData.building : {};
    const mergedPlans = mergeFloorPlans(building.floor_plans ?? [], plans);
    const current = JSON.stringify(building.floor_plans ?? []);
    const next = JSON.stringify(mergedPlans);
    if (current === next) continue;

    const nextRawData = {
      ...rawData,
      building: { ...building, floor_plans: mergedPlans }
    };
    const patchUrl = new URL("/rest/v1/properties", supabaseUrl);
    patchUrl.searchParams.set("external_id", `eq.${row.external_id}`);
    const patchResponse = await fetch(patchUrl, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ raw_data: nextRawData, updated_at: new Date().toISOString() })
    });
    if (!patchResponse.ok) {
      return {
        status: 502,
        body: { ok: false, error: "Falha ao atualizar linha no Supabase", building_id: buildingId, external_id: row.external_id }
      };
    }
    rowsChanged += 1;
  }

  return {
    status: 200,
    body: {
      ok: true,
      mode: "floor_plans_backfill",
      building_id: buildingId,
      plans: plans.length,
      with_image: plans.filter((plan) => plan.image_url).length,
      rows_found: rows.length,
      rows_changed: rowsChanged
    }
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const floorPlansBackfillBuildingId = String(req.query?.floor_plans_backfill_building_id || "").trim();
    const floorPlansBuildingId = String(req.query?.floor_plans_building_id || "").trim();

    if (floorPlansBackfillBuildingId) {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      if (!isAuthorized(req)) {
        return res.status(404).json({ ok: false, error: "Not found" });
      }
      if (!/^\d+$/.test(floorPlansBackfillBuildingId)) {
        return res.status(400).json({ ok: false, error: "floor_plans_backfill_building_id inválido" });
      }
      if (String(req.query?.confirm || "") !== "es-floorplans-v1") {
        return res.status(400).json({ ok: false, error: "Confirmação de backfill ausente" });
      }

      const clientId = process.env.ORULO_CLIENT_ID;
      const clientSecret = process.env.ORULO_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(500).json({ ok: false, error: "Credenciais da Órulo não configuradas" });
      }
      const accessToken = await getOruloAccessToken(clientId, clientSecret);
      const result = await backfillBuildingFloorPlans({
        buildingId: floorPlansBackfillBuildingId,
        oruloHeaders: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
      return res.status(result.status).json(result.body);
    }

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const clientId = process.env.ORULO_CLIENT_ID;
    const clientSecret = process.env.ORULO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ ok: false, error: "Credenciais da Órulo não configuradas" });
    }

    const accessToken = await getOruloAccessToken(clientId, clientSecret);
    const oruloHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };

    if (floorPlansBuildingId) {
      if (!isAuthorized(req)) {
        return res.status(404).json({ ok: false, error: "Not found" });
      }

      if (!/^\d+$/.test(floorPlansBuildingId)) {
        return res.status(400).json({ ok: false, error: "floor_plans_building_id inválido" });
      }

      const result = await fetchFloorPlans(floorPlansBuildingId, oruloHeaders);
      if (!result.response.ok) {
        return res.status(502).json({
          ok: false,
          error: "Falha ao consultar plantas na Órulo",
          status: result.response.status
        });
      }

      const sanitized = result.plans;
      return res.status(200).json({
        ok: true,
        mode: "floor_plans_diagnostic",
        building_id: floorPlansBuildingId,
        count: sanitized.length,
        with_image: sanitized.filter((plan) => plan.image_url).length,
        floor_plans: sanitized
      });
    }

    const params = new URLSearchParams({
      state: "SP",
      city: "São Paulo",
      results_per_page: "50",
      page: "1"
    });

    const buildingsResponse = await fetch(
      `https://www.orulo.com.br/api/v2/buildings?${params.toString()}`,
      { headers: oruloHeaders }
    );

    const buildingsData = await buildingsResponse.json();

    if (!buildingsResponse.ok) {
      return res.status(502).json({ ok: false, error: "Falha ao consultar empreendimentos na Órulo" });
    }

    const buildings = Array.isArray(buildingsData.buildings) ? buildingsData.buildings : [];
    const properties = [];

    for (const building of buildings) {
      try {
        const typologiesResponse = await fetch(
          `https://www.orulo.com.br/api/v2/buildings/${building.id}/typologies`,
          { headers: oruloHeaders }
        );

        if (!typologiesResponse.ok) continue;

        const typologiesData = await typologiesResponse.json();
        const typologies = Array.isArray(typologiesData.typologies) ? typologiesData.typologies : [];

        for (const typology of typologies) {
          if (
            typology.stock !== undefined &&
            typology.stock !== null &&
            Number(typology.stock) <= 0
          ) continue;

          const price = typology.discount_price ?? typology.original_price ?? building.min_price ?? null;
          const image =
            building.default_image?.["1024x1024"] ||
            building.default_image?.["520x280"] ||
            building.default_image?.["2280x1800"] ||
            building.default_image?.["200x140"] ||
            null;

          properties.push({
            id: `orulo:${building.id}:${typology.id}`,
            source: "novos",
            building_id: String(building.id),
            typology_id: String(typology.id),
            name: building.name || "Empreendimento",
            type: typology.type || null,
            finality: building.finality || null,
            value: price !== null ? Number(price) : null,
            private_area: typology.private_area !== undefined ? Number(typology.private_area) : null,
            bedrooms: typology.bedrooms !== undefined ? Number(typology.bedrooms) : null,
            bathrooms: typology.bathrooms !== undefined ? Number(typology.bathrooms) : null,
            suites: typology.suites !== undefined ? Number(typology.suites) : null,
            parking: typology.parking !== undefined ? Number(typology.parking) : null,
            stock: typology.stock !== undefined ? Number(typology.stock) : null,
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
            status: building.status || null,
            stage: building.stage || null,
            developer: building.developer?.name || null,
            image,
            reference: typology.reference || null,
            floor_reference: typology.floor_reference ?? null,
            section_reference: typology.section_reference || null,
            updated_at: typology.updated_at || building.updated_at || null
          });
        }
      } catch {
        continue;
      }
    }

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
    return res.status(error?.statusCode || 500).json({ ok: false, error: error?.message || "Erro interno ao processar catálogo Órulo" });
  }
}
