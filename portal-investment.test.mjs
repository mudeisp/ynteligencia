import test from 'node:test';
import assert from 'node:assert/strict';
import {groupDevelopments,parseRoute} from './portal/model.js';
import {createPortalHandler,sitemap} from './portal/router.js';
import {investmentCandidates,INVESTMENT_PATH} from './portal/investment.js';
const row=(v={})=>({id:'unit-1',external_id:'orulo:1:1',building_id:'1',active:true,state:'ES',city:'Vitória',neighborhood:'Jardim Camburi',development_name:'Compacto real',price:530000,area:38,bedrooms:1,typology_type:'Apartamento',stage:'Em construção',...v});
const rows=[row(),row({id:'large',price:200000,area:100,bedrooms:3}),row({id:'land',building_id:'2',typology_type:'Terreno'}),row({id:'office',building_id:'3',typology_type:'Sala comercial'}),row({id:'unknown',building_id:'4',typology_type:null}),row({id:'other-city',building_id:'5',city:'Vila Velha'})];
async function page(path=INVESTMENT_PATH,{preview=false,inventory=rows,method='GET',fail=false}={}){
 const calls=[],res={headers:{},statusCode:200,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},send(s){this.body=s;return this;},end(){return this;}};
 await createPortalHandler({preview,canonicalOrigin:'https://www.yincorp.com.br',inventory:async(state,options)=>{calls.push({state,...options});if(fail)throw Error('offline');return inventory;}})({method,url:path,query:{}},res);
 return {...res,calls};
}
test('dedicated route only; compact selection keeps unit facts together and excludes other uses/cities',()=>{
 assert.deepEqual(parseRoute(INVESTMENT_PATH),{kind:'investment',state:'ES',city:'vitoria'});
 for(const path of ['/sp/sao-paulo/investimento-airbnb','/es/serra/investimento-airbnb'])assert.notEqual(parseRoute(path).kind,'investment');
 const selected=investmentCandidates(groupDevelopments(rows));assert.equal(selected.length,1);assert.equal(selected[0].price,530000);assert.equal(selected[0].area,'38 m²');assert.equal(selected[0].units.length,1);
 assert.equal(investmentCandidates(groupDevelopments([row({bedrooms:null}),row({id:'bad-area',area:null})])).length,0);
});
test('indexable SSR delivers metadata, canonical, breadcrumbs and exact linked ItemList without additional inventory reads',async()=>{
 const res=await page(INVESTMENT_PATH+'?utm_source=test&gclid=abc&pagina=8&preco=1');
 assert.equal(res.statusCode,200);assert.deepEqual(res.calls,[{state:'ES',mode:'listing'}]);
 assert.match(res.body,/<title>Investimento Airbnb em Vitória ES:/);assert.match(res.body,/<meta name="description" content="Compare imóveis compactos/);assert.match(res.body,/content="index,follow"/);
 assert.ok(res.body.includes(`rel="canonical" href="https://www.yincorp.com.br${INVESTMENT_PATH}"`));
 assert.equal((res.body.match(/<h1>/g)||[]).length,1);assert.match(res.body,/Compacto real/);assert.match(res.body,/530\.000/);assert.doesNotMatch(res.body,/200\.000/);
 assert.match(res.body,/href="\/es\/vitoria\/lancamentos"/);assert.match(res.body,/href="\/es\/vitoria\/jardim-camburi"/);
 const schema=JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(res.body)[1]);
 assert.ok(schema['@graph'].some(g=>g['@type']==='BreadcrumbList'));
 const list=schema['@graph'].find(g=>g['@type']==='ItemList');assert.equal(list.numberOfItems,1);assert.ok(res.body.includes(`href="${new URL(list.itemListElement[0].url).pathname}"`));
});
test('clear condominium warning, no unsupported performance claims, escaped supplier fields and no approval badge',async()=>{
 const res=await page(INVESTMENT_PATH,{inventory:[row({development_name:'<script>bad()</script>',features:['<img onerror=bad>']})]});
 assert.match(res.body,/A locação curta depende das regras do condomínio e da legislação aplicável/);assert.match(res.body,/Convenção e autorização para locação curta:<\/strong> não verificadas/);
 assert.match(res.body,/Não apresentamos estimativas de diária, ocupação, rentabilidade ou retorno/);
 assert.doesNotMatch(res.body,/(?:rende|retorno garantido|rentabilidade de|ocupação de|diária de R\$|aprovado para Airbnb|\d+(?:[.,]\d+)?\s*%)/i);
 assert.doesNotMatch(res.body,/<script>bad|<img onerror/);assert.match(res.body,/&lt;script&gt;/);
});
test('preview disables tracking, HEAD works, empty selection is honest, unavailable inventory fails closed',async()=>{
 const preview=await page(INVESTMENT_PATH,{preview:true});assert.match(preview.body,/noindex,follow/);assert.doesNotMatch(preview.body,/googletagmanager.com/);
 assert.equal((await page(INVESTMENT_PATH,{method:'HEAD'})).body,'');assert.equal((await page(INVESTMENT_PATH,{method:'POST'})).statusCode,405);
 assert.match((await page(INVESTMENT_PATH,{inventory:[row({area:100})]})).body,/Não há configurações/);
 assert.equal((await page(INVESTMENT_PATH,{inventory:[]})).statusCode,404);assert.equal((await page(INVESTMENT_PATH,{fail:true})).statusCode,503);
 const slash=await page(INVESTMENT_PATH+'/?utm_source=test');assert.equal(slash.statusCode,308);assert.equal(slash.headers.location,INVESTMENT_PATH+'?utm_source=test');
});
test('sitemap and Vitória catalog expose the single new landing',async()=>{
 const xml=sitemap(groupDevelopments(rows),'https://www.yincorp.com.br');assert.equal(xml.split(INVESTMENT_PATH).length-1,1);assert.doesNotMatch(xml,/vila-velha\/investimento-airbnb/);
 assert.ok((await page('/es/vitoria')).body.includes(`href="${INVESTMENT_PATH}"`));
});
