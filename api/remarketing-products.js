import { authorizedMiaRead, rest, supabaseConfigured } from "../ads-store.js";
import { projectRemarketingProducts } from "../remarketing-products.js";

const MAX_ROWS = 5000;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "method_not_allowed" });
  }
  if (!process.env.MIA_READ_TOKEN) return res.status(503).json({ success: false, error: "remarketing_products_unavailable" });
  if (!authorizedMiaRead(req)) return res.status(401).json({ success: false, error: "unauthorized" });
  if (!supabaseConfigured()) return res.status(503).json({ success: false, error: "remarketing_products_unavailable" });

  try {
    const params = new URLSearchParams({
      select: "id,development_name,title,neighborhood,city,state,source,price,bedrooms,area,active",
      active: "eq.true",
      state: "eq.SP",
      city: "ilike.São Paulo",
      order: "id.asc",
      limit: String(MAX_ROWS),
    });
    const result = await rest(`properties?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
    if (!result.ok || !Array.isArray(result.data)) return res.status(503).json({ success: false, error: "remarketing_products_unavailable" });
    if (result.data.length >= MAX_ROWS) return res.status(503).json({ success: false, error: "remarketing_products_incomplete" });
    const projected = projectRemarketingProducts(result.data);
    if (!projected) return res.status(502).json({ success: false, error: "invalid_remarketing_products" });
    return res.status(200).json(projected);
  } catch {
    return res.status(503).json({ success: false, error: "remarketing_products_unavailable" });
  }
}
