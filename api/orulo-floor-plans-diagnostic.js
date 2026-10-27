export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (process.env.VERCEL_ENV === 'production') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }

  const buildingId = String(req.query?.building_id || '').trim();
  if (!/^\d+$/.test(buildingId)) {
    return res.status(400).json({ ok: false, error: 'building_id inválido' });
  }

  const clientId = process.env.ORULO_CLIENT_ID;
  const clientSecret = process.env.ORULO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ ok: false, error: 'Credenciais Órulo ausentes' });
  }

  try {
    const tokenResponse = await fetch('https://www.orulo.com.br/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      }).toString()
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(502).json({ ok: false, error: 'Falha na autenticação Órulo', status: tokenResponse.status });
    }

    const params = new URLSearchParams();
    params.append('dimensions[]', '520x280');
    params.append('dimensions[]', '1024x1024');
    params.append('dimensions[]', '2280x1800');

    const plansResponse = await fetch(
      `https://www.orulo.com.br/api/v2/buildings/${buildingId}/floor_plans?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/json'
        }
      }
    );
    const plansData = await plansResponse.json().catch(() => ({}));
    if (!plansResponse.ok) {
      return res.status(502).json({ ok: false, error: 'Falha ao consultar plantas Órulo', status: plansResponse.status });
    }

    const plans = Array.isArray(plansData.floor_plans) ? plansData.floor_plans : [];
    const sanitized = plans.map((plan) => ({
      id: plan?.id ?? null,
      type: plan?.type ?? null,
      description: plan?.description ?? null,
      associations: plan?.associations ?? null,
      image_520x280: plan?.['520x280'] ?? null,
      image_1024x1024: plan?.['1024x1024'] ?? null,
      image_2280x1800: plan?.['2280x1800'] ?? null
    }));

    return res.status(200).json({
      ok: true,
      building_id: buildingId,
      count: sanitized.length,
      with_image: sanitized.filter((plan) => plan.image_1024x1024 || plan.image_2280x1800 || plan.image_520x280).length,
      floor_plans: sanitized
    });
  } catch (error) {
    console.error('ORULO_FLOOR_PLANS_DIAGNOSTIC_ERROR', {
      message: error?.message || String(error)
    });
    return res.status(500).json({ ok: false, error: 'Falha interna no diagnóstico' });
  }
}
