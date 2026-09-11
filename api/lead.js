export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const praediumUrl = process.env.PRAEDIUM_WEBHOOK_URL;

  if (!praediumUrl) {
    return res.status(500).json({
      success: false,
      error: "PRAEDIUM_WEBHOOK_URL não configurada"
    });
  }

  try {
    const body = req.body || {};

    const payload = {
      nome: body.nome || body.name || "",
      telefone: body.telefone || body.phone || "",
      email: body.email || "",
      origem: body.origem || "ynteligencia",
      empreendimento:
        body.empreendimento ||
        body.property_name ||
        "",
      mensagem: body.mensagem || ""
    };

    const response = await fetch(praediumUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        "Praedium error:",
        response.status,
        responseText
      );

      return res.status(502).json({
        success: false,
        error: "Praedium recusou o lead",
        status: response.status
      });
    }

    return res.status(200).json({
      success: true
    });

  } catch (error) {
    console.error("Lead API error:", error);

    return res.status(500).json({
      success: false,
      error: "Erro interno ao enviar lead"
    });
  }
}
