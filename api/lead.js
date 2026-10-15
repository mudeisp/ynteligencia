import crypto from "node:crypto";


export default async function handler(req, res) {

  /*
   * =========================================================
   * API CENTRAL DE LEADS
   * YNTELIGENCIA + LANDING PAGES YINCORP
   * =========================================================
   */


  /*
   * =========================================================
   * CORS
   * =========================================================
   */

  const allowedOrigins = new Set([
    "https://app.yincorp.com.br",
    "https://www.yincorp.com.br",
    "https://yincorp.com.br",
    ...currentDeploymentOrigins()
  ]);


  const origin =
    req.headers.origin || "";


  if (
    origin &&
    allowedOrigins.has(origin)
  ) {

    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );

  }


  res.setHeader(
    "Vary",
    "Origin"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );


  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );


  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  /*
   * =========================================================
   * PREFLIGHT
   * =========================================================
   */

  if (req.method === "OPTIONS") {

    return res
      .status(204)
      .end();

  }


  /*
   * =========================================================
   * SOMENTE POST
   * =========================================================
   */

  if (req.method !== "POST") {

    return res
      .status(405)
      .json({

        success: false,

        error:
          "Method not allowed"

      });

  }


  /*
   * =========================================================
   * BLOQUEIA ORIGENS EXTERNAS
   * =========================================================
   */

  if (
    origin &&
    !allowedOrigins.has(origin)
  ) {

    return res
      .status(403)
      .json({

        success: false,

        error:
          "Origin not allowed"

      });

  }


  try {

    /*
     * =======================================================
     * BODY
     * =======================================================
     */

    let body =
      req.body || {};


    if (
      typeof body === "string"
    ) {

      try {

        body =
          JSON.parse(body);

      } catch {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "JSON inválido"

          });

      }

    }


    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {

      return res
        .status(400)
        .json({

          success: false,

          error:
            "Dados inválidos"

        });

    }


    /*
     * =======================================================
     * NORMALIZAÇÃO
     * APP + LANDING PAGES
     * =======================================================
     */

    const nome =
      clean(

        body.nome ||
        body.name ||
        ""

      );


    const telefone =
      cleanPhone(

        body.telefone ||
        body.phone ||
        ""

      );


    const email =
      clean(

        body.email ||
        ""

      );


    const origem =
      clean(

        body.origem ||
        body.source ||
        "ynteligencia"

      );


    const empreendimento =
      clean(

        body.empreendimento ||
        body.property_name ||
        body.property ||
        ""

      );


    const perfil =
      clean(

        body.perfil ||
        body.profile ||
        ""

      );


    const pagina =
      clean(

        body.pagina ||
        body.page ||
        ""

      );


    /*
     * =======================================================
     * TRACKING
     * =======================================================
     */

    const tracking = {

      gclid:
        clean(
          body.gclid ||
          ""
        ),

      gbraid:
        clean(
          body.gbraid ||
          ""
        ),

      wbraid:
        clean(
          body.wbraid ||
          ""
        ),

      utm_source:
        clean(
          body.utm_source ||
          body.utms?.utm_source ||
          ""
        ),

      utm_medium:
        clean(
          body.utm_medium ||
          body.utms?.utm_medium ||
          ""
        ),

      utm_campaign:
        clean(
          body.utm_campaign ||
          body.utms?.utm_campaign ||
          ""
        ),

      utm_content:
        clean(
          body.utm_content ||
          body.utms?.utm_content ||
          ""
        ),

      utm_term:
        clean(
          body.utm_term ||
          body.utms?.utm_term ||
          ""
        )

    };


    /*
     * =======================================================
     * DADOS DO IMÓVEL
     * =======================================================
     */

    const propertyId =
      clean(
        body.property_id ||
        ""
      );


    const neighborhood =
      clean(
        body.neighborhood ||
        ""
      );


    const propertyValue =
      Number(
        body.property_value ||
        0
      ) || 0;

    const commercialValue =
      commercialValueClause(
        body.property_value
      );


    const matchScore =
      Number(
        body.match_score ||
        0
      ) || 0;


    const sessionId =
      clean(
        body.session_id ||
        ""
      );


    const visitorId =
      clean(
        body.visitor_id ||
        ""
      );


    const leadSummary =
      clean(
        body.lead_summary ||
        ""
      );


    const bedrooms =
      Number(
        body.bedrooms ||
        0
      ) || 0;


    const inventorySource =
      clean(
        body.inventory_source ||
        ""
      );


    const aiContext =
      body.ai_context &&
      typeof body.ai_context === "object" &&
      !Array.isArray(body.ai_context)
        ? body.ai_context
        : null;


    const conversation =
      normalizeConversation(
        body.conversation
      );


    const conversationText =
      conversation.length
        ? conversation
            .map(item =>
              `${item.role === "user" ? "Cliente" : "IA"}: ${item.content}`
            )
            .join("\n")
        : cleanMultiline(
            body.conversation_text ||
            ""
          );


    /*
     * =======================================================
     * MENSAGEM / JORNADA
     * =======================================================
     */

    const mensagemBase =
      clean(

        body.mensagem ||

        [

          empreendimento
            ? `Imóvel: ${empreendimento}`
            : "",

          perfil
            ? `Perfil: ${perfil}`
            : "",

          propertyId
            ? `Código: ${propertyId}`
            : "",

          neighborhood
            ? `Bairro: ${neighborhood}`
            : "",

          commercialValue,

          matchScore
            ? `MATCH: ${matchScore}%`
            : ""

        ]

          .filter(Boolean)

          .join(" | ")

      );


    const mensagem =
      [
        withCommercialValue(
          mensagemBase,
          body.property_value
        ),

        leadSummary
          ? `RESUMO MATCH IA: ${leadSummary}`
          : "",

        !leadSummary && conversationText
          ? `CONVERSA MATCH IA:\n${conversationText}`
          : ""

      ]
        .filter(Boolean)
        .join("\n\n");


    /*
     * =======================================================
     * VALIDAÇÃO
     * =======================================================
     */

    if (
      !nome ||
      telefone.length < 10 ||
      telefone.length > 15
    ) {

      return res
        .status(400)
        .json({

          success: false,

          error:
            "Informe nome e telefone válido"

        });

    }


    /*
     * =======================================================
     * PAYLOAD CENTRAL
     * =======================================================
     */

    const payload = {

      nome,
      telefone,
      email,
      origem,
      empreendimento,
      perfil,
      mensagem,
      pagina,

      property_id:
        propertyId,

      property_value:
        propertyValue,

      neighborhood,

      match_score:
        matchScore,

      session_id:
        sessionId,

      visitor_id:
        visitorId,

      lead_summary:
        leadSummary,

      conversation,

      conversation_text:
        conversationText,

      ...tracking

    };


    /*
     * =======================================================
     * 1. PRAEDIUM
     * =======================================================
     */

    const praediumUrl =

      process.env.PRAEDIUM_WEBHOOK_URL ||

      process.env.PRAEDIUM_URL;


    let praediumOk =
      false;


    let praediumStatus =
      null;

    const ynteligenciaLead =
      isYnteligenciaV2Lead(
        origem
      );


    if (!ynteligenciaLead && praediumUrl) {

      try {

        const praediumPayload = {

          /*
           * Compatibilidade com webhook antigo
           */

          Nome:
            nome,

          WhatsApp:
            telefone,


          /*
           * Campos completos
           */

          nome,

          telefone,

          email,

          origem,

          empreendimento,

          perfil,

          mensagem,

          lead_summary:
            leadSummary,

          observacao:
            leadSummary,

          bedrooms,

          inventory_source:
            inventorySource,

          conversation,

          conversation_text:
            conversationText,

          visitor_id:
            visitorId,

          session_id:
            sessionId,

          pagina,


          /*
           * Tracking
           */

          gclid:
            tracking.gclid,

          gbraid:
            tracking.gbraid,

          wbraid:
            tracking.wbraid,

          utm_source:

            tracking.utm_source ||

            origem,

          utm_medium:
            tracking.utm_medium,

          utm_campaign:
            tracking.utm_campaign,

          utm_content:

            tracking.utm_content ||

            origem,

          utm_term:
            tracking.utm_term

        };


        const praediumResponse =
          await fetch(

            praediumUrl,

            {

              method:
                "POST",

              headers: {

                "Content-Type":
                  "application/json"

              },

              body:
                JSON.stringify(
                  praediumPayload
                )

            }

          );


        praediumStatus =
          praediumResponse.status;


        const responseText =

          await praediumResponse
            .text()
            .catch(
              () => ""
            );


        let crmResult =
          null;


        try {

          crmResult =
            JSON.parse(
              responseText
            );

        } catch {}


        const explicitlyRejected =

          crmResult &&

          typeof crmResult ===
            "object" &&

          (
            crmResult.success === false ||

            crmResult.ok === false
          );


        praediumOk =

          praediumResponse.ok &&

          !explicitlyRejected;


        if (!praediumOk) {

          console.error(

            "PRAEDIUM_ERROR",

            praediumResponse.status,

            responseText

          );

        } else {

          console.log(

            "PRAEDIUM_OK",

            {

              origem,

              empreendimento,

              gclid:

                tracking.gclid

                  ? "capturado"

                  : "ausente"

            }

          );

        }


      } catch (error) {

        console.error(

          "PRAEDIUM_CONNECTION_ERROR",

          error

        );

      }


    } else if (!ynteligenciaLead) {

      console.warn(

        "PRAEDIUM_WEBHOOK_URL/PRAEDIUM_URL não configurada."

      );

    }


    /*
     * =======================================================
     * 2. SUPABASE
     * =======================================================
     */

    const supabaseUrl =

      process.env.SUPABASE_URL;


    const supabaseKey =

      process.env.SUPABASE_SERVICE_ROLE_KEY ||

      process.env.SUPABASE_SECRET_KEY;


    let supabaseOk =
      false;

    let leadConflict =
      false;


    if (
      supabaseUrl &&
      supabaseKey
    ) {

      try {

        const leadEventId =
          logicalLeadEventId(
            body.lead_event_id
          );

        const sessionContext =
          leadSessionContext(
            body.session
          );

        const profileAnswers =
          declaredProfile(
            body.declared_profile
          );

        const touches =
          leadTouches(
            body.touches
          );

        const leadLookup =
          leadEventId
            ? await findOperationalLead(
                supabaseUrl,
                supabaseKey,
                leadEventId,
                sessionId,
                visitorId,
                propertyId
              )
            : "absent";


        if (leadLookup === "match") {

          supabaseOk =
            true;

        } else if (leadLookup === "conflict") {

          leadConflict =
            true;

        } else {

        const supabasePayload = {

          name:
            nome,

          email:
            email,

          phone:
            telefone,

          status:
            "novo",

          lead_score:
            matchScore,

          destination:
            "yincorp",

          notes:

            leadSummary ||

            mensagem ||

            `Lead capturado em ${origem}`,

          session_id:

            sessionId ||

            null,

          metadata: {

            source:
              origem,

            crm:

              praediumOk

                ? "praedium"

                : "pending",

            profile:
              perfil,

            visitor_id:
              visitorId,

            lead_summary:
              leadSummary,

            ai_context:
              aiContext,

            bedrooms,

            inventory_source:
              inventorySource,

            conversation,

            conversation_text:
              conversationText,

            attribution: {

              gclid:
                tracking.gclid,

              gbraid:
                tracking.gbraid,

              wbraid:
                tracking.wbraid,

              utm_source:
                tracking.utm_source,

              utm_medium:
                tracking.utm_medium,

              utm_campaign:
                tracking.utm_campaign,

              utm_content:
                tracking.utm_content,

              utm_term:
                tracking.utm_term,

              landing_page:
                pagina

            },

            property: {

              id:
                propertyId,

              name:
                empreendimento,

              neighborhood,

              value:
                propertyValue,

              match_score:
                matchScore,

              bedrooms,

              source:
                inventorySource

            },

            ...leadCorrelation(

              leadEventId,

              sessionContext,

              profileAnswers,

              touches

            )

          }

        };


        const supabaseResponse =
          await fetch(

            `${supabaseUrl}/rest/v1/leads`,

            {

              method:
                "POST",

              headers: {

                apikey:
                  supabaseKey,

                Authorization:
                  `Bearer ${supabaseKey}`,

                "Content-Type":
                  "application/json",

                Prefer:
                  "return=minimal"

              },

              body:
                JSON.stringify(
                  supabasePayload
                )

            }

          );


        const supabaseText =

          await supabaseResponse
            .text()
            .catch(
              () => ""
            );


        if (!supabaseResponse.ok) {

          console.error(

            "SUPABASE_ERROR",

            supabaseResponse.status,

            supabaseText

          );

        } else {

          supabaseOk =
            true;


          console.log(

            "SUPABASE_OK",

            {

              origem,

              empreendimento,

              gclid:

                tracking.gclid

                  ? "capturado"

                  : "ausente"

            }

          );

        }

        }


      } catch (error) {

        console.error(

          "SUPABASE_CONNECTION_ERROR",

          error

        );

      }


    } else {

      console.warn(

        "SUPABASE_URL/SUPABASE_SECRET_KEY não configurado."

      );

    }


    if (leadConflict) {

      console.warn(
        "SUPABASE_LEAD_EVENT_CONFLICT"
      );

      return res
        .status(409)
        .json({

          success: false,

          error:
            "lead_event_id_conflict",

          supabase: false

        });

    }


    /*
     * =======================================================
     * 3. RESEND / E-MAIL
     * =======================================================
     */

    const resendApiKey =

      process.env.RESEND_API_KEY;


    let emailSent =
      false;

    let emailStatus =
      "missing_api_key";


    if (resendApiKey) {

      try {

        const emailResponse =
          await fetch(

            "https://api.resend.com/emails",

            {

              method:
                "POST",

              headers: {

                Authorization:
                  `Bearer ${resendApiKey}`,

                "Content-Type":
                  "application/json"

              },

              body:
                JSON.stringify({

                  from:
                    "Ynteligencia <leads@yincorp.com.br>",

                  to: [

                    "contato.yincorp@gmail.com"

                  ],

                  subject:

                    ynteligenciaLead

                      ? `Novo lead Match IA — ${
                          neighborhood ||
                          empreendimento ||
                          "Ynteligencia"
                        }`

                      : `Novo lead | ${
                          empreendimento ||
                          origem
                        }`,

                  html:

                    ynteligenciaLead

                      ? buildMatchIaEmail({

                          nome,
                          telefone,
                          email,
                          empreendimento,
                          neighborhood,
                          propertyId,
                          propertyValue:
                            body.property_value,
                          bedrooms,
                          inventorySource,
                          leadSummary,
                          aiContext,
                          sessionId,
                          visitorId,
                          tracking

                        })

                      : buildEmail({

                          nome,

                          telefone,

                          email,

                          origem,

                          empreendimento,

                          perfil,

                          mensagem,

                          leadSummary,

                          conversationText,

                          pagina,

                          tracking,

                          praediumOk,

                          supabaseOk

                        })

                })

            }

          );


        const emailResponseText =

          await emailResponse
            .text()
            .catch(
              () => ""
            );


        if (!emailResponse.ok) {

          emailStatus =
            "provider_rejected";

          console.error(

            "RESEND_ERROR",

            emailResponse.status,

            safeProviderMessage(
              emailResponseText
            )

          );

        } else {

          emailSent =
            true;

          emailStatus =
            "sent";


          console.log(
            "RESEND_OK"
          );

        }


      } catch (error) {

        emailStatus =
          "network_error";

        console.error(

          "RESEND_CONNECTION_ERROR",

          error && error.name
            ? error.name
            : "Error"

        );

      }


    } else {

      console.warn(

        "RESEND_API_KEY não configurada."

      );

    }


    /*
     * =======================================================
     * 4. META CONVERSIONS API
     * =======================================================
     */

    const metaPixelId =

      process.env.META_PIXEL_ID ||

      "1552958819302786";


    const metaToken =

      process.env.META_CAPI_TOKEN;


    let metaOk =
      false;


    if (metaToken) {

      try {

        /*
         * Telefone em formato internacional
         */

        let metaPhone =
          telefone;


        if (
          metaPhone &&
          !metaPhone.startsWith("55")
        ) {

          metaPhone =
            `55${metaPhone}`;

        }


        /*
         * SHA256
         */

        const hashedPhone =

          crypto
            .createHash("sha256")
            .update(metaPhone)
            .digest("hex");


        const hashedName =

          crypto
            .createHash("sha256")
            .update(
              nome
                .toLowerCase()
                .trim()
            )
            .digest("hex");


        const metaPayload = {

          data: [

            {

              event_name:
                "Lead",

              event_time:

                Math.floor(
                  Date.now() / 1000
                ),

              action_source:
                "website",

              event_source_url:

                pagina ||

                undefined,

              user_data: {

                fn:
                  hashedName,

                ph:
                  hashedPhone

              },

              custom_data: {

                content_name:
                  empreendimento,

                profile:
                  perfil,

                source:
                  origem,

                gclid:
                  tracking.gclid,

                utm_source:

                  tracking.utm_source ||

                  "direto",

                utm_medium:

                  tracking.utm_medium ||

                  "none",

                utm_campaign:

                  tracking.utm_campaign ||

                  "none",

                utm_content:

                  tracking.utm_content ||

                  "none",

                utm_term:

                  tracking.utm_term ||

                  "none"

              }

            }

          ]

        };


        const metaResponse =
          await fetch(

            `https://graph.facebook.com/v19.0/${metaPixelId}/events?access_token=${metaToken}`,

            {

              method:
                "POST",

              headers: {

                "Content-Type":
                  "application/json"

              },

              body:
                JSON.stringify(
                  metaPayload
                )

            }

          );


        const metaText =

          await metaResponse
            .text()
            .catch(
              () => ""
            );


        if (!metaResponse.ok) {

          console.error(

            "META_CAPI_ERROR",

            metaResponse.status,

            metaText

          );

        } else {

          metaOk =
            true;


          console.log(
            "META_CAPI_OK"
          );

        }


      } catch (error) {

        console.error(

          "META_CAPI_CONNECTION_ERROR",

          error

        );

      }


    } else {

      console.log(

        "META_CAPI_TOKEN não configurado."

      );

    }


    /*
     * =======================================================
     * RESPOSTA DA API
     * =======================================================
     */

    const leadCaptured =
      supabaseOk ||
      emailSent;

    const success =
      ynteligenciaLead
        ? leadCaptured
        : true;


    return res
      .status(200)
      .json({

        success,

        source:
          origem,

        property:
          empreendimento,

        delivery_status:

          praediumOk

            ? "webhook_accepted"

            : "webhook_not_confirmed",

        praedium:
          praediumOk,

        praedium_status:
          praediumStatus,

        supabase:
          supabaseOk,

        email_sent:
          emailSent,

        email_status:
          emailStatus,

        meta:
          metaOk,

        tracking: {

          gclid:
            !!tracking.gclid,

          gbraid:
            !!tracking.gbraid,

          wbraid:
            !!tracking.wbraid,

          utm_source:
            !!tracking.utm_source,

          utm_medium:
            !!tracking.utm_medium,

          utm_campaign:
            !!tracking.utm_campaign,

          utm_content:
            !!tracking.utm_content,

          utm_term:
            !!tracking.utm_term

        }

      });


  } catch (error) {

    console.error(

      "LEAD_API_ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        error:
          "Erro interno ao enviar lead"

      });

  }

}


/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function clean(value) {

  return String(
    value ?? ""
  )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


function cleanMultiline(value) {

  return String(
    value ?? ""
  )
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

}


function normalizeConversation(value) {

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-200)
    .map(item => {

      const role =
        item?.role === "user"
          ? "user"
          : "assistant";

      const content =
        clean(
          item?.content ||
          ""
        );

      const at =
        clean(
          item?.at ||
          ""
        );

      return {
        role,
        content,
        at
      };

    })
    .filter(item => item.content);

}


function cleanPhone(value) {

  return String(
    value ?? ""
  )

    .replace(
      /\D/g,
      ""
    );

}


function currentDeploymentOrigins() {
  const hosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL
  ];

  return hosts
    .map(host => String(host || "").trim())
    .map(host => host.replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter(Boolean)
    .map(host => `https://${host}`);
}


function isYnteligenciaV2Lead(origem) {
  const value = String(origem || "").trim().toLowerCase();
  return value === "ynteligencia" || value.startsWith("ynteligencia_");
}

function logicalLeadEventId(value) {
  const id = clean(value);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return "";
  return id;
}

function leadText(value, max) {
  const text = clean(value).slice(0, max);
  if (!text || /@|whatsapp|wa\.me|\d{8,}/i.test(text)) return "";
  return text;
}

function leadSessionContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const number = Number(value.number);
  const days = Number(value.days_since_last_visit);
  const previous = clean(value.previous_session_id || "").slice(0, 120);
  const stored = {};
  if (Number.isFinite(number) && number >= 1 && number < 100000) {
    stored.number = Math.floor(number);
  }
  if (typeof value.is_returning === "boolean") stored.is_returning = value.is_returning;
  if (/^[A-Za-z0-9_-]{8,120}$/.test(previous)) stored.previous_session_id = previous;
  if (Number.isFinite(days) && days >= 0 && days < 10000) stored.days_since_last_visit = days;
  return Object.keys(stored).length ? stored : null;
}

function declaredProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const list = items => Array.isArray(items)
    ? items.map(item => leadText(item, 40)).filter(Boolean).slice(0, 12)
    : [];
  const amount = item => {
    const number = Number(item);
    return Number.isFinite(number) && number >= 0 && number < 1e12 ? number : 0;
  };
  const bedrooms = Number(value.bedrooms);
  const stored = {
    purpose: leadText(value.purpose, 40),
    region: leadText(value.region, 80),
    budget: amount(value.budget),
    budget_min: amount(value.budget_min ?? value.budgetMin),
    budget_max: amount(value.budget_max ?? value.budgetMax),
    budget_label: leadText(value.budget_label ?? value.budgetLabel, 40),
    bedrooms: Number.isFinite(bedrooms) ? Math.max(0, Math.min(20, Math.floor(bedrooms))) : null,
    timing: leadText(value.timing, 40),
    types: list(value.types),
    feature: list(value.feature)
  };
  const filled = Object.entries(stored).filter(([, item]) => {
    if (Array.isArray(item)) return item.length > 0;
    return item !== "" && item !== 0 && item !== null;
  });
  return filled.length ? Object.fromEntries(filled) : null;
}

function leadTouch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const attribution = [
    "gclid", "gbraid", "wbraid",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"
  ];
  const context = ["source", "medium", "referrer", "landing_page", "captured_at"];
  const stored = {};
  for (const key of attribution) {
    const text = clean(value[key]).slice(0, 500);
    if (text) stored[key] = text;
  }
  for (const key of context) {
    const text = clean(value[key]).slice(0, 500);
    if (!text || /@|\d{8,}/.test(text)) continue;
    stored[key] = text;
  }
  return Object.keys(stored).length ? stored : null;
}

function leadTouches(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = {
    first_touch: leadTouch(value.first_touch),
    current_touch: leadTouch(value.current_touch),
    previous_touch: leadTouch(value.previous_touch)
  };
  const filled = Object.fromEntries(Object.entries(stored).filter(([, item]) => item));
  return Object.keys(filled).length ? filled : null;
}

function leadCorrelation(leadEventId, sessionContext, profileAnswers, touches) {
  return {
    ...(leadEventId ? { lead_event_id: leadEventId } : {}),
    ...(sessionContext ? { session: sessionContext } : {}),
    ...(profileAnswers ? { declared_profile: profileAnswers } : {}),
    ...(touches ? { touches } : {})
  };
}

function classifyOperationalLead(rows, sessionId, visitorId, propertyId) {
  if (!Array.isArray(rows)) return "unavailable";
  if (rows.length === 0) return "absent";
  const wantedSession = clean(sessionId);
  const wantedVisitor = clean(visitorId);
  const wantedProperty = clean(propertyId);
  const match = rows.some(row =>
    clean(row && row.session_id) === wantedSession &&
    clean(row && row.visitor_id) === wantedVisitor &&
    clean(row && row.property_id) === wantedProperty
  );
  return match ? "match" : "conflict";
}

async function findOperationalLead(supabaseUrl, supabaseKey, leadEventId, sessionId, visitorId, propertyId) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "session_id,visitor_id:metadata->>visitor_id,property_id:metadata->property->>id"
  );
  params.set("metadata->>lead_event_id", `eq.${leadEventId}`);
  params.set("limit", "20");
  const url = `${supabaseUrl}/rest/v1/leads?${params.toString()}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      console.warn("SUPABASE_LEAD_LOOKUP_SKIPPED", response.status);
      return "unavailable";
    }
    const text = await response.text().catch(() => "");
    let rows = null;
    try {
      rows = JSON.parse(text);
    } catch (error) {
      console.warn("SUPABASE_LEAD_LOOKUP_SKIPPED", "invalid_json");
      return "unavailable";
    }
    return classifyOperationalLead(rows, sessionId, visitorId, propertyId);
  } catch (error) {
    console.warn("SUPABASE_LEAD_LOOKUP_ERROR");
    return "unavailable";
  }
}


function commercialValueLabel(value) {
  if (value === null || value === undefined) {
    return "Valor sob consulta";
  }

  const text = String(value).trim();
  if (!text || text === "0" || text === "0.1" || text === "0,1") {
    return "Valor sob consulta";
  }

  const amount = Number(text.replace(",", "."));
  if (!Number.isFinite(amount) || amount < 1) {
    return "Valor sob consulta";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(amount);
}


function commercialValueClause(value) {
  const label = commercialValueLabel(value);
  if (label === "Valor sob consulta") return label;
  return `Valor: ${label}`;
}


function withCommercialValue(message, value) {
  const clause = commercialValueClause(value);
  const text = String(message || "");
  if (!text) return clause;
  if (/Valor:\s*[^|\n]+/.test(text)) {
    return text.replace(/Valor:\s*[^|\n]+/, clause);
  }
  return text;
}


function safeProviderMessage(text) {
  return String(text || "")
    .replace(/re_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 300);
}


function readableLine(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</p>`;
}


function emailValueText(value) {
  const label = commercialValueLabel(value);
  if (label === "Valor sob consulta") return "Sob consulta";
  return label;
}


function matchIaEmailSummary({
  leadSummary,
  neighborhood,
  empreendimento,
  bedrooms,
  search
}) {
  const existing = String(leadSummary || "").trim();
  if (existing) return existing;

  const context = search && typeof search === "object" ? search : {};
  const place = String(context.neighborhood || neighborhood || "").trim();
  const development = String(context.development || "").trim();
  const propertyName = String(empreendimento || "").trim();
  const beds = Number(context.bedrooms) > 0
    ? Number(context.bedrooms)
    : Number(bedrooms) > 0
      ? Number(bedrooms)
      : 0;
  const details = [];

  if (beds > 0) {
    details.push(`de ${beds} dormitório${beds > 1 ? "s" : ""}`);
  }
  if (Number(context.min_price) >= 1) {
    details.push(`a partir de ${commercialValueLabel(context.min_price)}`);
  }
  if (Number(context.max_price) >= 1) {
    details.push(`até ${commercialValueLabel(context.max_price)}`);
  }

  const where = [];
  if (place) where.push(`em ${place}`);
  if (development && development !== propertyName) {
    where.push(`no empreendimento ${development}`);
  }

  const hasSearch = details.length > 0 || where.length > 0;
  if (!hasSearch && !propertyName) return "Sem resumo adicional.";
  if (!hasSearch) return `Cliente demonstrou interesse no ${propertyName}.`;

  const searchText = `Cliente busca imóvel${
    details.length ? ` ${details.join(", ")}` : ""
  }${where.length ? ` ${where.join(", ")}` : ""}`;

  if (propertyName) {
    return `${searchText} e demonstrou interesse no ${propertyName}.`;
  }

  return `${searchText}.`;
}


function buildMatchIaEmail({
  nome,
  telefone,
  email,
  empreendimento,
  neighborhood,
  propertyId,
  propertyValue,
  bedrooms,
  inventorySource,
  leadSummary,
  aiContext,
  sessionId,
  visitorId,
  tracking
}) {
  const search = aiContext && aiContext.search ? aiContext.search : {};
  const opened = Array.isArray(aiContext && aiContext.opened)
    ? aiContext.opened
    : [];
  const others = opened.filter(item =>
    String(item && item.id || "") !== String(propertyId || "")
  );
  const priceLabel = value => {
    if (value === null || value === undefined || value === "") return "";
    return emailValueText(value);
  };
  const range = [
    Number(search.min_price) >= 1
      ? `mínimo ${commercialValueLabel(search.min_price)}`
      : "",
    Number(search.max_price) >= 1
      ? `máximo ${commercialValueLabel(search.max_price)}`
      : ""
  ].filter(Boolean).join(", ");
  const searchInventory = String(search.inventory || "").trim();
  const searchSourceLabel = searchInventory === "novos" || searchInventory === "usados"
    ? searchInventory
    : "";
  const sourceLabel = inventorySource === "novos"
    ? "novos"
    : inventorySource === "usados"
      ? "usados"
      : "";

  const otherLines = others.map(item => {
    const bits = [
      item.name || "Imóvel",
      item.id || "",
      priceLabel(item.value),
      item.neighborhood || "",
      Number(item.bedrooms) > 0 ? `${item.bedrooms} dormitórios` : "",
      item.source || ""
    ].filter(Boolean);
    return `<li>${escapeHtml(bits.join(" · "))}</li>`;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222;line-height:1.55">
      <h2 style="margin:0 0 16px">Novo lead Match IA</h2>
      ${readableLine("Nome", nome)}
      ${readableLine("Telefone", telefone)}
      ${readableLine("E-mail", email)}
      <h3>RESUMO MATCH IA</h3>
      <p>${escapeHtml(matchIaEmailSummary({
        leadSummary,
        neighborhood,
        empreendimento,
        bedrooms,
        search
      }))}</p>
      <h3>Busca</h3>
      ${readableLine("Bairro", search.neighborhood || neighborhood)}
      ${readableLine("Empreendimento", search.development || "")}
      ${readableLine("Preço", range)}
      ${readableLine("Dormitórios", Number(search.bedrooms) > 0 ? String(search.bedrooms) : (Number(bedrooms) > 0 ? String(bedrooms) : ""))}
      ${readableLine("Origem", searchSourceLabel)}
      <h3>Imóvel principal</h3>
      ${readableLine("Nome", empreendimento)}
      ${readableLine("Código", propertyId)}
      ${readableLine("Valor", emailValueText(propertyValue))}
      ${readableLine("Bairro", neighborhood)}
      ${readableLine("Dormitórios", Number(bedrooms) > 0 ? String(bedrooms) : "")}
      ${readableLine("Origem", sourceLabel)}
      ${otherLines ? `<h3>Outros imóveis abertos</h3><ul>${otherLines}</ul>` : ""}
      <h3>Origem</h3>
      ${readableLine("utm_source", tracking && tracking.utm_source)}
      ${readableLine("utm_medium", tracking && tracking.utm_medium)}
      ${readableLine("utm_campaign", tracking && tracking.utm_campaign)}
      ${readableLine("utm_term", tracking && tracking.utm_term)}
      ${readableLine("utm_content", tracking && tracking.utm_content)}
      ${readableLine("gclid", tracking && tracking.gclid)}
      <h3>Sessão</h3>
      ${readableLine("session_id", sessionId)}
      ${readableLine("visitor_id", visitorId)}
    </div>
  `;
}


function escapeHtml(value) {

  return String(
    value ?? ""
  )

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );

}


/*
 * =========================================================
 * TEMPLATE DO E-MAIL
 * =========================================================
 */

function buildEmail({

  nome,

  telefone,

  email,

  origem,

  empreendimento,

  perfil,

  mensagem,

  leadSummary,

  conversationText,

  pagina,

  tracking,

  praediumOk,

  supabaseOk

}) {

  return `

    <div style="
      font-family:Arial,sans-serif;
      max-width:640px;
      margin:auto;
      color:#222;
      line-height:1.6;
    ">

      <div style="
        background:#171717;
        color:#ffffff;
        padding:24px;
      ">

        <div style="
          color:#E4D0A3;
          font-size:12px;
          font-weight:700;
          letter-spacing:1px;
        ">

          YNTELIGENCIA

        </div>

        <h2 style="
          margin:8px 0 0;
        ">

          Novo lead

        </h2>

      </div>


      <div style="
        border:1px solid #dddddd;
        border-top:0;
        padding:24px;
      ">

        <p>

          <strong>
            Nome:
          </strong>

          ${escapeHtml(nome)}

          <br>


          <strong>
            Telefone:
          </strong>

          ${escapeHtml(telefone)}

          <br>


          <strong>
            E-mail:
          </strong>

          ${escapeHtml(
            email ||
            "Não informado"
          )}

          <br>


          <strong>
            Origem:
          </strong>

          ${escapeHtml(origem)}

          <br>


          <strong>
            Imóvel:
          </strong>

          ${escapeHtml(
            empreendimento ||
            "Não informado"
          )}

          <br>


          <strong>
            Perfil:
          </strong>

          ${escapeHtml(
            perfil ||
            "Não informado"
          )}

        </p>


        <hr>


        <p>

          <strong>
            Jornada:
          </strong>

          <br>

          ${escapeHtml(
            mensagem ||
            "Não informada"
          )}

        </p>


        ${
          conversationText
            ? `
              <hr>

              <h3>
                Conversa Match IA
              </h3>

              ${
                leadSummary
                  ? `
                    <p>
                      <strong>Resumo:</strong><br>
                      ${escapeHtml(leadSummary)}
                    </p>
                  `
                  : ""
              }

              <pre style="
                white-space:pre-wrap;
                font-family:Arial,sans-serif;
                font-size:13px;
                line-height:1.55;
                background:#f7f4ed;
                border:1px solid #e4ded3;
                border-radius:10px;
                padding:14px;
              ">${escapeHtml(conversationText)}</pre>
            `
            : ""
        }


        <hr>


        <h3>
          Atribuição
        </h3>


        <p>

          <strong>
            GCLID:
          </strong>

          ${escapeHtml(
            tracking.gclid ||
            "Não informado"
          )}

          <br>


          <strong>
            GBRAID:
          </strong>

          ${escapeHtml(
            tracking.gbraid ||
            "Não informado"
          )}

          <br>


          <strong>
            WBRAID:
          </strong>

          ${escapeHtml(
            tracking.wbraid ||
            "Não informado"
          )}

          <br>


          <strong>
            UTM Source:
          </strong>

          ${escapeHtml(
            tracking.utm_source ||
            "Não informado"
          )}

          <br>


          <strong>
            UTM Medium:
          </strong>

          ${escapeHtml(
            tracking.utm_medium ||
            "Não informado"
          )}

          <br>


          <strong>
            UTM Campaign:
          </strong>

          ${escapeHtml(
            tracking.utm_campaign ||
            "Não informado"
          )}

          <br>


          <strong>
            UTM Content:
          </strong>

          ${escapeHtml(
            tracking.utm_content ||
            "Não informado"
          )}

          <br>


          <strong>
            UTM Term:
          </strong>

          ${escapeHtml(
            tracking.utm_term ||
            "Não informado"
          )}

        </p>


        <hr>


        <p>

          <strong>
            Página:
          </strong>

          <br>

          ${escapeHtml(
            pagina ||
            "Não informada"
          )}

        </p>


        <p>

          <strong>
            Praedium:
          </strong>

          ${
            praediumOk
              ? "Confirmado"
              : "Não confirmado"
          }

          <br>


          <strong>
            Supabase:
          </strong>

          ${
            supabaseOk
              ? "Gravado"
              : "Não confirmado"
          }

        </p>

      </div>

    </div>

  `;

}
