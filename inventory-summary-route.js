import { authorizedMiaRead, rest, supabaseConfigured } from "./ads-store.js";
import { projectInventorySummary } from "./inventory-summary.js";

/** Uses the existing server token and rotation mechanism; never accepts a query token. */
export async function handleInventorySummary(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return reply(res, 405, "method_not_allowed"); }
  if (!process.env.MIA_READ_TOKEN) return reply(res, 503, "inventory_summary_unavailable");
  if (!authorizedMiaRead(req)) return reply(res, 401, "unauthorized");
  if (!supabaseConfigured()) return reply(res, 503, "inventory_summary_unavailable");
  try {
    // One STABLE RPC, one database snapshot, one JSON result: no row-page truncation.
    const result = await rest("rpc/mia_inventory_summary_v1", { signal: AbortSignal.timeout(15000) });
    if (!result.ok) return reply(res, 503, "inventory_summary_unavailable");
    const summary = projectInventorySummary(result.data);
    if (!summary) return reply(res, 502, "invalid_inventory_summary");
    return res.status(200).json(summary);
  } catch {
    return reply(res, 503, "inventory_summary_unavailable");
  }
}
function reply(res, status, error) { return res.status(status).json({ success: false, error }); }
