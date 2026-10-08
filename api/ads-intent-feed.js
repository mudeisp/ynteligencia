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
    items
  });
}
