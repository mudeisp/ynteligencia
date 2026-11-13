import { timingSafeEqual } from "node:crypto";
import { signWhatsAppStage } from "../lib/whatsapp-notification.js";

const stages = { attended: "Atendido", visit_scheduled: "Visita agendada", visit_completed: "Visita realizada" };
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("X-Frame-Options","DENY");
  const {id,expiry,sig}=req.query||{};
  if (!/^[a-f0-9-]{36}$/i.test(id||"") || !/^\d{10}$/.test(expiry||"") ||
      Number(expiry)<Date.now()/1000 || !/^[a-f0-9]{64}$/.test(sig||"")) return res.status(403).send("Link inválido ou expirado.");
  if (!timingSafeEqual(Buffer.from(sig,"hex"),Buffer.from(signWhatsAppStage(id,expiry),"hex"))) return res.status(403).send("Link inválido.");
  if (req.method==="GET") {
    res.setHeader("Content-Type","text/html; charset=utf-8");
    return res.status(200).send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Atendimento Yincorp</title><h1>Atualizar atendimento</h1><form method="post">'+Object.entries(stages).map(([key,label])=>'<p><button name="stage" value="'+key+'">'+label+'</button></p>').join('')+'</form></html>');
  }
  if (req.method!=="POST") return res.status(405).end();
  const stage=req.body?.stage;
  if (!Object.hasOwn(stages,stage)) return res.status(400).send("Etapa inválida.");
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  const response=await fetch(process.env.SUPABASE_URL+"/rest/v1/rpc/record_whatsapp_contact_stage",{
    method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify({target_lead:id,target_stage:stage}),signal:AbortSignal.timeout(5000)
  }).catch(()=>null);
  return response?.ok?res.status(200).send("Etapa registrada: "+stages[stage]):res.status(503).send("Não foi possível registrar. Tente novamente.");
}
