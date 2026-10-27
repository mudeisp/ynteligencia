import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupDevelopments} from './portal/model.js';import {planComposition,photoAsset,groupFloorPlans,groupConfigurations} from './portal/composition.js';
import {getEditorialSource} from './portal/editorial-sources.js';import {architectureComposition} from './portal/architecture.js';import {renderFloorPlans} from './portal/floor-plans.js';
const row={id:'00000000-0000-4000-8000-000000000001',active:true,building_id:'123',state:'ES',city:'Serra',neighborhood:'Centro',development_name:'Um Nome de Empreendimento Muito Longo para Diferentes Telas',price:300000,bedrooms:2,parking_spaces:1,area:55};
const project=(photos=0,extra={})=>groupDevelopments([{...row,images:Array.from({length:photos},(_,i)=>`https://example.com/${i}.jpg`),...extra}])[0];
test('one image is never duplicated to manufacture an image story; absent modules disappear',()=>{
 const g=project(1),c=planComposition(g),html=architectureComposition(g);assert.equal(c.cover.url,g.photos[0]);assert.equal(c.modules.imageStory.enabled,false);assert.equal(c.modules.film.enabled,false);assert.equal(c.modules.floorPlans.enabled,false);assert.equal(c.modules.amenities.enabled,false);assert.doesNotMatch(html,/id="arquitetura"|id="midia"|id="plantas"|id="diferenciais"|conteúdo indisponível/);
});
test('zero photos produce a deliberate typographic opening without an empty image frame',()=>{const g=project(),c=planComposition(g),html=architectureComposition(g);assert.equal(c.modules.cover.layout,'typographic');assert.doesNotMatch(html,/class="art-cover-image"/);});
test('the four editorial image compositions are reusable and stories are bounded',()=>{
 assert.equal(planComposition(project(2)).stories[0].type,'B');assert.equal(planComposition(project(3)).stories[0].type,'C');
 const rich=planComposition(project(32));assert.deepEqual(rich.stories.map(s=>s.type),['A','B','D']);assert.ok(rich.stories.flatMap(s=>s.assets).length<=6);assert.equal(rich.photos.length,32);
 const urls=rich.stories.flatMap(s=>s.assets.map(p=>p.url));assert.equal(new Set(urls).size,urls.length);assert.ok(!urls.includes(rich.cover.url));
});
test('orientation metadata controls the cover and HTTPS media is validated',()=>{
 const g=project(2);g.photoAssets=[{url:g.photos[0],width:1600,height:800}];assert.equal(planComposition(g).modules.cover.layout,'landscape');
 assert.equal(photoAsset({url:'https://example.com/p.jpg',width:800,height:1600}).orientation,'portrait');assert.equal(photoAsset('javascript:bad'),null);
});
test('reviewed enrichment is optional, prioritized and never mutates inventory',()=>{
 const g=project(3),before=JSON.stringify(g);assert.equal(planComposition(g,{cover:{url:'https://unreviewed.example/a.jpg'}}).cover.url,g.photos[0]);
 const profile=getEditorialSource('orulo-83252'),c=planComposition(g,profile);assert.equal(c.cover.url,profile.cover.url);assert.deepEqual(c.stories.map(s=>s.type),['A','C']);assert.equal(JSON.stringify(g),before);assert.deepEqual(getEditorialSource('unknown'),{});
});
test('floor plans follow 1–3, 4–10, 11+ composition rules',()=>{
 for(const [count,layout] of [[1,'sequence'],[2,'sequence'],[3,'sequence'],[4,'directory'],[10,'directory'],[11,'categories'],[30,'categories']]){
  const g=project(1,{floor_plans:Array.from({length:count},(_,i)=>({id:String(i),description:`Planta ${i} - ${i%4+1} dorm 55,00m²`,image_url:`https://example.com/plan-${i}.jpg`}))});
  assert.equal(planComposition(g).modules.floorPlans.layout,layout);assert.ok(renderFloorPlans(g).includes('art-plans--'+layout));assert.match(renderFloorPlans(g),/data-plan-image=/);
 }
});
test('plan and configuration categories use available facts and preserve each record once',()=>{
 const plans=[{description:'Implantação'},{description:'Planta 1 dorm 40m²'},{description:'Planta 2 dorm 55m²'},{description:'Garden 2 dorm'},{description:'Cobertura 4 dorm'}],groups=groupFloorPlans(plans);
 assert.deepEqual(groups.map(g=>g.name),['Implantação','1 dormitório','2 dormitórios','Garden','Cobertura']);assert.equal(groups.flatMap(g=>g.items).length,plans.length);
 const units=[{bedrooms:2},{bedrooms:3},{bedrooms:2,unitType:'Garden'}];assert.deepEqual(groupConfigurations(units).map(g=>g.name),['2 dormitórios','3 dormitórios','Garden']);
});
test('amenities have bounded highlights and full disclosure; value never selects a luxury theme',()=>{
 const g=project(4,{features:Array.from({length:23},(_,i)=>({name:'Diferencial '+i}))}),c=planComposition(g);assert.equal(c.highlights.length,8);assert.equal(c.allAmenities.length,23);assert.match(architectureComposition(g),/Todos os diferenciais \(23\)/);
 for(const price of [300000,1000000,5000000])assert.deepEqual(planComposition({...g,price}).order,c.order);
});
test('one serif system is loaded and media enhancement never requests assets en masse',()=>{
 const renderer=readFileSync(new URL('./portal/render.js',import.meta.url),'utf8');assert.doesNotMatch(renderer,/Cormorant/);assert.equal((renderer.match(/family=DM\+Serif\+Display/g)||[]).length,1);
 const js=readFileSync(new URL('./assets/js/property-story.js',import.meta.url),'utf8');assert.doesNotMatch(js,/fetch\(|localStorage|sessionStorage/);
});
