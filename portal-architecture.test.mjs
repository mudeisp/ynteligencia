import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupDevelopments} from './portal/model.js';
import {architectureComposition,architecturalPlans} from './portal/architecture.js';
const base={id:'00000000-0000-4000-8000-000000000001',external_id:'orulo:123:1',active:true,building_id:'123',state:'ES',city:'Vila Velha',neighborhood:'São Conrado',development_name:'Projeto de Referência',developer:'Construtora',price:990000,area:65.5,bedrooms:2,parking_spaces:1,suites:1,image_url:'https://example.com/facade.jpg',videos:[{url:'https://www.youtube.com/watch?v=S_6EmQoOQe0'}],floor_plans:[{id:'1',description:'Planta 01 - 2 dorm 65,50m²',image_url:'https://example.com/plan.jpg'}]};
test('architecture narrative gives media precedence over specifications and availability',()=>{
 const g=groupDevelopments([base])[0],html=architectureComposition(g);
 const cover=html.indexOf('class="art-cover"'),images=html.indexOf('id="arquitetura"'),video=html.indexOf('id="midia"'),facts=html.indexOf('id="essencia"'),plans=html.indexOf('id="plantas"'),price=html.indexOf('id="disponibilidade"');
 assert.ok(cover<images && images<video && video<facts && facts<plans && plans<price);
 assert.doesNotMatch(html.slice(cover,html.indexOf('id="sobre"')),/990\.000|data-contact/);
 assert.match(html,/data-art-video=/);assert.match(html,/data-art-plan="0"/);assert.match(html,/data-plan-image=/);assert.match(html,/65,50 m² · 2 quartos · 1 suíte · 1 vaga/);
});
test('missing assets do not create imaginary media, plans or project descriptions',()=>{
 const g=groupDevelopments([{...base,videos:[],floor_plans:[],image_url:null,description:''}])[0],html=architectureComposition(g);
 assert.doesNotMatch(html,/id="midia"|id="plantas"|youtube\.com|Piscina|Spa/);assert.match(html,/Projeto de Referência/);
});
test('source curation supplements Paradiso without modifying its inventory model',()=>{
 const g=groupDevelopments([{...base,building_id:'83252',external_id:'orulo:83252:1',videos:[]}])[0],before=JSON.stringify(g),html=architectureComposition(g);
 assert.equal(JSON.stringify(g),before);assert.match(html,/paradisorc\.com\.br\/images\/fachada01\.jpg/);assert.match(html,/S_6EmQoOQe0/);assert.match(html,/Material publicado no site oficial/);
});
test('story enhancement never changes business endpoints, identity or attribution storage',()=>{
 const code=readFileSync(new URL('./assets/js/property-story.js',import.meta.url),'utf8');assert.doesNotMatch(code,/fetch\(|localStorage|sessionStorage|gtag|fbq|supabase|\/api\//);assert.match(code,/data-art-plan-title/);
});
