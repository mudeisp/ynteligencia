export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  const praediumUrl = process.env.PRAEDIUM_WEBHOOK_URL;
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!praediumUrl) {
    return res.status(500).json({
      success: false,
      error: "PRAEDIUM_WEBHOOK_URL não configurada"
    });
  }

  try {
    let body=req.body || {};
    if(typeof body==="string"){
      try{body=JSON.parse(body);}catch{
        return res.status(400).json({success:false,error:"JSON inválido"});
      }
    }
    if(!body || typeof body!=="object" || Array.isArray(body)){
      return res.status(400).json({success:false,error:"Dados inválidos"});
    }
    const name=body.nome || body.name || "";
    const phone=body.telefone || body.phone || "";
    if(typeof name!=="string" || typeof phone!=="string" ||
       !name.trim() || phone.replace(/\D/g,"").length<10 ||
       phone.replace(/\D/g,"").length>15){
      return res.status(400).json({success:false,error:"Informe nome e telefone válido"});
    }

    /* ==========================================
       DADOS DO LEAD + ATRIBUIÇÃO
    ========================================== */

    const payload = {
      nome: body.nome || body.name || "",
      telefone: body.telefone || body.phone || "",
      email: body.email || "",

      origem:
        body.origem ||
        "ynteligencia",

      empreendimento:
        body.empreendimento ||
        body.property_name ||
        "",

      mensagem:
        body.mensagem || "",

      pagina:
        body.pagina || "",

      gclid:
        body.gclid || "",

      gbraid:
        body.gbraid || "",

      wbraid:
        body.wbraid || "",

      utm_source:
        body.utm_source || "",

      utm_medium:
        body.utm_medium || "",

      utm_campaign:
        body.utm_campaign || "",

      utm_content:
        body.utm_content || "",

      utm_term:
        body.utm_term || ""
    };


    /* ==========================================
       1. ENVIA PARA O PRAEDIUM
    ========================================== */

    const response = await fetch(
      praediumUrl,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify(payload)
      }
    );


    const responseText =
      await response.text();


    let crmResult=null;
    try{crmResult=JSON.parse(responseText);}catch{}
    const explicitlyRejected=crmResult && typeof crmResult==="object" &&
      (crmResult.success===false || crmResult.ok===false);
    if (!response.ok || explicitlyRejected) {

      console.error(
        "Praedium error:",
        response.status
      );

      return res.status(502).json({
        success: false,
        error:
          "Praedium recusou o lead",
        status:
          response.status
      });
    }


    console.log("Webhook Praedium aceitou o envio", {status:response.status});


    /* ==========================================
       2. ENVIA ALERTA POR E-MAIL
    ========================================== */

    let emailSent = false;


    if (resendApiKey) {

      try {

        const emailResponse =
          await fetch(
            "https://api.resend.com/emails",
            {
              method: "POST",

              headers: {
                "Authorization":
                  `Bearer ${resendApiKey}`,

                "Content-Type":
                  "application/json"
              },

              body: JSON.stringify({

                from:
                  "Ynteligencia <leads@yincorp.com.br>",

                to: [
                  "contato.yincorp@gmail.com"
                ],

                subject:
                  `🔥 Novo lead Ynteligencia — ${
                    payload.empreendimento ||
                    "Imóvel"
                  }`,

                html: `
                  <div style="
                    font-family:Arial,sans-serif;
                    max-width:620px;
                    margin:auto;
                    color:#182232;
                    line-height:1.6;
                  ">

                    <div style="
                      background:#101a2b;
                      color:#ffffff;
                      padding:24px;
                      border-radius:14px 14px 0 0;
                    ">

                      <div style="
                        color:#ff914d;
                        font-size:12px;
                        font-weight:bold;
                        letter-spacing:1px;
                      ">
                        YNTELIGENCIA
                      </div>

                      <h1 style="
                        margin:8px 0 0;
                        font-size:25px;
                      ">
                        🔥 Novo lead
                      </h1>

                    </div>


                    <div style="
                      border:1px solid #e2e6eb;
                      border-top:0;
                      padding:24px;
                      border-radius:0 0 14px 14px;
                    ">

                      <h2 style="
                        margin-top:0;
                        font-size:20px;
                      ">
                        ${escapeHtml(
                          payload.nome ||
                          "Cliente"
                        )}
                      </h2>


                      <p>

                        <strong>Telefone:</strong>
                        ${escapeHtml(
                          payload.telefone ||
                          "Não informado"
                        )}

                        <br>

                        <strong>E-mail:</strong>
                        ${escapeHtml(
                          payload.email ||
                          "Não informado"
                        )}

                      </p>


                      <hr style="
                        border:0;
                        border-top:1px solid #e2e6eb;
                        margin:22px 0;
                      ">


                      <p>
                        <strong>Imóvel:</strong><br>

                        ${escapeHtml(
                          payload.empreendimento ||
                          "Não informado"
                        )}
                      </p>


                      <p>
                        <strong>Jornada do comprador:</strong><br>

                        ${escapeHtml(
                          payload.mensagem ||
                          "Não informada"
                        )}
                      </p>


                      <hr style="
                        border:0;
                        border-top:1px solid #e2e6eb;
                        margin:22px 0;
                      ">


                      <div style="
                        background:#f5f6f8;
                        padding:16px;
                        border-radius:10px;
                      ">

                        <div style="
                          font-size:12px;
                          font-weight:bold;
                          color:#697487;
                          margin-bottom:8px;
                        ">
                          ATRIBUIÇÃO DO LEAD
                        </div>


                        <p style="margin:0;">

                          <strong>GCLID:</strong>
                          ${escapeHtml(
                            payload.gclid ||
                            "Não informado"
                          )}

                          <br>

                          <strong>GBRAID:</strong>
                          ${escapeHtml(
                            payload.gbraid ||
                            "Não informado"
                          )}

                          <br>

                          <strong>WBRAID:</strong>
                          ${escapeHtml(
                            payload.wbraid ||
                            "Não informado"
                          )}

                          <br><br>

                          <strong>UTM Source:</strong>
                          ${escapeHtml(
                            payload.utm_source ||
                            "Não informado"
                          )}

                          <br>

                          <strong>UTM Medium:</strong>
                          ${escapeHtml(
                            payload.utm_medium ||
                            "Não informado"
                          )}

                          <br>

                          <strong>UTM Campaign:</strong>
                          ${escapeHtml(
                            payload.utm_campaign ||
                            "Não informado"
                          )}

                          <br>

                          <strong>UTM Content:</strong>
                          ${escapeHtml(
                            payload.utm_content ||
                            "Não informado"
                          )}

                          <br>

                          <strong>UTM Term:</strong>
                          ${escapeHtml(
                            payload.utm_term ||
                            "Não informado"
                          )}

                          <br><br>

                          <strong>Página:</strong>
                          ${escapeHtml(
                            payload.pagina ||
                            "Não informada"
                          )}

                        </p>

                      </div>


                      <hr style="
                        border:0;
                        border-top:1px solid #e2e6eb;
                        margin:22px 0;
                      ">


                      <p style="
                        margin-bottom:0;
                        color:#697487;
                        font-size:12px;
                      ">
                        Lead capturado pela Ynteligencia e enviado ao Praedium.
                      </p>

                    </div>

                  </div>
                `
              })
            }
          );


        const emailResponseText =
          await emailResponse.text();


        if (!emailResponse.ok) {

          console.error(
            "Resend error:",
            emailResponse.status
          );

        } else {

          emailSent = true;

          console.log(
            "Alerta Ynteligencia enviado por e-mail."
          );
        }


      } catch (emailError) {

        /*
          IMPORTANTE:
          falha no e-mail NÃO invalida o lead.

          O Praedium já recebeu.
        */

        console.error(
          "Erro ao enviar alerta pelo Resend:",
          emailError
        );
      }


    } else {

      console.warn(
        "RESEND_API_KEY não configurada. Lead enviado ao Praedium sem alerta por e-mail."
      );
    }


    /* ==========================================
       3. CONFIRMA PARA O FRONT-END
    ========================================== */

    return res.status(200).json({

      success: true,

      // Confirma aceite do webhook; não presume ID de contato no CRM.
      praedium: true,
      delivery_status: "webhook_accepted",

      email_sent:
        emailSent,

      tracking: {

        gclid:
          !!payload.gclid,

        gbraid:
          !!payload.gbraid,

        wbraid:
          !!payload.wbraid
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


/* ==========================================
   PROTEÇÃO DO HTML DO E-MAIL
========================================== */

function escapeHtml(value) {

  return String(value ?? "")

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")

    .replace(/"/g, "&quot;")

    .replace(/'/g, "&#039;");
}
