import {
  ads,
  applyCors,
  authorizedExport,
  authorizedMiaRead,
  deploymentOrigins,
  readBody,
  rest,
  supabaseConfigured
} from "./ads-store.js";
import {
  eventsPath,
  parseMiaReadQuery,
  profilesPath,
  projectMiaRead,
  scoresPath,
  sliceEventPage,
  uniqueVisitorIds,
  visitorsPath
} from "./mia-read.js";

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
  if (!ads.agentHandoffEnabled()) {
    return res.status(409).json({ success: false, error: "handoff_disabled" });
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

function requireExportAuth(req, res) {
  res.setHeader("Cache-Control", "no-store");
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

function requireExport(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return false;
  }
  return requireExportAuth(req, res);
}

const EXPORT_ERROR_CODES = new Set([
  "download_failed",
  "google_rejected",
  "timeout",
  "manual_retry",
  "unknown"
]);

function exportErrorCode(value) {
  const code = String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().toLowerCase();
  return EXPORT_ERROR_CODES.has(code) ? code : "unknown";
}

function conversionEventIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null;
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const id = item.trim();
    if (!id || id.length > 200 || /[\u0000-\u001f]/.test(id)) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length ? ids : null;
}

export async function handleAdsSheet(req, res) {
  if (!requireExport(req, res)) return;

  const rows = await rest(
    "ads_events?select=event_time,event_name,product,visitor_id,session_id,gclid,gbraid,wbraid,conversion_gclid,conversion_gbraid,conversion_wbraid,conversion_click_source,utm_source,utm_campaign,declared_neighborhood,declared_development,declared_bedrooms,declared_max_price,observed_neighborhood,observed_bedrooms,observed_price_min,observed_price_max,observed_confidence,property_id,property_name,property_price,property_inventory_source&order=event_time.asc&limit=5000",
    { method: "GET" }
  );
  if (!rows.ok) {
    return res.status(502).json({ success: false, error: "Não foi possível exportar os eventos" });
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(200);
  return res.end(ads.sheetCsv(rows.data || []));
}

function rpcRows(result) {
  return Array.isArray(result.data) ? result.data : [];
}

export async function handleAdsGoogleConversions(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }
  if (!requireExportAuth(req, res)) return;

  if (req.method === "POST") {
    let body;
    try {
      body = readBody(req);
    } catch {
      return res.status(400).json({ success: false, error: "Corpo inválido" });
    }
    const wantsConfirm = Object.prototype.hasOwnProperty.call(body, "confirm_event_ids");
    const wantsFail = Object.prototype.hasOwnProperty.call(body, "fail_event_ids");
    if (wantsConfirm === wantsFail) {
      return res.status(400).json({
        success: false,
        error: "Informe confirm_event_ids ou fail_event_ids"
      });
    }
    const ids = conversionEventIds(wantsConfirm ? body.confirm_event_ids : body.fail_event_ids);
    if (!ids) {
      return res.status(400).json({
        success: false,
        error: wantsConfirm ? "confirm_event_ids inválido" : "fail_event_ids inválido"
      });
    }

    if (wantsConfirm) {
      const confirmed = await rest("rpc/confirm_google_lead_conversions", {
        method: "POST",
        prefer: "return=representation",
        body: { p_event_ids: ids }
      });
      if (!confirmed.ok) {
        return res.status(502).json({ success: false, error: "Não foi possível confirmar a exportação" });
      }
      const rows = rpcRows(confirmed);
      return res.status(200).json({
        success: true,
        confirmed: rows.length,
        event_ids: rows.map(row => row.event_id)
      });
    }

    const failed = await rest("rpc/fail_google_lead_conversions", {
      method: "POST",
      prefer: "return=representation",
      body: {
        p_event_ids: ids,
        p_error: exportErrorCode(body.error)
      }
    });
    if (!failed.ok) {
      return res.status(502).json({ success: false, error: "Não foi possível registrar a falha da exportação" });
    }
    const rows = rpcRows(failed);
    return res.status(200).json({
      success: true,
      failed: rows.length,
      event_ids: rows.map(row => row.event_id)
    });
  }

  const claimed = await rest("rpc/claim_google_lead_conversions", {
    method: "POST",
    prefer: "return=representation",
    body: { p_limit: 500 }
  });
  if (!claimed.ok) {
    return res.status(502).json({ success: false, error: "Não foi possível reservar as conversões" });
  }

  const rows = rpcRows(claimed).map(row => ({
    ...row,
    event_name: "lead_created"
  }));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(200);
  return res.end(ads.googleAdsConversionsCsv(rows));
}

function miaReply(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

function miaQuery(req) {
  const query = {};
  if (req.query && typeof req.query === "object") {
    Object.assign(query, req.query);
  }
  if (!req.url) return query;
  try {
    const url = new URL(req.url, "https://app.yincorp.com.br");
    for (const [key, value] of url.searchParams.entries()) {
      if (query[key] === undefined) query[key] = value;
    }
  } catch (error) {
    return null;
  }
  return query;
}

function miaRows(result) {
  if (!result || !result.ok || !Array.isArray(result.data)) return null;
  return result.data;
}

export async function handleAdsMiaRead(req, res) {
  if (req.method !== "GET") {
    return miaReply(res, 405, { success: false, error: "Method not allowed" });
  }
  if (!process.env.MIA_READ_TOKEN) {
    return miaReply(res, 503, { success: false, error: "MIA_READ_TOKEN não configurado" });
  }
  if (!authorizedMiaRead(req)) {
    return miaReply(res, 401, { success: false, error: "Não autorizado" });
  }
  if (!supabaseConfigured()) {
    return miaReply(res, 503, {
      success: false,
      error: "Supabase não configurado para a camada de anúncios"
    });
  }

  const query = miaQuery(req);
  if (!query) {
    return miaReply(res, 400, { success: false, error: "from ou to inválido" });
  }
  const parsed = parseMiaReadQuery(query, new Date());
  if (!parsed.ok) {
    return miaReply(res, 400, { success: false, error: parsed.error });
  }

  try {
    const eventsResult = miaRows(await rest(eventsPath(parsed), { method: "GET" }));
    if (!eventsResult) {
      return miaReply(res, 502, { success: false, error: "Não foi possível ler os eventos de anúncio" });
    }
    const pageSlice = sliceEventPage(eventsResult, parsed.limit);
    const visitorIds = uniqueVisitorIds(pageSlice.rows);
    let visitorRows = [];
    let profileRows = [];
    let scoreRows = [];
    if (visitorIds.length) {
      const [visitors, profiles, scores] = await Promise.all([
        rest(visitorsPath(visitorIds), { method: "GET" }),
        rest(profilesPath(visitorIds), { method: "GET" }),
        rest(scoresPath(visitorIds), { method: "GET" })
      ]);
      visitorRows = miaRows(visitors);
      profileRows = miaRows(profiles);
      scoreRows = miaRows(scores);
      if (!visitorRows || !profileRows || !scoreRows) {
        return miaReply(res, 502, { success: false, error: "Não foi possível ler os eventos de anúncio" });
      }
    }
    return miaReply(res, 200, projectMiaRead({
      visitorIds,
      events: pageSlice.rows,
      visitors: visitorRows,
      profiles: profileRows,
      scores: scoreRows,
      generatedAt: new Date().toISOString(),
      page: {
        limit: parsed.limit,
        from: parsed.from,
        to: parsed.to,
        has_more: pageSlice.hasMore,
        next_cursor: pageSlice.nextCursor
      }
    }));
  } catch (error) {
    console.error("ADS_MIA_READ_ERROR", error && error.name ? error.name : "Error");
    return miaReply(res, 502, { success: false, error: "Não foi possível ler os eventos de anúncio" });
  }
}
