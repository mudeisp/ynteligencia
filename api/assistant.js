export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Match IA",
      openai_key_configured: Boolean(
        process.env.OPENAI_API_KEY
      )
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const apiKey =
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "OPENAI_API_KEY não configurada"
      });
    }

    const body =
      req.body || {};

    const message =
      String(
        body.message || ""
      ).trim();

    const property =
      body.property &&
      typeof body.property === "object"
        ? body.property
        : {};

    const history =
      Array.isArray(body.history)
        ? body.history.slice(-12)
        : [];

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Mensagem vazia"
      });
    }

    const propertyContext =
      JSON.stringify(
        property,
        null,
        2
      ).slice(0, 18000);


    const systemPrompt = `
Você é a Match IA, assistente imobiliária dentro do app Ynteligencia.

Você está conversando com uma pessoa que está olhando um imóvel específico.

FALE COMO UMA BOA CONSULTORA IMOBILIÁRIA.

Seja:
- natural;
- direta;
- simpática;
- útil;
- sem pressão comercial.

IMPORTANTE:

Responda EXATAMENTE ao que a pessoa perguntou.

Exemplo:

Pergunta:
"Qual é o bairro?"

Resposta:
"Esse imóvel fica em Vila Anastácio."

Não aproveite uma pergunta simples para falar de estoque, condições ou outros assuntos que não foram perguntados.

Se a resposta estiver nos dados do imóvel, responda diretamente.

Se não estiver nos dados, diga claramente que essa informação não consta na ficha.

Não invente informações.

Você pode usar:
- nome do imóvel;
- bairro;
- endereço;
- preço;
- metragem;
- dormitórios;
- vagas;
- estoque;
- condições;
- incorporadora;
- características;
- descrição;
- datas;
- localização.

DISPONIBILIDADE

Quando perguntarem se está disponível:
- informe o estoque cadastrado, se houver;
- diga que é o estoque da última atualização;
- não prometa disponibilidade em tempo real.

Se a pessoa quiser confirmação em tempo real, visita, reserva ou negociação, finalize com:

[[HANDOFF]]

CONDIÇÕES

Se houver condições comerciais nos dados, explique de forma simples.

Se não houver, diga:
"Essa condição não consta na ficha que tenho aqui."

E ofereça o atendimento humano apenas se fizer sentido.

CONVERSA

- Respostas curtas: normalmente 1 a 4 frases.
- Faça no máximo uma pergunta por resposta.
- Não faça interrogatório.
- Não repita "posso te ajudar".
- Não diga que é ChatGPT.
- Não mencione OpenAI.
- Seu nome é Match IA.

DADOS DO IMÓVEL:

${propertyContext}
`.trim();


    const messages = [
      {
        role: "system",
        content: systemPrompt
      },

      ...history
        .filter(
          item =>
            item &&
            ["user", "assistant"]
              .includes(item.role)
        )
        .map(
          item => ({
            role:
              item.role,

            content:
              String(
                item.content || ""
              ).slice(0, 2000)
          })
        ),

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
          "https://api.openai.com/v1/chat/completions",

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

                messages,

                max_completion_tokens:
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
        JSON.stringify(data)
      );

      return res.status(502).json({
        success: false,

        error:
          data?.error?.message ||
          `OpenAI HTTP ${response.status}`
      });
    }


    let reply =
      data?.choices?.[0]
        ?.message?.content || "";


    reply =
      String(reply)
        .trim();


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

      console.error(
        "MATCH_IA_EMPTY_REPLY",
        JSON.stringify(data)
      );

      return res.status(502).json({
        success: false,
        error:
          "A IA não retornou texto"
      });
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


    const timeout =
      error?.name ===
      "AbortError";


    return res
      .status(
        timeout
          ? 504
          : 500
      )
      .json({

        success: false,

        error:
          timeout
            ? "A IA demorou mais que o esperado."
            : "Erro interno na assistente"
      });
  }
}
