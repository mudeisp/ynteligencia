#!/usr/bin/env node
/*
  Reconstrói buyer_profiles chamando a mesma RPC do caminho online.
  Não recalcula estágio, toque nem contagem aqui.

  Sem --apply, só conta. Sem BUYER_PROFILE_BACKFILL=1, não faz nada.

  A ordem é event_time e, no empate, event_id. O resultado é o mesmo
  de aplicar os eventos fora de ordem, porque a função SQL é determinística.
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
      Prefer: "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    throw new Error(`supabase_${response.status}`);
  }
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

function byTime(a, b) {
  const time = String(a.event_time || "").localeCompare(String(b.event_time || ""));
  if (time !== 0) return time;
  return String(a.event_id || "").localeCompare(String(b.event_id || ""));
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
  const events = (await readEvents()).slice().sort(byTime);
  const visitors = new Set(events.map(row => row.visitor_id).filter(Boolean));
  console.log(`eventos=${events.length} visitantes=${visitors.size} modo=${apply ? "apply" : "leitura"}`);
  if (!apply) return;

  for (const row of events) {
    const result = await rest("rpc/apply_buyer_profile_event", {
      method: "POST",
      body: { p_event: buyer.toApplyPayload(row) }
    });
    const status = result.data && result.data.status;
    if (status === "rejected") {
      throw new Error("buyer_profile_rejected");
    }
  }
  console.log(`eventos_aplicados=${events.length}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error("BUYER_PROFILE_BACKFILL_ERROR", error && error.name ? error.name : "Error");
    process.exitCode = 1;
  });
}
