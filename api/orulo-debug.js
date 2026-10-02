export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const clientId =
      process.env.ORULO_CLIENT_ID;

    const clientSecret =
      process.env.ORULO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        ok: false,
        error: "Credenciais Órulo ausentes"
      });
    }

    const buildingId =
      String(
        req.query?.id || "83363"
      ).trim();

    // 1. TOKEN ATUAL — MESMA AUTENTICAÇÃO DA INFRA
    const tokenResponse =
      await fetch(
        "https://www.orulo.com.br/oauth/token",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body:
            new URLSearchParams({
              client_id:
                clientId,

              client_secret:
                clientSecret,

              grant_type:
                "client_credentials"
            }).toString()
        }
      );

    const tokenData =
      await tokenResponse
        .json()
        .catch(() => ({}));

    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {
      return res.status(502).json({
        ok: false,
        step: "oauth",
        status:
          tokenResponse.status,
        response:
          tokenData
      });
    }

    const headers = {
      Authorization:
        `Bearer ${tokenData.access_token}`,

      Accept:
        "application/json"
    };

    async function testEndpoint(
      name,
      url
    ) {
      try {
        const response =
          await fetch(
            url,
            {
              headers
            }
          );

        const text =
          await response.text();

        let data;

        try {
          data =
            JSON.parse(text);
        } catch {
          data =
            text;
        }

        return {
          name,

          url,

          status:
            response.status,

          ok:
            response.ok,

          data
        };

      } catch (error) {
        return {
          name,
          url,
          ok: false,
          status: 0,
          error:
            error?.message ||
            String(error)
        };
      }
    }

    const base =
      "https://www.orulo.com.br/api/v2/buildings";

    const results =
      await Promise.all([
        testEndpoint(
          "building",
          `${base}/${buildingId}`
        ),

        testEndpoint(
          "typologies",
          `${base}/${buildingId}/typologies`
        ),

        testEndpoint(
          "images",
          `${base}/${buildingId}/images`
        ),

        testEndpoint(
          "floor_plans",
          `${base}/${buildingId}/floor_plans`
        ),

        testEndpoint(
          "files",
          `${base}/${buildingId}/files`
        )
      ]);

    return res.status(200).json({
      ok: true,

      building_id:
        buildingId,

      auth:
        "client_credentials",

      results
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,

      error:
        error?.message ||
        String(error)
    });
  }
}
