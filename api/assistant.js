export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // =========================================================
  // TESTE DE SAÚDE
  // =========================================================

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
    // =======================================================
    // CONFIGURAÇÃO
    // =======================================================

    const apiKey =
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "OPENAI_API_KEY não configurada na Vercel"
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

    // =======================================================
    // CONTEXTO DO IMÓVEL
    // =======================================================

    const propertyContext =
      JSON.stringify(
        property,
        null,
        2
      ).slice(0, 18000);

    const instructions = `
Você é a Match IA, assistente imobiliária do app Ynteligencia.

Você está conversando com uma pessoa que está olhando UM imóvel específico.

Seu papel é conversar como uma boa consultora imobiliária:
natural, objetiva, inteligente, simpática e sem pressão.

REGRA PRINCIPAL

Responda primeiro e diretamente ao que a pessoa perguntou.

Exemplo:

Cliente:
"Qual é o bairro?"

Resposta:
"Esse imóvel fica em Vila Anastácio."

Não aproveite uma pergunta simples para falar de assuntos que não foram perguntados.

DADOS

Use somente os dados fornecidos no contexto do imóvel.

Você pode usar informações como:

- nome do empreendimento;
- bairro;
- cidade;
- endereço;
- preço;
- área;
- dormitórios;
- suítes;
- vagas;
- incorporadora;
- descrição;
- características;
- estoque;
- condições de pagamento;
- preço original;
- preço promocional;
- data de atualização;
- status do empreendimento.

Se uma informação não estiver nos dados, diga claramente que ela não consta na ficha.

Nunca invente.

DISPONIBILIDADE

Se perguntarem se existe unidade disponível:

- informe o estoque cadastrado, quando houver;
- informe a data da última atualização, se disponível;
- explique de forma curta que o estoque pode mudar.

Se a pessoa quiser confirmar disponibilidade em tempo real, reserve, negociar ou visitar, termine a resposta com:

[[HANDOFF]]

CONDIÇÕES DE PAGAMENTO

Se houver payment_conditions, explique as condições de maneira simples.

Se houver:
- opportunity;
- original_price;
- discount_price;

use essas informações quando forem relevantes.

Se não houver condição cadastrada, diga:

"Essa condição não consta na ficha que tenho aqui."

Não invente entrada, parcelas ou financiamento.

COMPARAÇÃO

Se a pessoa perguntar o que deveria comparar antes de decidir, analise os dados disponíveis do imóvel.

Pode considerar:

- preço;
- preço por m²;
- metragem;
- número de dormitórios;
- vagas;
- localização;
- estoque;
- estágio do empreendimento;
- condições comerciais.

Não precisa ter outro imóvel disponível para ajudar nessa análise.

PONTOS FORTES

Quando perguntarem os pontos fortes, use concretamente os dados do imóvel e da localização.

Evite respostas genéricas.

ESTILO

- português do Brasil;
- respostas normalmente entre 1 e 4 frases;
- uma pergunta por vez, no máximo;
- não faça interrogatório;
- não repita "posso te ajudar";
- não diga que é ChatGPT;
- não mencione OpenAI;
- seu nome é Match IA.

ATENDIMENTO HUMANO

Use [[HANDOFF]] somente quando houver intenção real de:

- falar com uma pessoa;
- confirmar disponibilidade atual;
- visitar;
- negociar;
- reservar;
- obter condição comercial que não consta na ficha.

DADOS DO IMÓVEL ATUAL:

${propertyContext}
`.trim();

    // =======================================================
    // HISTÓRICO
    // =======================================================

    const safeHistory =
      history
        .filter(
          item =>
            item &&
            ["user", "assistant"]
              .includes(item.role) &&
            String(
              item.content || ""
            ).trim()
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
        );

    const input = [
      ...safeHistory,

      {
        role: "user",
        content: message
      }
    ];

    // =======================================================
    // OPENAI
    // =======================================================

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

              Authorization:
                `Bearer ${apiKey}`
            },

            body:
              JSON.stringify({
                model:
                  "gpt-5.6-luna",

                instructions,

                input,

                reasoning: {
                  effort: "none"
                },

                text: {
                  verbosity: "low"
                },

                max_output_tokens:
                  800
              })
          }
        );

    } finally {
      clearTimeout(timeout);
    }

    // =======================================================
    // RESPOSTA OPENAI
    // =======================================================

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

    // =======================================================
    // EXTRAI TEXTO
    // =======================================================

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

    // =======================================================
    // HANDOFF HUMANO
    // =======================================================

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

    // =======================================================
    // PROTEÇÃO CONTRA RESPOSTA VAZIA
    // =======================================================

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

    // =======================================================
    // SUCESSO
    // =======================================================

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
      error?.name ===
      "AbortError";

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
            ? "A IA demorou mais que o esperado."
            : "Erro interno na assistente"
      });
  }
}
