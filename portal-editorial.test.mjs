import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupDevelopments,geography,parseFilters,listDevelopments} from './portal/model.js';
import {renderListing,renderDevelopment} from './portal/render.js';
const row={id:'00000000-0000-4000-8000-000000000001',active:true,state:'ES',city:'Vitória',neighborhood:'Enseada do Suá',building_id:'66878',development_name:'Youniverse - Studios',typology_type:'Studio',price:959000,bedrooms:1,area:39.47,parking_spaces:1,typology_stock:7,image_url:'https://example.com/facade.jpg'};
test('home has a photographic editorial opening, meaningful live metrics and one independent stylesheet',()=>{
 const groups=groupDevelopments([row,{...row,id:'2',building_id:'2',city:'Serra',typology_stock:3}]),route={kind:'state',state:'ES'},filters=parseFilters(new URLSearchParams());
 const html=renderListing({route,filters,groups,cities:geography(groups,'ES'),results:listDevelopments(groups,route,filters),origin:'https://www.yincorp.com.br',canonical:'https://www.yincorp.com.br/es',preview:true});
 assert.match(html,/<h1>Lugares onde vale<br> a pena viver\./);assert.match(html,/class="hero-photograph"/);assert.match(html,/class="hero-search wrap"/);
 assert.match(html,/<strong>10<\/strong><span>unidades com estoque informado/);assert.match(html,/<strong>2<\/strong><span>empreendimentos/);
 assert.doesNotMatch(html,/3\.950|brand-monogram|hero-art|portal-v3\.css|href="\/assets\/css\/portal\.css"/);assert.match(html,/portal-editorial\.css/);assert.match(html,/class="wordmark"/);
});
test('project is composed around architecture and actual plan images while preserving lead contract',()=>{
 const g=groupDevelopments([{...row,floor_plans:Array.from({length:27},(_,i)=>({id:String(i),description:`Planta ${i+1}`,image_url:`https://example.com/planta-${i}.jpg`}))}])[0];
 const html=renderDevelopment({project:g,route:{kind:'development'},origin:'https://www.yincorp.com.br',canonical:'https://www.yincorp.com.br'+g.path,preview:true});
 assert.equal((html.match(/data-art-plan="/g)||[]).length,27);assert.match(html,/class="art-cover /);assert.match(html,/class="art-offer"/);assert.match(html,/class="technical-editorial wrap"/);assert.doesNotMatch(html,/contact-panel|development-layout/);
 assert.match(html,/id="portal-lead"/);assert.match(html,/"leadEndpoint":"\/api\/portal\/lead"/);assert.match(html,/"preview":true/);assert.match(html,/"db_id":"00000000-0000-4000-8000-000000000001"/);assert.match(html,/noindex,follow/);
});
test('gallery enhancement has no telemetry imports or writes and supports reduced motion',()=>{
 const source=readFileSync(new URL('./assets/js/portal-gallery.js',import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\(|localStorage|sessionStorage|gtag|fbq|setInterval/);assert.match(source,/prefers-reduced-motion/);assert.match(source,/planTrigger\?\.focus/);
});
