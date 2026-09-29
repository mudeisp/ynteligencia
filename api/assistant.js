export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Match IA",
      openai_key_configured: Boolean(process.env.OPENAI_API_KEY)
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "OPENAI_API_KEY não configurada na Vercel"
      });
    }

    const body = req.body || {};

    const message =
      String(body.message || "").trim();

    const property =
      body.property &&
      typeof body.property === "object"
        ? body.property
        : {};

    const history =
      Array.isArray(body.history)
        ? body.history.slice(-16)
        : [];

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Mensagem vazia"
      });
    }

    const safeHistory =
      history
        .filter(
          item =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            String(item.content || "").trim()
        )
        .map(
          item => ({
            role: item.role,
            content: String(
              item.content || ""
            ).slice(0, 2200)
          })
        );

    const propertyContext =
      JSON.stringify(
        property,
        null,
        2
      ).slice(0, 16000);

    const instructions = `
Você é a Match IA, assistente de compra imobiliária dentro do app Ynteligencia.

Seu papel não é parecer um chatbot de atendimento.

Converse como uma boa consultora imobiliária:
natural, objetiva, inteligente e sem pressão.

CONTEXTO

O cliente está olhando um imóvel específico.

Os dados desse imóvel estão no final destas instruções.

COMO CONVERSAR

- Responda primeiro a pergunta do cliente.

- Depois, se ajudar, faça UMA pergunta curta para avançar a conversa.

- Use português do Brasil.

- Evite repetir frases como "posso te ajudar".

- Não faça interrogatório.

- Não peça telefone ou WhatsApp sem motivo.

- Não diga que é ChatGPT.

- Não mencione OpenAI.

- Seu nome é Match IA.

- Prefira respostas de 2 a 5 frases.

DISPONIBILIDADE

- Se houver availability.typology_stock ou availability.building_stock maior que zero, diga claramente quantas unidades constam na ficha.

- Se houver data de atualização, informe que é o estoque da última atualização disponível.

- Não diga que está disponível agora sem confirmação humana.

- Se o cliente pedir confirmação atual, reserva ou unidade específica, termine com:

[[HANDOFF]]

CONDIÇÕES COMERCIAIS

- Leia:

commercial.payment_conditions
commercial.opportunity
commercial.original_price
commercial.discount_price

- Se houver dados, explique-os antes de oferecer atendimento humano.

- Nunca invente entrada, parcela, financiamento ou desconto.

- Se não houver condições na ficha, diga isso naturalmente.

COMPARAÇÃO

- Você pode ajudar o comprador a pensar sobre metragem, valor, bairro, dormitórios e perfil do imóvel.

- Se ele pedir outras opções e você não tiver outros imóveis no contexto, pergunte qual prioridade ele quer preservar.

INTENÇÃO COMERCIAL

Use [[HANDOFF]] somente quando o cliente:

- pedir humano;
- quiser visitar;
- quiser negociar;
- quiser reservar;
- quiser confirmar disponibilidade em tempo real;
- pedir uma condição que não esteja nos dados.

Quando usar [[HANDOFF]], explique naturalmente por que vale falar com o Rafael.

DADOS DO IMÓVEL ATUAL:

${propertyContext}
`.trim();

    const input = [
      ...safeHistory,

      {
        role: "user",
        content: message
      }
    ];

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        25000
      );

    let response;

    try {
      response =
        await fetch(
          "https://api.openai.com/v1/responses",

          {
            method: "POST",

            signal:
              controller.signal,

            headers: {
              "Content-Type":
                "application/json",

              "Authorization":
                `Bearer ${apiKey}`
            },

            body:
              JSON.stringify({
                model:
                  "gpt-5-mini",

                instructions,

                input,

                max_output_tokens:
                  500
              })
          }
        );

    } finally {
      clearTimeout(timeout);
    }

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      console.error(
        "OPENAI_ASSISTANT_ERROR",
        response.status,
        data
      );

      return res.status(502).json({
        success: false,

        error:
          data?.error?.message ||
          `OpenAI respondeu com HTTP ${response.status}`
      });
    }

    let reply = "";

    if (
      typeof data.output_text ===
      "string"
    ) {
      reply =
        data.output_text;
    }

    if (
      !reply &&
      Array.isArray(data.output)
    ) {
      for (
        const item of
        data.output
      ) {
        if (
          !Array.isArray(
            item?.content
          )
        ) {
          continue;
        }

        for (
          const part of
          item.content
        ) {
          if (
            typeof part?.text ===
            "string"
          ) {
            reply +=
              part.text;
          }
        }
      }
    }

    reply =
      String(
        reply || ""
      ).trim();

    const handoff =
      reply.includes(
        "[[HANDOFF]]"
      );

    reply =
      reply
        .replace(
          /\[\[HANDOFF\]\]/g,
          ""
        )
        .trim();

    if (!reply) {
      reply =
        "Me diz o que você quer entender deste imóvel — preço, disponibilidade, condições ou se vale comparar com outra opção.";
    }

    return res.status(200).json({
      success: true,
      reply,
      handoff
    });

  } catch (error) {

    console.error(
      "ASSISTANT_FATAL",
      error
    );

    const isTimeout =
      error?.name === "AbortError";

    return res
      .status(
        isTimeout
          ? 504
          : 500
      )
      .json({
        success: false,

        error:
          isTimeout
            ? "A IA demorou mais que o esperado. Tente novamente."
            : "Erro interno na assistente"
      });
  }
}
