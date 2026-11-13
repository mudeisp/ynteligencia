const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('commercial retries retain receipt beyond Resend idempotency window',async()=>{
 const handler=(await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('api/whatsapp-commercial-lead.js')).toString('base64'))).default;
 const previousFetch=global.fetch, previousEnv={...process.env};
 process.env.WHATSAPP_COMMERCIAL_TOKEN='test';process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SECRET_KEY='test';process.env.RESEND_API_KEY='test';
 let state={phone:'+15555550199',first_message_at:'2026-11-13T13:12:00Z',first_attempt_at:new Date().toISOString()}, sent=0, notify=true;
 global.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(url.endsWith('/register_whatsapp_contact'))return Response.json([{lead_id:'fixture',notify}]);
  if(url.endsWith('/whatsapp_email_state')){
   if(body.receipt_id)state.email_id=body.receipt_id;
   return Response.json(state);
  }
  assert.equal(url,'https://api.resend.com/emails');sent++;
  assert.match(body.text,/WhatsApp: \+15555550199/);
  return Response.json({id:'resend-fixture'});
 };
 async function run(){
  const res={status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:'POST',headers:{authorization:'Bearer test'},body:{id:'3cf998e5-4ebf-4d96-b50a-f0e6f6f07701',phone:'15555550199',occurredAt:'2026-11-13T13:12:00Z'}},res);
  return res;
 }
 try{
  assert.equal((await run()).body.email_id,'resend-fixture');
  state.first_attempt_at=new Date(Date.now()-25*3600000).toISOString();
  assert.equal((await run()).body.email_id,'resend-fixture');assert.equal(sent,1);
  delete state.email_id;
  assert.equal((await run()).body.error,'notification_requires_review');assert.equal(sent,1);
  notify=false;
  assert.deepEqual((await run()).body,{lead_id:'fixture'});assert.equal(sent,1);
 }finally{global.fetch=previousFetch;process.env=previousEnv}
});
