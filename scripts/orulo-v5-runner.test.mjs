import test from 'node:test';
import assert from 'node:assert/strict';
import {runV5Batch} from './orulo-v5-runner.mjs';
const manifest={writeEnabled:false,manifestHash:'abc',targets:[{buildingId:'1'},{buildingId:'2'},{buildingId:'3'}]};
const authorize=async()=>({manifestHash:'abc',verified:true});
const receipt=buildingId=>({verified:true,buildingId,casReadbackVerified:true,auditReceiptVerified:true});
test('isolates proven prewrite source failure and continues',async()=>{
 const seen=[];const result=await runV5Batch({manifest,authorize,record:async x=>seen.push(x),execute:async({target})=>{
 if(target.buildingId==='2')throw Object.assign(Error('BATCH_IMAGE_UNAVAILABLE'),{phase:'PREWRITE',casAttempted:false});
 return receipt(target.buildingId);}});
 assert.deepEqual(result.completed,['1','3']);assert.equal(result.isolated.length,1);assert.equal(seen.length,3);
});
test('stops on global integrity failures',async()=>{
 let calls=0;await assert.rejects(runV5Batch({manifest,authorize,record:async()=>{},execute:async()=>{calls++;throw Error('BATCH_UNATTRIBUTED_GLOBAL_CHANGE');}}),/V5_GLOBAL_STOP/);assert.equal(calls,1);
});
test('rejects unverified authorization',async()=>{
 await assert.rejects(runV5Batch({manifest,authorize:async()=>({verified:false}),record:async()=>{},execute:async()=>{}}),/NOT_AUTHORIZED/);
});
test('does not isolate ambiguous CAS errors or unproven prewrite failures',async()=>{
 for(const error of [Error('BATCH_CONCURRENT_CHANGE_BEFORE_CAS'),Error('BATCH_IMAGE_UNAVAILABLE')]){
  let calls=0;
  await assert.rejects(runV5Batch({manifest,authorize,record:async()=>{},execute:async()=>{calls++;throw error;}}),/V5_GLOBAL_STOP/);
  assert.equal(calls,1);
 }
});
test('rejects receipt without audited CAS readback',async()=>{
 await assert.rejects(runV5Batch({manifest,authorize,record:async()=>{},execute:async({target})=>({verified:true,buildingId:target.buildingId})}),/V5_GLOBAL_STOP/);
});
