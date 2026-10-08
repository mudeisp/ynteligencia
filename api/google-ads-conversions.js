import crypto from "node:crypto";
import { ads, rest, supabaseConfigured } from "./ads-store.js";

function authorized(req) {
  const expected = process.env.ADS_EXPORT_TOKEN || "";
  const header = String(req.headers.authorization || "");
  const provided = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!expected || !provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!process.env.ADS_EXPORT_TOKEN) {
    return res.status(503).json({
      success: false,
      error: "ADS_EXPORT_TOKEN não configurado"
    });
  }
  if (!authorized(req)) {
    return res.status(401).json({ success: false, error: "Não autorizado" });
  }
  if (!supabaseConfigured()) {
    return res.status(500).json({
      success: false,
      error: "Supabase não configurado para a camada de anúncios"
    });
  }

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
