import test from 'node:test';
import assert from 'node:assert/strict';
import {queueFromVerifiedReports} from './orulo-v5-reports.mjs';
const report={status:'COMPLETED',writes:0,state:'PE',batchId:'V4-PE-P1-NEW-013',items:[
 {buildingId:'83921',status:'RECOVERABLE',recoverablePlans:[{planId:'12',urls:['https://static.orulo.com.br/images/properties/a/b.jpg']}]},
 {buildingId:'83923',status:'DATA_CONFLICT',reason:'PLAN_IDS_CHANGED'},
 {buildingId:'84359',status:'SOURCE_MISSING'}
]};
test('maps source-verified candidates and isolates exceptions',()=>{
 const result=queueFromVerifiedReports([report]);
 assert.equal(result.writeEnabled,false);
 assert.equal(result.summary.eligibleBuildings,1);
 assert.equal(result.summary.exceptionBuildings,2);
 assert.deepEqual(result.batches[0].items[0].missingPlanIds,['12']);
});
test('rejects reports with writes or overlapping buildings',()=>{
 assert.throws(()=>queueFromVerifiedReports([{...report,writes:1}]),/UNVERIFIED/);
 assert.throws(()=>queueFromVerifiedReports([report,report]),/OVERLAP/);
});
