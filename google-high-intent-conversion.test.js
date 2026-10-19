import assert from "node:assert/strict";
import { test } from "node:test";
import { googleHighIntentConversionsCsv } from "./google-high-intent-conversion.js";

const ads = {
  GOOGLE_CONVERSION_COLUMNS: [
    "Google Click ID", "GBRAID", "WBRAID", "Conversion Name",
    "Conversion Time", "Conversion Value", "Conversion Currency", "Order ID", "Product"
  ],
  GOOGLE_SIGNAL_CONVERSIONS: {
    high_intent_buyer: { name: "High Intent Buyer", value: 1 }
  },
  CONVERSION_CURRENCY: "BRL",
  googleAdsConversionTime: value => value === "2026-10-19T12:00:00.000Z" ? "2026-10-19 09:00:00-0300" : ""
};

test("exports high intent with its own conversion name and value", () => {
  const csv = googleHighIntentConversionsCsv([{
    event_id: "evt-high-1",
    event_time: "2026-10-19T12:00:00.000Z",
    product: "ynteligencia",
    gclid: "gclid-real",
    gbraid: "",
    wbraid: ""
  }], ads);
  assert.match(csv, /"High Intent Buyer"/);
  assert.match(csv, /"1"/);
  assert.match(csv, /"BRL"/);
  assert.match(csv, /"evt-high-1"/);
  assert.match(csv, /"gclid-real"/);
});

test("skips rows without Google click identity and deduplicates event ids", () => {
  const csv = googleHighIntentConversionsCsv([
    { event_id: "evt-no-click", event_time: "2026-10-19T12:00:00.000Z", product: "ynteligencia" },
    { event_id: "evt-high-1", event_time: "2026-10-19T12:00:00.000Z", product: "ynteligencia", gbraid: "braid-real" },
    { event_id: "evt-high-1", event_time: "2026-10-19T12:00:00.000Z", product: "ynteligencia", wbraid: "duplicate" }
  ], ads);
  assert.equal(csv.split("\n").filter(Boolean).length, 2);
  assert.equal(csv.includes("evt-no-click"), false);
  assert.equal(csv.includes("duplicate"), false);
});

test("does not emit visitor or contact fields", () => {
  const csv = googleHighIntentConversionsCsv([{
    event_id: "evt-high-2",
    event_time: "2026-10-19T12:00:00.000Z",
    product: "agente_yincorp",
    wbraid: "wbraid-real",
    visitor_id: "11111111-1111-4111-8111-111111111111",
    email: "person@example.com",
    phone: "11999999999"
  }], ads);
  assert.equal(csv.includes("11111111"), false);
  assert.equal(csv.includes("example.com"), false);
  assert.equal(csv.includes("11999999999"), false);
});
