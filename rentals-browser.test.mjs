import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=(await readFile(new URL('./assets/js/rentals.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace("await import('./portal-session.js')",'__tracking');
async function harness({preview=false,save=true,floating=false}={}){
  const events=[],payloads=[],links=[],navigations=[];
  const element=()=>({listeners:{},textContent:'',addEventListener(n,fn){this.listeners[n]=fn;}});
  const button={disabled:false},feedback=element();feedback.append=e=>links.push(e);
  const form=element();Object.assign(form,{dataset:{id:'00000000-0000-4000-8000-000000000000',name:'Casa',neighborhood:'Perdizes',price:'4000'},elements:{nome:{value:'QA'},telefone:{value:'11999999999'},email:{value:''}},querySelector:()=>button});
  const property={id:form.dataset.id,external_id:'nonstop:abc123',name:'Casa',neighborhood:'Perdizes',city:'São Paulo'};
  const c={console,URL,URLSearchParams,AbortSignal,Date,Promise,setTimeout,clearTimeout,location:{pathname:'/alugar/imovel/'+property.id,href:'https://www.yincorp.com.br/alugar/imovel/'+property.id,assign:url=>{events.push('navigate');navigations.push(url);}},document:{body:{},head:{append(){}},getElementById:id=>id==='portal-data'?{textContent:JSON.stringify({preview,property})}:id==='rental-lead'?form:feedback,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement:element},__tracking:{visitorId:'visitor',sessionId:'session',session:{session_number:3,is_returning:true},touches:{current_touch:{gclid:'paid'}},attribution:()=>({gclid:'paid',gbraid:'braid',wbraid:'wbraid',utm_source:'google',utm_campaign:'rental'}),leadId:()=>'lead-once',track:async(name,data)=>{events.push({name,data});},adsTrack:async(name,data)=>{events.push({name,data,ads:true});}},submitInterest:async payload=>{payloads.push(payload);if(!save)throw Error('not persisted');},YntWhatsAppContact:{url:m=>'https://wa.me/5511992976368?text='+encodeURIComponent(m)}};
  let mounted=null;const dialog={openCount:0,showModal(){this.openCount++;}};
  if(floating){c.document.querySelector=selector=>selector==='.rental-contact-dialog'?dialog:null;c.YntWhatsAppContact.mountFloating=options=>{mounted=options;return null;};}
  c.window=c;vm.createContext(c);await vm.runInContext('(async()=>{'+code+'})()',c);
  return {events,payloads,links,navigations,button,feedback,dialog,mounted,submit:()=>form.listeners.submit({preventDefault(){}})};
}
test('rental Preview never creates identity, telemetry, leads or WhatsApp continuation',async()=>{const h=await harness({preview:true});await h.submit();assert.equal(h.events.length,0);assert.equal(h.payloads.length,0);assert.equal(h.links.length,0);assert.match(h.feedback.textContent,/envio desativado/);});
test('failed persistence leaves the form retryable and never reveals WhatsApp',async()=>{const h=await harness({save:false});await h.submit();assert.equal(h.links.length,0);assert.equal(h.button.disabled,false);assert.match(h.feedback.textContent,/Não foi possível registrar/);});
test('canonical identity, click IDs and attribution survive the rental lead; WhatsApp uses exact property context and records intention before navigation',async()=>{
  const h=await harness();await h.submit();const p=h.payloads[0];
  for(const [key,value] of Object.entries({visitor_id:'visitor',session_id:'session',gclid:'paid',gbraid:'braid',wbraid:'wbraid',utm_campaign:'rental',purpose:'LOCACAO',property_id:'nonstop:abc123',lead_event_id:'lead-once'}))assert.equal(p[key],value);
  assert.equal(h.links.length,1);assert.equal(h.navigations.length,0);
  const message=decodeURIComponent(h.links[0].href);assert.match(message,/Perdizes/);assert.match(message,/nonstop:abc123/);assert.match(message,/https:\/\/www.yincorp.com.br\/alugar\/imovel\//);
  await h.links[0].listeners.click({preventDefault(){}});assert.equal(h.navigations.length,1);
  assert.equal(h.events.at(-1),'navigate');const intent=h.events.find(e=>e.ads&&e.name==='whatsapp_cta_clicked');assert.equal(intent.data.intent.purpose,'LOCACAO');
  assert.ok(h.events.some(e=>e.name==='property_view'&&e.data.purpose==='LOCACAO'));
});

test('floating WhatsApp reuses the portal visual component and opens capture without bypassing the lead gate',async()=>{
  const h=await harness({floating:true});assert.ok(h.mounted);assert.equal(h.mounted.resolveProperty().id,'00000000-0000-4000-8000-000000000000');
  const options=h.mounted.getOptions();await options.track();await options.adsTrack();options.navigate();
  assert.equal(h.dialog.openCount,1);assert.equal(h.navigations.length,0);assert.equal(h.payloads.length,0);
  assert.ok(h.events.some(e=>e.name==='rental_contact_click'&&e.data.purpose==='LOCACAO'&&e.data.surface==='floating_whatsapp'));
});
