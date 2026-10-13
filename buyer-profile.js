/*
  Cliente da projeção Buyer Profile.

  A regra de merge, contagem, estágio e sanitização vive em
  public.apply_buyer_profile_event. Este arquivo só traduz o evento
  já persistido e chama a RPC. Online e backfill usam o mesmo payload.

  Cidade, estado, região, tipo e finalidade só entram se estiverem em
  metadata.canonical_preference, gravado no ads_events. O objeto em
  memória do pedido não é uma segunda fonte.

  800 ms é o teto de todas as projeções do mesmo evento. Quem grava o
  anúncio cria um único prazo e reparte o que ainda falta. Acima desse
  prazo o fato em ads_events já está gravado; a projeção se recupera
  pelo ledger no backfill, sem segurar o cliente.
*/

const PROFILE_EVENTS = new Set([
  "ad_entry",
  "ai_search",
  "property_view",
  "property_view_multiple",
  "agent_handoff_created",
  "agent_opened",
  "lead_created"
]);
const BUYER_PROFILE_TIMEOUT_MS = 800;

const LEAD_KEY = /"(?:lead_summary|transcript|whatsapp|messages|conversation|contact|phone|email|message|name)"|(?:^|[^a-z0-9_])(?:lead_summary|transcript|whatsapp|messages|conversation|contact|phone|email|message|name)\s*:|\\?"(?:lead_summary|transcript|whatsapp|messages|conversation|contact|phone|email|message|name)\\?"\s*:/i;

function text(value, max = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function trackingText(value, max = 200) {
  const raw = String(value ?? "");
  if (/[\r\n]/.test(raw)) return "";
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed === "0" || /^(?:false|null|undefined)$/i.test(trimmed)) return "";
  if (trimmed.length > max || trimmed[0] === "{" || trimmed[0] === "[") return "";
  if (LEAD_KEY.test(trimmed)) return "";
  return trimmed;
}

function toApplyPayload(input) {
  const source = input && typeof input === "object" ? input : {};
  const fromRow = source.declared_neighborhood !== undefined || source.property_name !== undefined;
  const intent = fromRow ? {
    neighborhood: source.declared_neighborhood,
    development: source.declared_development,
    bedrooms: source.declared_bedrooms,
    min_price: source.declared_min_price,
    max_price: source.declared_max_price,
    inventory_source: source.declared_inventory_source
  } : (source.intent || {});
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const storedPreference = metadata.canonical_preference && typeof metadata.canonical_preference === "object"
    ? metadata.canonical_preference
    : {};
  const preference = fromRow
    ? storedPreference
    : (source.preference && typeof source.preference === "object" ? source.preference : intent);
  const property = fromRow ? {
    property_id: source.property_id,
    name: source.property_name,
    neighborhood: source.property_neighborhood
  } : (source.property || {});
  return {
    event_id: text(source.event_id, 80),
    event_name: text(source.event_name, 40),
    event_time: text(source.event_time, 40),
    visitor_id: text(source.visitor_id, 80),
    session_id: text(source.session_id, 120),
    product: text(source.product, 40),
    gclid: trackingText(source.gclid, 200),
    gbraid: trackingText(source.gbraid, 200),
    wbraid: trackingText(source.wbraid, 200),
    utm_source: trackingText(source.utm_source, 120),
    utm_medium: trackingText(source.utm_medium, 120),
    utm_campaign: trackingText(source.utm_campaign, 120),
    utm_term: trackingText(source.utm_term, 120),
    utm_content: trackingText(source.utm_content, 120),
    neighborhood: text(intent.neighborhood, 80),
    development: text(intent.development, 120),
    bedrooms: intent.bedrooms ?? 0,
    min_price: intent.min_price ?? 0,
    max_price: intent.max_price ?? 0,
    inventory_source: text(intent.inventory_source, 20),
    city: text(preference.city, 80),
    state: text(preference.state, 40),
    region: text(preference.region, 80),
    property_type: text(preference.property_type || preference.propertyType, 80),
    purpose: text(preference.purpose || preference.intention || preference.finality, 80),
    property_id: text(property.property_id, 120),
    property_name: text(property.name, 180),
    property_neighborhood: text(property.neighborhood, 80)
  };
}

async function updateBuyerProfileFromEvent(event, rest, options = {}) {
  if (typeof rest !== "function") {
    return { ok: false, error: "buyer_profile_storage_unavailable" };
  }
  const result = await rest("rpc/apply_buyer_profile_event", {
    method: "POST",
    body: { p_event: toApplyPayload(event) },
    signal: options.signal
  });
  if (!result || result.ok === false) {
    return { ok: false, status: result && result.status || 0 };
  }
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (data.status === "rejected") {
    return { ok: false, error: data.error || "rejected" };
  }
  return { ok: true, status: data.status || "applied", profile: data.profile || null };
}

async function getBuyerProfile(visitorId, rest) {
  if (typeof rest !== "function") {
    return { ok: false, error: "buyer_profile_storage_unavailable", profile: null };
  }
  const result = await rest("rpc/get_buyer_profile", {
    method: "POST",
    body: { p_visitor_id: text(visitorId, 80) }
  });
  if (!result || result.ok === false) {
    return { ok: false, status: result && result.status || 0, profile: null };
  }
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (data.status === "rejected") {
    return { ok: false, error: data.error || "rejected", profile: null };
  }
  return { ok: true, profile: data.profile || null };
}

module.exports = {
  PROFILE_EVENTS,
  BUYER_PROFILE_TIMEOUT_MS,
  toApplyPayload,
  updateBuyerProfileFromEvent,
  getBuyerProfile
};
