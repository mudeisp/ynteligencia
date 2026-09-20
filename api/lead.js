export default async function handler(req, res) {
  const allowedOrigins = new Set([
    "https://app.yincorp.com.br",
    "https://www.yincorp.com.br",
    "https://yincorp.com.br"
  ]);

  const origin = req.headers.origin || "";

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");

  /*
   * ==========================================
   * CORS PREFLIGHT
   * ==========================================
   */

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  /*
   * ==========================================
   * SOMENTE POST
   * ==========================================
   */

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  /*
   * ==========================================
   * BLOQUEIA ORIGENS NÃO AUTORIZADAS
   * ==========================================
   */

  if (
    origin &&
    !allowedOrigins.has(origin)
  ) {
    return res.status(403).json({
      success: false,
      error: "Origin not allowed"
    });
  }

  try {

    /*
     * ==========================================
     * BODY
     * ==========================================
     */

    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          success: false,
          error: "JSON inválido"
        });
      }
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return res.status(400).json({
        success: false,
        error: "Dados inválidos"
      });
    }

    /*
     * ==========================================
     * NORMALIZAÇÃO
     * APP + LPs
     * ==========================================
     */

    const nome = clean(
      body.nome ||
      body.name ||
      ""
    );

    const telefone = cleanPhone(
      body.telefone ||
      body.phone ||
      ""
    );

    const email = clean(
      body.email ||
      ""
    );

    const origem = clean(
      body.origem ||
      body.source ||
      "ynteligencia"
    );

    const empreendimento = clean(
      body.empreendimento ||
      body.property_name ||
      body.property ||
      ""
    );

    const perfil = clean(
      body.perfil ||
      body.profile ||
      ""
    );

    const pagina = clean(
      body.pagina ||
      body.page ||
      ""
    );

    /*
     * ==========================================
     * TRACKING
     * ==========================================
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
     * ==========================================
     * MENSAGEM
     * ==========================================
     */

    const mensagem = clean(

      body.mensagem ||

      [
        empreendimento
          ? `Imóvel: ${empreendimento}`
          : "",

        perfil
          ? `Perfil: ${perfil}`
          : "",

        body.property_id
          ? `Código: ${body.property_id}`
          : "",

        body.neighborhood
          ? `Bairro: ${body.neighborhood}`
          : "",

        body.property_value
          ? `Valor: ${body.property_value}`
          : "",

        body.match_score
          ? `MATCH: ${body.match_score}%`
          : ""

      ]
        .filter(Boolean)
        .join(" | ")

    );

    /*
     * ==========================================
     * VALIDAÇÃO
     * ==========================================
     */

    if (
      !nome ||
      telefone.length < 10 ||
      telefone.length > 15
    ) {

      return res.status(400).json({

        success: false,

        error:
          "Informe nome e telefone válido"

      });

    }

    /*
     * ==========================================
     * PAYLOAD CENTRAL
     * ==========================================
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

      ...tracking,

      property_id:
        clean(
          body.property_id ||
          ""
        ),

      property_value:
        Number(
          body.property_value ||
          0
        ) || 0,

      neighborhood:
        clean(
          body.neighborhood ||
          ""
        ),

      match_score:
        Number(
          body.match_score ||
          0
        ) || 0,

      session_id:
        clean(
          body.session_id ||
          ""
        )

    };

    /*
     * ==========================================
     * 1. PRAEDIUM
     * ==========================================
     */

    const praediumUrl =
      process.env.PRAEDIUM_WEBHOOK_URL ||
      process.env.PRAEDIUM_URL;

    let praediumOk = false;
    let praediumStatus = null;

    if (praediumUrl) {

      try {

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
                JSON.stringify({

                  /*
                   * Compatibilidade antiga
                   */
                  Nome:
                    nome,

                  WhatsApp:
                    telefone,

                  /*
                   * Campos novos
                   */
                  nome,
                  telefone,
                  email,
                  origem,
                  empreendimento,
                  perfil,
                  mensagem,
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

                })

            }

          );

        praediumStatus =
          praediumResponse.status;

        const responseText =
          await praediumResponse.text();

        let crmResult = null;

        try {
          crmResult =
            JSON.parse(
              responseText
            );
        } catch {}

        const rejected =

          crmResult &&

          typeof crmResult === "object" &&

          (
            crmResult.success === false ||
            crmResult.ok === false
          );

        praediumOk =

          praediumResponse.ok &&

          !rejected;

        if (!praediumOk) {

          console.error(

            "Praedium error:",

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
          "Erro Praedium:",
          error
        );

      }

    } else {

      console.warn(
        "PRAEDIUM_WEBHOOK_URL/PRAEDIUM_URL não configurada."
      );

    }

    /*
     * ==========================================
     * 2. SUPABASE
     * ==========================================
     */

    const supabaseUrl =
      process.env.SUPABASE_URL;

    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    let supabaseOk = false;

    if (
      supabaseUrl &&
      supabaseKey
    ) {

      try {

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
                JSON.stringify({

                  name:
                    nome,

                  email:
                    email,

                  phone:
                    telefone,

                  status:
                    "novo",

                  lead_score:
                    payload.match_score,

                  destination:
                    "yincorp",

                  notes:
                    mensagem ||
                    `Lead capturado em ${origem}`,

                  session_id:
                    payload.session_id ||
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

                    attribution: {

                      ...tracking,

                      landing_page:
                        pagina

                    },

                    property: {

                      id:
                        payload.property_id,

                      name:
                        empreendimento,

                      neighborhood:
                        payload.neighborhood,

                      value:
                        payload.property_value,

                      match_score:
                        payload.match_score

                    }

                  }

                })

            }

          );

        supabaseOk =
          supabaseResponse.ok;

        if (!supabaseResponse.ok) {

          console.error(

            "Supabase error:",

            supabaseResponse.status,

            await supabaseResponse.text()

          );

        } else {

          console.log(

            "SUPABASE_OK",

            {
              origem,
              empreendimento
            }

          );

        }

      } catch (error) {

        console.error(
          "Erro Supabase:",
          error
        );

      }

    } else {

      console.warn(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurada."
      );

    }

    /*
     * ==========================================
     * 3. RESEND
     * ==========================================
     */

    const resendApiKey =
      process.env.RESEND_API_KEY;

    let emailSent = false;

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
                    `Novo lead | ${
                      empreendimento ||
                      origem
                    }`,

                  html:
                    buildEmail({

                      nome,
                      telefone,
                      email,
                      origem,
                      empreendimento,
                      perfil,
                      mensagem,
                      pagina,
                      tracking,
                      praediumOk,
                      supabaseOk

                    })

                })

            }

          );

        emailSent =
          emailResponse.ok;

        if (!emailResponse.ok) {

          console.error(

            "Resend error:",

            emailResponse.status,

            await emailResponse.text()

          );

        } else {

          console.log(
            "RESEND_OK"
          );

        }

      } catch (error) {

        console.error(
          "Erro Resend:",
          error
        );

      }

    } else {

      console.warn(
        "RESEND_API_KEY não configurada."
      );

    }

    /*
     * ==========================================
     * RESPOSTA
     * ==========================================
     */

    return res.status(200).json({

      success: true,

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
      "Lead API error:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "Erro interno ao enviar lead"

    });

  }

}


/*
 * ==========================================
 * HELPERS
 * ==========================================
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


function cleanPhone(value) {

  return String(
    value ?? ""
  )

    .replace(
      /\D/g,
      ""
    );

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


function buildEmail({

  nome,
  telefone,
  email,
  origem,
  empreendimento,
  perfil,
  mensagem,
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
        color:#fff;
        padding:22px;
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
          margin:7px 0 0;
        ">

          Novo lead

        </h2>

      </div>

      <div style="
        border:1px solid #ddd;
        border-top:0;
        padding:22px;
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
