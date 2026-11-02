import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {attributedHref,rankProjects,cleanInvestmentContext,evolveIntent} from './portal/investment-model.js';
import {createJourney} from './assets/js/investment-journey.js';
import {groupDevelopments} from './portal/model.js';
import {createPortalHandler} from './portal/router.js';
import {comparisonProjects} from './portal/investment-journey.js';
import {investmentCandidates} from './portal/investment.js';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),map};};
const candidate=(id,price,extra={})=>({id:`orulo-${id}`,path:`/es/vitoria/empreendimento/teste--orulo-${id}`,name:`Projeto ${id}`,neighborhood:'Mata da Praia',stage:'Pronto',stageCode:'ready',units:[{price,stock:1,area:35,bedrooms:1}],...extra});
const projects=[candidate(1,600000),candidate(2,900000),candidate(3,null),candidate(4,500000,{stage:'Em construção',stageCode:'construction',delivery:'2027-03-01'}),candidate(5,400000,{units:[{price:400000,stock:0}]})];
const now='2026-11-02';
test('ranking is deterministic, applies budget to actual units and does not fill with over-budget/unknown/zero-stock options',()=>{
 const a=rankProjects(projects,{budget:700000},now),b=rankProjects([...projects].reverse(),{budget:700000},now);
 assert.deepEqual(a,b);assert.deepEqual(a.map(p=>p.id),['orulo-4','orulo-1']);assert.ok(a.every(p=>p.price<=700000));
 assert.deepEqual(rankProjects(projects,{budget:100000},now),[]);
 assert.equal(rankProjects(projects,{budget:700000,objective:'income'},now)[0].id,rankProjects(projects,{budget:700000,objective:'appreciation'},now)[0].id);
});
test('timing never infers immediate operation from construction or stale delivery, ties and region are explainable',()=>{
 assert.deepEqual(rankProjects(projects,{timing:'immediate',budget:700000},now).map(p=>p.id),['orulo-1']);
 assert.ok(rankProjects(projects,{timing:'12months',budget:700000},now).some(p=>p.id==='orulo-4'));
 assert.deepEqual(rankProjects([candidate(1,200000,{stageCode:'construction',delivery:'2025-01-01'})],{timing:'12months'},now),[]);
 const ranked=rankProjects([candidate(1,600000),candidate(2,650000,{neighborhood:'Praia do Canto'})],{region:'Praia do Canto',budget:700000},now);
 assert.equal(ranked[0].id,'orulo-2');assert.match(ranked[0].reasons.join(' '),/bairro/);
});
test('all attribution identifiers retain case and value through investment and project links; no foreign destination',()=>{
 const entries={gclid:'GClick-X',gbraid:'GBraid',wbraid:'WBraid',utm_source:'google',utm_medium:'cpc',utm_campaign:'Residencial Original',utm_term:'apartamento',utm_content:'Variante A',visitor_id:'visitor-A',session_id:'session-A'};
 const search=new URLSearchParams(entries).toString();
 for(const path of ['/es/vitoria/investimento-airbnb',projects[0].path])assert.deepEqual(Object.fromEntries(new URL(attributedHref(path,search),'https://www.yincorp.com.br').searchParams),entries);
 assert.ok(attributedHref('https://evil.test/es/vitoria',search).startsWith('/es/vitoria?'));
});
test('intent history evolves and reload retains profile, compared/selected projects without touching attribution',()=>{
 const s=storage(),events=[],first={gclid:'original',utm_campaign:'residential'};s.setItem('ynteligencia_first_touch_v2',JSON.stringify(first));
 const j=createJourney({storage:s,key:'journey',emit:(...args)=>events.push(args)});j.select('residential');j.select('investment');j.comparison(projects);j.profile({budget:700000,timing:'immediate'},projects,now);j.project('orulo-1');
 const reload=createJourney({storage:s,key:'journey'}),c=reload.context();assert.equal(c.initial_declared_intent,'residential');assert.equal(c.declared_intent,'investment');assert.equal(c.airbnb_interest,true);assert.equal(c.profile.budget,700000);assert.equal(c.selected_project,'orulo-1');assert.deepEqual(c.top_projects,['orulo-1']);assert.equal(c.intent_history.length,2);
 assert.deepEqual(JSON.parse(s.getItem('ynteligencia_first_touch_v2')),first);assert.deepEqual(events.map(e=>e[0]),['residential_intent_selected','investment_intent_selected','investment_comparison_viewed','investment_profile_completed','investment_project_selected']);
});
test('Preview emits no events, writes no storage, and context sanitizer excludes arbitrary keys and unsafe IDs',()=>{
 const s=storage(),j=createJourney({storage:s,key:'journey',preview:true,emit:()=>assert.fail()});j.select('investment');j.profile({budget:700000},projects,now);j.comparison(projects);j.project('orulo-1');assert.equal(s.map.size,0);
 const c=cleanInvestmentContext({...j.context(),email:'secret@test.com',selected_project:'https://evil.test',profile:{budget:Infinity,region:'X'.repeat(1000)},top_projects:['orulo-1','bad']});assert.equal(c.email,undefined);assert.equal(c.selected_project,'');assert.equal(c.profile.budget,null);assert.equal(c.profile.region.length,80);assert.deepEqual(c.top_projects,['orulo-1']);
});
const row={id:'11111111-1111-4111-8111-111111111111',external_id:'orulo:1:1',building_id:'1',active:true,state:'ES',city:'Vitória',neighborhood:'Mata da Praia',development_name:'Projeto real',price:600000,area:35,bedrooms:1,typology_type:'Apartamento',parking_spaces:0,typology_stock:3,stage:'Pronto'};
test('comparison preserves unit facts and unknowns; SSR editorial, metadata, schema and preview guarantees survive',async()=>{
 const groups=groupDevelopments([row,{...row,id:'second',price:800000,area:45,bedrooms:0,parking_spaces:1,typology_stock:null}]);
 const comparisons=comparisonProjects(investmentCandidates(groups));assert.deepEqual(comparisons[0].units.map(u=>[u.price,u.parking,u.stock]),[[600000,0,3],[800000,1,null]]);
 for(const preview of [false,true]){
  let body;const res={setHeader(){},status(){return this;},send(s){body=s;},end(){}};
  await createPortalHandler({preview,inventory:async()=>[row]})({method:'GET',url:'/es/vitoria/investimento-airbnb?gclid=test'},res);
  assert.match(body,/id="investment-profile"/);assert.match(body,/id="comparador"/);assert.match(body,/id="investment-results"/);assert.match(body,/A locação curta depende das regras do condomínio e da legislação aplicável/);assert.match(body,/rel="canonical" href="https:\/\/www.yincorp.com.br\/es\/vitoria\/investimento-airbnb"/);
  assert.match(body,new RegExp(preview?'noindex,follow':'index,follow'));if(preview)assert.doesNotMatch(body,/googletagmanager.com/);
  assert.doesNotMatch(body,/retorno garantido|rentabilidade de|ocupação de|diária de R\$|aprovado para Airbnb|\d+(?:[.,]\d+)?\s*%/i);
  const config=JSON.parse(body.match(/id="portal-data" type="application\/json">(.*?)<\/script>/)[1]);assert.equal(config.investmentProjects.length,1);
 }
});
test('existing session first/current touches and identity survive a full intent transition, and new events carry both touches',async()=>{
 const local=storage(),session=storage(),requests=[];
 const source=readFileSync(new URL('./assets/js/portal-session.js',import.meta.url),'utf8').replace(/export \{[^;]+\};\s*$/,'globalThis.result={visitorId:YNTELIGENCIA_VISITOR_ID,sessionId:YNTELIGENCIA_SESSION_ID,touches:YNTELIGENCIA_TOUCHES,track:supabaseTrack};');
 function boot(href){const location=new URL(href),ctx={crypto:webcrypto,localStorage:local,sessionStorage:session,URL,URLSearchParams,document:{getElementById:()=>({textContent:'{"state":"ES"}'}),referrer:''},location,history:{replaceState(){}},console,fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,text:async()=>''};}};ctx.window=ctx;vm.runInNewContext(source,ctx);return ctx.result;}
 const first=boot('https://www.yincorp.com.br/es/vitoria?gclid=OriginalCase&utm_campaign=Residential');
 const target=attributedHref('/es/vitoria/investimento-airbnb','',first),second=boot('https://www.yincorp.com.br'+target);
 assert.equal(first.visitorId,second.visitorId);assert.equal(first.sessionId,second.sessionId);assert.equal(second.touches.first_touch.gclid,'OriginalCase');assert.equal(second.touches.current_touch.utm_campaign,'Residential');
 await second.track('investment_intent_selected',{investment_context:cleanInvestmentContext(evolveIntent({},'investment'))});
 assert.equal(requests[0].metadata.first_touch.gclid,'OriginalCase');assert.equal(requests[0].metadata.current_touch.utm_campaign,'Residential');assert.equal(requests[0].metadata.investment_context.airbnb_interest,true);
});
