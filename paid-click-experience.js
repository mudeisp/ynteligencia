"use strict";

/*
  Paid Click Experience V1.
  Continues the intent delivered by paid traffic, asks for push only after
  value is perceived, and never treats a cache flag as push authority.
  No score, no ad write, no MATCH change.
*/

const PAID_CLICK_EXPERIENCE_VERSION = "paid-click-experience/1";
const PII_KEYS = new Set([
  "name", "email", "phone", "message", "document", "address",
  "nome", "telefone", "mensagem", "documento", "endereco"
]);
const TEXT_EVENT_KEYS = new Set([
  "event_name", "neighborhood", "region", "type", "search", "development", "origin"
]);
const NUMBER_EVENT_KEYS = new Set(["bedrooms", "min_price", "max_price", "new_option_count"]);

function cleanAdParam(value) {
  return String(value || "").replace(/[-_]+/g, " ").trim();
}

function formatPlaceName(value) {
  const lowercaseWords = new Set(["da", "das", "de", "do", "dos", "e"]);
  return cleanAdParam(value)
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => index > 0 && lowercaseWords.has(word)
      ? word
      : word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1))
    .join(" ");
}

function firstParam(params, names) {
  for (const name of names) {
    const value = params[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function readSearchParams(search) {
  const raw = typeof search === "string"
    ? Object.fromEntries(new URLSearchParams(search.startsWith("?") ? search.slice(1) : search))
    : (search || {});
  const mode = String(firstParam(raw, ["modo"]) || "").toLowerCase();
  const neighborhood = formatPlaceName(firstParam(raw, ["bairro", "neighborhood"]));
  const region = formatPlaceName(firstParam(raw, ["regiao", "region"]));
  const bedrooms = whole(firstParam(raw, ["dormitorios", "bedrooms"]));
  const minPrice = whole(firstParam(raw, ["valor_min", "min_price"]));
  const maxPrice = whole(firstParam(raw, ["valor_max", "max_price"]));
  const type = formatPlaceName(firstParam(raw, ["tipo", "type"]));
  const searchText = cleanAdParam(firstParam(raw, ["busca", "search"]));
  const development = formatPlaceName(firstParam(raw, ["empreendimento", "development"]));
  const directToResults = mode !== "explorar" && Boolean(
    neighborhood || region || bedrooms || minPrice || maxPrice || type || searchText || development
  );
  return {
    mode, neighborhood, region, bedrooms, minPrice, maxPrice, type,
    search: searchText, development, directToResults, asksAgain: false
  };
}

function compactMoney(value) {
  const amount = whole(value);
  if (!amount) return "";
  if (amount >= 1000000) {
    const millions = amount / 1000000;
    const text = Number.isInteger(millions)
      ? String(millions)
      : String(Math.round(millions * 10) / 10).replace(".", ",");
    return `R$${text} ${millions > 1 ? "milhões" : "milhão"}`;
  }
  if (amount >= 1000) return `R$${Math.round(amount / 1000)} mil`;
  return `R$${Math.round(amount)}`;
}

function placeTitle(intent) {
  const type = String(intent?.type || "").toLocaleLowerCase("pt-BR");
  let noun = "Apartamentos";
  if (type.startsWith("casa")) noun = "Casas";
  else if (type && !type.startsWith("apartamento")) noun = intent.type;
  if (intent?.neighborhood) return `${noun} em ${intent.neighborhood}`;
  if (intent?.region) return `${noun} em ${intent.region}`;
  if (intent?.development) return intent.development;
  if (intent?.search) return intent.search;
  if (intent?.type) return intent.type;
  return "Imóveis da sua busca";
}

function contextCopy(intent) {
  const source = intent || {};
  const parts = [];
  if (source.bedrooms) parts.push(source.bedrooms === 1 ? "1 dormitório" : `${source.bedrooms} dormitórios`);
  const minText = compactMoney(source.minPrice);
  const maxText = compactMoney(source.maxPrice);
  if (minText && maxText) parts.push(`de ${minText} a ${maxText}`);
  else if (maxText) parts.push(`até ${maxText}`);
  else if (minText) parts.push(`a partir de ${minText}`);
  return { title: placeTitle(source), subtitle: parts.join(" · ") };
}

function comparableText(value) {
  return cleanAdParam(value).toLocaleLowerCase("pt-BR");
}

function sameSearch(left, right) {
  if (!left || !right) return false;
  const textKeys = ["neighborhood", "region", "type", "search", "development"];
  const numberKeys = ["bedrooms", "minPrice", "maxPrice"];
  return textKeys.every(key => comparableText(left[key]) === comparableText(right[key]))
    && numberKeys.every(key => Number(left[key] || 0) === Number(right[key] || 0));
}

function subscriptionAuthority(input) {
  const source = input || {};
  if (source.sdkReady !== true) return "unknown";
  const optedIn = source.optedIn === true;
  const subscriptionId = String(source.subscriptionId || "").trim();
  return optedIn && subscriptionId ? "subscribed" : "not_subscribed";
}

function paidPushDecision(result) {
  if (!result || typeof result !== "object") return "subscription_unresolved";
  if (result.permission === "denied" || result.reason === "permission_denied") return "permission_denied";
  if (
    result.success === true &&
    result.permission === "granted" &&
    result.optedIn === true &&
    String(result.subscriptionId || "").trim() &&
    result.alertConfigured === true
  ) return "subscribed";
  return "subscription_unresolved";
}

function createExperience(input) {
  const source = input || {};
  let authority = source.subscriptionAuthority;
  if (!authority) authority = source.subscribed === true ? "subscribed" : "not_subscribed";
  const subscribed = authority === "subscribed";
  const authorityPending = authority === "unknown";
  const permissionDenied = source.permissionDenied === true;
  const dismissed = Boolean(source.sessionId) && source.dismissedSessionId === source.sessionId;
  const returning = sameSearch(source.remembered, source.intent);
  let phase = "A";
  if (subscribed) phase = "H";
  else if (permissionDenied) phase = "G";
  else if (dismissed) phase = "F";
  else if (returning) phase = "I";
  const newOptionCount = Number.isInteger(source.newOptionCount) && source.newOptionCount >= 0
    ? source.newOptionCount
    : null;
  return {
    phase,
    resultsShown: false,
    seenIds: [],
    propertiesSeen: 0,
    detailOpened: false,
    returnedToResults: false,
    refined: false,
    promptVisible: false,
    permissionPending: false,
    authorityPending,
    subscriptionAuthority: authority,
    subscriptionUnresolved: false,
    subscribed,
    permissionDenied,
    dismissed,
    justSubscribed: false,
    returning,
    newOptionCount,
    promptEligible: false,
    score: null,
    classification: null
  };
}

function valuePerceived(state) {
  if (!state.resultsShown) return false;
  return state.propertiesSeen >= 2;
}

function canPrompt(state) {
  return valuePerceived(state)
    && !state.subscribed
    && !state.permissionDenied
    && !state.dismissed
    && !state.promptVisible
    && !state.permissionPending
    && !state.authorityPending
    && !state.subscriptionUnresolved
    && (state.phase === "A" || state.phase === "I" || state.phase === "B");
}

function withPhase(state) {
  let phase = state.phase;
  if (state.subscribed) phase = state.justSubscribed ? "E" : "H";
  else if (state.permissionDenied) phase = "G";
  else if (state.dismissed) phase = "F";
  else if (state.subscriptionUnresolved) phase = "J";
  else if (state.permissionPending) phase = "D";
  else if (state.promptVisible) phase = "C";
  else if (valuePerceived(state)) phase = "B";
  else if (state.returning) phase = "I";
  else phase = "A";
  return {
    ...state,
    phase,
    promptEligible: canPrompt({ ...state, phase }),
    score: null,
    classification: null
  };
}

function reducePaidExperience(state, action) {
  const next = { ...state, seenIds: Array.isArray(state.seenIds) ? state.seenIds.slice() : [] };
  const type = action && action.type;
  if (type === "results_shown") next.resultsShown = true;
  if (type === "detail_opened") {
    next.detailOpened = true;
    const id = String(action.propertyId || "");
    if (id && !next.seenIds.includes(id)) next.seenIds.push(id);
    next.propertiesSeen = next.seenIds.length;
  }
  if (type === "returned_to_results") next.returnedToResults = true;
  if (type === "refined") next.refined = true;
  if (type === "prompt_shown") next.promptVisible = true;
  if (type === "accept") {
    next.permissionPending = true;
    next.subscriptionUnresolved = false;
    next.promptVisible = false;
  }
  if (type === "subscribed") {
    next.subscribed = true;
    next.justSubscribed = true;
    next.subscriptionAuthority = "subscribed";
    next.authorityPending = false;
    next.subscriptionUnresolved = false;
    next.permissionPending = false;
    next.promptVisible = false;
  }
  if (type === "dismiss") {
    next.dismissed = true;
    next.promptVisible = false;
    next.permissionPending = false;
  }
  if (type === "permission_denied") {
    next.permissionDenied = true;
    next.permissionPending = false;
    next.subscriptionUnresolved = false;
    next.promptVisible = false;
  }
  if (type === "subscription_unresolved") {
    next.subscriptionUnresolved = true;
    next.permissionPending = false;
    next.promptVisible = false;
  }
  if (type === "subscription_reconciled") {
    const authority = action.authority || "unknown";
    next.subscriptionAuthority = authority;
    next.authorityPending = authority === "unknown";
    next.subscribed = authority === "subscribed";
    next.justSubscribed = false;
    if (authority === "subscribed") {
      next.permissionDenied = false;
      next.subscriptionUnresolved = false;
      next.permissionPending = false;
      next.promptVisible = false;
    }
  }
  return withPhase(next);
}

function evaluatePushPrompt(state, options) {
  const detailOpen = options?.detailOpen === true;
  return {
    visible: Boolean(state?.promptVisible) && !detailOpen,
    eligible: Boolean(state?.promptEligible) && !detailOpen
  };
}

function promptCopy() {
  return {
    headline: "Quer que eu te avise quando aparecer uma nova opção dentro desta busca?",
    primary: "SIM, QUERO SER AVISADO",
    secondary: "Agora não"
  };
}

function acceptanceCopy() {
  return "Pronto. Vou te avisar quando aparecer uma nova opção compatível com esta busca.";
}
function subscribedNote() { return "Alertas desta busca ativos"; }
function deniedNote() { return "Avisos desativados neste navegador."; }
function unresolvedNote() { return "Ainda não consegui confirmar o alerta. Você pode continuar navegando."; }

function memoryLine(state) {
  if (!state || !state.returning) return "";
  if (state.newOptionCount === null || state.newOptionCount === undefined) return "Continue de onde parou";
  if (state.newOptionCount === 1) return "Continue de onde parou · 1 opção nova";
  return `Continue de onde parou · ${state.newOptionCount} opções novas`;
}

function safeText(value) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (!text || text.length > 120) return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(text)) return undefined;
  if (/\b(?:https?:\/\/|www\.)/i.test(text)) return undefined;
  const digits = text.replace(/\D/g, "");
  if (/^[+\d\s().-]+$/.test(text) && digits.length >= 8) return undefined;
  return text;
}

function safeNumber(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  if (key === "bedrooms") return Number.isInteger(number) && number <= 20 ? number : undefined;
  if (key === "new_option_count") return Number.isInteger(number) && number <= 100000 ? number : undefined;
  return number <= 10000000000 ? number : undefined;
}

function sanitizeEvent(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const clean = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const key = String(rawKey).toLowerCase();
    if (PII_KEYS.has(key)) continue;
    if (TEXT_EVENT_KEYS.has(key)) {
      const sanitized = safeText(value);
      if (sanitized !== undefined) clean[rawKey] = sanitized;
      continue;
    }
    if (NUMBER_EVENT_KEYS.has(key)) {
      const sanitized = safeNumber(key, value);
      if (sanitized !== undefined) clean[rawKey] = sanitized;
    }
  }
  return clean;
}

const api = {
  PAID_CLICK_EXPERIENCE_VERSION,
  cleanAdParam,
  formatPlaceName,
  readSearchParams,
  contextCopy,
  sameSearch,
  subscriptionAuthority,
  paidPushDecision,
  createExperience,
  reducePaidExperience,
  evaluatePushPrompt,
  promptCopy,
  acceptanceCopy,
  subscribedNote,
  deniedNote,
  unresolvedNote,
  memoryLine,
  sanitizeEvent
};

if (typeof module === "object" && module.exports) module.exports = api;
const root = typeof globalThis !== "undefined" ? globalThis : window;
root.PaidClickExperience = api;
