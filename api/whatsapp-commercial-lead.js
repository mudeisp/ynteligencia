import { notifyWhatsAppLead } from "../lib/whatsapp-notification.js";
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

    const emailId = await notifyWhatsAppLead({url,key,lead});
    return res.status(200).json({ lead_id: lead.lead_id, email_id: emailId });
  } catch (error) {
    if (error.message === "notification_requires_review") return res.status(503).json({ error: "notification_requires_review" });
    return res.status(503).json({ error: "whatsapp_lead_processing_failed" });
  }
}
