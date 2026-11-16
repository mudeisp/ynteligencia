import test from 'node:test';
import assert from 'node:assert/strict';
import {planRecoveryQueue,OUTCOMES} from './orulo-v5-queue.mjs';
test('continues with independent buildings and isolates conflicts',()=>{
 const r=planRecoveryQueue([
  {state:'SP',buildingId:'10',missingPlanIds:['5','5','2']},
  {state:'SP',buildingId:'11',missingPlanIds:['3'],blocked:true,reason:'AUDIT_CONFLICT'},
  {state:'ES',buildingId:'12',missingPlanIds:['4']},
  {state:'SP',buildingId:'13',missingPlanIds:[]}
 ],{batchSize:1});
 assert.equal(r.writeEnabled,false);
 assert.equal(r.summary.eligibleBuildings,2);
 assert.equal(r.summary.exceptionBuildings,1);
 assert.equal(r.summary.completeBuildings,1);
 assert.equal(r.summary.missingPlanCandidates,3);
 assert.deepEqual(r.batches.map(b=>b.state),['SP','ES']);
 assert.equal(r.exceptions[0].outcome,OUTCOMES.ISOLATED);
});
test('ambiguous outcome never enters eligible queue',()=>{
 const r=planRecoveryQueue([{state:'SP',buildingId:'1',missingPlanIds:['2'],sourceStatus:'AMBIGUOUS'}]);
 assert.equal(r.summary.eligibleBuildings,0);
 assert.equal(r.exceptions[0].outcome,OUTCOMES.RECONCILE);
});
test('rejects duplicate building and invalid batch sizes',()=>{
 const x={state:'SP',buildingId:'1',missingPlanIds:['2']};
 assert.throws(()=>planRecoveryQueue([x,x]),/DUPLICATE/);
 assert.throws(()=>planRecoveryQueue([x],{batchSize:11}),/INVALID/);
});
