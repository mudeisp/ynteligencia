export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const clientId = process.env.ORULO_CLIENT_ID;
    const clientSecret = process.env.ORULO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        ok: false,
        error: "Credenciais da Órulo não configuradas na Vercel"
      });
    }

    // 1. Autentica na Órulo
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
        error: "Falha na autenticação com a Órulo",
        details: tokenData
      });
    }

    // 2. Consulta cidades de SP disponíveis para nossa integração
    const citiesResponse = await fetch(
      "https://www.orulo.com.br/api/v2/addresses/cities?state=SP",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/json"
        }
      }
    );

    const citiesData = await citiesResponse.json();

    if (!citiesResponse.ok) {
      return res.status(citiesResponse.status).json({
        ok: false,
        error: "Falha ao consultar cidades na Órulo",
        details: citiesData
      });
    }

    // 3. Retorna somente os dados do catálogo, nunca o token
    return res.status(200).json({
      ok: true,
      message: "Catálogo Órulo acessado com sucesso",
      state: "SP",
      cities: citiesData.cities || [],
      total_cities: Array.isArray(citiesData.cities)
        ? citiesData.cities.length
        : 0
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
