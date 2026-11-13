const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
test('phone-only registration saves before notifying, reuses receipts and preserves saved contacts on mail failure',async()=>{
 const handler=(await import(pathToFileURL(resolve('api/whatsapp-pre-registration.js')).href)).default;
 const oldFetch=global.fetch,env={...process.env};
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY='test';process.env.RESEND_API_KEY='test';
 let saved=false,receipt=null,emails=0,notify=true,failEmail=false,phone;
 global.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(url.endsWith('/register_whatsapp_pre_registration')){saved=true;phone=body.contact_phone;return Response.json([{lead_id:'fixture',notify}]);}
  if(url.endsWith('/whatsapp_email_state')){
   if(body.receipt_id)receipt=body.receipt_id;
   return Response.json({phone:'+5511999999999',source:'whatsapp_pre_registration',first_message_at:'2026-11-13T14:00:00Z',first_attempt_at:new Date().toISOString(),email_id:receipt});
  }
  assert(saved);assert.equal(url,'https://api.resend.com/emails');emails++;
  assert.equal(body.subject,'Novo pré-cadastro — WhatsApp');
  assert.match(body.text,/Pré-cadastro no site/);
  return failEmail?Response.json({error:'unavailable'},{status:503}):Response.json({id:'receipt'});
 };
 let request=0;
 async function run(body,origin='https://www.yincorp.com.br'){
  const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:'POST',headers:{origin,'x-forwarded-for':String(request++)},body},res);return res;
 }
 try{
  assert.equal((await run({phone:'(11) 99999-9999'})).body.success,true);assert.equal(phone,'5511999999999');
  await run({phone:'+55 11 99999-9999'});assert.equal(emails,1);
  notify=false;await run({phone:'11999999999'});assert.equal(emails,1);
  notify=true;receipt=null;failEmail=true;
  assert.equal((await run({phone:'11999999999'})).body.notification_pending,true);assert(saved);
  assert.equal((await run({phone:'123'})).code,400);
  assert.equal((await run({phone:'11999999999'},'https://invalid.test')).code,403);
 }finally{global.fetch=oldFetch;process.env=env}
});
