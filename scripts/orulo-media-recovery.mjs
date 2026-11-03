import { pathToFileURL } from 'node:url';
import { fetchOruloFloorPlans, mergeFloorPlans } from '../orulo-floor-plans.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzaegidwtdjuhqchpdpd.supabase.co';
const ORULO_CLIENT_ID = process.env.ORULO_CLIENT_ID;
const ORULO_CLIENT_SECRET = process.env.ORULO_CLIENT_SECRET;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export function parseArgs(argv = process.argv.slice(2)) {
  const buildingArgs = argv.filter((arg) => arg === '--building-id' || arg.startsWith('--building-id='));
  if (buildingArgs.length > 1) throw new Error('BUILDING_ID_INVALID');
  const buildingId = buildingArgs.length ? validateBuildingId(buildingArgs[0].slice('--building-id='.length)) : null;
  const statesArg = argv.find((arg) => arg.startsWith('--states='));
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const states = String(statesArg?.split('=')[1] || process.env.ORULO_MEDIA_STATES || 'SP,ES')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]{2}$/.test(value));
  const limit = Math.max(0, Number(limitArg?.split('=')[1] || process.env.ORULO_MEDIA_LIMIT_BUILDINGS || 0) || 0);
  return { states: [...new Set(states)], limit, buildingId, write: argv.includes('--write') };
}

function validateBuildingId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('BUILDING_ID_INVALID');
  }
  return value;
}

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

export async function listRows({ states, fetchImpl = fetch }) {
  const rows = [];
  const pageSize = 500;
  for (const state of states) {
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const url = `${SUPABASE_URL}/rest/v1/properties?select=external_id,state,city,development_name,raw_data&source=eq.novos&active=eq.true&state=eq.${encodeURIComponent(state)}`;
      const response = await fetchImpl(url, { headers: { ...supabaseHeaders(), Range: `${from}-${to}` } });
      if (!response.ok) throw new Error(`SUPABASE_LIST_FAILED_${state}_${response.status}`);
      const batch = await response.json();
      if (!Array.isArray(batch) || !batch.length) break;
      rows.push(...batch);
      if (batch.length < pageSize) break;
    }
  }
  return rows;
}

export function groupRowsByBuilding(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const buildingId = row?.raw_data?.building_id ?? row?.raw_data?.building?.id;
    if (buildingId === undefined || buildingId === null || buildingId === '') continue;
    const key = String(buildingId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function floorPlans(rawData) {
  return Array.isArray(rawData?.building?.floor_plans) ? rawData.building.floor_plans : [];
}

export function mediaSnapshot(rawData) {
  const plans = floorPlans(rawData);
  const planImages = plans.filter((plan) => Boolean(plan?.image_url || plan?.url || plan?.['2280x1800'] || plan?.['1024x1024'] || plan?.['520x280'])).length;
  const videos = Array.isArray(rawData?.building?.videos) ? rawData.building.videos.filter((video) => video?.url).length : 0;
  const virtualTour = Boolean(rawData?.building?.virtual_tour);
  const photos = Array.isArray(rawData?.images) ? rawData.images.filter(Boolean).length : 0;
  return {
    photos,
    floorPlans: plans.length,
    floorPlanImages: planImages,
    videos,
    virtualTour,
    status: plans.length > 0 && planImages === 0 ? 'MEDIA_INCOMPLETE_FLOOR_PLANS' : 'MEDIA_OK'
  };
}

export function enrichRawData(rawData, enrichedPlans) {
  const raw = rawData && typeof rawData === 'object' ? rawData : {};
  const building = raw.building && typeof raw.building === 'object' ? raw.building : {};
  return {
    ...raw,
    building: {
      ...building,
      floor_plans: mergeFloorPlans(building.floor_plans ?? [], enrichedPlans)
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

export async function runRecovery({ fetchImpl = fetch, args = parseArgs() } = {}) {
  const buildingId = args.buildingId == null ? null : validateBuildingId(args.buildingId);
  const token = await getOruloToken(fetchImpl);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const rows = await listRows({ states: args.states, fetchImpl });
  let buildings = [...groupRowsByBuilding(rows).entries()];
  if (buildingId !== null) {
    buildings = buildings.filter(([id]) => id === buildingId);
    if (!buildings.length) throw new Error('BUILDING_ID_NOT_FOUND');
  }
  if (args.limit > 0) buildings = buildings.slice(0, args.limit);

  const summary = {
    mode: args.write ? 'write' : 'dry-run',
    states: args.states,
    buildingId,
    rows: buildingId === null ? rows.length : buildings.reduce((count, [, buildingRows]) => count + buildingRows.length, 0),
    buildings: buildings.length,
    buildingsWithDeclaredPlans: 0,
    buildingsMissingPlanImagesBefore: 0,
    buildingsRecoverable: 0,
    plansDeclaredBefore: 0,
    planImagesBefore: 0,
    plansReturnedLive: 0,
    planImagesReturnedLive: 0,
    rowsChanged: 0,
    rowsWritten: 0,
    failures: [],
    recoverable: []
  };

  for (const [buildingId, buildingRows] of buildings) {
    const representative = buildingRows[0];
    const before = mediaSnapshot(representative?.raw_data);
    summary.plansDeclaredBefore += before.floorPlans;
    summary.planImagesBefore += before.floorPlanImages;
    if (before.floorPlans > 0) summary.buildingsWithDeclaredPlans += 1;
    if (before.floorPlans > 0 && before.floorPlanImages === 0) summary.buildingsMissingPlanImagesBefore += 1;

    try {
      const livePlans = await fetchOruloFloorPlans(buildingId, headers, { fetchImpl });
      const liveImages = livePlans.filter((plan) => plan?.image_url).length;
      summary.plansReturnedLive += livePlans.length;
      summary.planImagesReturnedLive += liveImages;

      if (liveImages > before.floorPlanImages) {
        summary.buildingsRecoverable += 1;
        summary.recoverable.push({
          buildingId,
          development: representative?.development_name || representative?.raw_data?.building?.name || null,
          state: representative?.state || null,
          city: representative?.city || null,
          declaredPlans: before.floorPlans,
          imagesBefore: before.floorPlanImages,
          livePlans: livePlans.length,
          liveImages
        });
      }

      for (const row of buildingRows) {
        const nextRaw = enrichRawData(row.raw_data, livePlans);
        const current = JSON.stringify(floorPlans(row.raw_data));
        const next = JSON.stringify(floorPlans(nextRaw));
        if (current === next) continue;
        summary.rowsChanged += 1;
        if (args.write) {
          await patchRow(row.external_id, nextRaw, fetchImpl);
          summary.rowsWritten += 1;
        }
      }

      console.log('ORULO_MEDIA_RECOVERY_BUILDING', {
        buildingId,
        development: representative?.development_name || null,
        before,
        livePlans: livePlans.length,
        liveImages,
        write: args.write
      });
    } catch (error) {
      const failure = { buildingId, error: error?.message || String(error) };
      summary.failures.push(failure);
      console.warn('ORULO_MEDIA_RECOVERY_FAILED', failure);
    }
  }

  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecovery()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failures.length) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
