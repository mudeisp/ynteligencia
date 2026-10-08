import { ads, applyCors, readBody, rest, supabaseConfigured } from "./ads-store.js";

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!supabaseConfigured()) {
    return res.status(500).json({
      success: false,
      error: "Supabase não configurado para a camada de anúncios"
    });
  }

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
