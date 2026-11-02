import test from 'node:test';
import assert from 'node:assert/strict';
import {groupDevelopments} from './portal/model.js';
import {marketSummary,marketProfile,SP_PRIORITY} from './portal/market-guide.js';
import {createPortalHandler,sitemap} from './portal/router.js';
const row=(v={})=>({id:'unit',external_id:'orulo:1:1',building_id:'1',active:true,state:'SP',city:'São Paulo',neighborhood:'Moema',development_name:'Projeto real',price:750000,area:45,bedrooms:1,typology_type:'Apartamento',finality:'Residencial',updated_at:'2026-10-31T12:00:00Z',...v});
async function page(path,rows,preview=false){const calls=[],res={headers:{},statusCode:200,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},send(s){this.body=s;return this;},end(){return this;}};await createPortalHandler({preview,inventory:async(state,options)=>{calls.push({state,...options});return rows;}})({method:'GET',url:path,query:{}},res);return {...res,calls};}
test('summary separates declared use and type, omits absent prices, counts projects once per bucket and never mutates units',()=>{
 const groups=groupDevelopments([row(),row({id:'unit2',price:900000}),row({id:'nr',building_id:'2',price:250000,finality:'Não residencial',typology_type:'Studio'}),row({id:'unknown',building_id:'3',finality:null,price:null,area:null,bedrooms:null})]);
 const before=JSON.stringify(groups),s=marketSummary(groups);assert.equal(s[0].use,'Residencial');assert.equal(s[0].projects,1);assert.equal(s[0].price,750000);assert.equal(s[1].use,'Não residencial');assert.equal(s[1].label,'Studio');assert.equal(s[1].price,250000);assert.equal(s[2].use,'Uso a confirmar');assert.equal(s[2].price,null);assert.equal(s[2].area,'Sob consulta');assert.equal(JSON.stringify(groups),before);
});
test('all four requested neighborhoods and Vitória deliver specific SSR, canonical, same-source summary and existing tracking',async()=>{
 for(const neighborhood of SP_PRIORITY){
  const rows=[row({neighborhood}),row({id:'foreign',building_id:'2',state:'ES',city:'Vitória',price:1}),row({id:'other',building_id:'3',city:'Campinas',price:2})];
  const path='/sp/sao-paulo/'+neighborhood,res=await page(path,rows);
  assert.equal(res.statusCode,200);assert.equal((res.body.match(/<h1>/g)||[]).length,1);assert.match(res.body,/<title>Imóveis e lançamentos/);assert.ok(res.body.includes(`rel="canonical" href="https://www.yincorp.com.br${path}"`));assert.match(res.body,/content="index,follow"/);assert.match(res.body,/GUIA DE COMPRA/);assert.match(res.body,/750\.000/);assert.match(res.body,/Não representa todo o mercado/);assert.match(res.body,/Uso informado/);assert.match(res.body,/não comprova permissão para Airbnb/);assert.match(res.body,/googletagmanager.com/);assert.deepEqual(res.calls,[{state:'SP',mode:'listing'}]);
  const data=JSON.parse(/<script id="portal-data" type="application\/json">(.*?)<\/script>/.exec(res.body)[1]);assert.equal(data.leadEndpoint,'/api/portal/lead');
 }
 const es=await page('/es/vitoria',[row({state:'ES',city:'Vitória'})]);assert.match(es.body,/GUIA DE COMPRA/);assert.match(es.body,/\/es\/vitoria\/investimento-airbnb/);
});
test('explicit NR designation conflicting with declared residential finality remains uncertain',()=>{
 const groups=groupDevelopments([row({development_name:'Projeto - NR'}),row({id:'nonres',building_id:'2',development_name:'Projeto não residencial',finality:'Não residencial'})]);
 const summary=marketSummary(groups);assert.ok(summary.some(b=>b.use==='Uso a confirmar (identificação NR)'));assert.ok(summary.some(b=>b.use==='Não residencial'));assert.ok(!summary.some(b=>b.use==='Residencial'));
});
test('guide is scoped to supported landing pages and base inventory even on filters; no unsupported claims or injected supplier HTML',async()=>{
 assert.equal(marketProfile({kind:'intent',state:'ES',city:'vitoria'}),null);
 const rows=[row({development_name:'<script>bad()</script>'}),row({id:'expensive',price:1500000})];
 const res=await page('/sp/sao-paulo/moema?preco=800000',rows);assert.match(res.body,/noindex,follow/);assert.match(res.body,/antes dos filtros e da paginação/);assert.match(res.body,/750\.000/);assert.doesNotMatch(res.body,/<script>bad|retorno garantido|rentabilidade de|\d+(?:[.,]\d+)?\s*%/i);
 assert.doesNotMatch((await page('/sp/sao-paulo/perdizes',[row({neighborhood:'Perdizes'})])).body,/GUIA DE COMPRA/);
 const preview=await page('/sp/sao-paulo/moema',rows,true);assert.match(preview.body,/noindex,follow/);assert.doesNotMatch(preview.body,/googletagmanager.com/);
});
test('Brooklin alias redirects only to the stocked geography and preserves attribution and filters',async()=>{
 const rows=[row({neighborhood:'Brooklin Paulista'})],res=await page('/sp/sao-paulo/brooklin?gclid=test&preco=800000',rows);
 assert.equal(res.statusCode,308);assert.equal(res.headers.location,'/sp/sao-paulo/brooklin-paulista?gclid=test&preco=800000');
 assert.equal((await page('/sp/sao-paulo/brooklin',[row({neighborhood:'Moema'})])).statusCode,404);
 assert.equal((await page('/sp/sao-paulo/brooklin',[row({neighborhood:'Brooklin'})])).statusCode,200);
 assert.doesNotMatch(sitemap(groupDevelopments(rows),'https://www.yincorp.com.br'),/<loc>[^<]*\/brooklin<\/loc>/);
});
