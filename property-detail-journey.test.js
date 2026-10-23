const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const journey=require("./property-detail-journey.js");
const source=fs.readFileSync("assets/js/delivery-4.js","utf8");
function declaration(name){
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);
  const end=source.indexOf("\nfunction ",start+10);
  return source.slice(start,end<0?undefined:end);
}
const escape=value=>String(value).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
const property={id:"unit-42",db_id:"db-42",name:"MAC Brooklin",neighborhood:"Brooklin",source:"novos",value:1436516,area:80,bedrooms:2,parking:1,match:{score:73,reasons:["score detail"]},rawData:{}};

test("organic and paid APP entries use the property handoff; attribution does not imply AGENTE origin",()=>{
  for(const search of ["","?gclid=click&utm_source=google","?source_product=agente_yincorp"]){
    assert.equal(journey.context(search).fromAgent,false);
  }
});
test("explicit AGENTE return skips the modal history entry and returns to the original tab",()=>{
  assert.equal(journey.context("?agent_return=1").fromAgent,true);
  for(const detailState of [true,false]){
    const plan=journey.returnPlan({search:"?agent_return=1",referrer:"https://agente.yincorp.com.br/?utm_source=google",historyLength:4,detailState});
    assert.equal(plan.delta,detailState?-2:-1);
  }
});
test("missing or untrusted history falls back to canonical AGENTE without a new handoff",()=>{
  for(const referrer of ["","https://evil.example/","javascript:alert(1)","https://agente.yincorp.com.br.evil.example/"]){
    const plan=journey.returnPlan({search:"?agent_return=1&gclid=a&gbraid=b&wbraid=c&utm_source=google&utm_medium=cpc&utm_campaign=brooklin&bairro=Brooklin&handoff=secret&return=https://evil.example",referrer,historyLength:4,detailState:true});
    assert.equal(plan.delta,0);
    const url=new URL(plan.href);
    assert.equal(url.origin,"https://agente.yincorp.com.br");
    for(const [k,v] of Object.entries({gclid:"a",gbraid:"b",wbraid:"c",utm_source:"google",utm_medium:"cpc",utm_campaign:"brooklin",bairro:"Brooklin"}))assert.equal(url.searchParams.get(k),v);
    assert.equal(url.searchParams.has("handoff"),false);
    assert.equal(url.searchParams.has("return"),false);
  }
});
test("cards render only the decision hierarchy, escape data and leave internal scores intact",()=>{
  const context=vm.createContext({esc:escape,area:String,money:n=>`R$ ${n}`,photoList:()=>["https://example.com/image.jpg"]});
  vm.runInContext(declaration("coverHTML")+declaration("propertyFacts")+declaration("card"),context);
  for(const inventory of ["novos","usados"]){
    const p={...property,source:inventory,name:'Projeto <script>"',adAlternative:true};
    const before=JSON.stringify(p);
    const html=context.card(p,true);
    assert.match(html,/VER IMÓVEL/);
    assert.match(html,/data-property-action="details"/);
    assert.match(html,/80 m² • 2 dormitórios • 1 vaga/);
    assert.match(html,/Projeto &lt;script>&quot;/);
    assert.doesNotMatch(html,/% MATCH|score detail|Alternativa|por m²|Quero conhecer|NOVO|USADO/);
    assert.equal(JSON.stringify(p),before);
    assert.equal((html.match(/<img/g)||[]).length,1);
  }
});

function modalHarness(search="",inventory="novos"){
  const calls={events:[],handoffs:[],returns:[],closed:[],hydrated:[],nodes:new Map()};
  const p={...property,source:inventory};
  let modal=null;
  const node=selector=>{
    if(selector===".detail-map-frame")return null;
    if(!calls.nodes.has(selector))calls.nodes.set(selector,{addEventListener(type,fn){this[type]=fn;},focus(){},remove(){},classList:{remove(){}}});
    return calls.nodes.get(selector);
  };
  const history={length:4,state:null,pushState(state){this.state=state;},go(delta){calls.returns.push(delta);},back(){calls.returns.push(-1);}};
  const document={referrer:"https://agente.yincorp.com.br/",body:{style:{},appendChild(el){modal=el;}},
    getElementById(id){return id==="photoModal"?modal:null;},
    createElement(){return {dataset:{},setAttribute(){},addEventListener(){},querySelector:node,querySelectorAll:()=>[],remove(){modal=null;}};}};
  const context=vm.createContext({URL,URLSearchParams,history,document,console:{info(){}},sessionStorage:{setItem(){}},
    window:{YntPropertyJourney:journey,YntFeatureLoader:{markLoaded(){}},location:{search,href:"https://app.yincorp.com.br/"+search,assign:url=>calls.returns.push(url)},requestAnimationFrame(){},scrollY:450},
    propertyForInteraction:()=>p,hydratePropertyDetails:async p=>p,photoManifestLoaded:true,sourceMode:"todos",profile:{},
    photoManifest:{},photoList:()=>["https://example.com/photo.jpg"],extractAllPropertyImages:()=>[{url:"https://example.com/photo.jpg"}],extractFloorplans:()=>["https://example.com/plan.jpg"],extractPropertyOptions:()=>[],
    propertyMapQuery:()=>"São Paulo",detailUpdatedLabel:()=>"Hoje",detailValue:x=>x||"",detailDate:()=>"",detailFeatureNames:()=>[],clean:x=>x,esc:escape,area:String,money:n=>`R$ ${n}`,detailRow:(a,b)=>`<div>${a}: ${b}</div>`,
    propertyFacts:p=>[p.area+" m²",p.bedrooms+" dormitórios",p.parking+" vaga"],
    gtag:(...args)=>calls.events.push(args),supabaseTrack:(...args)=>calls.events.push(args),yntAdsTrack:(...args)=>calls.events.push(args),yntAdsIntentFromState:()=>({}),
    notePaidSignal(){},scheduleAiAssistantForProperty(){},hydrateDevelopmentRichModal:(...args)=>calls.hydrated.push(args),renderDetailSimilar(){},updateDetailGallery(){},
    openAgentConversation:p=>calls.handoffs.push(p),openPropertySpecialist(){},
    closePropertyDetail:options=>calls.closed.push(options),IntersectionObserver:class{observe(){}disconnect(){}}
  });
  vm.runInContext(fs.readFileSync("assets/js/lazy/property-detail.js","utf8"),context);
  return {calls,context,history,document,p,get modal(){return modal;}};
}
test("APP primary CTA uses the original property handoff and preserves property_view payload",async()=>{
  const h=modalHarness("?gclid=paid&utm_source=google");
  await h.context.showPhotoModal(h.p.id);
  assert.match(h.modal.innerHTML,/QUERO SABER MAIS/);
  assert.doesNotMatch(h.modal.innerHTML,/% MATCH|Seu MATCH|Por que combina|CONVERSAR COM A IA/);
  h.calls.nodes.get(".detail-primary-cta").click();
  assert.equal(h.calls.handoffs[0],h.p);
  assert.equal(h.calls.returns.length,0);
  const view=h.calls.events.find(e=>e[0]==="property_view"&&e[1].property_uuid);
  assert.equal(view[1].match_score,73);
  assert.equal(view[1].property_id,"unit-42");
  assert.equal(h.calls.hydrated.length,1);
});
test("AGENTE primary CTA returns without invoking property handoff or creating identity",async()=>{
  const h=modalHarness("?agent_return=1&visitor_id=existing&session_id=existing","usados");
  await h.context.showPhotoModal(h.p.id);
  assert.match(h.modal.innerHTML,/VOLTAR À CONVERSA/);
  assert.match(h.modal.innerHTML,/Plantas do condomínio/);
  assert.match(h.modal.innerHTML,/detail-map-frame/);
  assert.match(h.modal.innerHTML,/detailSimilarGrid/);
  h.calls.nodes.get(".detail-primary-cta").click();
  assert.deepEqual(h.calls.returns,[-2]);
  assert.equal(h.calls.handoffs.length,0);
  assert.equal(h.calls.closed[0].fromJourneyReturn,true);
  assert.equal(h.calls.hydrated.length,0);
});
