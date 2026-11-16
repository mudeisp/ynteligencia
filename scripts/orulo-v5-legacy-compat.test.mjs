import test from 'node:test';
import assert from 'node:assert/strict';
import {assessV5LegacyCompatibility} from './orulo-v5-legacy-compat.mjs';
import {OUTCOMES} from './orulo-v5-queue.mjs';
const batch={batchId:'V5-SP-0001',state:'SP',items:[{state:'SP',buildingId:'79694',missingPlanIds:['1'],outcome:OUTCOMES.READY}]};
test('legacy catalog cannot silently authorize a new V5 batch',()=>{
 const r=assessV5LegacyCompatibility({batch,options:{approvedReportHashes:['a'.repeat(64)]},
  legacyCatalog:{masterHash:'abc',batches:{}},
  legacyHealth:{batchProtocol:1,batchMasterHash:'abc',writeEnabled:false}});
 assert.equal(r.compatible,false);
 assert.equal(r.writeEnabled,false);
 assert.ok(r.blockers.includes('V5_BATCH_NOT_IN_LEGACY_CATALOG'));
 assert.ok(r.blockers.includes('V5_MANIFEST_NOT_SUPPORTED_BY_LEGACY_RPC'));
});
test('even matching legacy entry is not sufficient to grant V5 writes',()=>{
 const r=assessV5LegacyCompatibility({batch,options:{approvedReportHashes:['a'.repeat(64)]},
  legacyCatalog:{masterHash:'abc',batches:{'V5-SP-0001':{released:true}}},
  legacyHealth:{batchProtocol:1,batchMasterHash:'abc',writeEnabled:false}});
 assert.equal(r.compatible,false);
 assert.ok(r.blockers.includes('V5_CONTROL_SHA_AND_SQL_APPROVAL_NOT_INSTALLED'));
});
