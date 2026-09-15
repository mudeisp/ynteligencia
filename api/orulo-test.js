export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const clientId = process.env.ORULO_CLIENT_ID;
    const clientSecret = process.env.ORULO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        ok: false,
        error: "Credenciais da Órulo não configuradas na Vercel"
      });
    }

    // 1. Autenticação
    const tokenResponse = await fetch(
      "https://www.orulo.com.br/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials"
        }).toString()
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(tokenResponse.status || 500).json({
        ok: false,
        error: "Falha na autenticação com a Órulo"
      });
    }

    // 2. Busca uma pequena amostra de empreendimentos em São Paulo
    const params = new URLSearchParams({
      state: "SP",
      city: "São Paulo",
      results_per_page: "5",
      page: "1"
    });

    const buildingsResponse = await fetch(
      `https://www.orulo.com.br/api/v2/buildings?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/json"
        }
      }
    );

    const buildingsData = await buildingsResponse.json();

    if (!buildingsResponse.ok) {
      return res.status(buildingsResponse.status).json({
        ok: false,
        error: "Falha ao consultar empreendimentos na Órulo",
        details: buildingsData
      });
    }

    // 3. Retorna a resposta real para entendermos a estrutura
    return res.status(200).json({
      ok: true,
      message: "Empreendimentos da Órulo carregados com sucesso",
      city: "São Paulo",
      state: "SP",
      total: buildingsData.total ?? null,
      page: buildingsData.page ?? null,
      total_pages: buildingsData.total_pages ?? null,
      buildings: buildingsData.buildings || []
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
