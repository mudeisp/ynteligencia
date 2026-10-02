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

    // =====================================================
    // 1. TOKEN
    // =====================================================

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
        data:
          tokenData
      });
    }

    // =====================================================
    // 2. BUSCA BUILDING COMPLETO
    // =====================================================

    const buildingResponse =
      await fetch(
        `https://www.orulo.com.br/api/v2/buildings/${encodeURIComponent(buildingId)}`,
        {
          headers: {
            Authorization:
              `Bearer ${tokenData.access_token}`,

            Accept:
              "application/json"
          }
        }
      );

    const buildingData =
      await buildingResponse
        .json()
        .catch(() => ({}));

    if (!buildingResponse.ok) {
      return res.status(502).json({
        ok: false,
        step: "building",
        status:
          buildingResponse.status,
        data:
          buildingData
      });
    }

    // =====================================================
    // 3. PALAVRAS QUE QUEREMOS ENCONTRAR
    // =====================================================

    const terms = [
      "book",
      "tabela",
      "pdf",
      "memorial",
      "arquivo",
      "file",
      "material",
      "brochure",
      "download",
      "price",
      "pricing",
      "pricetable",
      "price_table"
    ];

    // =====================================================
    // 4. VARREDURA RECURSIVA
    // =====================================================

    const matches = [];

    function inspect(
      value,
      path = "root",
      depth = 0
    ) {
      if (
        value === null ||
        value === undefined ||
        depth > 20
      ) {
        return;
      }

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        const text =
          String(value)
            .toLowerCase();

        const found =
          terms.filter(
            term =>
              text.includes(
                term
              )
          );

        if (found.length) {
          matches.push({
            path,
            terms:
              found,
            value:
              String(value)
                .slice(0, 1000)
          });
        }

        return;
      }

      if (Array.isArray(value)) {
        value.forEach(
          (
            item,
            index
          ) => {
            inspect(
              item,
              `${path}[${index}]`,
              depth + 1
            );
          }
        );

        return;
      }

      if (
        typeof value === "object"
      ) {
        for (
          const [
            key,
            child
          ] of Object.entries(value)
        ) {
          const keyText =
            String(key)
              .toLowerCase();

          const foundInKey =
            terms.filter(
              term =>
                keyText.includes(
                  term
                )
            );

          if (
            foundInKey.length
          ) {
            matches.push({
              path:
                `${path}.${key}`,
              terms:
                foundInKey,
              value:
                typeof child === "object"
                  ? "[object/array]"
                  : String(child)
                      .slice(0, 1000)
            });
          }

          inspect(
            child,
            `${path}.${key}`,
            depth + 1
          );
        }
      }
    }

    inspect(
      buildingData,
      "building"
    );

    // =====================================================
    // 5. RESPOSTA
    // =====================================================

    return res.status(200).json({
      ok: true,

      building_id:
        buildingId,

      auth:
        "client_credentials",

      matches_found:
        matches.length,

      matches
    });

  } catch (error) {
    console.error(
      "ORULO_MATERIALS_DEBUG_FATAL",
      error
    );

    return res.status(500).json({
      ok: false,

      error:
        error?.message ||
        String(error),

      stack:
        process.env.NODE_ENV ===
        "development"
          ? error?.stack
          : undefined
    });
  }
}
