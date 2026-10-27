export async function fetchOruloFloorPlans(buildingId, headers, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams();
  params.append("dimensions[]", "520x280");
  params.append("dimensions[]", "1024x1024");
  params.append("dimensions[]", "2280x1800");

  const response = await fetchImpl(
    `https://www.orulo.com.br/api/v2/buildings/${encodeURIComponent(String(buildingId))}/floor_plans?${params.toString()}`,
    { headers }
  );

  if (!response.ok) {
    const error = new Error(`ORULO_FLOOR_PLANS_FETCH_FAILED_${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const plans = Array.isArray(data?.floor_plans) ? data.floor_plans : [];

  return plans.map((plan) => ({
    ...plan,
    image_url:
      plan?.["2280x1800"] ||
      plan?.["1024x1024"] ||
      plan?.["520x280"] ||
      plan?.image_url ||
      plan?.url ||
      null,
    images: [
      plan?.["2280x1800"],
      plan?.["1024x1024"],
      plan?.["520x280"]
    ].filter(Boolean)
  }));
}

export function mergeFloorPlans(basePlans, enrichedPlans) {
  const enrichedById = new Map(
    (Array.isArray(enrichedPlans) ? enrichedPlans : [])
      .filter((plan) => plan?.id !== undefined && plan?.id !== null)
      .map((plan) => [String(plan.id), plan])
  );

  const merged = (Array.isArray(basePlans) ? basePlans : []).map((plan) => {
    const extra = enrichedById.get(String(plan?.id ?? ""));
    return extra ? { ...plan, ...extra } : plan;
  });

  const seen = new Set(
    merged
      .filter((plan) => plan?.id !== undefined && plan?.id !== null)
      .map((plan) => String(plan.id))
  );

  for (const plan of Array.isArray(enrichedPlans) ? enrichedPlans : []) {
    const id = String(plan?.id ?? "");
    if (!id || seen.has(id)) continue;
    merged.push(plan);
    seen.add(id);
  }

  return merged;
}
