const {
  ONESIGNAL_APP_ID,
  ONESIGNAL_REST_API_KEY,
  PUSH_TEST_VISITOR_ID
} = process.env;

function clean(value) {
  return String(value ?? "").trim();
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const visitorId =
    clean(
      req.query?.visitor ||
      req.body?.visitor ||
      PUSH_TEST_VISITOR_ID
    );

  const propertyId =
    clean(
      req.query?.imovel ||
      req.body?.imovel ||
      "orulo:82013:128326"
    );

  if (
    !ONESIGNAL_APP_ID ||
    !ONESIGNAL_REST_API_KEY
  ) {
    return res.status(500).json({
      success: false,
      error:
        "Configure ONESIGNAL_APP_ID e ONESIGNAL_REST_API_KEY na Vercel."
    });
  }

  if (!visitorId) {
    return res.status(400).json({
      success: false,
      error:
        "Informe o visitor_id na URL ou crie PUSH_TEST_VISITOR_ID na Vercel."
    });
  }

  const url =
    `https://app.yincorp.com.br/?imovel=${encodeURIComponent(propertyId)}` +
    `&push=1&visitor=${encodeURIComponent(visitorId)}`;

  const body = {
    app_id: ONESIGNAL_APP_ID,

    target_channel: "push",

    include_aliases: {
      external_id: [
        visitorId
      ]
    },

    headings: {
      en: "Teste Ynteligencia"
    },

    contents: {
      en:
        "Nova oportunidade disponível. Toque para abrir o imóvel."
    },

    url,

    data: {
      property_id: propertyId,
      visitor_id: visitorId,
      push_type: "test"
    }
  };

  try {
    const response =
      await fetch(
        "https://api.onesignal.com/notifications",
        {
          method: "POST",

          headers: {
            Authorization:
              `Key ${ONESIGNAL_REST_API_KEY}`,

            "Content-Type":
              "application/json; charset=utf-8"
          },

          body:
            JSON.stringify(body)
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      return res
        .status(response.status)
        .json({
          success: false,
          onesignal_status:
            response.status,
          onesignal: data
        });
    }

    return res.status(200).json({
      success: true,
      visitor_id: visitorId,
      property_id: propertyId,
      launch_url: url,
      onesignal: data
    });

  } catch (error) {
    console.error(
      "PUSH_TEST_ERROR",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        String(
          error?.message ||
          error
        )
    });
  }
}
