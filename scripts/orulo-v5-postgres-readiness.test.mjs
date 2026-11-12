import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectV5PostgresReadiness} from './orulo-v5-postgres-readiness.mjs';
import {OUTCOMES} from './orulo-v5-queue.mjs';
const batch={batchId:'V5-SP-0001',state:'SP',items:[{state:'SP',buildingId:'79694',missingPlanIds:['1'],outcome:OUTCOMES.READY}]};
const options={approvedReportHashes:['a'.repeat(64)]};
const legacyCatalog={masterHash:'legacy',batches:{}};
const health={version:2,snapshotProtocol:'paged-v2',storage:'postgres',durable:true,appendOnly:true,
 synchronousCommit:'on',writeEnabled:false,batchProtocol:1,batchMasterHash:'legacy'};
test('reads health without invoking any mutation',async()=>{
 const calls=[];const transport={control:async(action)=>{calls.push(action);return health;},
 apply:async()=>{throw Error('WRITE_NOT_ALLOWED');}};
 const result=await inspectV5PostgresReadiness({batch,options,legacyCatalog,transport});
 assert.deepEqual(calls,['health']);assert.equal(result.auditHealthy,true);
 assert.equal(result.compatible,false);assert.ok(result.blockers.includes('V5_MANIFEST_NOT_SUPPORTED_BY_LEGACY_RPC'));
});
test('fails health readiness without weakening protocol blockers',async()=>{
 const result=await inspectV5PostgresReadiness({batch,options,legacyCatalog,
 transport:{control:async()=>({...health,durable:false})}});
 assert.equal(result.auditHealthy,false);
 assert.ok(result.blockers.includes('POSTGRES_AUDIT_HEALTH_UNVERIFIED'));
});
