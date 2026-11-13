import { timingSafeEqual } from "node:crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const secret = process.env.WHATSAPP_COMMERCIAL_TOKEN;
  if (!secret) return res.status(503).json({ error: "not_configured" });
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(String(req.headers.authorization || ""));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { id, phone, occurredAt, clickRef } = req.body || {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) ||
      typeof phone !== "string" || !/^[1-9]\d{7,14}$/.test(phone) ||
      typeof occurredAt !== "string" || !Number.isFinite(Date.parse(occurredAt))) {
    return res.status(400).json({ error: "invalid_contact" });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const url = process.env.SUPABASE_URL;
  if (!key || !url) return res.status(503).json({ error: "database_not_configured" });

  try {
    const rpc = await fetch(`${url}/rest/v1/rpc/register_whatsapp_contact`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: id, phone, received_at: occurredAt, click_ref: typeof clickRef === 'string' && /^[0-9a-f-]{36}$/i.test(clickRef) ? clickRef : null }),
      signal: AbortSignal.timeout(5000)
    });
    if (!rpc.ok) throw new Error("registration_failed");
    const [lead] = await rpc.json();
    if (!lead?.lead_id) throw new Error("registration_missing");
    if (!lead.notify) return res.status(200).json({ lead_id: lead.lead_id });

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
    if (state.email_id) return res.status(200).json({ lead_id: lead.lead_id, email_id: state.email_id });
    // Resend idempotency expires after 24h. Ambiguous old attempts require review.
    if (!Number.isFinite(Date.parse(state.first_attempt_at)) ||
        Date.now() - Date.parse(state.first_attempt_at) >= 23 * 60 * 60 * 1000) {
      return res.status(503).json({ error: "notification_requires_review", lead_id: lead.lead_id });
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
        subject: "Novo lead recebido pelo WhatsApp",
        text: `WhatsApp: ${state.phone}\nPrimeira mensagem: ${state.first_message_at}\nRegistro: ${lead.lead_id}`
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!email.ok) throw new Error("notification_failed");
    const receipt = await email.json();
    if (typeof receipt.id !== "string" || !receipt.id) throw new Error("receipt_missing");
    await notificationState(receipt.id);
    return res.status(200).json({ lead_id: lead.lead_id, email_id: receipt.id });
  } catch {
    return res.status(503).json({ error: "whatsapp_lead_processing_failed" });
  }
}
