import {
  ads,
  applyCors,
  authorizedExport,
  deploymentOrigins,
  readBody,
  rest,
  supabaseConfigured
} from "./ads-store.js";

function unavailable(res) {
  return res.status(500).json({
    success: false,
    error: "Supabase não configurado para a camada de anúncios"
  });
}

function handoffOrigins() {
  return [
    "https://app.yincorp.com.br",
    "https://www.yincorp.com.br",
    "https://yincorp.com.br",
    ...deploymentOrigins()
  ];
}

export async function handleCreateHandoff(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!supabaseConfigured()) return unavailable(res);

  try {
    const result = await ads.createHandoff(readBody(req), rest, new Date(), {
      allowedOrigins: handoffOrigins()
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("ADS_HANDOFF_CREATE_ERROR", error && error.name ? error.name : "Error");
    return res.status(500).json({
      success: false,
      error: "Erro interno ao criar o handoff"
    });
  }
}

export async function handleGetHandoff(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!supabaseConfigured()) return unavailable(res);

  try {
    const result = await ads.readHandoff(readBody(req), rest);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("ADS_HANDOFF_READ_ERROR", error && error.name ? error.name : "Error");
    return res.status(500).json({
      success: false,
      error: "Erro interno ao ler o handoff"
    });
  }
}

export async function handleAdsEvent(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!supabaseConfigured()) return unavailable(res);

  try {
    const result = await ads.recordAdsEvent(readBody(req), rest);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("ADS_EVENT_ERROR", error && error.name ? error.name : "Error");
    return res.status(500).json({
      success: false,
      error: "Erro interno ao registrar evento"
    });
  }
}

export async function handleAdsFeed(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!supabaseConfigured()) return unavailable(res);

  const rows = await rest(
    "properties?select=external_id,development_name,title,neighborhood,price,bedrooms,area,source,image_url,active&active=eq.true&limit=500",
    { method: "GET" }
  );
  if (!rows.ok) {
    return res.status(502).json({ success: false, error: "Não foi possível ler o inventário" });
  }

  const items = (rows.data || []).map(ads.propertyFeedItem);
  return res.status(200).json({
    success: true,
    count: items.length,
    property_url_parameter: "imovel",
    property_id_alias: "property_id",
    items
  });
}

export async function handleAdsIntentFeed(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!supabaseConfigured()) return unavailable(res);

  const events = await rest(
    "ads_events?select=declared_neighborhood,declared_development,declared_bedrooms,declared_max_price,event_name&event_name=in.(ai_search,ad_entry,property_view)&order=event_time.desc&limit=1000",
    { method: "GET" }
  );
  const inventory = await rest(
    "properties?select=neighborhood,development_name,title&active=eq.true&limit=1000",
    { method: "GET" }
  );
  if (!events.ok || !inventory.ok) {
    return res.status(502).json({ success: false, error: "Não foi possível montar o feed de intenção" });
  }

  const items = ads.intentFeedItems(events.data || [], inventory.data || []);
  return res.status(200).json({
    success: true,
    count: items.length,
    development_urls_open_in_app: false,
    development_urls_emitted: false,
    items
  });
}

function requireExport(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return false;
  }
  if (!process.env.ADS_EXPORT_TOKEN) {
    res.status(503).json({
      success: false,
      error: "ADS_EXPORT_TOKEN não configurado"
    });
    return false;
  }
  if (!authorizedExport(req)) {
    res.status(401).json({ success: false, error: "Não autorizado" });
    return false;
  }
  if (!supabaseConfigured()) {
    unavailable(res);
    return false;
  }
  return true;
}

export async function handleAdsSheet(req, res) {
  if (!requireExport(req, res)) return;

  const rows = await rest(
    "ads_events?select=event_time,event_name,product,visitor_id,session_id,gclid,gbraid,wbraid,utm_source,utm_campaign,declared_neighborhood,declared_development,declared_bedrooms,declared_max_price,observed_neighborhood,observed_bedrooms,observed_price_min,observed_price_max,observed_confidence,property_id,property_name,property_price,property_inventory_source&order=event_time.asc&limit=5000",
    { method: "GET" }
  );
  if (!rows.ok) {
    return res.status(502).json({ success: false, error: "Não foi possível exportar os eventos" });
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(200);
  return res.end(ads.sheetCsv(rows.data || []));
}

export async function handleAdsGoogleConversions(req, res) {
  if (!requireExport(req, res)) return;

  const rows = await rest(
    "ads_events?select=event_id,event_name,event_time,product,gclid,gbraid,wbraid" +
    "&event_name=in.(high_intent_buyer,lead_created)" +
    "&order=event_time.asc&limit=5000",
    { method: "GET" }
  );
  if (!rows.ok) {
    return res.status(502).json({ success: false, error: "Não foi possível exportar as conversões" });
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(200);
  return res.end(ads.googleAdsConversionsCsv(rows.data || []));
}
