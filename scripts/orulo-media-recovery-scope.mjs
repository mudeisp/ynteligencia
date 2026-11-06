import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {MANIFEST_HASH,digest} from './orulo-media-recovery-postgres.mjs';

// Sole classification authority: the existing immutable manifest, never caller input.
const ids=JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8'));
if(ids.length!==99 || new Set(ids).size!==99 || digest(JSON.stringify(ids))!==MANIFEST_HASH)
 throw Error('FIXED_LOTE1_MANIFEST_REQUIRED');
const allowed=new Set(ids),uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash=/^[0-9a-f]{32}$/,building=/^[1-9][0-9]*$/;
const counters=()=>({contentChanges:0,timestampOnly:0,insertions:0,deletions:0});

function index(capture){
 if(!capture || !Array.isArray(capture.keys) || !Array.isArray(capture.records) ||
    capture.keys.length!==capture.records.length || capture.seal?.processed!==capture.keys.length ||
    !Array.isArray(capture.columns) || !isDeepStrictEqual(capture.columns,capture.seal.columns) ||
    !isDeepStrictEqual(capture.keys,capture.seal.keysAtSeal))
  throw Error('POSTGRES_SCOPE_CAPTURE_INCOMPLETE');
 const result=new Map();
 capture.records.forEach((r,i)=>{
  if(!Array.isArray(r) || r.length!==6 || !uuid.test(r[0]) || r[0]!==capture.keys[i] ||
     (i>0 && r[0]<=capture.keys[i-1]) || typeof r[2]!=='string' ||
     (r[4]!==null && (!hash.test(r[4]) || !hash.test(r[5]))) ||
     (r[4]===null && r[5]!==null))throw Error('POSTGRES_SCOPE_RECORD_INVALID');
  result.set(r[0],r);
 });
 return result;
}
const evidence=r=>r?{externalId:r[1],buildingId:r[2],updatedAt:r[3],fullHash:r[4],contentHash:r[5]}:null;
function scope(b,a){
 const before=b?.[2],after=a?.[2];
 if(allowed.has(before)||allowed.has(after))return 'IN_SCOPE';
 // A deletion requires its audited BEFORE binding; current inventory is never used.
 if((b&&!building.test(before)) || (a&&!building.test(after)) || (b&&a&&before!==after))return 'UNKNOWN';
 return 'OUT_OF_SCOPE';
}
export function classifyCaptures(before,after){
 const b=index(before),a=index(after),totals={compared:0,...counters()};
 const counts={IN_SCOPE:counters(),OUT_OF_SCOPE:counters(),UNKNOWN:counters()},changes=[];
 for(const id of [...new Set([...b.keys(),...a.keys()])].sort()){
  const old=b.get(id)?.[4]===null?null:b.get(id),next=a.get(id)?.[4]===null?null:a.get(id);
  if(!old&&!next)continue;
  let type;
  if(!old)type='insertions';else if(!next)type='deletions';else{
   totals.compared++;
   if(old[4]===next[4] && (!isDeepStrictEqual(old.slice(1,4),next.slice(1,4)) || old[5]!==next[5]))
    throw Error('POSTGRES_SCOPE_HASH_INCONSISTENCY');
   if(old[5]!==next[5])type='contentChanges';
   else if(old[4]!==next[4]){
    if(old[3]===next[3] || old[1]!==next[1] || old[2]!==next[2])throw Error('POSTGRES_SCOPE_HASH_INCONSISTENCY');
    type='timestampOnly';
   }else continue;
  }
  const classification=scope(old,next);totals[type]++;counts[classification][type]++;
  changes.push({uuid:id,type,scope:classification,before:evidence(old),after:evidence(next)});
 }
 const schemaMatch=isDeepStrictEqual(before.columns,after.columns);
 const captureStable=before.seal.membershipStable===true && after.seal.membershipStable===true;
 const reasons=[];
 if(!schemaMatch)reasons.push('SCHEMA_CHANGED');if(!captureStable)reasons.push('CAPTURE_UNSTABLE');
 if(Object.values(counts.IN_SCOPE).some(Boolean))reasons.push('IN_SCOPE_DIVERGENCE');
 if(Object.values(counts.UNKNOWN).some(Boolean))reasons.push('UNCLASSIFIABLE_DIVERGENCE');
 return {version:1,manifestHash:MANIFEST_HASH,totals,counts,changes,schemaMatch,captureStable,reasons,
  decision:reasons.length?'REVIEW_REQUIRED':changes.length?'PASSED_WITH_OUT_OF_SCOPE_CHANGES':'PASSED'};
}
export function verifyScopeComparison(review,comparison){
 if(comparison?.schemaMatch!==review.schemaMatch || comparison?.captureStable!==review.captureStable ||
    Object.entries(review.totals).some(([key,value])=>comparison?.[key]!==value))
  throw Error('POSTGRES_SCOPE_SERVER_COMPARISON_DIVERGENCE');
}

// Versioned diagnostics only. The operational executor supplies no external
// attestor: neither an OUT_OF_SCOPE label nor a client-provided JSON flag is proof.
// A future trusted reader must independently authenticate the writer, transaction
// and exact transition. Even fixture-attested changes remain blocked by the
// existing STRICT_GLOBAL_V1 server policy; this function cannot authorize writes.
export function classifyBatchIntegrity(before,after,{targetIds=[],verified=[],attestExternal}={}){
 const classifications=['AUTHORIZED_TARGET_CHANGE','EXTERNAL_CHANGE_VERIFIED','EXTERNAL_CHANGE_UNATTRIBUTED','UNEXPECTED_TARGET_CHANGE','SNAPSHOT_INCOMPLETE'];
 const result={version:1,policy:'STRICT_GLOBAL_V1',review:null,changes:[],counts:Object.fromEntries(classifications.map(k=>[k,0])),blocked:true};
 const add=record=>{result.changes.push(record);result.counts[record.classification]++;};
 try{result.review=classifyCaptures(before,after);}catch(error){
  add({uuid:null,classification:'SNAPSHOT_INCOMPLETE',reason:['POSTGRES_SCOPE_CAPTURE_INCOMPLETE','POSTGRES_SCOPE_RECORD_INVALID','POSTGRES_SCOPE_HASH_INCONSISTENCY'].includes(error.message)?error.message:'UNVERIFIABLE_SNAPSHOT',
   beforeRecords:before?.records?.length??null,afterRecords:after?.records?.length??null});return result;
 }
 const targets=new Set(targetIds),receipts=new Map(verified.map(r=>[r.id,r]));
 if(targets.size!==targetIds.length||receipts.size!==verified.length)add({uuid:null,classification:'UNEXPECTED_TARGET_CHANGE',reason:'DUPLICATE_TARGET_OR_RECEIPT'});
 const validReceipt=(change,r)=>r?.status==='UPDATED'&&r.receipt?.verified===true&&r.receipt.id===change.uuid&&uuid.test(r.operationId||'')&&
  change.before?.fullHash===r.receipt.beforeFullHash&&change.after?.fullHash===r.receipt.afterFullHash&&
  change.before?.contentHash===r.receipt.expectedBeforeContentHash&&change.after?.contentHash===r.receipt.expectedAfterContentHash&&
  r.readback?.fullHash===change.after?.fullHash&&r.readback?.contentHash===change.after?.contentHash;
 for(const change of result.review.changes){
  const record={...change,changedFields:change.type==='timestampOnly'?['updated_at']:null};
  if(targets.has(change.uuid)||receipts.has(change.uuid)){
   const receipt=receipts.get(change.uuid),ok=targets.has(change.uuid)&&validReceipt(change,receipt);
   add({...record,classification:ok?'AUTHORIZED_TARGET_CHANGE':'UNEXPECTED_TARGET_CHANGE',changedFields:ok&&Array.isArray(receipt.changedFields)?[...receipt.changedFields]:record.changedFields,reason:ok?'MATCHED_AUTHORIZED_CAS_AND_READBACK':'MISSING_OR_DIVERGENT_AUTHORIZED_RECEIPT',operationId:receipt?.operationId??null});continue;
  }
  let proof;try{proof=typeof attestExternal==='function'?attestExternal(change):null;}catch{}
  const attested=change.scope==='OUT_OF_SCOPE'&&proof?.kind==='INDEPENDENT_WRITER_ATTESTATION_V1'&&proof.uuid===change.uuid&&
   typeof proof.process==='string'&&proof.process.length>0&&typeof proof.eventId==='string'&&proof.eventId.length>0&&
   typeof proof.transactionId==='string'&&/^[1-9]\d*$/.test(proof.transactionId)&&proof.executorTransactionExcluded===true&&
   proof.beforeFullHash===change.before?.fullHash&&proof.afterFullHash===change.after?.fullHash&&
   Array.isArray(proof.changedFields)&&proof.changedFields.length>0&&proof.changedFields.every(f=>typeof f==='string'&&f.length>0);
  add({...record,classification:attested?'EXTERNAL_CHANGE_VERIFIED':'EXTERNAL_CHANGE_UNATTRIBUTED',
   changedFields:attested?[...proof.changedFields]:record.changedFields,
   reason:attested?'INDEPENDENT_ATTESTATION_DIAGNOSTIC_ONLY':'NO_AUTHENTICATED_WRITER_AND_EXACT_TRANSITION_PROOF',
   ...(attested?{origin:{process:proof.process,eventId:proof.eventId,transactionId:proof.transactionId}}:{})});
 }
 for(const r of verified)if(!result.review.changes.some(c=>c.uuid===r.id))add({uuid:r.id,classification:'UNEXPECTED_TARGET_CHANGE',reason:'RECEIPT_WITHOUT_MATCHING_SNAPSHOT_CHANGE',operationId:r.operationId??null});
 if(!result.review.schemaMatch||!result.review.captureStable)add({uuid:null,classification:'SNAPSHOT_INCOMPLETE',reason:!result.review.schemaMatch?'SCHEMA_CHANGED':'CAPTURE_UNSTABLE'});
 result.blocked=result.changes.some(c=>c.classification!=='AUTHORIZED_TARGET_CHANGE');
 return result;
}
