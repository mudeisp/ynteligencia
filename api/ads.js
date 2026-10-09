import {
  handleAdsEvent,
  handleAdsFeed,
  handleAdsGoogleConversions,
  handleAdsIntentFeed,
  handleAdsSheet
} from "../ads-routes.js";

const actions = {
  event: handleAdsEvent,
  feed: handleAdsFeed,
  "intent-feed": handleAdsIntentFeed,
  sheet: handleAdsSheet,
  "google-conversions": handleAdsGoogleConversions
};

function requestAction(req) {
  const queryAction = req.query && req.query.action;
  if (queryAction) return String(queryAction);
  try {
    const url = new URL(req.url || "/", "https://app.yincorp.com.br");
    return url.searchParams.get("action") || "";
  } catch (error) {
    return "";
  }
}

export default async function handler(req, res) {
  const action = actions[requestAction(req)];
  if (!action) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ success: false, error: "Ação de anúncio inválida" });
  }
  return action(req, res);
}
