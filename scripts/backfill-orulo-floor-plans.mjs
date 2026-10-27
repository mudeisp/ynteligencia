import { fetchOruloFloorPlans, mergeFloorPlans } from '../orulo-floor-plans.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzaegidwtdjuhqchpdpd.supabase.co';
const ORULO_CLIENT_ID = process.env.ORULO_CLIENT_ID;
const ORULO_CLIENT_SECRET = process.env.ORULO_CLIENT_SECRET;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const WRITE = process.argv.includes('--write');

function required(name, value) {
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

async function getOruloToken(fetchImpl = fetch) {
  const response = await fetchImpl('https://www.orulo.com.br/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: required('ORULO_CLIENT_ID', ORULO_CLIENT_ID),
      client_secret: required('ORULO_CLIENT_SECRET', ORULO_CLIENT_SECRET),
      grant_type: 'client_credentials'
    }).toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`ORULO_AUTH_FAILED_${response.status}`);
  return data.access_token;
}

function supabaseHeaders() {
  const key = required('SUPABASE_SECRET_KEY', SUPABASE_SECRET_KEY);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
}

export async function listEsRows(fetchImpl = fetch) {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const url = `${SUPABASE_URL}/rest/v1/properties?select=external_id,raw_data&source=eq.novos&active=eq.true&state=eq.ES`;
    const response = await fetchImpl(url, {
      headers: { ...supabaseHeaders(), Range: `${from}-${to}` }
    });
    if (!response.ok) throw new Error(`SUPABASE_LIST_FAILED_${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export function groupRowsByBuilding(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.raw_data?.building_id;
    if (id === undefined || id === null || id === '') continue;
    const key = String(id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

export function enrichRawData(rawData, plans) {
  const raw = rawData && typeof rawData === 'object' ? rawData : {};
  const building = raw.building && typeof raw.building === 'object' ? raw.building : {};
  return {
    ...raw,
    building: {
      ...building,
      floor_plans: mergeFloorPlans(building.floor_plans ?? [], plans)
    }
  };
}

async function patchRow(externalId, rawData, fetchImpl = fetch) {
  const endpoint = `${SUPABASE_URL}/rest/v1/properties?external_id=eq.${encodeURIComponent(externalId)}`;
  const response = await fetchImpl(endpoint, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ raw_data: rawData, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`SUPABASE_PATCH_FAILED_${response.status}`);
}

export async function runBackfill({ fetchImpl = fetch, write = WRITE } = {}) {
  const token = await getOruloToken(fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const rows = await listEsRows(fetchImpl);
  const grouped = groupRowsByBuilding(rows);
  const summary = {
    mode: write ? 'write' : 'dry-run',
    rows: rows.length,
    buildings: grouped.size,
    buildings_with_plans: 0,
    plans: 0,
    plans_with_image: 0,
    rows_changed: 0,
    failures: []
  };

  for (const [buildingId, buildingRows] of grouped) {
    try {
      const plans = await fetchOruloFloorPlans(buildingId, headers, { fetchImpl });
      const withImage = plans.filter((p) => p?.image_url).length;
      if (plans.length) summary.buildings_with_plans += 1;
      summary.plans += plans.length;
      summary.plans_with_image += withImage;

      for (const row of buildingRows) {
        const nextRaw = enrichRawData(row.raw_data, plans);
        const current = JSON.stringify(row?.raw_data?.building?.floor_plans ?? []);
        const next = JSON.stringify(nextRaw?.building?.floor_plans ?? []);
        if (current === next) continue;
        summary.rows_changed += 1;
        if (write) await patchRow(row.external_id, nextRaw, fetchImpl);
      }

      console.log('ORULO_FLOOR_PLANS_BACKFILL_BUILDING', {
        buildingId,
        rows: buildingRows.length,
        plans: plans.length,
        withImage
      });
    } catch (error) {
      summary.failures.push({ buildingId, error: error?.message || String(error) });
      console.warn('ORULO_FLOOR_PLANS_BACKFILL_FAILED', buildingId, error?.message || error);
    }
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackfill()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failures.length) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
