export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

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

    const history =
      Array.isArray(body.history)
        ? body.history.slice(-10)
        : [];

    const property =
      body.property &&
      typeof body.property === "object"
        ? body.property
        : {};

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
            ["user", "assistant"].includes(
              item.role
            )
        )

        .map(
          item => ({
            role:
              item.role,

            content:
              String(
                item.content || ""
              ).slice(0, 1800)
          })
        );

    const propertyContext =
      JSON.stringify(
        property,
        null,
        2
      ).slice(0, 12000);

    const instructions = `
Você é a Match IA, concierge imobiliária da Ynteligencia.

Converse em português do Brasil, de forma curta, clara, útil e humana.

Seu contexto é UM imóvel que o cliente está vendo agora no app.

Use somente os dados fornecidos abaixo como fatos sobre esse imóvel.

Não invente disponibilidade, desconto, condição comercial, financiamento, prazo, metragem, endereço ou estoque.

Se a disponibilidade ou condição de hoje não estiver explicitamente confirmada nos dados, diga que precisa ser confirmada com o atendimento humano.

OBJETIVOS:

1. Responder dúvidas sobre o imóvel atual.

2. Entender o que importa para o comprador:
- orçamento
- dormitórios
- região
- novo/usado
- morar/investir

3. Ajudar a comparar e organizar a decisão.

4. Quando houver intenção concreta de confirmar disponibilidade, negociar, visitar ou falar com alguém, ofereça encaminhar para o Rafael.

REGRAS DE CONVERSA:

- Faça no máximo uma pergunta por resposta.

- Prefira respostas de 2 a 5 frases.

- Não pressione o usuário a deixar contato.

- Não diga que é ChatGPT nem mencione OpenAI.

Você é "Match IA".

- Se o usuário pedir pessoa humana, visita, negociação, reserva, disponibilidade atual ou confirmação comercial, termine sua resposta com o marcador exato:

[[HANDOFF]]

- Só use [[HANDOFF]] quando fizer sentido real encaminhar.

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

    const response =
      await fetch(
        "https://api.openai.com/v1/responses",

        {
          method: "POST",

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
                350,

              reasoning: {
                effort: "low"
              },

              text: {
                verbosity: "low"
              }
            })
        }
      );

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
          "Falha ao consultar a IA"
      });
    }

    let reply = "";

    if (
      typeof data.output_text ===
      "string"
    ) {
      reply =
        data.output_text;

    } else if (
      Array.isArray(
        data.output
      )
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
        "Posso te ajudar a entender melhor este imóvel ou organizar uma comparação com outras opções.";
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

    return res.status(500).json({
      success: false,
      error:
        "Erro interno na assistente"
    });
  }
}
