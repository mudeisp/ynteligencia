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

    // =========================================================
    // 1. TOKEN
    // =========================================================

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

        step:
          "oauth",

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

    // =========================================================
    // 2. HELPER DE TESTE
    // =========================================================

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

          status: 0,

          ok: false,

          error:
            error?.message ||
            String(error)
        };
      }
    }

    // =========================================================
    // 3. ENDPOINTS
    // =========================================================

    const base =
      "https://www.orulo.com.br/api/v2/buildings";

    const results =
      await Promise.all([

        // -----------------------------------------------------
        // EMPREENDIMENTO
        // -----------------------------------------------------

        testEndpoint(
          "building",
          `${base}/${buildingId}`
        ),

        // -----------------------------------------------------
        // TIPOLOGIAS
        // -----------------------------------------------------

        testEndpoint(
          "typologies",
          `${base}/${buildingId}/typologies`
        ),

        // -----------------------------------------------------
        // FOTOS
        // -----------------------------------------------------

        testEndpoint(
          "images",
          `${base}/${buildingId}/images?dimensions[]=1024x1024`
        ),

        // -----------------------------------------------------
        // PLANTAS
        // IMPORTANTE: precisa informar dimensão
        // -----------------------------------------------------

        testEndpoint(
          "floor_plans",
          `${base}/${buildingId}/floor_plans?dimensions[]=1024x1024`
        ),

        // -----------------------------------------------------
        // ARQUIVOS
        // Mantemos apenas para confirmar comportamento
        // -----------------------------------------------------

        testEndpoint(
          "files",
          `${base}/${buildingId}/files`
        )

      ]);

    // =========================================================
    // 4. RESUMO
    // =========================================================

    const summary =
      results.map(item => ({
        name:
          item.name,

        status:
          item.status,

        ok:
          item.ok
      }));

    return res
      .status(200)
      .json({
        ok: true,

        building_id:
          buildingId,

        auth:
          "client_credentials",

        summary,

        results
      });

  } catch (error) {
    console.error(
      "ORULO_DEBUG_FATAL",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,

        error:
          error?.message ||
          String(error)
      });
  }
}
