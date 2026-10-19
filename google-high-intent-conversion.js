export function googleHighIntentConversionsCsv(rows, ads) {
  const columns = Array.isArray(ads && ads.GOOGLE_CONVERSION_COLUMNS)
    ? ads.GOOGLE_CONVERSION_COLUMNS
    : [];
  const spec = ads && ads.GOOGLE_SIGNAL_CONVERSIONS
    ? ads.GOOGLE_SIGNAL_CONVERSIONS.high_intent_buyer
    : null;
  if (!columns.length || !spec || !spec.name || typeof ads.googleAdsConversionTime !== "function") {
    throw new Error("high_intent_conversion_config_unavailable");
  }

  const seen = new Set();
  const lines = [columns.join(",")];
  for (const row of rows || []) {
    const eventId = clean(row && row.event_id);
    if (!eventId || seen.has(eventId)) continue;
    const gclid = clean(row && row.gclid);
    const gbraid = clean(row && row.gbraid);
    const wbraid = clean(row && row.wbraid);
    if (!gclid && !gbraid && !wbraid) continue;
    const conversionTime = ads.googleAdsConversionTime(row && row.event_time);
    if (!conversionTime) continue;
    seen.add(eventId);
    const exported = {
      "Google Click ID": gclid,
      GBRAID: gbraid,
      WBRAID: wbraid,
      "Conversion Name": spec.name,
      "Conversion Time": conversionTime,
      "Conversion Value": spec.value,
      "Conversion Currency": ads.CONVERSION_CURRENCY,
      "Order ID": eventId,
      Product: clean(row && row.product)
    };
    lines.push(columns.map(column => csvCell(exported[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
