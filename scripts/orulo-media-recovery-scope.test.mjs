import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyCaptures,classifyBatchIntegrity,verifyScopeComparison} from './orulo-media-recovery-scope.mjs';
const ids=JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8'));
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const row=(n,building='47422',full='a',content='b',time='2026-01-01T00:00:00')=>[id(n),'unit-'+n,building,time,full.repeat(32),content.repeat(32)];
const capture=records=>({keys:records.map(r=>r[0]),records,columns:[['id','uuid']],seal:{processed:records.length,keysAtSeal:records.map(r=>r[0]),membershipStable:true,columns:[['id','uuid']]}});
test('two external content changes pass with warning and preserve UUID/both building bindings/hashes/type',()=>{
 const before=capture([row(1),row(2)]),after=capture([row(1,'47422','c','d'),row(2,'47422','e','f')]);
 const review=classifyCaptures(before,after);
 assert.equal(review.decision,'PASSED_WITH_OUT_OF_SCOPE_CHANGES');assert.equal(review.counts.OUT_OF_SCOPE.contentChanges,2);
 assert.equal(review.counts.IN_SCOPE.contentChanges,0);assert.equal(review.changes[0].uuid,id(1));
 assert.equal(review.changes[0].before.fullHash,'a'.repeat(32));assert.equal(review.changes[0].after.contentHash,'d'.repeat(32));
 assert.equal(review.changes[0].before.buildingId,'47422');assert.equal(review.changes[0].type,'contentChanges');
 verifyScopeComparison(review,{...review.totals,schemaMatch:true,captureStable:true});
});
test('every ID in immutable manifest remains protected, including content/price/stock hash changes',()=>{
 for(const building of ids){
  const r=classifyCaptures(capture([row(1,building)]),capture([row(1,building,'c','d')]));
  assert.equal(r.decision,'REVIEW_REQUIRED');assert.equal(r.counts.IN_SCOPE.contentChanges,1);
 }
});
test('deletion requires prior audited binding; insertion requires an unambiguous observed binding',()=>{
 for(const [before,after] of [[capture([row(1,'')]),capture([])],[capture([]),capture([row(1,'')])]]){
  const r=classifyCaptures(before,after);assert.equal(r.decision,'REVIEW_REQUIRED');assert.equal(r.changes[0].scope,'UNKNOWN');
 }
 const deleted=classifyCaptures(capture([row(1)]),capture([]));
 assert.equal(deleted.changes[0].scope,'OUT_OF_SCOPE');assert.equal(deleted.changes[0].before.buildingId,'47422');
 assert.equal(deleted.changes[0].after,null);assert.equal(deleted.totals.deletions,1);
});
test('reassociation cannot evade scope; ambiguous external reassociation is blocked',()=>{
 for(const [old,next] of [[ids[0],'47422'],['47422',ids[0]]]){
  assert.equal(classifyCaptures(capture([row(1,old)]),capture([row(1,next,'c','d')])).changes[0].scope,'IN_SCOPE');
 }
 assert.equal(classifyCaptures(capture([row(1)]),capture([row(1,'47423','c','d')])).changes[0].scope,'UNKNOWN');
});
test('unchanged records without building IDs do not fabricate divergences; timestamp changes follow scope',()=>{
 assert.equal(classifyCaptures(capture([row(1,'')]),capture([row(1,'')])).decision,'PASSED');
 for(const building of ['47422',ids[0]]){
  const r=classifyCaptures(capture([row(1,building)]),capture([row(1,building,'c','b','2026-01-02T00:00:00')]));
  assert.equal(r.totals.timestampOnly,1);assert.equal(r.decision,building===ids[0]?'REVIEW_REQUIRED':'PASSED_WITH_OUT_OF_SCOPE_CHANGES');
 }
});
test('schema drift, incomplete capture, missing membership and malformed/inconsistent hashes fail closed',()=>{
 const b=capture([row(1)]),a=capture([row(1)]);a.columns=a.seal.columns=[['id','uuid'],['drift','text']];
 assert.equal(classifyCaptures(b,a).decision,'REVIEW_REQUIRED');
 assert.throws(()=>classifyCaptures(b,{...b,records:[]}),/INCOMPLETE/);
 assert.throws(()=>classifyCaptures(b,{...b,seal:{...b.seal,keysAtSeal:[]}}),/INCOMPLETE/);
 const invalid=capture([row(1)]);invalid.records[0][4]='bad';assert.throws(()=>classifyCaptures(b,invalid),/RECORD_INVALID/);
 assert.throws(()=>classifyCaptures(b,capture([row(1,'47422','a','c')])),/HASH_INCONSISTENCY/);
 assert.throws(()=>classifyCaptures(b,capture([row(1,'47422','c','b')])),/HASH_INCONSISTENCY/);
 const unstable=capture([row(1)]);unstable.seal.membershipStable=false;assert.equal(classifyCaptures(b,unstable).decision,'REVIEW_REQUIRED');
 const review=classifyCaptures(b,b);assert.throws(()=>verifyScopeComparison(review,{...review.totals,contentChanges:1,schemaMatch:true,captureStable:true}),/COMPARISON_DIVERGENCE/);
});

const v8Fixture=()=>{
 const before=capture([row(1,'5971')]),after=capture([row(1,'5971','c','d')]);
 const verified=[{id:id(1),operationId:id(9),status:'UPDATED',receipt:{id:id(1),verified:true,beforeFullHash:'a'.repeat(32),afterFullHash:'c'.repeat(32),expectedBeforeContentHash:'b'.repeat(32),expectedAfterContentHash:'d'.repeat(32)},readback:{fullHash:'c'.repeat(32),contentHash:'d'.repeat(32)},changedFields:['raw_data.building.floor_plans[0].image_url']}];
 return{before,after,options:{targetIds:[id(1)],verified}};
};
test('V8 classifies an exact authorized transition only with verified receipt and matching readback',()=>{
 const f=v8Fixture(),r=classifyBatchIntegrity(f.before,f.after,f.options);
 assert.equal(r.blocked,false);assert.equal(r.counts.AUTHORIZED_TARGET_CHANGE,1);assert.deepEqual(r.changes[0].changedFields,['raw_data.building.floor_plans[0].image_url']);
 // Historical manifest classification remains unchanged; receipt attribution is a separate layer.
 assert.equal(r.review.changes[0].scope,'OUT_OF_SCOPE');
});
test('V8 unexpected target change, absent receipt and divergent readback all block',()=>{
 for(const change of [f=>f.options.verified=[],f=>f.options.verified[0].receipt.verified=false,f=>f.options.verified[0].readback.fullHash='0'.repeat(32),f=>f.options.verified[0].receipt.afterFullHash='0'.repeat(32)]){
  const f=v8Fixture();change(f);const r=classifyBatchIntegrity(f.before,f.after,f.options);assert.equal(r.blocked,true);assert.equal(r.counts.UNEXPECTED_TARGET_CHANGE,1);
 }
});
test('V8 unknown external content changes retain every UUID/hash and do not invent field names',()=>{
 const f=v8Fixture();f.before=capture([...f.before.records,row(2,'64515'),row(3,'64516')]);f.after=capture([...f.after.records,row(2,'64515','e','f'),row(3,'64516','1','2')]);
 const r=classifyBatchIntegrity(f.before,f.after,f.options);assert.equal(r.blocked,true);assert.equal(r.counts.EXTERNAL_CHANGE_UNATTRIBUTED,2);assert.equal(r.changes.length,3);
 for(const c of r.changes.filter(c=>c.uuid!==id(1))){assert.equal(c.changedFields,null);assert.ok(c.before.fullHash&&c.after.fullHash);}
});
test('V8 timestamp-only evidence identifies updated_at but never proves an external actor',()=>{
 const r=classifyBatchIntegrity(capture([row(2)]),capture([row(2,'47422','c','b','2026-01-02')]));assert.equal(r.blocked,true);assert.equal(r.changes[0].classification,'EXTERNAL_CHANGE_UNATTRIBUTED');assert.deepEqual(r.changes[0].changedFields,['updated_at']);
});
test('V8 independently attested fixture origin is diagnostic only; strict server policy still blocks',()=>{
 const before=capture([row(2)]),after=capture([row(2,'47422','c','d')]);
 const attestExternal=change=>({kind:'INDEPENDENT_WRITER_ATTESTATION_V1',uuid:change.uuid,process:'synthetic-authenticated-webhook',eventId:'independent-fixture-event',transactionId:'123',executorTransactionExcluded:true,beforeFullHash:'a'.repeat(32),afterFullHash:'c'.repeat(32),changedFields:['price','updated_at']});
 const r=classifyBatchIntegrity(before,after,{attestExternal});assert.equal(r.counts.EXTERNAL_CHANGE_VERIFIED,1);assert.equal(r.blocked,true);assert.equal(r.policy,'STRICT_GLOBAL_V1');assert.equal(r.changes[0].origin.eventId,'independent-fixture-event');
 // A JSON claim cannot inject the trusted attestor, and mismatched hashes never verify.
 assert.equal(classifyBatchIntegrity(before,after,{attestExternal:{verified:true}}).counts.EXTERNAL_CHANGE_UNATTRIBUTED,1);
 assert.equal(classifyBatchIntegrity(before,after,{attestExternal:c=>({...attestExternal(c),afterFullHash:'0'.repeat(32)})}).counts.EXTERNAL_CHANGE_UNATTRIBUTED,1);
});
test('V8 incomplete snapshots, unstable membership and schema drift never permit finish',()=>{
 const f=v8Fixture();for(const bad of [{...f.after,records:[]},{...f.after,seal:{...f.after.seal,membershipStable:false}},{...f.after,columns:[['new','text']]}]){const r=classifyBatchIntegrity(f.before,bad,f.options);assert.equal(r.blocked,true);assert.ok(r.counts.SNAPSHOT_INCOMPLETE);}
});
test('V8 duplicate receipts and a receipt without a snapshot delta cannot hide another operation',()=>{
 const f=v8Fixture();assert.equal(classifyBatchIntegrity(f.before,f.after,{...f.options,verified:[...f.options.verified,...f.options.verified]}).blocked,true);
 const r=classifyBatchIntegrity(f.before,f.before,f.options);assert.equal(r.blocked,true);assert.equal(r.changes[0].reason,'RECEIPT_WITHOUT_MATCHING_SNAPSHOT_CHANGE');
});
