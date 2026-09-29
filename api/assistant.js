const SUPABASE_URL =
  "https://wzaegidwtdjuhqchpdpd.supabase.co";


// =========================================================
// SUPABASE
// =========================================================

function supabaseHeaders() {
  const key =
    process.env.SUPABASE_SECRET_KEY;

  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY_MISSING"
    );
  }

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}


// =========================================================
// NORMALIZA RESULTADOS DO ESTOQUE
// =========================================================

function normalizeInventoryRow(row) {
  const raw =
    row?.raw_data &&
    typeof row.raw_data === "object"
      ? row.raw_data
      : {};

  const building =
    raw?.building &&
    typeof raw.building === "object"
      ? raw.building
      : {};

  const typology =
    raw?.typology &&
    typeof raw.typology === "object"
      ? raw.typology
      : {};

  return {
    id:
      row.external_id ||
      row.id ||
      "",

    building_id:
      raw.building_id ||
      building.id ||
      "",

    empreendimento:
      row.development_name ||
      building.name ||
      row.title ||
      "",

    titulo:
      row.title ||
      "",

    bairro:
      row.neighborhood ||
      building?.address?.area ||
      "",

    cidade:
      row.city ||
      building?.address?.city ||
      "",

    preco:
      Number(row.price) ||
      Number(typology.discount_price) ||
      Number(typology.original_price) ||
      0,

    preco_original:
      Number(typology.original_price) ||
      0,

    preco_promocional:
      Number(typology.discount_price) ||
      0,

    area:
      Number(row.area) ||
      Number(typology.private_area) ||
      0,

    dormitorios:
      Number(row.bedrooms) ||
      Number(typology.bedrooms) ||
      0,

    suites:
      Number(typology.suites) ||
      0,

    banheiros:
      Number(row.bathrooms) ||
      Number(typology.bathrooms) ||
      0,

    vagas:
      Number(row.parking_spaces) ||
      Number(typology.parking) ||
      0,

    estoque_tipologia:
      Number(typology.stock) ||
      0,

    estoque_empreendimento:
      Number(building.stock) ||
      0,

    status:
      building.stage ||
      building.status ||
      "",

    endereco:
      building.address ||
      null,

    atualizado_em:
      building.last_updated_pricetable_at ||
      typology.updated_at ||
      building.updated_at ||
      "",

    source:
      row.source ||
      ""
  };
}


// =========================================================
// CONSULTA ESTOQUE
// =========================================================

async function searchInventory(
  args,
  currentProperty
) {
  const relation =
    String(
      args?.relation ||
      "similar"
    );

  const currentBuildingId =
    String(
      currentProperty?.building_id ||
      ""
    ).trim();

  const currentNeighborhood =
    String(
      currentProperty?.neighborhood ||
      ""
    ).trim();

  const currentId =
    String(
      currentProperty?.id ||
      ""
    ).trim();


  const params =
    new URLSearchParams();

  params.set(
    "select",
    [
      "external_id",
      "development_name",
      "title",
      "neighborhood",
      "city",
      "state",
      "price",
      "bedrooms",
      "bathrooms",
      "parking_spaces",
      "area",
      "source",
      "active",
      "raw_data"
    ].join(",")
  );

  params.set(
    "source",
    "eq.novos"
  );

  params.set(
    "active",
    "eq.true"
  );


  // =======================================================
  // MESMO EMPREENDIMENTO / MESMO ENDEREÇO
  // =======================================================

  if (
    (
      relation === "same_building" ||
      relation === "same_address"
    ) &&
    currentBuildingId
  ) {
    params.set(
      "raw_data->>building_id",
      `eq.${currentBuildingId}`
    );
  }


  // =======================================================
  // MESMO BAIRRO
  // =======================================================

  else if (
    (
      relation === "same_neighborhood" ||
      relation === "similar"
    ) &&
    currentNeighborhood
  ) {
    params.set(
      "neighborhood",
      `eq.${currentNeighborhood}`
    );
  }


  // =======================================================
  // BAIRRO EXPLICITAMENTE PEDIDO
  // =======================================================

  if (
    args?.neighborhood
  ) {
    params.set(
      "neighborhood",
      `eq.${String(
        args.neighborhood
      ).trim()}`
    );
  }


  // =======================================================
  // DORMITÓRIOS
  // =======================================================

  const bedrooms =
    Number(
      args?.bedrooms
    );

  if (
    Number.isFinite(bedrooms) &&
    bedrooms > 0
  ) {
    params.set(
      "bedrooms",
      `eq.${bedrooms}`
    );
  }


  // =======================================================
  // PREÇO
  // =======================================================

  const minPrice =
    Number(
      args?.min_price
    );

  const maxPrice =
    Number(
      args?.max_price
    );

  if (
    Number.isFinite(minPrice) &&
    minPrice > 0
  ) {
    params.set(
      "price",
      `gte.${minPrice}`
    );
  }

  if (
    Number.isFinite(maxPrice) &&
    maxPrice > 0
  ) {
    /*
      PostgREST não permite duas chaves iguais em URLSearchParams
      com set(). Por isso usamos append para o segundo filtro.
    */
    if (
      params.has("price")
    ) {
      params.append(
        "price",
        `lte.${maxPrice}`
      );
    } else {
      params.set(
        "price",
        `lte.${maxPrice}`
      );
    }
  }


  // =======================================================
  // ÁREA
  // =======================================================

  const minArea =
    Number(
      args?.min_area
    );

  const maxArea =
    Number(
      args?.max_area
    );

  if (
    Number.isFinite(minArea) &&
    minArea > 0
  ) {
    params.set(
      "area",
      `gte.${minArea}`
    );
  }

  if (
    Number.isFinite(maxArea) &&
    maxArea > 0
  ) {
    if (
      params.has("area")
    ) {
      params.append(
        "area",
        `lte.${maxArea}`
      );
    } else {
      params.set(
        "area",
        `lte.${maxArea}`
      );
    }
  }


  // =======================================================
  // ORDENAÇÃO
  // =======================================================

  const sort =
    String(
      args?.sort ||
      ""
    );

  if (
    sort === "cheapest"
  ) {
    params.set(
      "order",
      "price.asc.nullslast"
    );
  }

  else if (
    sort === "most_expensive"
  ) {
    params.set(
      "order",
      "price.desc.nullslast"
    );
  }

  else if (
    sort === "largest"
  ) {
    params.set(
      "order",
      "area.desc.nullslast"
    );
  }

  else {
    params.set(
      "order",
      "price.asc.nullslast"
    );
  }


  params.set(
    "limit",
    "15"
  );


  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/properties?${params.toString()}`,
      {
        method: "GET",
        headers:
          supabaseHeaders()
      }
    );


  const text =
    await response.text();


  if (!response.ok) {
    console.error(
      "MATCH_IA_INVENTORY_ERROR",
      response.status,
      text
    );

    throw new Error(
      `INVENTORY_HTTP_${response.status}`
    );
  }


  let rows = [];

  try {
    rows =
      JSON.parse(text);
  } catch {
    rows = [];
  }


  if (
    !Array.isArray(rows)
  ) {
    rows = [];
  }


  let normalized =
    rows.map(
      normalizeInventoryRow
    );


  // Remove da busca o imóvel atual,
  // quando houver outras opções.
  const withoutCurrent =
    normalized.filter(
      item =>
        String(item.id) !==
        currentId
    );


  if (
    withoutCurrent.length
  ) {
    normalized =
      withoutCurrent;
  }


  return {
    search_type:
      relation,

    current_property_id:
      currentId,

    current_building_id:
      currentBuildingId,

    total_found:
      normalized.length,

    properties:
      normalized.slice(0, 12)
  };
}


// =========================================================
// EXTRAÇÃO DA RESPOSTA
// =========================================================

function extractOutputText(data) {
  if (
    typeof data?.output_text ===
    "string"
  ) {
    return data.output_text.trim();
  }

  let text = "";

  if (
    Array.isArray(
      data?.output
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
          text +=
            part.text;
        }
      }
    }
  }

  return text.trim();
}


// =========================================================
// HANDLER
// =========================================================

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  // =======================================================
  // HEALTH CHECK
  // =======================================================

  if (
    req.method === "GET"
  ) {
    return res
      .status(200)
      .json({
        ok: true,

        service:
          "Match IA",

        openai_key_configured:
          Boolean(
            process.env
              .OPENAI_API_KEY
          ),

        supabase_configured:
          Boolean(
            process.env
              .SUPABASE_SECRET_KEY
          ),

        inventory_search:
          true
      });
  }


  if (
    req.method !== "POST"
  ) {
    return res
      .status(405)
      .json({
        success: false,
        error:
          "Method not allowed"
      });
  }


  try {
    // =====================================================
    // CONFIG
    // =====================================================

    const apiKey =
      process.env
        .OPENAI_API_KEY;


    if (!apiKey) {
      return res
        .status(500)
        .json({
          success: false,

          error:
            "OPENAI_API_KEY não configurada"
        });
    }


    if (
      !process.env
        .SUPABASE_SECRET_KEY
    ) {
      return res
        .status(500)
        .json({
          success: false,

          error:
            "SUPABASE_SECRET_KEY não configurada"
        });
    }


    // =====================================================
    // INPUT
    // =====================================================

    const body =
      req.body || {};


    const message =
      String(
        body.message ||
        ""
      ).trim();


    const property =
      body.property &&
      typeof body.property ===
        "object"
        ? body.property
        : {};


    const history =
      Array.isArray(
        body.history
      )
        ? body.history
            .slice(-12)
        : [];


    if (!message) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Mensagem vazia"
        });
    }


    // =====================================================
    // CONTEXTO
    // =====================================================

    const propertyContext =
      JSON.stringify(
        property,
        null,
        2
      ).slice(
        0,
        18000
      );


    const instructions = `
Você é a Match IA, assistente imobiliária do Ynteligencia.

Você conversa com uma pessoa que está olhando um imóvel específico.

Você não é apenas uma assistente que lê uma ficha.

Você também consegue pesquisar o estoque imobiliário da Ynteligencia usando a ferramenta search_inventory.

CONVERSA

Converse naturalmente, como uma excelente consultora imobiliária.

Responda primeiro ao que foi perguntado.

Não force roteiros.

Não faça interrogatório.

Não diga que é ChatGPT.

Não mencione OpenAI.

Seu nome é Match IA.

Normalmente responda em 1 a 5 frases.

BUSCA NO ESTOQUE

Sempre use search_inventory quando a pergunta exigir saber se existem OUTROS imóveis ou unidades.

Exemplos:

- "Tem outras unidades nesse endereço?"
- "Tem outra planta?"
- "Tem uma unidade maior?"
- "Tem uma mais barata?"
- "Tem 2 dormitórios nesse prédio?"
- "Tem outra unidade nesse empreendimento?"
- "O que mais tem nesse condomínio?"
- "Tem outras opções no bairro?"
- "Tem algo parecido?"
- "Tem até 700 mil?"
- "Tem outro apartamento com mais metragem?"

Para perguntas sobre:

"mesmo endereço",
"mesmo prédio",
"mesmo condomínio",
"mesmo empreendimento",
"outras unidades"

prefira relation = "same_building".

Se o cliente pedir outras opções no bairro:
relation = "same_neighborhood".

Se pedir opções parecidas:
relation = "similar".

A ferramenta devolve dados REAIS cadastrados no estoque.

Nunca diga que não existem outras unidades antes de consultar a ferramenta quando a pergunta for sobre estoque.

DEPOIS DA BUSCA

Explique os resultados de forma humana.

Não despeje JSON.

Exemplo:

"Sim. Encontrei outras 3 opções nesse empreendimento. A mais barata tem 31 m² e 1 dormitório por R$ 620 mil; também há uma de 48 m² com 2 dormitórios por R$ 810 mil."

Depois você pode fazer uma pergunta útil, como:

"Quer que eu compare essas opções com a unidade que você está vendo?"

Não invente unidades que não vieram da ferramenta.

DISPONIBILIDADE

Estoque cadastrado não é garantia de disponibilidade neste exato minuto.

Quando houver stock, diga que é o estoque informado na última atualização.

Se o cliente quiser confirmação comercial em tempo real, visita, reserva ou negociação, finalize com:

[[HANDOFF]]

IMÓVEL ATUAL

${propertyContext}
`.trim();


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
                2000
              )
          })
        );


    const initialInput = [
      ...safeHistory,

      {
        role:
          "user",

        content:
          message
      }
    ];


    // =====================================================
    // TOOL
    // =====================================================

    const tools = [
      {
        type:
          "function",

        name:
          "search_inventory",

        description:
          "Pesquisa o estoque real da Ynteligencia no Supabase. Use para encontrar outras unidades do mesmo empreendimento/endereço, imóveis do mesmo bairro, unidades mais baratas/maiores, opções por dormitórios ou imóveis semelhantes.",

        strict:
          true,

        parameters: {
          type:
            "object",

          properties: {
            relation: {
              type:
                "string",

              enum: [
                "same_building",
                "same_address",
                "same_neighborhood",
                "similar"
              ],

              description:
                "Relação dos imóveis procurados com o imóvel que o usuário está vendo."
            },

            neighborhood: {
              type: [
                "string",
                "null"
              ]
            },

            bedrooms: {
              type: [
                "integer",
                "null"
              ]
            },

            min_price: {
              type: [
                "number",
                "null"
              ]
            },

            max_price: {
              type: [
                "number",
                "null"
              ]
            },

            min_area: {
              type: [
                "number",
                "null"
              ]
            },

            max_area: {
              type: [
                "number",
                "null"
              ]
            },

            sort: {
              type:
                "string",

              enum: [
                "relevance",
                "cheapest",
                "most_expensive",
                "largest"
              ]
            }
          },

          required: [
            "relation",
            "neighborhood",
            "bedrooms",
            "min_price",
            "max_price",
            "min_area",
            "max_area",
            "sort"
          ],

          additionalProperties:
            false
        }
      }
    ];


    // =====================================================
    // PRIMEIRA CHAMADA
    // =====================================================

    const firstResponse =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

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

              input:
                initialInput,

              tools,

              tool_choice:
                "auto",

              reasoning: {
                effort:
                  "none"
              },

              text: {
                verbosity:
                  "low"
              },

              max_output_tokens:
                900
            })
        }
      );


    const firstData =
      await firstResponse
        .json()
        .catch(
          () => ({})
        );


    if (
      !firstResponse.ok
    ) {
      console.error(
        "OPENAI_ASSISTANT_ERROR",
        firstResponse.status,
        JSON.stringify(
          firstData
        )
      );

      return res
        .status(502)
        .json({
          success:
            false,

          error:
            firstData
              ?.error
              ?.message ||
            `OpenAI HTTP ${firstResponse.status}`
        });
    }


    // =====================================================
    // PROCURA FUNCTION CALLS
    // =====================================================

    const functionCalls =
      Array.isArray(
        firstData.output
      )
        ? firstData.output.filter(
            item =>
              item?.type ===
                "function_call" &&
              item?.name ===
                "search_inventory"
          )
        : [];


    // =====================================================
    // SEM TOOL = RESPOSTA DIRETA
    // =====================================================

    if (
      !functionCalls.length
    ) {
      let reply =
        extractOutputText(
          firstData
        );


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
        return res
          .status(502)
          .json({
            success:
              false,

            error:
              "A IA não retornou texto"
          });
      }


      return res
        .status(200)
        .json({
          success:
            true,

          reply,

          handoff,

          inventory_search:
            false
        });
    }


    // =====================================================
    // EXECUTA AS BUSCAS
    // =====================================================

    const toolOutputs = [];


    for (
      const call
      of functionCalls
    ) {
      let args = {};

      try {
        args =
          JSON.parse(
            call.arguments ||
            "{}"
          );
      } catch {
        args = {
          relation:
            "similar"
        };
      }


      let result;

      try {
        result =
          await searchInventory(
            args,
            property
          );
      } catch (error) {
        console.error(
          "MATCH_IA_TOOL_ERROR",
          error
        );

        result = {
          error:
            "Não foi possível consultar o estoque agora.",

          properties:
            [],

          total_found:
            0
        };
      }


      toolOutputs.push({
        type:
          "function_call_output",

        call_id:
          call.call_id,

        output:
          JSON.stringify(
            result
          )
      });
    }


    // =====================================================
    // SEGUNDA CHAMADA COM RESULTADO DO ESTOQUE
    // =====================================================

    const secondInput = [
      ...initialInput,
      ...firstData.output,
      ...toolOutputs
    ];


    const secondResponse =
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
                "gpt-5.6-luna",

              instructions,

              input:
                secondInput,

              tools,

              tool_choice:
                "none",

              reasoning: {
                effort:
                  "none"
              },

              text: {
                verbosity:
                  "low"
              },

              max_output_tokens:
                1100
            })
        }
      );


    const secondData =
      await secondResponse
        .json()
        .catch(
          () => ({})
        );


    if (
      !secondResponse.ok
    ) {
      console.error(
        "OPENAI_ASSISTANT_SECOND_ERROR",
        secondResponse.status,
        JSON.stringify(
          secondData
        )
      );

      return res
        .status(502)
        .json({
          success:
            false,

          error:
            secondData
              ?.error
              ?.message ||
            `OpenAI HTTP ${secondResponse.status}`
        });
    }


    let reply =
      extractOutputText(
        secondData
      );


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
        "MATCH_IA_EMPTY_SECOND_REPLY",
        JSON.stringify(
          secondData
        )
      );

      return res
        .status(502)
        .json({
          success:
            false,

          error:
            "A IA não retornou texto após consultar o estoque"
        });
    }


    return res
      .status(200)
      .json({
        success:
          true,

        reply,

        handoff,

        inventory_search:
          true
      });


  } catch (error) {
    console.error(
      "ASSISTANT_FATAL",
      error
    );


    return res
      .status(500)
      .json({
        success:
          false,

        error:
          error?.message ||
          "Erro interno na assistente"
      });
  }
}
