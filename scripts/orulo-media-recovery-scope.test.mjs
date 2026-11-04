import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyCaptures,verifyScopeComparison} from './orulo-media-recovery-scope.mjs';
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
