/* Read-only producer of the exact M.I.A inventory contract. No raw catalog leaves this boundary. */
import catalog from "./ai-neighborhood-catalog.js";

export const PRICE_CAPS = Object.freeze({ UP_TO_500K: 500000, UP_TO_1M: 1000000, UP_TO_2M: 2000000 });
export const NEIGHBORHOODS = Object.freeze([
  "Perdizes",
  "Pompeia",
  "Pinheiros",
  "Vila Madalena",
  "Lapa",
  "Alto da Lapa",
  "Barra Funda",
  "Butantã",
  "Jaguaré",
  "Sumaré",
  "Vila Leopoldina",
  "Alto de Pinheiros",
  "Rio Pequeno",
  "Vila Sônia",
  "Morumbi",
  "Moema",
  "Vila Mariana",
  "Chácara Klabin",
  "Brooklin",
  "Brooklin Paulista",
  "Brooklin Novo",
  "Campo Belo",
  "Saúde",
  "Ipiranga",
  "Paraíso",
  "Aclimação",
  "Jardins",
  "Jardim Paulista",
  "Itaim Bibi",
  "Vila Nova Conceição",
  "Santo Amaro",
  "Campo Grande",
  "Vila Clementino",
  "Planalto Paulista",
  "Mirandópolis",
  "Santana",
  "Tucuruvi",
  "Casa Verde",
  "Mandaqui",
  "Vila Guilherme",
  "Vila Maria",
  "Parada Inglesa",
  "Jardim São Paulo",
  "Lauzane Paulista",
  "Limão",
  "Freguesia do Ó",
  "Tremembé",
  "Jaçanã",
  "Tatuapé",
  "Mooca",
  "Anália Franco",
  "Vila Prudente",
  "Penha",
  "Carrão",
  "Belém",
  "Brás",
  "Água Rasa",
  "Vila Formosa",
  "Vila Matilde",
  "Itaquera",
  "Aricanduva",
  "Sapopemba",
  "São Mateus"
]);
const SCHEMA_VERSION = "ynt-inventory-summary/1";
const MAX_GROUPS = NEIGHBORHOODS.length * 5 * Object.keys(PRICE_CAPS).length;

export function destinationUrl(group) {
  const url = new URL("/", "https://app.yincorp.com.br");
  url.search = new URLSearchParams({
    modo: "explorar", cidade: "São Paulo", estado: "SP", bairro: group.neighborhood,
    dormitorios: String(group.bedrooms_min), valor_max: String(PRICE_CAPS[group.price_band]), source: "todos"
  }).toString();
  return url.toString();
}

/** Project a complete RPC result, rejecting any malformed/duplicate group. Never spread input. */
export function projectInventorySummary(input) {
  if (!record(input) || input.schema_version !== SCHEMA_VERSION || input.complete !== true ||
      input.city !== "São Paulo" || input.state !== "SP" || input.counting_unit !== "active_priced_catalog_entries" ||
      typeof input.generated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.generated_at) ||
      !Number.isFinite(Date.parse(input.generated_at)) || !Array.isArray(input.groups) || input.groups.length > MAX_GROUPS) return null;
  const groups = []; const seen = new Set();
  for (const group of input.groups) {
    if (!record(group) || !NEIGHBORHOODS.includes(group.neighborhood) ||
        !Number.isInteger(group.bedrooms_min) || group.bedrooms_min < 1 || group.bedrooms_min > 5 ||
        !Object.hasOwn(PRICE_CAPS, group.price_band) ||
        ![group.available_properties, group.new_count, group.used_count].every(count) ||
        group.available_properties !== group.new_count + group.used_count) return null;
    const key = `${group.neighborhood}:${group.bedrooms_min}:${group.price_band}`;
    if (seen.has(key)) return null; seen.add(key);
    groups.push({
      neighborhood: group.neighborhood, bedrooms_min: group.bedrooms_min, price_band: group.price_band,
      available_properties: group.available_properties, new_count: group.new_count, used_count: group.used_count,
      destination_url: destinationUrl(group)
    });
  }
  groups.sort((a, b) => `${a.neighborhood}:${a.bedrooms_min}:${a.price_band}`.localeCompare(`${b.neighborhood}:${b.bedrooms_min}:${b.price_band}`, "en"));
  return { schema_version: SCHEMA_VERSION, generated_at: input.generated_at, city: "São Paulo", state: "SP", counting_unit: "active_priced_catalog_entries", complete: true, groups };
}
export function catalogMatchesConsumer() {
  return NEIGHBORHOODS.length === catalog.NEIGHBORHOOD_CATALOG.length &&
    NEIGHBORHOODS.every((name, i) => name === catalog.NEIGHBORHOOD_CATALOG[i].canonical_name);
}
function record(input) { return input !== null && typeof input === "object" && !Array.isArray(input); }
function count(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
