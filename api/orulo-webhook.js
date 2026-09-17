export default async function handler(req, res) {
  // =========================================================
  // ÓRULO WEBHOOK — RECEPTOR V1
  // Recebe e valida notificações da Órulo.
  // NÃO altera Supabase nesta versão.
  // =========================================================

  res.setHeader("Cache-Control", "no-store");

  // A Órulo envia os eventos via POST.
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const payload = req.body;

    // ---------------------------------------------------------
    // 1. VALIDAÇÃO BÁSICA DO PAYLOAD
    // ---------------------------------------------------------

    if (!payload || typeof payload !== "object") {
      console.warn("ORULO_WEBHOOK_INVALID_BODY");

      return res.status(200).json({
        ok: true,
        received: false,
        reason: "invalid_body"
      });
    }

    const eventName = payload.name || null;
    const eventDate = payload.date || null;

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

    // ---------------------------------------------------------
    // 2. REGISTRO DO EVENTO
    // ---------------------------------------------------------

    console.log("ORULO_WEBHOOK_RECEIVED", {
      eventName,
      eventDate,
      buildingId,
      status,
      clientId
    });

    // ---------------------------------------------------------
    // 3. EVENTO SEM BUILDING ID
    // ---------------------------------------------------------

    if (buildingId === null) {
      console.warn(
        "ORULO_WEBHOOK_MISSING_BUILDING_ID",
        payload
      );

      // Respondemos 200 para confirmar recebimento.
      // Nenhuma alteração é feita.
      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        reason: "missing_building_id"
      });
    }

    // ---------------------------------------------------------
    // 4. STATUS SUPORTADOS PELA DOCUMENTAÇÃO ÓRULO
    // ---------------------------------------------------------

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

    // ---------------------------------------------------------
    // 5. V1 — SOMENTE RECEBIMENTO
    // ---------------------------------------------------------
    //
    // Nesta primeira versão NÃO:
    // - consulta a API Órulo
    // - altera properties
    // - altera Supabase
    // - executa sync
    //
    // Primeiro validamos o recebimento real do webhook.
    // ---------------------------------------------------------

    console.log("ORULO_WEBHOOK_VALID", {
      buildingId,
      status,
      clientId
    });

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
    console.error(
      "ORULO_WEBHOOK_FATAL",
      error
    );

    // A documentação da Órulo considera qualquer resposta
    // diferente de 200 como falha de recebimento.
    //
    // Nesta V1 de homologação priorizamos confirmar o recebimento
    // e registrar o erro no log, sem modificar dados.
    return res.status(200).json({
      ok: true,
      received: true,
      processed: false,
      reason: "internal_validation_error"
    });
  }
}
