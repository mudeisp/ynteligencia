import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFloorPlans} from './portal/floor-plans.js';

const unit={area:67.38,bedrooms:2,parking_spaces:1,suites:1,unitType:'Apartamento'};
const plan=(i,image=true)=>({description:`Planta ${String(i).padStart(2,'0')} - 2 dorm 67,38m²`,type:'Área condominial',image:image?`https://example.com/plan-${i}.jpg`:''});
const group=plans=>({token:'orulo-test',units:[unit],details:{plans,type:'Vertical',finality:'Residencial'}});

test('desktop keeps opened plans and mobile exposes a swipe carousel with the same images',()=>{
  const html=renderFloorPlans(group(Array.from({length:9},(_,i)=>plan(i+1))));
  assert.match(html,/art-plans-desktop-open/);
  assert.match(html,/Ver todas as plantas/);
  assert.match(html,/art-plans-mobile-carousel/);
  assert.match(html,/id="plant-rail"/);
  assert.match(html,/scroll-snap-type:x mandatory/);
  assert.match(html,/Deslize para ver as plantas/);
  assert.match(html,/data-plan-prev/);
  assert.match(html,/data-plan-next/);
  assert.match(html,/@media\(max-width:760px\)/);
  assert.match(html,/loading="lazy"/);
  for(let i=1;i<=9;i++)assert.ok(html.includes(`https://example.com/plan-${i}.jpg`));
});

test('one to three image-backed plans also use the mobile carousel without changing desktop sequence',()=>{
  const html=renderFloorPlans(group([plan(1),plan(2),plan(3)]));
  assert.match(html,/art-plan-sequence--3/);
  assert.match(html,/art-plans-mobile-carousel/);
  assert.match(html,/grid-auto-columns:100%/);
  assert.match(html,/art-plan-sequence[^}]*display:none!important/);
});

test('description-only supplier plans remain factual and do not invent images',()=>{
  const html=renderFloorPlans(group([plan(1,false),plan(2,false)]));
  assert.match(html,/art-plans--descriptions/);
  assert.match(html,/Outros desenhos descritos no catálogo/);
  assert.doesNotMatch(html,/data-plan-image=/);
  assert.doesNotMatch(html,/art-plans-mobile-carousel/);
});
