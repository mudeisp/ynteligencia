// Offline simulation only. Existing CAS/write functions are never invoked.
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {fetchOruloFloorPlans} from '../orulo-floor-plans.js';
import {batchPatches,verifyBatchImage} from './orulo-media-recovery-batch.mjs';
import {imageOnlyPlans,preserved,buildingIdOf} from './orulo-media-cas.mjs';
import {validateSource} from './orulo-national-source-readonly.mjs';
import {PRELIMINARY_SHA256,sha,bytes,readJSON,pinnedJSON,saveNew,newDirectory,verifyQueue,options,fail,urlsOf,imageKeys} from './orulo-national-transfer-common.mjs';

const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const localHash=v=>sha(JSON.stringify(ordered(v)));
const hasImage=p=>imageKeys.some(k=>k==='images'?Array.isArray(p?.images)&&p.images.length:typeof p?.[k]==='string'&&p[k].length);
export const unwrapRows=data=>Array.isArray(data)&&data.length===1&&Array.isArray(data[0]?.rows)?data[0].rows:
 data&&Array.isArray(data.rows)?data.rows:data;
export function readRows(directory){
 const names=readdirSync(directory).filter(n=>/^page-\d+\.json$/.test(n)).sort();
 if(!names.length)throw fail('SNAPSHOT_PAGES_REQUIRED');
 return names.flatMap(n=>{const rows=unwrapRows(readJSON(resolve(directory,n)));if(!Array.isArray(rows))throw fail('SNAPSHOT_PAGE_INVALID');return rows;});
}
export function verifyRows(records,recheck){
 if(!Array.isArray(records)||records.length!==Number(recheck.properties))throw fail('FRESH_MEMBERSHIP_INVALID');
 let prev='';const rows=new Map();
 for(const r of records){
  if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.id)||r.id<=prev||sha(r.recordCanonical)!==r.recordSha256)throw fail('FRESH_RECORD_HASH_OR_ORDER_INVALID');
  let row;try{row=JSON.parse(r.recordCanonical);}catch{throw fail('FRESH_CANONICAL_INVALID');}
  if(row.id!==r.id||row.source!=='novos'||!String(row.external_id).startsWith('orulo:'))throw fail('FRESH_SCOPE_INVALID');
  rows.set(r.id,{...r,row});prev=r.id;
 }
 const fingerprint=sha(records.map(r=>r.id+':'+r.recordSha256).join('\n'));
 if(fingerprint!==recheck.inventory_sha256)throw fail('FRESH_GLOBAL_FINGERPRINT_MISMATCH');
 return {rows,fingerprint};
}
export async function readSource(dir,queue,queueSha256){
 const indexPath=resolve(dir,'index.json'),index=pinnedJSON(indexPath,readFileSync(indexPath+'.sha256','utf8').trim());
 if(index.queueSha256!==queueSha256||index.manifestSha256!==queue.manifestSha256||index.productionWrites!==0||index.realCASCalls!==0)throw fail('SOURCE_INDEX_SCOPE_INVALID');
 const allowed=new Map(queue.buildings.map(b=>[b.buildingId,b])),buildings=new Map(),incidents=[],urlOwners=new Map(),seen=new Set();
 for(const ref of index.results){
  if(!allowed.has(ref.buildingId)||seen.has(ref.buildingId))throw fail('SOURCE_INDEX_BUILDING_INVALID');seen.add(ref.buildingId);
  if(ref.quarantined){incidents.push({classification:'UNKNOWN',scope:'BUILDING',buildingId:ref.buildingId,code:'INTERRUPTED_BUILDING_REQUIRES_REVIEW'});continue;}
  try{
   const base=resolve(dir,`buildings/${ref.buildingId}`),r=pinnedJSON(resolve(base,'result.json'),ref.sha256);
   if(r.buildingId!==ref.buildingId||r.provenance!=='DIRECT_AUTHENTICATED_ORULO_API'||r.writeAuthorized!==false)throw fail('SOURCE_PROVENANCE_INVALID');
   const entry={result:r,plans:new Map(),validPlans:new Set(),checks:new Map()};buildings.set(ref.buildingId,entry);
   if(r.incidents.length||r.httpStatus!==200){continue;}
   const raw=readFileSync(resolve(base,'source-response.json'));if(sha(raw)!==r.responseSha256)throw fail('SOURCE_RESPONSE_HASH_MISMATCH');
   const data=validateSource(JSON.parse(raw),ref.buildingId),rawById=new Map(data.floor_plans.map(p=>[String(p.id),p]));
   const normalized=await fetchOruloFloorPlans(ref.buildingId,{}, {fetchImpl:async()=>new Response(raw,{status:200})});
   entry.plans=new Map(normalized.map(p=>[String(p.id),p]));
   const reported=new Set();
   for(const plan of r.plans){
    if(reported.has(plan.planId)||!allowed.get(ref.buildingId).plans.some(p=>p.planId===plan.planId))throw fail('SOURCE_PLAN_REPORT_INVALID');
    reported.add(plan.planId);
    if(plan.status!=='RECOVERABLE')continue;
    const p=entry.plans.get(plan.planId),original=rawById.get(plan.planId);
    if(!p||!isDeepStrictEqual(p,plan.normalizedPlan))throw fail('SOURCE_NORMALIZATION_DIVERGENCE');
    const wanted=[...new Set([...urlsOf(original),...urlsOf(p)])].sort();
    if(!wanted.length||!isDeepStrictEqual(plan.imageChecks.map(c=>c.url).sort(),wanted))throw fail('SOURCE_URL_COVERAGE_INVALID');
    for(const c of plan.imageChecks){
     if(c.evidence!==`cdn/${sha(c.url)}.json`)throw fail('IMAGE_EVIDENCE_PATH_INVALID');
     const meta=pinnedJSON(resolve(dir,c.evidence),c.sha256),prefix=readFileSync(resolve(dir,`cdn/${sha(c.url)}.bin`));
     if(meta.url!==c.url||meta.status!=='VALIDATED_PREFIX'||meta.prefixSha256!==sha(prefix)||prefix.length!==meta.prefixBytes||![200,206].includes(meta.httpStatus))throw fail('IMAGE_EVIDENCE_INVALID');
     const checked=await verifyBatchImage(c.url,async()=>new Response(prefix,{status:meta.httpStatus}));
     const mime=(meta.contentType||'').split(';')[0].trim().toLowerCase();
     if(mime&&!['image/jpeg','image/png','image/webp','application/octet-stream','binary/octet-stream'].includes(mime)||checked.format!==meta.format)throw fail('IMAGE_MIME_OR_SIGNATURE_INVALID');
     const expected={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mime];
     if(expected&&expected!==checked.format)throw fail('IMAGE_MIME_OR_SIGNATURE_INVALID');
     entry.checks.set(c.url,{...checked,evidenceSha256:c.sha256});
    }
    entry.validPlans.add(plan.planId);
   }
   for(const original of data.floor_plans)for(const u of urlsOf(original)){
    if(!urlOwners.has(u))urlOwners.set(u,new Set());urlOwners.get(u).add(ref.buildingId+':'+original.id);
   }
  }catch(e){buildings.delete(ref.buildingId);incidents.push({classification:'BLOCKER',scope:'BUILDING',buildingId:ref.buildingId,code:e.code||'SOURCE_LOCAL_EVIDENCE_INVALID'});}
 }
 return {index,buildings,incidents,urlOwners};
}
export async function simulateProperty(row,plans,checks){
 const result=await batchPatches([row],async()=>plans,async url=>{if(!checks.has(url))throw fail('UNVALIDATED_PATCH_URL');return checks.get(url);});
 if(!result.targets.length)return {status:'ALREADY_COMPLETE',patches:[]};
 const patches=result.targets[0].patches,before=structuredClone(row),after=structuredClone(row);
 after.raw_data.building.floor_plans=imageOnlyPlans(after.raw_data,patches);
 // Merge only existing plants; preserve all non-image metadata and image-bearing plants.
 const old=before.raw_data.building.floor_plans,next=after.raw_data.building.floor_plans;
 if(preserved(before)!==preserved(after)||old.length!==next.length||old.some((p,i)=>
  String(p.id)!==String(next[i].id)||!isDeepStrictEqual(Object.fromEntries(Object.entries(p).filter(([k])=>!imageKeys.includes(k))),Object.fromEntries(Object.entries(next[i]).filter(([k])=>!imageKeys.includes(k))))||hasImage(p)&&!isDeepStrictEqual(p,next[i])))throw fail('SIMULATION_PRESERVATION_FAILED');
 const repeated=await batchPatches([after],async()=>plans,async()=>{throw fail('IDEMPOTENCY_IMAGE_RECHECK_UNEXPECTED');});
 if(repeated.targets.length)throw fail('SIMULATION_IDEMPOTENCY_FAILED');
 // Model only, deliberately NOT the PostgreSQL/legacy CAS algorithm.
 const localExpectedHash=localHash(before),concurrent=structuredClone(before);concurrent.__synthetic_concurrent_change=true;
 if(localHash(concurrent)===localExpectedHash)throw fail('SIMULATION_CONCURRENT_CHANGE_UNDETECTED');
 const rollback=structuredClone(after);
 rollback.raw_data.building.floor_plans=next.map((p,i)=>{
  const restored=Object.fromEntries(Object.entries(p).filter(([k])=>!imageKeys.includes(k)));
  for(const k of imageKeys)if(Object.hasOwn(old[i],k))restored[k]=structuredClone(old[i][k]);return restored;
 });
 if(!isDeepStrictEqual(rollback,before))throw fail('SIMULATION_ROLLBACK_FAILED');
 return {status:'RECOVERABLE',patches,localChecks:{preservation:'PASS',idempotency:'PASS',rollbackModel:'PASS',concurrentChangeModel:'PASS'},
  localModelHashAlgorithm:'SHA256 of sorted JS JSON; NOT a PostgreSQL or legacy CAS hash'};
}
export async function simulate({manifest,records,recheck,source}){
 const fresh=verifyRows(records,recheck),items=[],proposals=[],incidents=[...source.incidents];
 const scopeDrift=fresh.fingerprint!==manifest.inventoryFingerprint;
 for(const old of manifest.properties.filter(r=>r.candidateKeys.length)){
  const item={propertyId:old.id,buildingId:old.buildingId,status:'REQUIRES_REVIEW',productionEligible:false,writeAuthorized:false};
  try{
   const current=fresh.rows.get(old.id);
   if(!current){item.reason='CURRENT_ROW_NOT_FOUND';items.push(item);continue;}
   const row=current.row,stored=row.raw_data?.building?.floor_plans;
   item.currentRecordSha256=current.recordSha256;item.originalRecordSha256=old.recordSha256;
   if(!Array.isArray(stored)){item.reason='CURRENT_PLANS_INVALID';items.push(item);continue;}
   if(stored.length&&stored.every(hasImage)){item.status='ALREADY_COMPLETE';item.reason='CURRENT_REFERENCES_PRESENT';items.push(item);continue;}
   if(current.recordSha256!==old.recordSha256){item.reason='THIRD_PARTY_CHANGE_OR_STALE_MANIFEST';items.push(item);continue;}
   if(buildingIdOf(row)!==old.buildingId||row.active!==true){item.reason='CURRENT_PROTOCOL_SCOPE_REQUIRES_REVIEW';items.push(item);continue;}
   const b=source.buildings.get(old.buildingId);
   if(!b){item.status='SOURCE_ERROR';item.reason='SOURCE_UNQUERIED_OR_EVIDENCE_INVALID';items.push(item);continue;}
   const missing=stored.filter(p=>!hasImage(p)).map(p=>String(p.id));
   if(missing.some(pid=>!b.validPlans.has(pid))){
    const statuses=missing.map(pid=>b.result.plans.find(p=>p.planId===pid)?.status);
    item.status=statuses.includes('SOURCE_ERROR')?'SOURCE_ERROR':statuses.includes('AMBIGUOUS')?'AMBIGUOUS':statuses.includes('SOURCE_NOT_FOUND')?'SOURCE_NOT_FOUND':'REQUIRES_REVIEW';
    item.reason='NOT_ALL_MISSING_PLANS_SOURCE_VALIDATED';items.push(item);continue;
   }
   if(missing.some(pid=>urlsOf(b.plans.get(pid)).some(u=>source.urlOwners.get(u)?.size>1))){item.status='AMBIGUOUS';item.reason='EXACT_URL_SHARED_ACROSS_SOURCE_PLANS';items.push(item);continue;}
   const local=await simulateProperty(row,[...b.plans.values()],b.checks);
   Object.assign(item,local);item.reason='SOURCE_VALIDATED_AND_OFFLINE_IMAGE_PATCH_CHECKS_PASS';
   if(local.patches.length)proposals.push({propertyId:old.id,buildingId:old.buildingId,expectedRecordSha256:current.recordSha256,
    patches:local.patches,writeAuthorized:false,productionEligible:false});
  }catch(e){item.reason=e.code||'EXISTING_PROTOCOL_VALIDATION_FAILED';incidents.push({classification:'BLOCKER',scope:'PROPERTY',propertyId:old.id,code:item.reason});}
  items.push(item);
 }
 const counts={};for(const r of items){r.classification=['RECOVERABLE','ALREADY_COMPLETE'].includes(r.status)?'NON_BLOCKER':r.status==='AMBIGUOUS'?'UNKNOWN':'BLOCKER';counts[r.status]=(counts[r.status]||0)+1;}
 return {version:1,logicalBatchId:'orulo-national-v2',result:'UNKNOWN',writeAuthorized:false,productionWrites:0,realCASCalls:0,
  counts,items,diagnosticProposals:proposals,incidents,inventoryFingerprint:fresh.fingerprint,scopeDrift,
  readOnlySimulation:items.every(r=>['RECOVERABLE','ALREADY_COMPLETE'].includes(r.status))&&!scopeDrift?'PASS':'INCOMPLETE',
  productionEligibility:'BLOCKED_EXISTING_CATALOG_AND_AUTHORIZATION_UNCHANGED',
  mandatoryUnproven:['Production CAS locks, constraints, triggers and exact PostgreSQL comparison','Fresh protocol snapshots and administrative authorization','Source freshness at any future execution','Full-image hashes/visual correspondence and content duplicate analysis'],
  warning:'RECOVERABLE here is a diagnostic source/patch classification. This file is not an executor manifest or authorization.'};
}
async function main(){
 const o=options(process.argv.slice(2),['--manifest','--manifest-sha256','--queue','--queue-sha256','--rows-dir','--recheck','--source-dir','--output-dir']);
 for(const key of ['--manifest','--queue','--queue-sha256','--rows-dir','--recheck','--source-dir','--output-dir'])if(!o[key])throw fail('REQUIRED_ARGUMENT_MISSING');
 const expected=o['--manifest-sha256']||PRELIMINARY_SHA256,manifest=pinnedJSON(o['--manifest'],expected);
 if(manifest.version!==2||manifest.writeAuthorized!==false||manifest.operations?.length)throw fail('PRELIMINARY_MANIFEST_INVALID');
 const queue=verifyQueue(pinnedJSON(o['--queue'],o['--queue-sha256']));if(queue.manifestSha256!==expected)throw fail('QUEUE_MANIFEST_MISMATCH');
 const records=readRows(o['--rows-dir']),rawRecheck=readJSON(o['--recheck']),envelope=Array.isArray(rawRecheck)?rawRecheck[0]:rawRecheck;
 const recheck=envelope.recheck||envelope;
 const source=await readSource(o['--source-dir'],queue,o['--queue-sha256']);
 const result=await simulate({manifest,records,recheck,source}),dir=newDirectory(o['--output-dir']);
 const digest=saveNew(resolve(dir,'simulation.json'),result);saveNew(resolve(dir,'simulation.sha256'),Buffer.from(digest+'  simulation.json\n'));
 saveNew(resolve(dir,'incidents.json'),result.incidents);
 console.log(JSON.stringify({result:result.result,readOnlySimulation:result.readOnlySimulation,counts:result.counts,diagnosticProposals:result.diagnosticProposals.length,productionWrites:0}));
 if(result.readOnlySimulation!=='PASS')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.code||'OFFLINE_SIMULATION_ERROR');process.exitCode=1;});
