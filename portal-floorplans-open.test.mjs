import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFloorPlans} from './portal/floor-plans.js';

const unit={area:67.38,bedrooms:2,parking_spaces:1,suites:1,unitType:'Apartamento'};
const plan=(i,image=true)=>({description:`Planta ${String(i).padStart(2,'0')} - 2 dorm 67,38m²`,type:'Área condominial',image:image?`https://example.com/plan-${i}.jpg`:''});
const group=plans=>({token:'orulo-test',units:[unit],details:{plans,type:'Vertical',finality:'Residencial'}});

test('desktop exposes floor-plan images while retaining compact mobile controls',()=>{
  const html=renderFloorPlans(group(Array.from({length:9},(_,i)=>plan(i+1))));
  assert.match(html,/art-plans-desktop-open/);
  assert.equal((html.match(/art-plan-open-card/g)||[]).length,9);
  assert.match(html,/Ver todas as plantas/);
  assert.match(html,/art-plan-layout wrap/);
  assert.match(html,/@media\(max-width:760px\)/);
  assert.match(html,/loading="lazy"/);
});

test('description-only supplier plans remain factual and do not invent images',()=>{
  const html=renderFloorPlans(group([plan(1,false),plan(2,false)]));
  assert.match(html,/art-plans--descriptions/);
  assert.match(html,/Outros desenhos descritos no catálogo/);
  assert.doesNotMatch(html,/data-plan-image=/);
  assert.doesNotMatch(html,/art-plans-desktop-open/);
});
