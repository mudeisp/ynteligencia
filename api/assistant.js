export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
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

    const history =
      Array.isArray(
        body.history
      )
        ? body.history.slice(-40)
        : [];

    const property =
      body.property &&
      typeof body.property === "object"
        ? body.property
        : {};

    const mode =
      body.mode === "lead_summary"
        ? "lead_summary"
        : body.mode === "search"
        ? "search"
        : "property";

    const inventory =
      body.inventory &&
      typeof body.inventory === "object"
        ? body.inventory
        : null;

    if (
      !message &&
      mode !== "lead_summary"
    ) {
      return res.status(400).json({
        success: false,
        error: "Mensagem vazia"
      });
    }

    /*
      ========================================================
      HELPERS
      ========================================================
    */

    const safeHistory =
      history
        .filter(
          item =>
            item &&
            [
              "user",
              "assistant"
            ].includes(
              item.role
            )
        )
        .map(
          item => ({
            role:
              item.role,

            content:
              String(
                item.content ||
                ""
              ).slice(
                0,
                1800
              )
          })
        );

    function formatMoney(value) {
      const n =
        Number(value);

      if (
        !Number.isFinite(n) ||
        n <= 0
      ) {
        return "";
      }

      return n.toLocaleString(
        "pt-BR",
        {
          style:
            "currency",

          currency:
            "BRL",

          maximumFractionDigits:
            0
        }
      );
    }

    function formatArea(value) {
      const n =
        Number(value);

      if (
        !Number.isFinite(n) ||
        n <= 0
      ) {
        return "";
      }

      return `${n.toLocaleString(
        "pt-BR"
      )} m²`;
    }

    function cleanText(value) {
      return String(
        value || ""
      ).trim();
    }

    /*
      ========================================================
      SEARCH MODE
      RESPOSTA DETERMINÍSTICA COM DADOS REAIS
      ========================================================

      A search-properties já consultou o banco.

      Se temos resultado, não precisamos pedir para a IA
      "inventar" ou interpretar o estoque.

      Ela recebe fatos estruturados.
    */

    if (
      mode === "search" &&
      inventory &&
      inventory.inventory_ready !== false &&
      Number(
        inventory.total
      ) > 0 &&
      Array.isArray(
        inventory.matches
      )
    ) {
      const total =
        Number(
          inventory.total
        ) || 0;

      const matches =
        inventory.matches
          .slice(
            0,
            3
          );

      const items =
        matches.map(
          (
            item,
            index
          ) => {
            const parts =
              [];

            const name =
              cleanText(
                item?.name
              );

            const neighborhood =
              cleanText(
                item?.neighborhood
              );

            const price =
              formatMoney(
                item?.value
              );

            const bedrooms =
              Number(
                item?.bedrooms
              ) || 0;

            const area =
              formatArea(
                item?.area
              );

            if (name) {
              parts.push(
                name
              );
            }

            if (
              neighborhood
            ) {
              parts.push(
                `Bairro: ${neighborhood}`
              );
            }

            if (price) {
              parts.push(
                `Preço: ${price}`
              );
            }

            if (
              bedrooms > 0
            ) {
              parts.push(
                `Dormitórios: ${bedrooms}`
              );
            }

            if (area) {
              parts.push(
                `Área: ${area}`
              );
            }

            return (
              `${index + 1}) ` +
              parts.join(
                " — "
              )
            );
          }
        );

      let reply =
        `Encontrei ${total} ${
          total === 1
            ? "opção"
            : "opções"
        }.`;

      if (
        items.length
      ) {
        reply +=
          " " +
          items.join(
            " "
          );
      }

      /*
        Se encontrou um único imóvel,
        não fazemos pergunta automática.
        O frontend já consegue guardar esse match
        para perguntas como:
        "me manda o link"
        "qual o preço?"
        "qual o endereço?"
      */

      return res
        .status(200)
        .json({
          success: true,
          reply,
          handoff: false
        });
    }

    /*
      ========================================================
      SEARCH MODE
      ZERO RESULTADOS
      ========================================================
    */

    if (
      mode === "search" &&
      inventory &&
      inventory.inventory_ready !== false &&
      inventory.recognized_filters ===
        true &&
      Number(
        inventory.total
      ) === 0
    ) {
      const query =
        inventory.query ||
        {};

      const criteria =
        [];

      if (
        query.exact_name
      ) {
        criteria.push(
          `o empreendimento ${query.exact_name}`
        );
      } else if (
        query.neighborhood
      ) {
        criteria.push(
          query.neighborhood
        );
      }

      if (
        Number(
          query.bedrooms
        ) > 0
      ) {
        criteria.push(
          `${query.bedrooms} dormitório${
            Number(
              query.bedrooms
            ) > 1
              ? "s"
              : ""
          }`
        );
      }

      if (
        Number(
          query.max_price
        ) > 0
      ) {
        criteria.push(
          `até ${formatMoney(
            query.max_price
          )}`
        );
      }

      if (
        Number(
          query.min_price
        ) > 0
      ) {
        criteria.push(
          `a partir de ${formatMoney(
            query.min_price
          )}`
        );
      }

      const suffix =
        criteria.length
          ? ` para ${criteria.join(
              ", "
            )}`
          : "";

      return res
        .status(200)
        .json({
          success: true,

          reply:
            `Não encontrei uma correspondência exata${suffix} na base consultada. Posso ampliar a busca por bairro, preço ou características.`,

          handoff: false
        });
    }

    /*
      ========================================================
      SEARCH MODE
      INVENTÁRIO INDISPONÍVEL
      ========================================================
    */

    if (
      mode === "search" &&
      inventory &&
      inventory.inventory_ready ===
        false
    ) {
      return res
        .status(200)
        .json({
          success: true,

          reply:
            "O estoque ainda está sendo carregado. Tente novamente em alguns instantes.",

          handoff: false
        });
    }

    /*
      ========================================================
      CONTEXTO PROPERTY
      ========================================================
    */

    const propertyContext =
      JSON.stringify(
        property,
        null,
        2
      ).slice(
        0,
        12000
      );

    /*
      ========================================================
      INSTRUÇÕES OPENAI
      ========================================================
    */

    const instructions =
      mode === "lead_summary"
        ? `
Você resume uma conversa imobiliária para um corretor humano.

Use SOMENTE o histórico recebido.

Escreva em português do Brasil.

Produza um resumo comercial curto, com no máximo 6 linhas, contendo apenas o que estiver explícito:

- região/bairro ou empreendimento;
- faixa de preço;
- dormitórios/tipo;
- novo/usado;
- objetivo morar/investir;
- sinais de intenção: disponibilidade, visita, negociação, urgência.

Não invente dados.
Não faça recomendações.
Não use introdução.
Entregue somente o resumo.
`.trim()

        : mode === "search"
        ? `
Você é a Match IA, concierge imobiliária da Ynteligencia.

Converse em português do Brasil, de forma curta, clara, útil e humana.

Nesta modalidade o cliente está procurando imóveis.

IMPORTANTE:

- Quando o sistema tiver resultados do inventário, eles são tratados antes de você ser chamado.
- Portanto, se você está recebendo esta conversa em modo search, normalmente ainda faltam informações suficientes para executar a busca.
- Faça UMA pergunta curta por vez.
- Ajude a descobrir:
  bairro ou região;
  faixa de preço;
  dormitórios;
  tipo;
  novo/usado;
  morar/investir.

Não invente imóveis.
Não invente estoque.
Não invente preço.
Não invente disponibilidade.

Não diga que é ChatGPT.
Não mencione OpenAI.
Você é "Match IA".

Se o cliente pedir atendimento humano, visita ou negociação, termine com:

[[HANDOFF]]
`.trim()

        : `
Você é a Match IA, concierge imobiliária da Ynteligencia.

Converse em português do Brasil, de forma curta, clara, útil e humana.

Seu contexto é UM imóvel que o cliente está vendo ou acabou de encontrar.

Use SOMENTE os dados fornecidos abaixo como fatos sobre esse imóvel.

Não invente:
- disponibilidade;
- desconto;
- condição comercial;
- financiamento;
- prazo;
- metragem;
- endereço;
- estoque;
- link.

Se uma informação não estiver disponível nos dados recebidos, diga apenas que ela não veio cadastrada no resultado atual.

OBJETIVOS:

1. Responder dúvidas sobre o imóvel atual.

2. Ajudar o cliente a entender:
- preço;
- dormitórios;
- área;
- bairro;
- endereço;
- características presentes nos dados.

3. Ajudar a comparar e organizar a decisão.

4. Quando houver intenção concreta de:
- confirmar disponibilidade;
- negociar;
- visitar;
- falar com alguém;

ofereça encaminhar para o Rafael.

REGRAS:

- Faça no máximo uma pergunta por resposta.
- Prefira respostas de 2 a 5 frases.
- Não pressione o cliente a deixar contato.
- Não diga que é ChatGPT.
- Não mencione OpenAI.
- Você é "Match IA".

Se o usuário pedir pessoa humana, visita, negociação, reserva, disponibilidade atual ou confirmação comercial, termine com:

[[HANDOFF]]

DADOS DO IMÓVEL ATUAL:

${propertyContext}
`.trim();

    /*
      ========================================================
      INPUT
      ========================================================
    */

    const input =
      mode ===
      "lead_summary"
        ? safeHistory
        : [
            ...safeHistory,

            {
              role:
                "user",

              content:
                message
            }
          ];

    /*
      ========================================================
      OPENAI
      ========================================================
    */

    const response =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
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
                effort:
                  "low"
              },

              text: {
                verbosity:
                  "low"
              }
            })
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (!response.ok) {
      console.error(
        "OPENAI_ASSISTANT_ERROR",
        response.status,
        data
      );

      return res
        .status(502)
        .json({
          success: false,

          error:
            data?.error
              ?.message ||
            "Falha ao consultar a IA"
        });
    }

    /*
      ========================================================
      EXTRAI TEXTO
      ========================================================
    */

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

    /*
      ========================================================
      HANDOFF
      ========================================================
    */

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

    /*
      ========================================================
      FALLBACK
      ========================================================
    */

    if (!reply) {
      reply =
        mode ===
        "lead_summary"
          ? "Conversa iniciada pela Match IA, sem preferências suficientes para resumir."

          : mode ===
            "search"
          ? "Qual bairro ou região você prefere?"

          : "Posso continuar te ajudando com este imóvel.";
    }

    /*
      ========================================================
      RETURN
      ========================================================
    */

    return res
      .status(200)
      .json({
        success: true,
        reply,
        handoff
      });

  } catch (error) {
    console.error(
      "ASSISTANT_FATAL",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        error:
          "Erro interno na assistente"
      });
  }
}
