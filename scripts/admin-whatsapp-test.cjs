const {randomUUID}=require('node:crypto');
(async()=>{
 const db=process.env.SUPABASE_URL+"/rest/v1/";
 const headers={apikey:process.env.SUPABASE_SECRET_KEY,Authorization:"Bearer "+process.env.SUPABASE_SECRET_KEY,"Content-Type":"application/json"};
 const id="3cf998e5-4ebf-4d96-b50a-f0e6f6f07701", formId="3cf998e5-4ebf-4d96-b50a-f0e6f6f07702";
 const occurredAt="2026-11-13T13:15:00.000Z";
 async function contact(label,id,phone){
   const r=await fetch("https://app.yincorp.com.br/api/whatsapp-commercial-lead",{method:"POST",headers:{Authorization:"Bearer "+process.env.WHATSAPP_COMMERCIAL_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({id,phone,occurredAt})});
   console.log("WA_TEST",JSON.stringify({label,at:new Date().toISOString(),http:r.status,body:await r.json()}));
 }
 await contact("new",id,"15555550199");
 await contact("same-message",id,"15555550199");
 await contact("same-phone-new-id","3cf998e5-4ebf-4d96-b50a-f0e6f6f07703","15555550199");
 const fixture=await fetch(db+"leads",{method:"POST",headers:{...headers,Prefer:"resolution=ignore-duplicates"},body:JSON.stringify({id:formId,name:"TESTE ISOLADO ADMINISTRATIVO",phone:"+15555550198",status:"novo",destination:"yincorp",metadata:{source:"form",test:"whatsapp-production-diagnostic-20261113"}})});
 console.log("WA_FIXTURE",fixture.status);
 if(fixture.ok) await contact("existing-form","3cf998e5-4ebf-4d96-b50a-f0e6f6f07704","15555550198");
 process.exit(1);
})().catch(()=>{console.log("WA_TEST transport_error");process.exit(1)});
