const SUPABASE_URL = "https://wzaegidwtdjuhqchpdpd.supabase.co";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const payload = req.body;

    if (!payload || typeof payload !== "object") {
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

    const buildingId = properties.building_id ?? null;
    const status = properties.status ?? null;
    const clientId = properties.client_id ?? null;

    console.log("ORULO_WEBHOOK_RECEIVED", {
      eventName,
      eventDate,
      buildingId,
      status,
      clientId
    });

    if (buildingId === null) {
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
      return res.status(200).json({
        ok: true,
        received: true,
        processed: false,
        building_id: buildingId,
        status,
        reason: "unsupported_status"
      });
    }

    // =========================================================
    // REMOVED
    // Soft delete somente do empreendimento recebido.
    // =========================================================

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
       * O raw_data atual salva:
       *
       * raw_data: {
       *   source: "orulo",
       *   building_id: "80696",
       *   typology_id: "..."
       * }
       *
       * Portanto filtramos SOMENTE esse building.
       */

      const buildingIdEncoded =
        encodeURIComponent(String(buildingId));

      const endpoint =
        `${SUPABASE_URL}/rest/v1/properties` +
        `?source=eq.novos` +
        `&raw_data->>building_id=eq.${buildingIdEncoded}`;

      const supabaseResponse = await fetch(endpoint, {
        method: "PATCH",

        headers: {
          apikey: supabaseSecretKey,
          Authorization: `Bearer ${supabaseSecretKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },

        body: JSON.stringify({
          active: false,
          updated_at: new Date().toISOString()
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
        affectedRows = JSON.parse(responseText);
      } catch {
        affectedRows = [];
      }

      console.log("ORULO_WEBHOOK_REMOVED", {
        buildingId,
        affected:
          Array.isArray(affectedRows)
            ? affectedRows.length
            : 0
      });

      return res.status(200).json({
        ok: true,
        received: true,
        processed: true,
        action: "soft_delete",
        building_id: buildingId,
        status,
        affected:
          Array.isArray(affectedRows)
            ? affectedRows.length
            : 0
      });
    }

    // =========================================================
    // OUTROS STATUS
    // Ainda não alteram dados nesta etapa.
    // =========================================================

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

    return res.status(200).json({
      ok: true,
      received: true,
      processed: false,
      reason: "internal_error"
    });
  }
}
