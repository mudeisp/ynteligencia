const VERSION = "remarketing-products/1";

export function projectRemarketingProducts(rows) {
  if (!Array.isArray(rows)) return null;
  const seen = new Set();
  const products = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || row.active !== true) continue;
    const externalId = text(row.external_id, 160);
    const name = text(row.development_name || row.title, 160);
    const neighborhood = text(row.neighborhood, 120);
    const city = text(row.city, 120);
    const state = text(row.state, 8)?.toUpperCase() || null;
    const source = text(row.source, 32)?.toLowerCase() || null;
    const price = money(row.price);
    const bedrooms = integer(row.bedrooms, 0, 20);
    if (!externalId || !name || !neighborhood || !city || state !== "SP" || !source || !price || bedrooms === null) continue;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    products.push(Object.freeze({
      property_id: externalId,
      product_name: name,
      neighborhood,
      city,
      state,
      source,
      price,
      bedrooms,
      active: true
    }));
  }
  products.sort((a, b) => a.price - b.price || a.product_name.localeCompare(b.product_name, "pt-BR") || a.property_id.localeCompare(b.property_id, "en"));
  return Object.freeze({ version: VERSION, products: Object.freeze(products) });
}

function text(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}
function money(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= 1000000000 ? n : null;
}
function integer(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
