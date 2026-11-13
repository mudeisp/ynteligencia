import { notifyWhatsAppLead } from "../lib/whatsapp-notification.js";

export default async function handler(req,res) {
  if(req.method!=="GET")return res.status(405).end();
  if(!process.env.CRON_SECRET||req.headers.authorization!=="Bearer "+process.env.CRON_SECRET)return res.status(401).end();
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  const headers={apikey:key,Authorization:"Bearer "+key};
  async function list(received,limit) {
    const since=new Date(Date.now()-7*86400000).toISOString();
    const query=new URLSearchParams({select:"id",created_at:"gte."+since,"metadata->>source":"in.(whatsapp,whatsapp_pre_registration)","metadata->whatsapp_notification->>email_id":received?"not.is.null":"is.null",order:"created_at.desc",limit:String(limit)});
    const response=await fetch(url+"/rest/v1/leads?"+query,{headers:{...headers,Prefer:"count=exact"},signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error("lead_reconciliation_failed");
    return {rows:await response.json(),total:Number(response.headers.get("content-range")?.split("/").pop())||0};
  }
  try{
    const [pending,sent]=await Promise.all([list(false,10),list(true,1)]);
    const results=await Promise.allSettled(pending.rows.map(({id})=>notifyWhatsAppLead({url,key,lead:{lead_id:id}})));
    const accepted=results.filter(result=>result.status==="fulfilled").length;
    const report={pending_before:pending.total,accepted,accepted_before:sent.total,pending_after:Math.max(0,pending.total-accepted)};
    console.info("whatsapp_notification_reconciliation",report);
    return res.status(200).json(report);
  }catch{return res.status(503).json({error:"reconciliation_unavailable"});}
}
