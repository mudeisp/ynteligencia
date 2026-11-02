import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFloorPlans} from './portal/floor-plans.js';

const plan=(i,image=true)=>({description:`Planta ${String(i).padStart(2,'0')} - 2 dorm 66,00m²`,type:'Apartamento',...(image?{image:`https://example.com/plan-${i}.jpg`}:{})});
const group=plans=>({token:'orulo-1',details:{plans,type:'Vertical'},units:[{unitType:'Apartamento',area:66,bedrooms:2,suites:1,parking_spaces:1}]});

test('desktop exposes plans visually while preserving the interactive mobile directory',()=>{
 const html=renderFloorPlans(group(Array.from({length:9},(_,i)=>plan(i+1))));
 assert.match(html,/art-plans-open-desktop/);
 assert.match(html,/art-plan-open-grid/);
 assert.match(html,/Planta 01/);
 assert.match(html,/Planta 06/);
 assert.match(html,/Ver todas as plantas/);
 assert.match(html,/3 adicionais/);
 assert.match(html,/art-plan-layout/);
 assert.match(html,/@media\(min-width:761px\)/);
});

test('small sets remain directly open without desktop duplication',()=>{
 const html=renderFloorPlans(group([plan(1),plan(2),plan(3)]));
 assert.match(html,/art-plan-sequence--3/);
 assert.doesNotMatch(html,/art-plans-open-desktop/);
});

test('description-only plans remain truthful and never synthesize an unverified image',()=>{
 const html=renderFloorPlans(group([plan(1,false),plan(2,false)]));
 assert.match(html,/art-plans--descriptions/);
 assert.match(html,/Outros desenhos descritos no catálogo/);
 assert.doesNotMatch(html,/example\.com\/plan-/);
});
