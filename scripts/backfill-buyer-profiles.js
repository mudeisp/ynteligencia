#!/usr/bin/env node
/*
  Reconstrói buyer_profiles a partir de ads_events.

  Não apaga eventos. Não altera ads_visitors, handoff nem leads.
  Sem --apply, só conta. Sem BUYER_PROFILE_BACKFILL=1, não faz nada.

  O rebuild parte de ads_events. Cidade, estado, região, tipo e
  propósito só entram se o evento os trouxer. Hoje esses campos
  não são colunas de ads_events; o backfill não os inventa.

  Exemplo, depois da migration aplicada:
    BUYER_PROFILE_BACKFILL=1 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      node scripts/backfill-buyer-profiles.js

    BUYER_PROFILE_BACKFILL=1 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      node scripts/backfill-buyer-profiles.js --apply
*/

const buyer = require("../buyer-profile.js");

const PAGE = 500;

function configured() {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY));
}

async function rest(path, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    throw new Error(`supabase_${response.status}`);
  }
  if (options.method && options.method !== "GET") return { ok: true, status: response.status, data: null };
  const data = await response.json();
  return { ok: true, status: response.status, data };
}

async function readEvents() {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await rest(
      `ads_events?select=*&order=event_time.asc,event_id.asc&limit=${PAGE}&offset=${offset}`,
      { method: "GET" }
    );
    const chunk = Array.isArray(page.data) ? page.data : [];
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
    offset += PAGE;
  }
}

async function main() {
  if (process.env.BUYER_PROFILE_BACKFILL !== "1") {
    console.error("Defina BUYER_PROFILE_BACKFILL=1. Nada foi alterado.");
    process.exitCode = 1;
    return;
  }
  if (!configured()) {
    console.error("Supabase não configurado. Nada foi alterado.");
    process.exitCode = 1;
    return;
  }

  const apply = process.argv.includes("--apply");
  const events = await readEvents();
  const profiles = buyer.rebuildProfiles(events);
  console.log(`eventos=${events.length} perfis=${profiles.length} modo=${apply ? "apply" : "leitura"}`);
  if (!apply) return;

  for (const profile of profiles) {
    await rest("buyer_profiles?on_conflict=visitor_id", { method: "POST", body: profile });
  }
  console.log(`perfis_gravados=${profiles.length}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error("BUYER_PROFILE_BACKFILL_ERROR", error && error.name ? error.name : "Error");
    process.exitCode = 1;
  });
}
