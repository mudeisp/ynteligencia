export async function notifyWhatsAppLead({url,key,lead}) {
    async function notificationState(receiptId = null) {
      const response = await fetch(`${url}/rest/v1/rpc/whatsapp_email_state`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contact_lead_id: lead.lead_id, receipt_id: receiptId }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error("notification_state_failed");
      return response.json();
    }
    const state = await notificationState();
    if (state.email_id) return state.email_id;
    // Resend idempotency expires after 24h. Ambiguous old attempts require review.
    if (!Number.isFinite(Date.parse(state.first_attempt_at)) ||
        Date.now() - Date.parse(state.first_attempt_at) >= 23 * 60 * 60 * 1000) {
      throw new Error("notification_requires_review");
    }

    const email = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `whatsapp-lead/${lead.lead_id}`
      },
      body: JSON.stringify({
        from: "Ynteligencia <leads@yincorp.com.br>",
        to: ["contato.yincorp@gmail.com"],
        subject: state.source === "whatsapp_pre_registration" ? "Novo pré-cadastro — WhatsApp" : "Novo lead recebido pelo WhatsApp",
        text: `WhatsApp: ${state.phone}\n${state.source === "whatsapp_pre_registration" ? "Pré-cadastro no site" : "Primeira mensagem"}: ${state.first_message_at}\nRegistro: ${lead.lead_id}`
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!email.ok) throw new Error("notification_failed");
    const receipt = await email.json();
    if (typeof receipt.id !== "string" || !receipt.id) throw new Error("receipt_missing");
    await notificationState(receipt.id);
    return receipt.id;
}
