import { randomUUID } from "node:crypto";
import { notifyWhatsAppLead } from "../lib/whatsapp-notification.js";

const requests = new Map();
const keys = ["gclid","gbraid","wbraid","utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id"];
function safePage(value) {
  try {
    const url = new URL(value);
    if (!["www.yincorp.com.br","yincorp.com.br","app.yincorp.com.br"].includes(url.hostname)) return "";
    return url.origin + url.pathname;
  } catch { return ""; }
}
function attribution(value) {
  return Object.fromEntries(keys.flatMap(key => {
    const entry = value?.[key];
    return typeof entry === "string" && /^[\p{L}\p{N} ._~+|:-]{1,200}$/u.test(entry)
      ? [[key,entry]] : [];
  }));
}
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  const origin = req.headers.origin;
  const allowed = new Set(["https://app.yincorp.com.br","https://www.yincorp.com.br","https://yincorp.com.br",
    ...[process.env.VERCEL_URL,process.env.VERCEL_BRANCH_URL].filter(Boolean).map(host=>"https://"+host)]);
  if (origin && !allowed.has(origin)) return res.status(403).json({error:"origin_not_allowed"});
  if (origin) res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS")return res.status(204).end();
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  if(Number(req.headers["content-length"])>8192)return res.status(413).json({error:"too_large"});
  const body=req.body||{};
  const v2=body.consent===true && /^[A-F0-9]{12}$/.test(body.reference||"");
  if(body.reference && !v2)return res.status(400).json({error:"invalid_consent_or_reference"});
  let phone=String(body.phone||"").replace(/\D/g,"");
  if(phone.length===10||phone.length===11)phone="55"+phone;
  if(!/^55[1-9][0-9]{9,10}$/.test(phone)||body.website) return res.status(400).json({error:"invalid_phone"});
  const ip=String(req.headers["x-forwarded-for"]||"unknown").split(",")[0];
  const now=Date.now(),recent=(requests.get(ip)||[]).filter(t=>now-t<60000);
  if(recent.length>=6)return res.status(429).json({error:"too_many_requests"});
  requests.set(ip,[...recent,now]);
  if(requests.size>10000)requests.clear();
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)return res.status(503).json({error:"not_configured"});
  try {
    const property=body.property&&typeof body.property==="object"?body.property:{};
    const firstPage=safePage(body.first_touch?.landing_page);
    const firstDate=Date.parse(body.first_touch?.timestamp || body.first_touch?.captured_at || "");
    const rpcName=v2?"register_whatsapp_pre_registration_v2":"register_whatsapp_pre_registration";
    const rpc=await fetch(url+"/rest/v1/rpc/"+rpcName,{
      method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify({contact_id:randomUUID(),contact_phone:phone,
        property_context:{id:String(property.property_id||"").slice(0,120),name:String(property.name||property.development||"").slice(0,200)},
        page_url:safePage(body.page),...(v2?{contact_ref:body.reference,attribution_context:attribution(body.attribution),first_touch_context:{...attribution(body.first_touch),...(firstPage?{landing_page:firstPage}:{}),...(Number.isFinite(firstDate)?{timestamp:new Date(firstDate).toISOString()}:{})}}:{})}),signal:AbortSignal.timeout(8000)});
    if(!rpc.ok)throw new Error("registration_failed");
    const [lead]=await rpc.json();
    if(!lead?.lead_id)throw new Error("registration_missing");
    let notified=!lead.notify;
    if(lead.notify){
      try{await notifyWhatsAppLead({url,key,lead});notified=true;}
      catch{console.warn("whatsapp_pre_registration_notification_pending",lead.lead_id);}
    }
    // A saved contact can proceed even if the email service is temporarily unavailable.
    return res.status(200).json({success:true,notification_pending:!notified,...(v2?{lead_id:lead.lead_id,created:lead.created===true}:{})});
  }catch{
    return res.status(503).json({error:"registration_unavailable"});
  }
}
