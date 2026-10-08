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

    const conversationIntent =
      detectConversationIntent(
        message,
        history
      );

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

    function normalizeIntentText(value) {
      return cleanText(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    }

    function detectConversationIntent(
      message,
      history = []
    ) {
      const joined = [
        ...history
          .filter(
            item =>
              item?.role === "user"
          )
          .slice(-5)
          .map(
            item =>
              item?.content || ""
          ),

        message || ""
      ]
        .join(" ")
        .slice(-7000);

      const t =
        normalizeIntentText(
          joined
        );

      const human =
        /\b(falar com (uma )?pessoa|falar com corretor|falar com rafael|atendimento humano|humano|me chama no whatsapp|whatsapp)\b/
          .test(t);

      const visit =
        /\b(agendar visita|marcar visita|quero visitar|posso visitar|gostaria de visitar|visitar o imovel|ver o imovel pessoalmente)\b/
          .test(t);

      const availability =
        /\b(esta disponivel|ainda esta disponivel|tem unidade disponivel|tem disponibilidade|confirmar disponibilidade|essa unidade existe|ainda tem essa unidade)\b/
          .test(t);

      const negotiation =
        /\b(negociar|negociacao|fazer proposta|aceita proposta|tem desconto|consegue desconto|melhor preco|valor negociavel|condicao comercial)\b/
          .test(t);

      const financing =
        /\b(financiamento|financiar|entrada|fgts|parcela|credito imobiliario)\b/
          .test(t);

      const alternatives =
        /\b(outra opcao|outras opcoes|outro imovel|outros imoveis|mais opcoes|algo parecido|parecido com esse|alternativas)\b/
          .test(t);

      const explicitHandoff =
        human ||
        visit ||
        availability ||
        negotiation;

      let temperature =
        "baixa";

      if (
        explicitHandoff
      ) {
        temperature =
          "alta";

      } else if (
        financing ||
        /\b(gostei|me interessei|tenho interesse|quero esse|curti esse)\b/
          .test(t)
      ) {
        temperature =
          "media";
      }

      return {
        human,
        visit,
        availability,
        negotiation,
        financing,
        alternatives,

        explicit_handoff:
          explicitHandoff,

        temperature
      };
    }

    function nextSearchQuestion(
      query = {}
    ) {
      /*
        Se o cliente já buscou um empreendimento pelo nome,
        não faz sentido perguntar região/bairro em seguida.
      */
      if (
        !cleanText(
          query.exact_name
        ) &&
        !cleanText(
          query.neighborhood
        ) &&
        !cleanText(
          query.region
        )
      ) {
        return "Qual região ou bairro você prefere?";
      }

      if (
        !(
          Number(
            query.max_price
          ) > 0
        ) &&
        !(
          Number(
            query.min_price
          ) > 0
        )
      ) {
        return "Qual faixa de preço você quer considerar?";
      }

      if (
        !(
          Number(
            query.bedrooms
          ) > 0
        )
      ) {
        return "Quantos dormitórios você precisa?";
      }

      if (
        !cleanText(
          query.source
        ) ||
        cleanText(
          query.source
        ) === "todos"
      ) {
        return "Você prefere imóvel novo, usado ou tanto faz?";
      }

      return "";
    }

    /*
      ========================================================
      SEARCH MODE
      RESPOSTA DETERMINÍSTICA COM DADOS REAIS
      ========================================================
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
          .filter(
            item =>
              cleanText(
                item?.id
              )
          )
          .slice(
            0,
            5
          );

      const place =
        cleanText(
          inventory.query
            ?.neighborhood
        ) ||
        cleanText(
          matches[0]
            ?.neighborhood
        );

      const reply =
        total === 1
          ? "Encontrei uma opção que combina com sua busca."
          : place
            ? `Encontrei várias opções em ${place}. Separei algumas que combinam melhor com sua busca.`
            : "Encontrei algumas opções que combinam com sua busca.";

      const properties =
        matches.map(
          item => ({
            id:
              cleanText(
                item?.id
              ),

            property_id:
              cleanText(
                item?.id
              ),

            building_id:
              cleanText(
                item?.building_id
              ),

            name:
              cleanText(
                item?.name
              ),

            neighborhood:
              cleanText(
                item?.neighborhood
              ),

            city:
              cleanText(
                item?.city
              ),

            value:
              Number(
                item?.value
              ) || 0,

            bedrooms:
              Number(
                item?.bedrooms
              ) || 0,

            area:
              Number(
                item?.area
              ) || 0,

            source:
              cleanText(
                item?.source
              ),

            image_url:
              item?.image_url ||
              "",

            address:
              item?.address ||
              null
          })
        );

      return res
        .status(200)
        .json({
          success: true,

          reply,

          properties,

          handoff:
            false,

          stage:
            total === 1
              ? "property"
              : "search",

          intent:
            conversationIntent
              .temperature
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
      inventory.inventory_ready !==
        false &&
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
            `Não encontrei uma correspondência exata${suffix}. ${
              Number(
                query.max_price
              ) > 0

                ? "Posso ampliar um pouco o valor máximo mantendo a localização."

                : query.neighborhood

                ? "Posso procurar em bairros próximos mantendo os demais critérios."

                : "Posso ampliar um critério por vez para encontrar alternativas."
            }`,

          handoff:
            false,

          stage:
            "search",

          intent:
            conversationIntent
              .temperature
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

          handoff:
            false
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
      mode ===
      "lead_summary"

        ? `
Você transforma uma conversa imobiliária em um briefing comercial para o corretor.

Use SOMENTE o histórico recebido. Não invente nem complete lacunas.

Escreva em português do Brasil e entregue no máximo 7 linhas, usando estes rótulos quando houver informação:

Busca:
Orçamento:
Perfil:
Preferências:
Imóvel de interesse:
Sinais de intenção:
Próxima ação:

Em "Sinais de intenção", registre apenas fatos como: perguntou disponibilidade, quer visitar, falou de financiamento, negociação, prazo ou urgência.

Em "Próxima ação", use apenas uma ação sustentada pelo histórico, por exemplo "confirmar disponibilidade" ou "agendar visita". Se não houver ação clara, escreva "continuar qualificação".

Não use introdução.
Não faça recomendações de imóvel.
Não invente dados.
Entregue somente o briefing.
`.trim()

        : mode ===
          "search"

        ? `
Você é a Match IA, consultora de compra imobiliária da Ynteligencia.

Seu papel não é preencher um formulário: é conduzir uma conversa comercial útil, curta e natural.

REGRAS:

- Português do Brasil.
- Respostas de 1 a 4 frases.
- Faça no máximo UMA pergunta por resposta.
- Nunca repita pergunta que o cliente já respondeu no histórico.
- Se já houver informação suficiente para pesquisar, não faça perguntas extras.
- Evite frases vazias como "ficarei feliz em ajudar", "claro!" ou apresentações repetidas.
- Não transforme a conversa em interrogatório.
- Não pressione por telefone ou WhatsApp.

ORDEM DE DESCOBERTA, SOMENTE QUANDO FALTAR:

1. região ou bairro;
2. faixa de preço;
3. dormitórios;
4. novo/usado;
5. características relevantes;
6. morar/investir, somente se isso ajudar a decisão.

O estoque real é responsabilidade do sistema.

NUNCA invente:
- imóvel;
- preço;
- disponibilidade;
- desconto;
- condição comercial;
- localização;
- características.

Quando o cliente pedir alternativas, preserve os critérios já informados e trate como continuidade da busca.

Se houver sinal de financiamento/entrada, responda de forma útil, mas não confirme aprovação, taxa ou condição que não esteja nos dados.

Não diga que é ChatGPT.
Não mencione OpenAI.
Você é "Match IA".

Se o cliente pedir atendimento humano, visita, negociação ou confirmação de disponibilidade, termine com:

[[HANDOFF]]
`.trim()

        : `
Você é a Match IA, consultora de compra imobiliária da Ynteligencia.

Converse em português do Brasil como uma boa consultora: curta, clara, natural e objetiva.

Seu contexto é UM imóvel que o cliente está vendo ou acabou de encontrar.

Primeiro responda exatamente o que o cliente perguntou. Só depois, se realmente ajudar a decisão, acrescente uma observação curta.

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
- Prefira respostas de 1 a 4 frases.
- Não repita fatos que o cliente já demonstrou conhecer.
- Não despeje a ficha inteira do imóvel quando ele fizer uma pergunta específica.
- Quando comparar, destaque diferenças objetivas; não invente vantagem.
- Se a informação não estiver nos dados, diga isso em uma frase e siga a conversa.
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

    if (
      !response.ok
    ) {
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

    let reply =
      "";

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
      ) ||
      conversationIntent
        .explicit_handoff ===
        true;

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

    if (
      !reply
    ) {
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

        handoff,

        /*
          Metadados opcionais.
          O frontend atual pode ignorar
          sem quebrar compatibilidade.
        */

        stage:
          mode ===
          "property"

            ? "property"

            : mode ===
              "lead_summary"

            ? "lead_summary"

            : "search",

        intent:
          conversationIntent
            .temperature,

        signals: {
          visit:
            conversationIntent
              .visit,

          availability:
            conversationIntent
              .availability,

          negotiation:
            conversationIntent
              .negotiation,

          financing:
            conversationIntent
              .financing,

          alternatives:
            conversationIntent
              .alternatives
        }
      });

  } catch (
    error
  ) {
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
