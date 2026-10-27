import test from 'node:test';
import assert from 'node:assert/strict';
import { groupDevelopments,parseRoute,parseFilters,listDevelopments,json,slug } from './portal/model.js';
import { createPortalHandler,sitemap } from './portal/handler.js';
import { readInventory } from './portal/data.js';
import { submitInterest } from './assets/js/portal-contact.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const row=(overrides={})=>({id:'00000000-0000-4000-8000-000000000001',external_id:'orulo:100:1',building_id:'100',development_name:'Mar & Sol',city:'Vila Velha',state:'ES',neighborhood:'Praia da Costa',price:600000,area:65,bedrooms:2,parking_spaces:1,image_url:'https://example.com/photo.jpg',active:true,updated_at:'2026-10-26T10:00:00Z',developer:'Construtora A',...overrides});
const inventory=[row(),row({id:'00000000-0000-4000-8000-000000000002',external_id:'orulo:100:2',price:900000,area:110,bedrooms:3,parking_spaces:2}),row({id:'00000000-0000-4000-8000-000000000003',external_id:'orulo:200:1',building_id:'200',development_name:'Jardim',city:'Serra',neighborhood:'Laranjeiras'})];
function mockResponse(){return {statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},send(s){this.body=s;return this;},end(){return this;}};}
async function page(path,{rows=inventory,method='GET',fail=false,preview=false}={}) {
  const res=mockResponse();
  await createPortalHandler({inventory:async()=>{if(fail)throw new Error('Unavailable');return rows;},preview,canonicalOrigin:'https://app.yincorp.com.br'})({method,url:path,query:{}},res);
  return res;
}
test('groups by supplier building, never by name; ranges cover active units',()=>{
  const groups=groupDevelopments([...inventory,row({id:'inactive',active:false,price:1})]);
  assert.equal(groups.length,2);const g=groups.find(g=>g.token==='orulo-100');
  assert.equal(g.units.length,2);assert.equal(g.price,600000);assert.equal(g.area,'65 a 110 m²');assert.equal(g.parking,'1 a 2');
  assert.match(g.path,/vila-velha\/empreendimento\/mar-sol--orulo-100$/);
  assert.equal(groupDevelopments([row({building_id:null,external_id:'other:1',id:'a'}),row({building_id:null,external_id:'other:2',id:'b'})]).length,2);
});
test('geography prevents homonym merging and covers every stocked ES city',()=>{
  assert.equal(groupDevelopments([row(),row({id:'b',city:'Vitória'}),row({id:'c',state:'SP'})]).length,3);
  assert.equal(slug('São Mateus'),'sao-mateus');
  assert.deepEqual(parseRoute('/es/serra/laranjeiras'),{kind:'neighborhood',state:'ES',city:'serra',neighborhood:'laranjeiras'});
  assert.equal(parseRoute('/es/vila-velha/extra/invalid'),null);assert.equal(parseRoute('/xx'),null);
});
test('joint filters cannot combine price from one unit with bedrooms from another',()=>{
  const filtered=listDevelopments(groupDevelopments(inventory),parseRoute('/es/vila-velha'),parseFilters(new URLSearchParams('preco=700000&quartos=3')));
  assert.equal(filtered.total,0);
});
test('listing SSR contains real links, metadata and scoped geographic results without JS',async()=>{
  const res=await page('/es/serra');
  assert.equal(res.statusCode,200);assert.match(res.body,/<h1>Encontre seu lugar em Serra\./);assert.match(res.body,/<article class="project-card">/);
  assert.match(res.body,/\/es\/serra\/empreendimento\/jardim--orulo-200/);assert.doesNotMatch(res.body,/Conhecer Mar/);
  assert.match(res.body,/rel="canonical" href="https:\/\/app.yincorp.com.br\/es\/serra"/);assert.match(res.body,/BreadcrumbList/);
});
test('development page exposes configurations, not duplicate cards; optional email',async()=>{
  const p=groupDevelopments(inventory)[0],res=await page(p.path);
  assert.equal(res.statusCode,200);assert.match(res.body,/65 a 110 m²/);assert.equal((res.body.match(/class="typology"/g)||[]).length,2);
  assert.doesNotMatch(res.body,/<input name="email"[^>]*required/);assert.match(res.body,/data-contact="00000000/);
});
test('unit deep link selects correct option and canonicalizes to its development',async()=>{
  const p=groupDevelopments(inventory)[0],res=await page(p.path+'/tipologia/'+inventory[1].id);
  assert.equal(res.statusCode,200);assert.match(res.body,/noindex,follow/);assert.match(res.body,/<option value="00000000-0000-4000-8000-000000000002" selected>/);
  assert.ok(res.body.includes(`rel="canonical" href="https://app.yincorp.com.br${p.path}"`));
});
test('obsolete name redirects to stable-ID canonical and preserves campaign parameters',async()=>{
  const p=groupDevelopments(inventory)[0];const res=await page('/es/vila-velha/empreendimento/nome-antigo--orulo-100?gclid=example');
  assert.equal(res.statusCode,308);assert.equal(res.headers.location,p.path+'?gclid=example');
});
test('GET filters resolve to real city and neighborhood URLs',async()=>{
  const res=await page('/es?cidade=vila-velha&bairro=praia-da-costa&quartos=2&preco=&ordem=recentes');
  assert.equal(res.statusCode,308);assert.equal(res.headers.location,'/es/vila-velha/praia-da-costa?quartos=2');
  assert.equal((await page('/es?cidade=cariacica')).statusCode,404);
});
test('missing geography, removed units, unknown pages and unsupported methods do not return soft 200s',async()=>{
  for(const path of ['/es/cariacica','/es/serra/bairro-inexistente','/es?pagina=999','/es?pagina=-1','/es?pagina=abc','/es/no/extra/path'])assert.equal((await page(path)).statusCode,404,path);
  assert.equal((await page('/es',{method:'POST'})).statusCode,405);
  const head=await page('/es',{method:'HEAD'});assert.equal(head.statusCode,200);assert.equal(head.body,'');
});
test('errors return 503 and retry guidance; preview is never indexable',async()=>{
  const unavailable=await page('/es',{fail:true});assert.equal(unavailable.statusCode,503);assert.equal(unavailable.headers['retry-after'],'60');assert.match(unavailable.body,/noindex/);
  const preview=await page('/es',{preview:true});assert.match(preview.headers['x-robots-tag'],/noindex/);assert.match(preview.body,/Envios e tracking desativados/);assert.doesNotMatch(preview.body,/googletagmanager.com/);
});
test('pagination is deterministic, self-canonical and never repeats a project',async()=>{
  const rows=Array.from({length:40},(_,i)=>row({id:String(i),building_id:String(i+1),external_id:`orulo:${i+1}:1`,development_name:`Projeto ${i}`}));
  const groups=groupDevelopments(rows),route=parseRoute('/es'),p1=listDevelopments(groups,route,parseFilters(new URLSearchParams())),p2=listDevelopments(groups,route,parseFilters(new URLSearchParams('pagina=2')));
  assert.equal(p1.items.length,18);assert.equal(p2.items.length,18);assert.equal(new Set([...p1.items,...p2.items].map(g=>g.token)).size,36);
  const res=await page('/es?pagina=2&utm_source=test',{rows});assert.match(res.body,/rel="canonical" href="https:\/\/app.yincorp.com.br\/es\?pagina=2"/);
});
test('filters are noindex, metadata strips attribution, input is escaped in HTML and JSON-LD',async()=>{
  const res=await page('/es?quartos=2&gclid=example');assert.match(res.body,/noindex,follow/);assert.doesNotMatch(res.body,/<link rel="canonical"[^>]+gclid/);
  const hostile=await page('/es',{rows:[row({development_name:'<script>alert(1)</script>',developer:'" onclick="bad()'})]});
  assert.match(hostile.body,/&lt;script&gt;/);assert.doesNotMatch(hostile.body,/<script>alert/);assert.equal(json('</script>'),'"\\u003c/script>"');
});
test('sitemap includes only live geographic and development pages, not typologies or tracking',()=>{
  const xml=sitemap(groupDevelopments(inventory),'https://app.yincorp.com.br');assert.match(xml,/<loc>https:\/\/app.yincorp.com.br\/es\/serra<\/loc>/);assert.doesNotMatch(xml,/tipologia|gclid|cariacica/);assert.equal((xml.match(/mar-sol--orulo-100/g)||[]).length,1);
});
test('inventory reads across REST row limits and refuses partial or failed catalogs',async()=>{
  let calls=0;
  const result=await readInventory('ES',{configured:()=>true,request:async path=>{calls++;assert.match(path,/state=eq.ES/);return {ok:true,data:calls===1?Array(500).fill(row()):[row({id:'last'})]};}});
  assert.equal(result.length,501);assert.equal(calls,2);
  await assert.rejects(readInventory('ES',{configured:()=>true,request:async()=>({ok:false,data:[]})}),/inventory_unavailable/);
});
test('lead continuation requires operational persistence, not email-only success',async()=>{
  const payload={nome:'Teste local',telefone:'27999999999',email:'',property_id:'orulo:100:2',lead_event_id:'test-event-123'};
  for(const result of [{success:true,email_sent:true,supabase:false},{success:false,supabase:true},null])await assert.rejects(submitInterest(payload,{request:async()=>({ok:true,json:async()=>result})}));
  let sent;
  await submitInterest(payload,{request:async(path,options)=>{assert.equal(path,'/api/lead');sent=JSON.parse(options.body);return {ok:true,json:async()=>({success:true,supabase:true})};}});
  assert.equal(sent.email,'');assert.equal(sent.property_id,'orulo:100:2');assert.equal(sent.lead_event_id,'test-event-123');
});
test('portal adapter preserves existing visitor, session and attribution keys across reloads',async()=>{
  const local=new Map(),session=new Map(),requests=[];
  const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))});
  const source=readFileSync(new URL('./assets/js/portal-session.js',import.meta.url),'utf8').replace(/export \{[^;]+\};\s*$/,'globalThis.result={visitorId:YNTELIGENCIA_VISITOR_ID,sessionId:YNTELIGENCIA_SESSION_ID,touches:YNTELIGENCIA_TOUCHES,track:supabaseTrack,leadId:yntLeadConversionId};');
  function boot(url){const location=new URL(url);const ctx={crypto:webcrypto,localStorage:storage(local),sessionStorage:storage(session),URL,URLSearchParams,document:{getElementById:()=>({textContent:'{"state":"ES"}'}),referrer:''},location,history:{replaceState(){}},console,fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,text:async()=>''};}};ctx.window=ctx;vm.runInNewContext(source,ctx);return ctx.result;}
  const first=boot('https://app.yincorp.com.br/es?gclid=sample&utm_campaign=es');
  const second=boot('https://app.yincorp.com.br/es/serra');
  assert.equal(first.visitorId,second.visitorId);assert.equal(first.sessionId,second.sessionId);assert.equal(second.touches.current_touch.gclid,'sample');
  assert.equal(first.leadId('orulo:100:2'),second.leadId('orulo:100:2'));
  await second.track('property_view',{property_id:'orulo:100:2',property_uuid:inventory[1].id});
  assert.equal(requests[0].property_id,inventory[1].id);assert.equal(requests[0].session_id,first.sessionId);assert.equal(requests[0].metadata.current_touch.gclid,'sample');
});
test('portal rewrite rules keep a separate state root to avoid empty wildcard redirect loops',()=>{
  const config=JSON.parse(readFileSync(new URL('./vercel.json',import.meta.url),'utf8'));
  const state=config.rewrites.find(r=>r.destination==='/api/development?portalPath=/:uf');
  assert.ok(state);assert.ok(config.rewrites.indexOf(state)<config.rewrites.findIndex(r=>r.source.includes(':rest*')));
  assert.equal(config.crons[0].path,'/api/push-daily');
});
