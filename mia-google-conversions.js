import { authorizedMiaRead, readBody, rest, supabaseConfigured } from "./ads-store.js";

const TARGET_CONVERSION_NAME = "LEADS QUALIFICADOS - Todos os registros de LEADS QUALIFICADOS";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

function eventIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null;
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const id = item.trim();
    if (!id || id.length > 200 || /[\u0000-\u001f]/.test(id)) return null;
    if (!seen.has(id)) ids.push(id);
    seen.add(id);
  }
  return ids.length ? ids : null;
}

function rows(result) {
  return result && result.ok && Array.isArray(result.data) ? result.data : null;
}

/**
 * Server-to-server bridge owned by YNTELIGENCIA.
 * M.I.A. receives only claimed offline conversion candidates; no contacts or CRM data.
 */
export async function handleMiaGoogleConversions(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return reply(res, 405, { success: false, error: "Method not allowed" });
  }
  if (!process.env.MIA_READ_TOKEN) {
    return reply(res, 503, { success: false, error: "MIA_READ_TOKEN não configurado" });
  }
  if (!authorizedMiaRead(req)) {
    return reply(res, 401, { success: false, error: "Não autorizado" });
  }
  if (!supabaseConfigured()) {
    return reply(res, 503, { success: false, error: "Supabase não configurado" });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = readBody(req);
    } catch {
      return reply(res, 400, { success: false, error: "Corpo inválido" });
    }
    const confirm = Object.prototype.hasOwnProperty.call(body, "confirm_event_ids");
    const fail = Object.prototype.hasOwnProperty.call(body, "fail_event_ids");
    if (confirm === fail) {
      return reply(res, 400, { success: false, error: "Informe confirm_event_ids ou fail_event_ids" });
    }
    const ids = eventIds(confirm ? body.confirm_event_ids : body.fail_event_ids);
    if (!ids) return reply(res, 400, { success: false, error: "event_ids inválido" });

    const result = await rest(confirm ? "rpc/confirm_google_lead_conversions" : "rpc/fail_google_lead_conversions", {
      method: "POST",
      prefer: "return=representation",
      body: confirm ? { p_event_ids: ids } : { p_event_ids: ids, p_error: "google_rejected" }
    });
    const updated = rows(result);
    if (!updated) return reply(res, 502, { success: false, error: "Não foi possível atualizar o ledger" });
    return reply(res, 200, {
      success: true,
      status: confirm ? "confirmed" : "failed",
      count: updated.length,
      event_ids: updated.map(row => row.event_id)
    });
  }

  const claimed = await rest("rpc/claim_google_lead_conversions", {
    method: "POST",
    prefer: "return=representation",
    body: { p_limit: 500 }
  });
  const claimedRows = rows(claimed);
  if (!claimedRows) {
    return reply(res, 502, { success: false, error: "Não foi possível reservar as conversões" });
  }

  return reply(res, 200, {
    success: true,
    schema: "mia-google-conversions/1",
    conversion_name: TARGET_CONVERSION_NAME,
    conversion_value: 10,
    currency_code: "BRL",
    count: claimedRows.length,
    rows: claimedRows.map(row => ({
      event_id: row.event_id,
      event_time: row.event_time,
      gclid: row.gclid || "",
      gbraid: row.gbraid || "",
      wbraid: row.wbraid || ""
    }))
  });
}
