import { fetchOruloFloorPlans, mergeFloorPlans } from './orulo-floor-plans.js';

let activeRuns = 0;
let originalFetch = null;
let patchedFetch = null;

function buildingDetailId(input) {
  try {
    const rawUrl = typeof input === 'string' || input instanceof URL
      ? String(input)
      : input?.url;

    if (!rawUrl) return null;

    const url = new URL(rawUrl);
    if (url.hostname !== 'www.orulo.com.br') return null;

    const match = url.pathname.match(/^\/api\/v2\/buildings\/([^/]+)\/?$/);
    if (!match) return null;

    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function requestHeaders(input, init) {
  if (init?.headers) return init.headers;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.headers;
  return {};
}

async function enrichBuildingDetailResponse({ response, buildingId, headers, fetchImpl }) {
  if (!response?.ok) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }

  const building = payload?.building && typeof payload.building === 'object'
    ? payload.building
    : payload;

  if (!building || typeof building !== 'object' || Array.isArray(building)) {
    return response;
  }

  let enrichedPlans;
  try {
    enrichedPlans = await fetchOruloFloorPlans(buildingId, headers, { fetchImpl });
  } catch (error) {
    console.warn('ORULO_FLOOR_PLANS_ENRICHMENT_FAILED', {
      buildingId,
      message: error?.message || String(error)
    });
    return response;
  }

  const floorPlans = mergeFloorPlans(building.floor_plans ?? [], enrichedPlans);
  const nextPayload = payload?.building && typeof payload.building === 'object'
    ? { ...payload, building: { ...building, floor_plans: floorPlans } }
    : { ...building, floor_plans: floorPlans };

  const nextHeaders = new Headers(response.headers);
  nextHeaders.delete('content-length');

  return new Response(JSON.stringify(nextPayload), {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders
  });
}

export async function withOruloFloorPlans(run) {
  if (typeof run !== 'function') {
    throw new TypeError('withOruloFloorPlans requires a function');
  }

  if (activeRuns === 0) {
    originalFetch = globalThis.fetch;
    const baseFetch = originalFetch.bind(globalThis);

    patchedFetch = async (input, init) => {
      const response = await baseFetch(input, init);
      const buildingId = buildingDetailId(input);

      if (!buildingId) return response;

      return enrichBuildingDetailResponse({
        response,
        buildingId,
        headers: requestHeaders(input, init),
        fetchImpl: baseFetch
      });
    };

    globalThis.fetch = patchedFetch;
  }

  activeRuns += 1;

  try {
    return await run();
  } finally {
    activeRuns -= 1;

    if (activeRuns === 0) {
      if (globalThis.fetch === patchedFetch && originalFetch) {
        globalThis.fetch = originalFetch;
      }
      originalFetch = null;
      patchedFetch = null;
    }
  }
}
