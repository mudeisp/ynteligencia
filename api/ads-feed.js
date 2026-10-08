import { ads, rest, supabaseConfigured } from "./ads-store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  if (!supabaseConfigured()) {
    return res.status(500).json({
      success: false,
      error: "Supabase não configurado para a camada de anúncios"
    });
  }

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
