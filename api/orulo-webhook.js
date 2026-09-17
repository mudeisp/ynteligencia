const SUPABASE_URL = "https://wzaegidwtdjuhqchpdpd.supabase.co";

export default async function handler(req, res) {
  // =========================================================
  // ÓRULO WEBHOOK — V2
  //
  // STATUS:
  // active / added_to_distribution
  //   -> autentica na Órulo
  //   -> busca SOMENTE o building recebido
  //   -> nesta versão NÃO grava no Supabase
  //
  // removed
  //   -> soft delete SOMENTE do building recebido
  //
  // excluded_from_distribution
  //   -> ainda não processado nesta versão
  //
  // IMPORTANTE:
  // NÃO executa sincronização completa.
  // NÃO desativa todo o catálogo.
  // =========================================================

  res.setHeader("Cache-Control", "no-store");

  // =========================================================
  // 1. SOMENTE POST
  // =========================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    // =======================================================
    // 2. PAYLOAD
    // =======================================================

    const payload = req.body;

    if (!payload || typeof payload !== "object") {
      console.warn("ORULO_WEBHOOK_INVALID_BODY");

      return res.status(200).json({
        ok: true,
        received: false,
        processed: false,
        reason: "invalid_body"
      });
    }

    const eventName =
      payload.name || null;

    const eventDate =
      payload.date || null;

    const properties =
      payload.properties &&
      typeof payload.properties === "object"
        ? payload.properties
        : {};

    const buildingId =
      properties.building_id ?? null;

    const status =
      properties.status ?? null;

    const clientId =
      properties.client_id ?? null;

    console.log("ORULO_WEBHOOK_RECEIVED", {
      eventName,
      eventDate,
      buildingId,
      status,
      clientId
    });

    // =======================================================
    // 3. VALIDAÇÃO DO EVENTO
    // =======================================================

    if (buildingId === null) {
      console.warn(
        "ORULO_WEBHOOK_MISSING_BUILDING_ID"
      );

      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        reason: "missing_building_id"
      });
    }

    const supportedStatuses = [
      "active",
      "removed",
      "added_to_distribution",
      "excluded_from_distribution"
    ];

    if (!supportedStatuses.includes(status)) {
      console.warn(
        "ORULO_WEBHOOK_UNKNOWN_STATUS",
        {
          buildingId,
          status
        }
      );

      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        building_id: buildingId,
        status,
        reason: "unsupported_status"
      });
    }

    // =======================================================
    // 4. REMOVED
    //
    // Soft delete SOMENTE das properties pertencentes ao
    // building informado pela Órulo.
    // =======================================================

    if (status === "removed") {
      const supabaseSecretKey =
        process.env.SUPABASE_SECRET_KEY;

      if (!supabaseSecretKey) {
        console.error(
          "ORULO_WEBHOOK_SUPABASE_KEY_MISSING"
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,
          building_id: buildingId,
          status,
          reason: "supabase_not_configured"
        });
      }

      /*
       * O catálogo atual grava:
       *
       * source: "novos"
       *
       * raw_data: {
       *   source: "orulo",
       *   building_id: "80696",
       *   typology_id: "..."
       * }
       *
       * Portanto alteramos SOMENTE esse building.
       */

      const buildingIdEncoded =
        encodeURIComponent(
          String(buildingId)
        );

      const endpoint =
        `${SUPABASE_URL}/rest/v1/properties` +
        `?source=eq.novos` +
        `&raw_data->>building_id=eq.${buildingIdEncoded}`;

      const supabaseResponse =
        await fetch(endpoint, {
          method: "PATCH",

          headers: {
            apikey:
              supabaseSecretKey,

            Authorization:
              `Bearer ${supabaseSecretKey}`,

            "Content-Type":
              "application/json",

            Prefer:
              "return=representation"
          },

          body: JSON.stringify({
            active: false,
            updated_at:
              new Date().toISOString()
          })
        });

      const responseText =
        await supabaseResponse.text();

      if (!supabaseResponse.ok) {
        console.error(
          "ORULO_WEBHOOK_REMOVE_ERROR",
          supabaseResponse.status,
          responseText
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,
          building_id: buildingId,
          status,
          reason: "supabase_update_failed"
        });
      }

      let affectedRows = [];

      try {
        affectedRows =
          JSON.parse(responseText);
      } catch {
        affectedRows = [];
      }

      const affected =
        Array.isArray(affectedRows)
          ? affectedRows.length
          : 0;

      console.log(
        "ORULO_WEBHOOK_REMOVED",
        {
          buildingId,
          affected
        }
      );

      return res.status(200).json({
        ok: true,
        received: true,
        processed: true,
        action: "soft_delete",
        building_id: buildingId,
        status,
        affected
      });
    }

    // =======================================================
    // 5. ACTIVE / ADDED_TO_DISTRIBUTION
    //
    // Nesta V2:
    //
    // 1. autentica na Órulo
    // 2. consulta SOMENTE o building recebido
    // 3. valida a resposta
    //
    // Ainda NÃO grava no Supabase.
    // =======================================================

    if (
      status === "active" ||
      status === "added_to_distribution"
    ) {
      const oruloClientId =
        process.env.ORULO_CLIENT_ID;

      const oruloClientSecret =
        process.env.ORULO_CLIENT_SECRET;

      if (
        !oruloClientId ||
        !oruloClientSecret
      ) {
        console.error(
          "ORULO_WEBHOOK_CREDENTIALS_MISSING"
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,
          building_id: buildingId,
          status,
          reason:
            "orulo_credentials_missing"
        });
      }

      // =====================================================
      // 5.1 AUTENTICAÇÃO ÓRULO
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
                  oruloClientId,

                client_secret:
                  oruloClientSecret,

                grant_type:
                  "client_credentials"
              }).toString()
          }
        );

      let tokenData = {};

      try {
        tokenData =
          await tokenResponse.json();
      } catch {
        tokenData = {};
      }

      if (
        !tokenResponse.ok ||
        !tokenData.access_token
      ) {
        console.error(
          "ORULO_WEBHOOK_AUTH_ERROR",
          tokenResponse.status
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,
          building_id: buildingId,
          status,
          reason: "orulo_auth_failed",
          upstream_status:
            tokenResponse.status
        });
      }

      const accessToken =
        tokenData.access_token;

      // =====================================================
      // 5.2 BUSCA SOMENTE O EMPREENDIMENTO RECEBIDO
      // =====================================================

      const buildingResponse =
        await fetch(
          `https://www.orulo.com.br/api/v2/buildings/${encodeURIComponent(
            String(buildingId)
          )}`,
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              Accept:
                "application/json"
            }
          }
        );

      if (!buildingResponse.ok) {
        console.error(
          "ORULO_WEBHOOK_BUILDING_ERROR",
          buildingId,
          buildingResponse.status
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,
          building_id: buildingId,
          status,
          reason:
            "building_fetch_failed",
          upstream_status:
            buildingResponse.status
        });
      }

      let buildingData = null;

      try {
        buildingData =
          await buildingResponse.json();
      } catch {
        buildingData = null;
      }

      const building =
        buildingData?.building &&
        typeof buildingData.building ===
          "object"
          ? buildingData.building
          : buildingData;

      // =====================================================
      // 5.3 VALIDAÇÃO DA RESPOSTA
      // =====================================================

      if (
        !building ||
        typeof building !== "object"
      ) {
        console.error(
          "ORULO_WEBHOOK_INVALID_BUILDING",
          buildingId
        );

        return res.status(200).json({
          ok: true,
          received: true,
          processed: false,
          building_id: buildingId,
          status,
          reason:
            "invalid_building_response"
        });
      }

      console.log(
        "ORULO_WEBHOOK_BUILDING_FETCHED",
        {
          buildingId,

          name:
            building.name || null,

          finality:
            building.finality || null,

          city:
            building.address?.city ||
            null,

          state:
            building.address?.state ||
            null
        }
      );

      // =====================================================
      // 5.4 V2 — RESULTADO DE VALIDAÇÃO
      //
      // Nenhuma property é modificada aqui.
      // =====================================================

      return res.status(200).json({
        ok: true,
        received: true,

        // Ainda false porque não fizemos o upsert.
        processed: false,

        action:
          "building_fetched_validation",

        building_id:
          buildingId,

        status,

        client_id:
          clientId,

        building: {
          id:
            building.id ??
            buildingId,

          name:
            building.name ??
            null,

          finality:
            building.finality ??
            null,

          city:
            building.address?.city ??
            null,

          state:
            building.address?.state ??
            null
        }
      });
    }

    // =======================================================
    // 6. EXCLUDED_FROM_DISTRIBUTION
    //
    // Ainda não executamos hard delete.
    // Vamos aguardar também a confirmação da Órulo sobre
    // segurança/autenticação do webhook antes dessa etapa.
    // =======================================================

    if (
      status ===
      "excluded_from_distribution"
    ) {
      console.log(
        "ORULO_WEBHOOK_DISTRIBUTION_EXCLUDED",
        {
          buildingId,
          clientId
        }
      );

      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        building_id: buildingId,
        status,
        client_id: clientId,
        mode: "validation_only"
      });
    }

    // =======================================================
    // 7. FALLBACK DEFENSIVO
    // =======================================================

    return res.status(200).json({
      ok: true,
      received: true,
      processed: false,
      building_id: buildingId,
      status,
      client_id: clientId,
      mode: "validation_only"
    });

  } catch (error) {
    // =======================================================
    // 8. ERRO INTERNO
    //
    // A Órulo exige HTTP 200 como confirmação de recebimento.
    // Nesta fase registramos o erro sem provocar alteração
    // adicional no catálogo.
    // =======================================================

    console.error(
      "ORULO_WEBHOOK_FATAL",
      error
    );

    return res.status(200).json({
      ok: true,
      received: true,
      processed: false,
      reason: "internal_error"
    });
  }
}
