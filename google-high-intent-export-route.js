import {
  ads,
  authorizedExport,
  readBody,
  rest,
  supabaseConfigured
} from "./ads-store.js";
import { googleHighIntentConversionsCsv } from "./google-high-intent-conversion.js";

const EXPORT_ERROR_CODES = new Set([
  "download_failed",
  "google_rejected",
  "timeout",
  "manual_retry",
  "unknown"
]);

function requireExportAuth(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.ADS_EXPORT_TOKEN) {
    res.status(503).json({ success: false, error: "ADS_EXPORT_TOKEN não configurado" });
    return false;
  }
  if (!authorizedExport(req)) {
    res.status(401).json({ success: false, error: "Não autorizado" });
    return false;
  }
  if (!supabaseConfigured()) {
    res.status(500).json({ success: false, error: "Supabase não configurado para a camada de anúncios" });
    return false;
  }
  return true;
}

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

function rpcRows(result) {
  return Array.isArray(result && result.data) ? result.data : [];
}

/**
 * Separate from Lead Created by design. GET claims High Intent Buyer rows and
 * returns the Google offline-conversion CSV. POST confirms or fails only this
 * conversion name's ledger rows. No public event/member endpoint is exposed.
 */
export async function handleAdsGoogleHighIntentConversions(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
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

    const rpc = wantsConfirm
      ? "rpc/confirm_google_high_intent_conversions"
      : "rpc/fail_google_high_intent_conversions";
    const result = await rest(rpc, {
      method: "POST",
      prefer: "return=representation",
      body: wantsConfirm
        ? { p_event_ids: ids }
        : { p_event_ids: ids, p_error: exportErrorCode(body.error) }
    });
    if (!result.ok) {
      return res.status(502).json({
        success: false,
        error: wantsConfirm
          ? "Não foi possível confirmar a exportação"
          : "Não foi possível registrar a falha da exportação"
      });
    }
    const rows = rpcRows(result);
    return res.status(200).json({
      success: true,
      [wantsConfirm ? "confirmed" : "failed"]: rows.length,
      event_ids: rows.map(row => row.event_id)
    });
  }

  const claimed = await rest("rpc/claim_google_high_intent_conversions", {
    method: "POST",
    prefer: "return=representation",
    body: { p_limit: 500 }
  });
  if (!claimed.ok) {
    return res.status(502).json({ success: false, error: "Não foi possível reservar as conversões" });
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.status(200);
  return res.end(googleHighIntentConversionsCsv(rpcRows(claimed), ads));
}
