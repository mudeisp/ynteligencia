const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const crypto=require("node:crypto");
const handoff=require("./agent-property-handoff.js");
const ads=require("./ads-intelligence.js");
const visitor="11111111-1111-4111-8111-111111111111";
const session="22222222-2222-4222-8222-222222222222";
const db="33333333-3333-4333-8333-333333333333";
const property={id:"orulo:unit-42",db_id:db,source:"novos",name:"Projeto Seguro",development:"Projeto Seguro",
  neighborhood:"Brooklin",city:"São Paulo",bedrooms:2,value:850000};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token="a".repeat(43);
const tokenUrl="https://agente.yincorp.com.br/?handoff="+token;
const options={visitorId:visitor,sessionId:session,crypto:crypto.webcrypto,origin:"https://app.yincorp.com.br"};
const html=fs.readFileSync("index.html","utf8");
function harness(input={}){
  const requests=[],navigations=[],fallbacks=[];let now=10000;
  const touch=Object.freeze({utm_medium:"organic",gclid:"",...input.touch});
  const browser={crypto:crypto.webcrypto,YntPropertyHandoff:handoff,location:{search:input.search??"?gclid=live-click",assign(url){navigations.push(["same-tab",url]);}},
    open(url){
      navigations.push(["open",url]);if(input.blocked)return null;
      const link={click(){navigations.push(["popup",link.href,link.rel]);if(input.popupError)throw new Error("popup unavailable");}};
      return {opener:{},document:{body:{appendChild(){}},createElement(){return link;}},close(){navigations.push(["close"]);}};
    }};
  const c=vm.createContext({URL,URLSearchParams,AbortSignal,Date:{now:()=>now},window:browser,
    location:{origin:input.origin??"https://app.yincorp.com.br"},document:{querySelector(){return null;}},
    YNTELIGENCIA_VISITOR_ID:visitor,YNTELIGENCIA_SESSION_ID:session,YNTELIGENCIA_TOUCHES:{current_touch:touch},adIntent:{active:false},paidSearch:{},
    openAiAssistant(p){fallbacks.push(p);},
    async fetch(url,init){requests.push({url,...JSON.parse(init.body)});if(input.fetch) return input.fetch(url,init);if(input.error)throw new Error("network");return {ok:input.ok??true,json:async()=>input.response??{success:true,url:tokenUrl}};}});
  const start=html.indexOf("function yntAgentHandoffUrl"),end=html.indexOf("function yntAdsTrack");
  const paidStart=html.indexOf("const YNT_PAID_UTM_MEDIA"),paidEnd=html.indexOf("function syncPaidClickContextUi",paidStart);
  vm.runInContext(html.slice(start,end)+"\n"+html.slice(paidStart,paidEnd)+`
    function yntAdsIntentFromState(){return {neighborhood:"Brooklin",bedrooms:2,max_price:900000,inventory_source:"novos"};}
    function yntAdsAttribution(){return {gclid:YNTELIGENCIA_TOUCHES.current_touch.gclid,utm_medium:YNTELIGENCIA_TOUCHES.current_touch.utm_medium};}
  `,c);
  return {requests,navigations,fallbacks,touch,open:p=>c.openAgentConversation(p??property),advance:ms=>now+=ms,c};
}
function store(){
  const handoffs=[],events=[],calls=[];
  const rest=async(path,request={})=>{
    calls.push({path,...request});const method=request.method??"GET",[table,query]=path.split("?"),params=new URLSearchParams(query);
    if(table==="ads_handoffs"){
      if(method==="POST"){handoffs.push(structuredClone(request.body));return {ok:true,status:201,data:null};}
      const found=handoffs.filter(x=>x.handoff_id===params.get("handoff_id")?.replace(/^eq\./,""));
      if(method==="PATCH"){Object.assign(found[0],request.body);return {ok:true,status:204,data:null};}
      return {ok:true,status:200,data:found};
    }
    if(table==="ads_events"&&method==="POST")events.push(structuredClone(request.body));
    if(table==="rpc/apply_buyer_profile_event")return {ok:true,status:200,data:{status:"applied"}};
    return {ok:true,status:200,data:[]};
  };
  return {rest,handoffs,events,calls};
}
const enabled={env:{ADS_AGENT_HANDOFF_ENABLED:"true"},createToken:()=>token,createId:()=>"44444444-4444-4444-8444-444444444444",allowedOrigins:["https://app.yincorp.com.br"]};
const now=new Date("2026-10-16T12:00:00Z");
const adapters=()=>import("./agent-handoff-v1.js");

test("manual property CTA creates root v1, separate IDs and a new UUID per opening",async()=>{
  const f=harness();await f.open();f.advance(751);await f.open();
  assert.equal(f.requests.length,2);
  for(const r of f.requests){assert.equal(r.version,1);assert.equal(r.kind,"property");assert.equal(r.entryPoint,"property.detail.manual_ai");assert.match(r.transitionId,uuid);assert.equal(r.context.currentProperty.external_id,property.id);assert.equal(r.context.currentProperty.db_id,db);assert.equal(r.context.currentProperty.city,"São Paulo");}
  assert.notEqual(f.requests[0].transitionId,f.requests[1].transitionId);
  assert.equal(f.navigations.filter(x=>x[0]==="popup").length,2);
});
test("reference extraction never puts a database UUID in external_id and preserves explicit source",()=>{
  const p=handoff.buildEnvelope({id:db,external_id:"nonstop:17",inventory_source:"usados",source:"nonstop",price:0,bedrooms:0},options).context.currentProperty;
  assert.equal(p.external_id,"nonstop:17");assert.equal(p.db_id,db);assert.equal(p.inventory_source,"usados");assert.equal(p.source,"nonstop");assert.equal(p.price,0);assert.equal(p.bedrooms,0);
});
test("live paid URL yields only a sanitized paid signal without rewriting the original touch",async()=>{
  const f=harness();await f.open();const r=f.requests[0];assert.deepEqual(r.paidContext,{isPaid:true,intent:null});
  assert.equal(r.tracking.current_touch.gclid,"");assert.equal(f.touch.gclid,"");assert.equal(f.touch.utm_medium,"organic");
  const conversation=JSON.stringify({context:r.context,paidContext:r.paidContext});assert.doesNotMatch(conversation,/live-click|gclid|current_touch|first_touch|https?:|@/);
});
test("email medium is not paid and paidSearch/current-touch signals continue to work",async()=>{
  const organic=harness({search:"?utm_medium=email"});await organic.open();assert.equal(organic.requests[0].paidContext,undefined);
  for(const input of [{search:"?utm_medium=cpc"},{search:"?wbraid=click"},{search:"",touch:{gclid:"original-click"}}]){const f=harness(input);await f.open();assert.deepEqual(f.requests[0].paidContext,{isPaid:true,intent:null});}
});
test("context and paid sanitization strip PII, arbitrary fields and attribution without copying transcripts",()=>{
  const envelope=handoff.buildEnvelope({...property,name:"private@example.test",neighborhood:"11999998888",email:"x@y.test",transcript:"private",url:"https://evil.test"},{...options,isPaid:true});
  const parsed=handoff.parseEnvelope({...envelope,email:"x@y.test",first_touch:{gclid:"secret"},paidContext:{isPaid:true,intent:{email:"private@example.test"},gclid:"secret",current_touch:{},transcript:"private"}});
  assert.equal(parsed.context.currentProperty.name,null);assert.equal(parsed.context.currentProperty.neighborhood,null);assert.deepEqual(parsed.paidContext,{isPaid:true,intent:null});assert.doesNotMatch(JSON.stringify(parsed),/private|secret|first_touch|current_touch|transcript/);
});
test("return URL uses only the existing property route and is safe even from Preview or an injected arrival URL",()=>{
  for(const origin of ["https://app.yincorp.com.br","https://www.yincorp.com.br","https://preview.vercel.app"]){const r=handoff.buildEnvelope(property,{...options,origin});const url=new URL(r.returnUrl);assert.equal(url.pathname,"/");assert.equal(url.searchParams.get("imovel"),property.id);assert.equal(url.searchParams.get("vid"),visitor);assert.deepEqual([...url.searchParams.keys()],["imovel","vid"]);assert.equal(url.hostname,origin.includes("preview")?"app.yincorp.com.br":new URL(origin).hostname);}
  for(const url of ["https://evil.test/","https://app.yincorp.com.br/?handoff=secret","https://app.yincorp.com.br/?email=x","https://app.yincorp.com.br:8443/","https://u:p@app.yincorp.com.br/","https://app.yincorp.com.br/?vid=invalid"]){assert.equal(handoff.safeReturnUrl(url),null,url);}
});
for(const error of ["handoff_disabled","network","http","missing-token","bad-json","wrong-origin"])
 test("local fallback: "+error,async()=>{
  const f=harness({error:error==="network",ok:!["http","handoff_disabled"].includes(error),response:error==="handoff_disabled"?{success:false,error}:error==="wrong-origin"?{success:true,url:"https://evil.test/?handoff="+token}:error==="missing-token"?{success:true}:undefined,
    ...(error==="bad-json"?{fetch:async()=>({ok:true,json:async()=>{throw new Error("invalid JSON");}})}:{})});
  await f.open();assert.equal(f.fallbacks.length,1);assert.equal(f.navigations.length,0);
 });
test("missing shared script or secure UUID support keeps the local fallback",async()=>{
  const f=harness();f.c.window.YntPropertyHandoff=undefined;await f.open();assert.equal(f.fallbacks.length,1);assert.equal(f.requests.length,0);
  assert.equal(handoff.buildEnvelope(property,{...options,crypto:null}),null);
});
test("popup blocked uses the same tab exactly once; no timer navigates later",async()=>{
  const f=harness({blocked:true});await f.open();assert.deepEqual(f.navigations,[["open","about:blank"],["same-tab",tokenUrl]]);assert.equal(f.fallbacks.length,0);
  const source=html.slice(html.indexOf("function yntAgentHandoffUrl"),html.indexOf("function yntAdsTrack"));assert.doesNotMatch(source,/setTimeout|setInterval/);
});
test("popup failure closes the unused window and opens local fallback",async()=>{
 const f=harness({popupError:true});await f.open();assert.equal(f.fallbacks.length,1);assert.ok(f.navigations.some(x=>x[0]==="close"));assert.equal(f.navigations.some(x=>x[0]==="same-tab"),false);
});
test("double click creates one token while pending and suppresses a fast completed double click",async()=>{
  let release;const f=harness({fetch:()=>new Promise(resolve=>{release=resolve;})});const first=f.open();await f.open();assert.equal(f.requests.length,1);release({ok:true,json:async()=>({success:true,url:tokenUrl})});await first;await f.open();assert.equal(f.requests.length,1);assert.equal(f.navigations.filter(x=>x[0]==="popup").length,1);
});
test("both manual bindings remain the only callers; other AI and human CTAs keep their local handlers",()=>{
  assert.equal((html.match(/openAgentConversation\(p\)/g)||[]).length,2);
  assert.match(html,/detail-ai-float-btn[\s\S]{0,120}openAgentConversation\(p\)/);
  assert.match(html,/detail-specialist-btn[^\n]+openAgentConversation\(p\)/);
  assert.match(html,/detail-specialist-human-btn[^\n]+openPropertySpecialist\(p\)/);
  assert.match(html,/function openHomeAiSearch\(/);assert.match(html,/function openAiAssistant\(/);assert.match(html,/function scheduleAiAssistantForProperty\(/);
  assert.equal((html.match(/action=create-handoff/g)||[]).length,1);
  assert.match(html,/Conversar com a IA/);assert.match(html,/<span>I\.A ajuda<\/span>/);
});
test("existing token/event implementation round-trips root native v1 without exposing attribution",async()=>{
  const {createPropertyHandoff,deliverPropertyHandoff}=await adapters();const f=harness();await f.open();const body=f.requests[0],s=store();
  const result=await createPropertyHandoff(body,s.rest,now,enabled);assert.equal(result.status,200);assert.equal(result.body.url,tokenUrl);assert.equal(s.handoffs.length,1);assert.equal(s.events.filter(x=>x.event_name==="agent_handoff_created").length,1);assert.equal(s.events.some(x=>x.event_name==="agent_opened"),false);
  assert.equal(s.handoffs[0].context.attribution.utm_medium,"organic");assert.equal(s.handoffs[0].context.attribution.gclid,"");
  const read=deliverPropertyHandoff(await ads.readHandoff({handoff_id:token},s.rest,now));assert.equal(read.status,200);assert.equal(read.body.kind,"property");assert.equal(read.body.transitionId,body.transitionId);assert.equal(read.body.context.currentProperty.external_id,property.id);assert.equal(read.body.context.currentProperty.db_id,db);assert.deepEqual(read.body.paidContext,{isPaid:true,intent:null});assert.doesNotMatch(JSON.stringify(read.body),/attribution|current_touch|gclid|handoff_id/);assert.ok(s.handoffs[0].consumed_at);
});
test("native and legacy creation use identical existing attribution, conversion and event projection",async()=>{
  const {createPropertyHandoff}=await adapters();const f=harness({touch:{gclid:"historic-click",utm_medium:"cpc"}});await f.open();const body=f.requests[0],native=store(),legacy=store();await createPropertyHandoff(body,native.rest,now,enabled);
  const p=body.context.currentProperty;await ads.createHandoff({visitor_id:visitor,session_id:session,source_product:"ynteligencia",return_origin:"https://app.yincorp.com.br",property:{...p,property_id:p.external_id,development:property.development},declared_intent:body.tracking.declared_intent,current_touch:body.tracking.current_touch,attribution:body.tracking.attribution},legacy.rest,now,enabled);
  assert.deepEqual(native.events,legacy.events);assert.deepEqual(native.handoffs[0].context.attribution,legacy.handoffs[0].context.attribution);assert.deepEqual(native.handoffs[0].context.conversion_attribution,legacy.handoffs[0].context.conversion_attribution);
});
test("legacy reads stay byte-for-byte unchanged and malformed native records fail closed",async()=>{
 const {deliverPropertyHandoff,createPropertyHandoff}=await adapters();const legacy={status:200,body:{context:{property:{property_id:"orulo:old"}},visitor_id:visitor,session_id:session}};assert.equal(deliverPropertyHandoff(legacy),legacy);
 assert.equal(deliverPropertyHandoff({...legacy,body:{...legacy.body,context:{property_handoff_v1:{version:1,kind:"catalog"}}}}).status,400);
 const s=store();assert.equal((await createPropertyHandoff({...handoff.buildEnvelope(property,options),kind:"match"},s.rest,now,enabled)).status,400);assert.equal(s.calls.length,0);
});
test("native disabled endpoint returns handoff_disabled without touching storage",async()=>{
 const saved=process.env.ADS_AGENT_HANDOFF_ENABLED;delete process.env.ADS_AGENT_HANDOFF_ENABLED;try{
  const {default:handler}=await import("./api/ads.js");const response={setHeader(){},status(status){this.code=status;return this;},json(body){this.body=body;return this;}};
  await handler({method:"POST",headers:{origin:"https://app.yincorp.com.br"},query:{action:"create-handoff"},body:handoff.buildEnvelope(property,options)},response);assert.equal(response.code,409);assert.equal(response.body.error,"handoff_disabled");
 }finally{if(saved===undefined)delete process.env.ADS_AGENT_HANDOFF_ENABLED;else process.env.ADS_AGENT_HANDOFF_ENABLED=saved;}
});
test("real /api/ads routing stores and delivers the validated envelope through the existing REST path",async()=>{
 const saved=Object.fromEntries(["ADS_AGENT_HANDOFF_ENABLED","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].map(k=>[k,process.env[k]]));const oldFetch=globalThis.fetch;const s=store();
 Object.assign(process.env,{ADS_AGENT_HANDOFF_ENABLED:"true",SUPABASE_URL:"https://supabase.example.test",SUPABASE_SERVICE_ROLE_KEY:"test-only"});
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith("https://supabase.example.test/rest/v1/"));const result=await s.rest(String(url).split("/rest/v1/")[1],{method:init.method,body:init.body?JSON.parse(init.body):undefined});return new Response(result.data==null?null:JSON.stringify(result.data),{status:result.status});};
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 try{const {default:handler}=await import("./api/ads.js");const created=response();await handler({method:"POST",headers:{origin:"https://app.yincorp.com.br"},query:{action:"create-handoff"},body:{...handoff.buildEnvelope(property,{...options,isPaid:true}),tracking:{current_touch:{gclid:"historic-click"}}}},created);assert.equal(created.code,200);assert.equal(created.headers["Cache-Control"],"no-store");const handoffId=new URL(created.body.url).searchParams.get("handoff");assert.match(handoffId,/^[A-Za-z0-9_-]{43}$/);assert.equal(s.handoffs.length,1);
 const read=response();await handler({method:"POST",headers:{},query:{action:"get-handoff"},body:{handoff_id:handoffId}},read);assert.equal(read.code,200);assert.equal(read.body.kind,"property");assert.equal(read.body.context.currentProperty.db_id,db);assert.deepEqual(read.body.paidContext,{isPaid:true,intent:null});assert.doesNotMatch(JSON.stringify(read.body),/historic-click|gclid|attribution/);assert.equal(s.events.filter(x=>x.event_name==="agent_handoff_created").length,1);
 }finally{globalThis.fetch=oldFetch;for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test("malformed native identities cannot downgrade to legacy or access storage",async()=>{
 const {createPropertyHandoff}=await adapters();const good=handoff.buildEnvelope(property,options);
 for(const change of [{version:2},{kind:"catalog"},{visitorId:[visitor]},{sessionId:"not-uuid"},{transitionId:null},{context:{currentProperty:{...good.context.currentProperty,external_id:db}}},{returnUrl:"https://evil.test/"}]){const s=store();const r=await createPropertyHandoff({...good,...change},s.rest,now,enabled);assert.equal(r.status,400);assert.equal(s.calls.length,0);}
});
test("request timeout opens local fallback and never schedules a redirect",async()=>{
 const f=harness({fetch:async(_url,init)=>{assert.ok(init.signal);const error=new Error("timeout");error.name="TimeoutError";throw error;}});await f.open();assert.equal(f.fallbacks.length,1);assert.equal(f.navigations.length,0);
});
test("paidSearch remains an additional paid signal without attribution changes",async()=>{
 const f=harness({search:""});f.c.paidSearch.neighborhood="Brooklin";await f.open();assert.deepEqual(f.requests[0].paidContext,{isPaid:true,intent:null});assert.equal(f.requests[0].tracking.current_touch.gclid,"");
});
