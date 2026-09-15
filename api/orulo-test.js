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

    // 2. Empreendimento real escolhido para inspeção
    const buildingId = "80696";

    const buildingResponse = await fetch(
      `https://www.orulo.com.br/api/v2/buildings/${buildingId}`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/json"
        }
      }
    );

    const buildingData = await buildingResponse.json();

    if (!buildingResponse.ok) {
      return res.status(buildingResponse.status).json({
        ok: false,
        error: "Falha ao consultar empreendimento na Órulo",
        building_id: buildingId,
        details: buildingData
      });
    }

    // 3. Retorna os dados reais para estudarmos a estrutura
    // O token e as credenciais nunca são enviados ao navegador
    return res.status(200).json({
      ok: true,
      message: "Detalhes do empreendimento carregados com sucesso",
      building_id: buildingId,
      building: buildingData
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
