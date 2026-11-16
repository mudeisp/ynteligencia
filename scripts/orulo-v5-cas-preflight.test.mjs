import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAuditedBatch,assertAuditedExecutionReady} from './orulo-v5-cas-preflight.mjs';
import {OUTCOMES} from './orulo-v5-queue.mjs';
const batch={batchId:'V5-SP-0001',state:'SP',items:[{state:'SP',buildingId:'79694',missingPlanIds:['12','13'],outcome:OUTCOMES.READY}]};
const options={approvedReportHashes:['a'.repeat(64)]};
test('builds a deterministic, read-only manifest',()=>{
 const a=prepareAuditedBatch(batch,options),b=prepareAuditedBatch(batch,options);
 assert.equal(a.manifestHash,b.manifestHash);
 assert.equal(a.writeEnabled,false);
 assert.equal(a.targets.length,1);
});
test('rejects protected, pending and unapproved targets',()=>{
 assert.throws(()=>prepareAuditedBatch(batch,{...options,protectedBuildingIds:['79694']}),/PROTECTED/);
 assert.throws(()=>prepareAuditedBatch(batch,{...options,pendingReconciliationIds:['79694']}),/PROTECTED/);
 assert.throws(()=>prepareAuditedBatch(batch,{approvedReportHashes:[]}),/APPROVAL_INPUT/);
 assert.throws(()=>prepareAuditedBatch({...batch,items:[{...batch.items[0],outcome:OUTCOMES.RECONCILE}]},options),/TARGET_INVALID/);
});
test('requires explicit approved manifest and fresh baseline',()=>{
 const manifest=prepareAuditedBatch(batch,options);
 const health={durable:true,synchronousCommit:'on',writeEnabled:false};
 const approval={explicit:true,verified:true,manifestHash:manifest.manifestHash};
 const baseline={fresh:true,manifestHash:manifest.manifestHash};
 assert.equal(assertAuditedExecutionReady({manifest,health,approval,baseline}).readyForExistingExecutor,true);
 assert.throws(()=>assertAuditedExecutionReady({manifest,health,approval:{...approval,verified:false},baseline}),/NOT_READY/);
 assert.throws(()=>assertAuditedExecutionReady({manifest,health,approval,baseline:{...baseline,fresh:false}}),/NOT_READY/);
});
