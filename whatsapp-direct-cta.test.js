const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/js/delivery-3.js','utf8');
const contact=fs.readFileSync('assets/js/whatsapp-contact.js','utf8');
const portal=fs.readFileSync('assets/js/portal.js','utf8');
const visitor='11111111-1111-4111-8111-111111111111';
const session='22222222-2222-4222-8222-222222222222';
const db='33333333-3333-4333-8333-333333333333';
const unit={id:'orulo:46939:1',db_id:db,name:'Mandarim The Legend',city:'São Paulo',neighborhood:'Brooklin',value:950000,source:'novos'};
function fn(name){return source.match(new RegExp('(?:async )?function '+name+'\\([\\s\\S]*?\\n\\}'))[0];}
function harness({mode='success',state='SP',paid=true}={}){
  const requests=[],navigations=[],events=[],timers=[];
  const touch=Object.freeze(paid?{gclid:'paid-click',gbraid:'braid',wbraid:'wbraid',utm_source:'google',utm_medium:'cpc',utm_campaign:'campaign',utm_term:'term',utm_content:'ad'}:{utm_source:'organic'});
  const location={pathname:`/${state.toLowerCase()}/cidade/empreendimento/mandarim`,search:'',href:`https://app.yincorp.com.br/${state.toLowerCase()}/cidade/empreendimento/mandarim`,hostname:'app.yincorp.com.br',origin:'https://app.yincorp.com.br',assign:url=>navigations.push(url)};
  const window={location};
  const c=vm.createContext({window,location,URL,URLSearchParams,Date,Promise,console,
    setTimeout:(f,ms)=>{timers.push(ms);return setTimeout(f,ms);},clearTimeout,
    SUPABASE_URL:"https://telemetry.invalid",SUPABASE_PUBLISHABLE_KEY:"test-public",
    YNTELIGENCIA_VISITOR_ID:visitor,YNTELIGENCIA_SESSION_ID:session,
    YNTELIGENCIA_ATTRIBUTION:touch,YNTELIGENCIA_TOUCHES:{first_touch:touch,current_touch:touch},
    YNTELIGENCIA_SESSION:{session_number:1},sourceMode:'novos',activeState:state,activeCity:unit.city,
    clean:v=>String(v||'').trim(),norm:v=>String(v||'').toLowerCase(),
    touchYnteligenciaSession(){},nextYnteligenciaEventSequence:()=>1,getYnteligenciaPreviousEvent:()=>null,setYnteligenciaPreviousEvent(){},
    yntAdsIntentFromState:()=>({development:unit.name,inventory_source:'novos'}),
    gtag:(...args)=>events.push(args),openLeadCapture:()=>{throw Error('Direct CTA opened the form');},
    fetch:(url,init)=>{requests.push({url,init,payload:JSON.parse(init.body)});if(mode==='throw')throw Error('offline');if(mode==='reject')return Promise.reject(Error('offline'));if(mode==='timeout')return new Promise(()=>{});return Promise.resolve({ok:mode!=='http-error',json:async()=>({success:true,event_id:'evt-1'}),text:async()=>''});}
  });
  vm.runInContext(contact+'\n'+['yntAdsAttribution','yntAdsTrack','supabaseTrack','openPropertySpecialist'].map(fn).join('\n'),c);
  return {c,requests,navigations,events,timers,touch,open:p=>c.openPropertySpecialist(p??unit)};
}
test('primary contact persists both canonical lanes before one WhatsApp navigation; no form or lead',async()=>{
  const h=harness();const pending=h.open();
  assert.equal(h.requests.length,2);assert.equal(h.navigations.length,0);
  await pending;
  assert.equal(h.navigations.length,1);
  assert.deepEqual(h.requests.map(r=>r.payload.event_name||r.payload.event_type),['whatsapp_cta_clicked','whatsapp_cta_clicked']);
  for(const r of h.requests)assert.equal(r.init.keepalive,true);
  const ads=h.requests[0].payload,telemetry=h.requests[1].payload;
  assert.equal(ads.visitor_id,visitor);assert.equal(ads.session_id,session);
  assert.equal(telemetry.metadata.visitor_id,visitor);assert.equal(telemetry.session_id,session);
  assert.equal(ads.property.property_id,unit.id);assert.equal(ads.property.db_id,db);
  assert.equal(telemetry.property_id,db);assert.equal(telemetry.metadata.external_id,unit.id);
  assert.equal(ads.property.name,unit.name);assert.equal(ads.metadata.development_name,unit.name);
  assert.equal(ads.metadata.city,unit.city);assert.equal(ads.metadata.price,unit.value);
  assert.equal(ads.metadata.url,h.c.location.href);assert.ok(ads.metadata.timestamp);
  for(const [key,value] of Object.entries(h.touch)){assert.equal(ads[key],value);assert.equal(telemetry.metadata.current_touch[key],value);assert.equal(ads.metadata.first_touch[key],value);}
  assert.equal(telemetry.metadata.campaign_intent.state,'SP');
  const url=new URL(h.navigations[0]);assert.equal(url.origin,'https://wa.me');assert.equal(url.pathname,'/5511992976368');
  assert.match(url.searchParams.get('text'),/Mandarim The Legend/);
  for(const forbidden of [db,unit.id,visitor,session,'paid-click','gclid','visitor_id','session_id'])assert.ok(!url.searchParams.get('text').includes(forbidden),forbidden);
});
test('rapid taps share the same attempt and cannot create two redirects or legacy double counting',async()=>{
  const h=harness();await Promise.all([h.open(),h.open()]);await h.open();
  assert.equal(h.requests.length,2);assert.equal(h.navigations.length,1);
  assert.doesNotMatch(JSON.stringify(h.requests),/property_whatsapp_click|lead_created|specialist_cta_opened/);
});
for(const mode of ['throw','reject','http-error','timeout'])test(`tracking ${mode} never prevents contact`,async()=>{
  const h=harness({mode});await h.c.YntWhatsAppContact.open(unit,{adsTrack:h.c.yntAdsTrack,track:(n,m)=>h.c.supabaseTrack(n,m,{keepalive:true}),timeoutMs:5});
  assert.equal(h.navigations.length,1);assert.equal(h.requests.length,2);
});
test('organic attribution is preserved without inventing paid IDs',async()=>{
  const h=harness({paid:false});await h.open();assert.equal(h.requests[0].payload.gclid,'');assert.equal(h.requests[0].payload.utm_source,'organic');
});
test('server accepts and persists WhatsApp in ads_events without producing a lead or Google conversion',async()=>{
  const ads=require('./ads-intelligence.js'),h=harness();await h.open();
  const normalized=ads.normalizeEvent(h.requests[0].payload);assert.equal(normalized.error,undefined);
  const row=ads.eventRow(normalized.event);assert.equal(row.event_name,'whatsapp_cta_clicked');assert.equal(row.property_id,unit.id);
  assert.equal(row.property_development,unit.name);assert.equal(row.metadata.current_touch.gclid,'paid-click');
  assert.equal(ads.googleAdsConversionsCsv([row]).split('\n').filter(Boolean).length,1);
  const calls=[];
  const persisted=await ads.recordAdsEvent(h.requests[0].payload,async(path,request={})=>{
    calls.push({path,...request});return {ok:true,status:200,data:[]};
  },new Date(),()=> 'contact-event');
  assert.equal(persisted.status,200);
  const inserted=calls.find(r=>r.path==='ads_events' && r.method==='POST');
  assert.equal(inserted.body.event_name,'whatsapp_cta_clicked');
  assert.equal(inserted.body.visitor_id,visitor);assert.equal(inserted.body.session_id,session);
  assert.equal(inserted.body.gclid,'paid-click');assert.equal(inserted.body.metadata.city,unit.city);
  assert.equal(calls.some(r=>r.path==='rpc/record_ads_lead'),false);

});
function element(){return {listeners:{},dataset:{},hidden:false,textContent:'',className:'',addEventListener(n,fn){this.listeners[n]=fn;},setAttribute(k,v){this[k]=v;},replaceChildren(){},append(){},focus(){}};}
async function portalHarness(state='SP',{selected=true}={}){
  const h=harness({state}),primary=element(),secondary=element(),feedback=element(),submit=element(),dialog=element();
  primary.dataset.whatsapp=selected?db:'';secondary.dataset.contact=db;dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
  const elements={unit:{value:''},nome:{value:'Teste'},telefone:{value:'11999999999'},email:{value:''}};
  const form={...element(),elements,querySelector:()=>submit};
  const project={name:unit.name,token:'orulo-46939',city:state==='SP'?'São Paulo':'Vila Velha',state,neighborhood:unit.neighborhood,path:`/${state.toLowerCase()}/cidade/empreendimento/mandarim`,units:[unit]};
  const config={state,kind:selected?'unit':'development',project,selectedUnit:selected?db:''};
  const openCalls=[],open=h.c.YntWhatsAppContact.open;
  h.c.YntWhatsAppContact.open=(p,o)=>{openCalls.push(p);return open(p,o);};
  const nodes={'portal-data':{textContent:JSON.stringify(config)},'contact-dialog':dialog,'portal-lead':form,'contact-feedback':feedback};
  const storage={getItem:()=>null,setItem(){}};
  const tracking={visitorId:visitor,sessionId:session,session:{},touches:{first_touch:h.touch,current_touch:h.touch},adsTrack:h.c.yntAdsTrack,track:h.c.supabaseTrack,attribution:h.c.yntAdsAttribution,leadId:()=> 'lead-1',touch(){}};
  const leadRequests=[],observers=[];
  h.c.MutationObserver=class{constructor(fn){observers.push(fn);}observe(){}};
  const {submitInterest}=await import('./assets/js/portal-contact.js');
  Object.assign(h.c,{document:{body:{appendChild:node=>{nodes[node.id]=node;}},referrer:'',getElementById:id=>nodes[id],querySelector:selector=>selector.startsWith('dialog[open]')&&dialog.open?dialog:null,querySelectorAll:selector=>selector==='[data-contact]'?[secondary]:selector==='[data-whatsapp]'?[primary]:[],addEventListener(){},createElement:()=>element()},localStorage:storage,sessionStorage:storage,__tracking:tracking,submitInterest:payload=>submitInterest(payload,{request:async(url,init)=>{leadRequests.push({url,payload:JSON.parse(init.body)});return {ok:true,json:async()=>({success:true,supabase:true})};}})});
  const code=portal.replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace("await import('./portal-session.js')",'__tracking');
  await vm.runInContext('(async()=>{'+code+'})()',h.c);
  h.requests.length=0;
  return {...h,primary,secondary,form,dialog,leadRequests,openCalls,icon:nodes['ynt-whatsapp-float'],refresh:()=>observers.forEach(fn=>fn()),tracking};
}
for(const state of ['ES','SP'])test(`${state}: internal WhatsApp bypasses form; secondary opens Specialist and existing form creates lead`,async()=>{
  const h=await portalHarness(state);
  h.primary.listeners.click();h.primary.listeners.click();await new Promise(r=>setTimeout(r,10));
  assert.equal(h.openCalls[0].id,unit.id);assert.equal(h.openCalls[0].db_id,db);
  assert.equal(h.requests.filter(r=>r.payload.event_name==='whatsapp_cta_clicked').length,1);
  assert.equal(h.requests.some(r=>['lead_created','specialist_cta_opened','property_whatsapp_click'].includes(r.payload.event_name||r.payload.event_type)),false);
  assert.equal(h.dialog.open,undefined);assert.equal(h.leadRequests.length,0);assert.equal(h.navigations.length,1);
  assert.equal(h.requests[0].payload.event_name,'whatsapp_cta_clicked');assert.equal(h.requests[0].payload.property.property_id,unit.id);
  h.secondary.listeners.click();assert.equal(h.dialog.open,true);assert.equal(h.form.elements.unit.value,db);
  assert.ok(h.requests.some(r=>r.payload.event_name==='specialist_cta_opened'));
  await h.form.listeners.submit({preventDefault(){}});
  assert.equal(h.leadRequests.length,1);assert.equal(h.leadRequests[0].url,'/api/portal/lead');
  assert.equal(h.leadRequests[0].payload.property_id,unit.id);
  assert.ok(h.requests.some(r=>r.payload.event_name==='lead_created'));
  assert.equal(h.navigations.length,1);
});
test('classic form still tracks Specialist and calls /api/lead before lead_created',()=>{
  const form=fn('openLeadCapture');assert.match(form,/yntAdsTrack\("specialist_cta_opened"/);
  assert.ok(form.indexOf('"/api/lead"')<form.indexOf('yntAdsTrack("lead_created"'));
  assert.match(fs.readFileSync('assets/js/lazy/property-detail.js','utf8'),/detail-specialist-form-btn.*addEventListener\("click",\(\)=>openLeadCapture\(p\)/);
});
test('rendered ES/SP developments and typologies offer the same contact hierarchy',async()=>{
  const {groupDevelopments}=await import('./portal/model.js');const {renderDevelopment}=await import('./portal/render.js');
  for(const state of ['ES','SP']){
    const g=groupDevelopments([{id:db,external_id:unit.id,building_id:'46939',development_name:unit.name,state,city:unit.city,neighborhood:unit.neighborhood,price:unit.value,active:true}])[0];
    for(const selected of [undefined,g.units[0]]){
      const html=renderDevelopment({project:g,unit:selected,route:{kind:selected?'unit':'development'},canonical:'https://app.yincorp.com.br'+g.path,origin:'https://app.yincorp.com.br'});
      assert.match(html,/data-whatsapp="[^"]*">Falar pelo WhatsApp<\/button><button[^>]*data-contact="[^"]*">Prefiro deixar meus dados/);
      const floating=html.match(/<div class="mobile-contact floating-property-contact">([\s\S]*?)<\/div><\/div><dialog/)[1];
      assert.match(floating,/Consultar disponibilidade<\/button>/);
      assert.match(floating,new RegExp('data-contact="'+(selected?db:'')+'"'));
      assert.equal((floating.match(/data-contact=/g)||[]).length,1);
      assert.doesNotMatch(floating,/data-whatsapp=|Prefiro deixar meus dados/);
      assert.match(html,/id="portal-lead"/);assert.match(html,/id="contact-dialog"/);
    }
  }
});

for(const state of ['ES','SP'])test(`${state}: internal aggregate WhatsApp uses development context without selecting a unit`,async()=>{
  const h=await portalHarness(state,{selected:false});h.primary.listeners.click();
  await new Promise(r=>setTimeout(r,10));
  assert.equal(h.openCalls[0].id,undefined);assert.equal(h.openCalls[0].db_id,undefined);
  assert.equal(h.openCalls[0].development_name,unit.name);
  const event=h.requests.find(r=>r.payload.event_name==='whatsapp_cta_clicked').payload;
  assert.equal(event.property.property_id,'');assert.equal(event.metadata.development_id,'orulo-46939');
  assert.equal(event.metadata.development_name,unit.name);assert.equal(h.navigations.length,1);
  assert.equal(h.dialog.open,undefined);assert.equal(h.leadRequests.length,0);
});
test('floating contact CSS stays fixed with mobile safe area and hides under open dialogs',()=>{
  const css=fs.readFileSync('assets/css/property-story.css','utf8');
  const floating=css.slice(css.indexOf('/* Persistent property contact;'));
  assert.match(floating,/position:fixed/);assert.match(floating,/width:320px/);
  assert.match(floating,/min-height:56px/);assert.match(floating,/z-index:40/);
  assert.match(floating,/@media\(max-width:768px\)/);
  assert.match(floating,/left:12px;right:12px;bottom:calc\(10px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(floating,/body:has\(dialog\[open\]\) .floating-property-contact\{display:none!important\}/);
});
test('classic property floating bar keeps internal form and agent actions without duplicating floating CTAs',()=>{
  const detail=fs.readFileSync('assets/js/lazy/property-detail.js','utf8');
  const bar=detail.split('<div class="detail-primary-bar">')[1].split('</div>')[0];
  assert.match(bar,/>Consultar disponibilidade<\/button>/);
  assert.doesNotMatch(bar,/Prefiro deixar meus dados|detail-primary-cta/);
  assert.match(detail,/detail-whatsapp-cta.*addEventListener\("click",\(\)=>openLeadCapture\(p\)/);
  assert.match(detail,/detail-specialist-form-btn.*addEventListener\("click",\(\)=>openLeadCapture\(p\)/);
  const css=fs.readFileSync('assets/css/app-delivery.css','utf8');
  assert.match(css,/\.photo-detail-shell \.detail-primary-bar\{position:fixed/);
  assert.match(css,/body:has\(#floorplanLightbox\) \.detail-primary-bar/);
});

for(const state of ['ES','SP'])for(const selected of [true,false])test(`${state}: availability form and independent WhatsApp icon (${selected?'unit':'development'})`,async()=>{
  const h=await portalHarness(state,{selected});
  assert.ok(h.icon);assert.equal(h.icon['aria-label'],'Falar pelo WhatsApp');
  assert.match(h.icon.innerHTML,/<svg/);assert.doesNotMatch(h.icon.innerHTML,/Consultar disponibilidade/);
  // Availability uses the existing data-contact listener, never the icon listener.
  h.secondary.listeners.click();assert.equal(h.dialog.open,true);
  assert.ok(h.requests.some(r=>r.payload.event_name==='specialist_cta_opened'));
  assert.equal(h.openCalls.length,0);assert.equal(h.navigations.length,0);
  h.refresh();assert.equal(h.icon.hidden,true);
  h.dialog.close();h.refresh();assert.equal(h.icon.hidden,false);
  h.requests.length=0;
  h.icon.listeners.click();h.icon.listeners.click();await new Promise(r=>setTimeout(r,10));
  assert.equal(h.navigations.length,1);assert.equal(h.dialog.open,false);assert.equal(h.leadRequests.length,0);
  const event=h.requests.find(r=>r.payload.event_name==='whatsapp_cta_clicked').payload;
  assert.equal(event.property.property_id,selected?unit.id:'');
  assert.equal(event.metadata.development_name,unit.name);
  assert.equal(event.visitor_id,visitor);assert.equal(event.session_id,session);assert.equal(event.gclid,'paid-click');
  assert.equal(event.metadata.first_touch.gbraid,'braid');assert.equal(event.metadata.current_touch.wbraid,'wbraid');
  assert.equal(h.requests.length,2);
  assert.ok(h.requests.every(r=>(r.payload.event_name||r.payload.event_type)==='whatsapp_cta_clicked'));
  assert.equal(h.openCalls[0].development_name,unit.name);
  // A repeated mount reuses the same root button and one click handler.
  const again=h.c.YntWhatsAppContact.mountFloating({resolveProperty:()=>unit,getOptions:()=>({})});
  assert.equal(again,h.icon);
});
test('independent icon is viewport fixed, circular, safe-area aware and leaves existing controls clear',()=>{
  const css=fs.readFileSync('assets/css/whatsapp-float.css','utf8');
  assert.match(css,/body > \.whatsapp-direct-float/);assert.match(css,/position:fixed;right:16px;bottom:calc\(16px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/width:56px;height:56px/);assert.match(css,/border-radius:50%/);assert.match(css,/z-index:1000/);
  assert.match(css,/floating-property-contact\{right:88px/);
  assert.match(css,/\[hidden\].*display:none!important/);
});
