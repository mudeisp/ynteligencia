import {readFileSync,appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchOruloFloorPlans} from '../orulo-floor-plans.js';
import {imageOnlyPlans,preserved,buildingIdOf} from './orulo-media-cas.mjs';
import {validateDispatch,checkGitHub,presence,verifySource,validateManifest} from './orulo-media-recovery-actions.mjs';
import {digest,openPostgresJournal,postgresTransport,PROJECT_URL,rpcFailureDetails} from './orulo-media-recovery-postgres.mjs';
import {classifyCaptures,verifyScopeComparison} from './orulo-media-recovery-scope.mjs';
const dir=new URL('./orulo-media-recovery-batches/',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,dir),'utf8'));
export const batchCatalog=read('catalog.json'),batchMaster=read('master.json');
const original=JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8'));validateManifest(original);
if(digest(JSON.stringify(batchMaster))!==batchCatalog.masterHash || batchMaster.originalManifestHash!==digest(JSON.stringify(original)) ||
 new Set(batchMaster.buildings.map(b=>b.buildingId)).size!==batchMaster.buildings.length ||
 batchMaster.buildings.some(b=>!original.includes(b.buildingId)||b.buildingId==='43126'||b.buildingId==='86644'))throw Error('BATCH_MASTER_INVALID');
const imageKeys=['image_url','images','2280x1800','1024x1024','520x280','url'];
const hasImage=p=>imageKeys.some(k=>typeof p?.[k]==='string'&&p[k].length || k==='images'&&Array.isArray(p?.images)&&p.images.length);
const pattern=/^https:\/\/static\.orulo\.com\.br\/images\/properties\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;
export function loadBatch(id){
 const entry=batchCatalog.batches[id];if(!entry)throw Error('BATCH_UNKNOWN');const m=read(entry.file);
 if(digest(JSON.stringify(m))!==entry.hash || m.masterHash!==batchCatalog.masterHash || m.id!==id || m.buildingIds.length>(m.phase===1?20:30) ||
  new Set(m.buildingIds).size!==m.buildingIds.length || m.buildingIds.some(id=>!batchMaster.buildings.some(b=>b.buildingId===id)) ||
  new Set(m.targets.map(t=>t.id)).size!==m.targets.length || m.targets.some(t=>!m.buildingIds.includes(t.buildingId)||!batchMaster.buildings.find(b=>b.buildingId===t.buildingId)?.eligibleUuids.includes(t.id)))throw Error('BATCH_MANIFEST_INVALID');
 return m;
}
export function validateBatchDispatch(env){
 validateDispatch(env);loadBatch(env.ORULO_BATCH_ID);
 if(env.ORULO_BATCH_READY!=='true' || env.ORULO_BATCH_APPROVED_SHA!==env.GITHUB_WORKFLOW_SHA || !/^[a-f0-9]{40}$/.test(env.ORULO_BATCH_APPROVED_SHA||''))throw Error('BATCH_REVIEWED_CONTROL_SHA_REQUIRED');
 if(!batchCatalog.batches[env.ORULO_BATCH_ID].released)throw Error('BATCH_PHASE_NOT_RELEASED');
}
export async function verifyBatchImage(url,request=fetch){
 if(typeof url!=='string'||!pattern.test(url))throw Error('BATCH_UNTRUSTED_IMAGE_URL');
 const r=await request(url,{headers:{Range:'bytes=0-4095'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok||!r.body)throw Error('BATCH_IMAGE_UNAVAILABLE');
 const reader=r.body.getReader();let bytes=Buffer.alloc(0);
 try{while(bytes.length<16){const n=await reader.read();if(n.done)break;bytes=Buffer.concat([bytes,Buffer.from(n.value)]);}}finally{await reader.cancel();}
 const format=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
 if(!format)throw Error('BATCH_IMAGE_SIGNATURE_INVALID');return {status:r.status,format};
}
export async function batchPatches(rows,fetchPlans,checkImage=verifyBatchImage){
 const byBuilding=new Map(),checks=new Map(),targets=[];
 for(const row of rows){const id=buildingIdOf(row);if(!byBuilding.has(id)){
  const live=await fetchPlans(id);if(!Array.isArray(live)||new Set(live.map(p=>String(p.id))).size!==live.length)throw Error('BATCH_SOURCE_PLAN_IDS_INVALID');
  byBuilding.set(id,new Map(live.map(p=>[String(p.id),p])));
 }}
 for(const row of rows){
  const buildingId=buildingIdOf(row),old=row.raw_data?.building?.floor_plans;
  if(!Array.isArray(old)||old.some(p=>p?.id==null)||new Set(old.map(p=>String(p.id))).size!==old.length)throw Error('BATCH_EXISTING_PLAN_IDS_INVALID');
  const patches=[];
  for(const plan of old){if(hasImage(plan))continue;const live=byBuilding.get(buildingId).get(String(plan.id));if(!live)throw Error('BATCH_SOURCE_PLAN_MISMATCH');
   const patch={id:String(plan.id)};
   for(const k of imageKeys){const v=live[k];if(k==='images'){
    if(Array.isArray(v)&&v.length){for(const url of v){if(!checks.has(url))checks.set(url,await checkImage(url));}patch.images=[...v];}
   }else if(typeof v==='string'&&v.length){if(!checks.has(v))checks.set(v,await checkImage(v));patch[k]=v;}}
   patch.image_url=patch.image_url||patch['2280x1800']||patch['1024x1024']||patch['520x280']||patch.url||patch.images?.[0];
   if(!patch.image_url)throw Error('BATCH_SOURCE_IMAGE_MISSING');patches.push(patch);
  }
  if(patches.length)targets.push({id:row.id,buildingId,patches});
 }
 return {targets:targets.sort((a,b)=>a.id.localeCompare(b.id)),distinctUrls:checks.size,patchableOccurrences:targets.reduce((s,t)=>s+t.patches.length,0),sourceBuildings:byBuilding.size};
}
const merge=(row,patches)=>imageOnlyPlans(row.raw_data,patches).map((p,i)=>hasImage(row.raw_data.building.floor_plans[i])?row.raw_data.building.floor_plans[i]:p);
export function batchApprovalSql(p){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.runUuid)||!/^[a-f0-9]{64}$/.test(p.headHash)||!/^[1-9][0-9]*$/.test(p.githubRunId)||!/^[a-f0-9]{40}$/.test(p.controlSha)||!batchCatalog.batches[p.batchId])throw Error('BATCH_APPROVAL_INVALID');
 return `-- Explicit owner confirmation in authenticated SQL Editor only. No public endpoint.\nbegin;\nset local lock_timeout='5s';\ndo $batch_approval$\nbegin\n perform orulo_audit.lock_run('${p.runUuid}'::uuid);\n if not exists(select 1 from orulo_audit.entries e where run_uuid='${p.runUuid}'::uuid and sequence=(select max(sequence) from orulo_audit.entries where run_uuid=e.run_uuid) and hash='${p.headHash}' and event->>'stage'='BATCH_PLAN' and event->>'batchId'='${p.batchId}' and created_at>=clock_timestamp()-interval '10 minutes') then raise exception 'BATCH_PLAN_EXPIRED_OR_CHANGED'; end if;\n perform orulo_audit.authorize_pilot('${p.runUuid}'::uuid,'${p.headHash}','${p.githubRunId}','${p.controlSha}','Owner explicitly confirms only this reviewed batch, UUIDs and image patches');\nend $batch_approval$;\ncommit;`;
}
async function sourceClient(env){
 const r=await fetch('https://www.orulo.com.br/oauth/token',{method:'POST',body:new URLSearchParams({client_id:env.ORULO_CLIENT_ID,client_secret:env.ORULO_CLIENT_SECRET,grant_type:'client_credentials'}),signal:AbortSignal.timeout(30000)});
 const d=await r.json();if(!r.ok||!d.access_token)throw Error('BATCH_ORULO_AUTH_FAILED');
 return id=>fetchOruloFloorPlans(id,{Authorization:'Bearer '+d.access_token},{fetchImpl:(url,o)=>fetch(url,{...o,signal:AbortSignal.timeout(30000)})});
}
export async function executeBatch({env,transport,fetchPlans,checkImage=verifyBatchImage,onPlan=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
 validateBatchDispatch(env);presence(env);const batch=loadBatch(env.ORULO_BATCH_ID),health=await transport.control('health');
 if(health.batchProtocol!==1||health.batchMasterHash!==batchCatalog.masterHash)throw Error('BATCH_MIGRATION_OR_CATALOG_REQUIRED');
 const journal=await openPostgresJournal(env,transport),rowArgs=id=>({p_run:journal.runUuid,p_event:{batchId:batch.id,id}});let currentId=null;const verified=[];let recovered=0;
 try{
  const inventory=await transport.control('batch_inventory',{p_run:journal.runUuid,p_event:{batchId:batch.id}});
  if(inventory.masterHash!==batchCatalog.masterHash||inventory.batchManifestHash!==batchCatalog.batches[batch.id].hash||!inventory.targets?.length||inventory.targets.some(t=>!batch.targets.some(a=>a.id===t.id&&a.buildingId===t.buildingId)))throw Error('BATCH_INVENTORY_INVALID_OR_EMPTY');
  const rows=[];for(const t of inventory.targets)rows.push((await transport.control('batch_row',rowArgs(t.id))).row);
  const proposed=await batchPatches(rows,fetchPlans||await sourceClient(env),checkImage);
  const targetIds=proposed.targets.map(t=>t.id);if(!isDeepStrictEqual(targetIds,inventory.targets.map(t=>t.id)))throw Error('BATCH_PLAN_COVERAGE_INVALID');
  const plan=await journal.record({type:'CLIENT_READBACK',stage:'BATCH_PLAN',batchId:batch.id,masterHash:batchCatalog.masterHash,batchManifestHash:batchCatalog.batches[batch.id].hash,
   buildingIds:[...new Set(proposed.targets.map(t=>t.buildingId))].sort((a,b)=>Number(a)-Number(b)),targetIds,...proposed,writeEnabled:false});
  await onPlan({runUuid:journal.runUuid,githubRunId:env.GITHUB_RUN_ID,controlSha:env.GITHUB_WORKFLOW_SHA,headHash:plan.ack.hash,batchId:batch.id,
   buildingIds:[...new Set(proposed.targets.map(t=>t.buildingId))],targetIds,targets:proposed.targets,patchableOccurrences:proposed.patchableOccurrences,distinctUrls:proposed.distinctUrls,masterHash:batchCatalog.masterHash,batchManifestHash:batchCatalog.batches[batch.id].hash});
  const deadline=now()+600000;while(!await journal.adoptBatchAuthorization(batch.id,plan.ack.hash,targetIds)){
   if(now()>=deadline)throw Error('BATCH_AUTHORIZATION_WAIT_TIMEOUT');await wait(5000);
  }
  const before=await journal.snapshot('BASELINE_V2');if(classifyCaptures(before.capture,before.capture).decision!=='PASSED')throw Error('BATCH_BASELINE_UNSTABLE');
  const baseline=new Map(before.capture.records.map(r=>[r[0],r]));
  for(const target of proposed.targets){currentId=target.id;const pre=await transport.control('batch_row',rowArgs(currentId)),row=pre.row;
   if(row.id!==target.id||buildingIdOf(row)!==target.buildingId||row.state!=='SP'||row.source!=='novos'||row.active!==true||pre.fullHash!==baseline.get(currentId)?.[4])throw Error('BATCH_CONCURRENT_CHANGE_BEFORE_CAS');
   const desired=merge(row,target.patches);if(isDeepStrictEqual(desired,row.raw_data.building.floor_plans))continue;
   const operationId=randomUUID();await journal.record({type:'INTENT',operationId,id:currentId,buildingId:target.buildingId,expected:row,desiredPlans:desired});
   const result=await journal.apply(operationId);if(result.status!=='UPDATED'||result.id!==currentId||result.receipt?.verified!==true)throw Error('BATCH_STOP_'+result.status);
   const post=await transport.control('batch_row',rowArgs(currentId));
   if(preserved(post.row)!==preserved(row)||!isDeepStrictEqual(post.row.raw_data.building.floor_plans,desired)||pre.fullHash!==result.receipt.beforeFullHash||pre.contentHash!==result.receipt.expectedBeforeContentHash||post.fullHash!==result.receipt.afterFullHash||post.contentHash!==result.receipt.expectedAfterContentHash)throw Error('BATCH_POST_WRITE_DIVERGENCE');
   await journal.record({type:'CLIENT_READBACK',stage:'BATCH_ROW_VERIFIED',operationId,id:currentId,fullHash:post.fullHash,contentHash:post.contentHash});
   recovered+=desired.filter((p,i)=>hasImage(p)&&!hasImage(row.raw_data.building.floor_plans[i])).length;
   verified.push({id:currentId,operationId,receipt:result.receipt});
  }
  const after=await journal.snapshot('READBACK_V2'),review=classifyCaptures(before.capture,after.capture),attributed=new Set();
  for(const r of verified){const d=review.changes.find(c=>c.uuid===r.id);if(!d||d.before?.fullHash!==r.receipt.beforeFullHash||d.after?.fullHash!==r.receipt.afterFullHash||d.before?.contentHash!==r.receipt.expectedBeforeContentHash||d.after?.contentHash!==r.receipt.expectedAfterContentHash)throw Error('BATCH_RECEIPT_ATTRIBUTION_FAILED');attributed.add(r.id);}
  const unexplained=review.changes.filter(c=>!attributed.has(c.uuid));await journal.record({type:'CLIENT_READBACK',stage:'BATCH_INTEGRITY',batchId:batch.id,review,attributedIds:[...attributed],unexplained});
  if(!review.schemaMatch||!review.captureStable||unexplained.length)throw Error('BATCH_UNATTRIBUTED_GLOBAL_CHANGE');
  const finish=await journal.batchFinish();verifyScopeComparison(review,finish.entry.event.comparison);
  return {result:verified.length?'APROVADO':'COMPLETED_NO_CHANGES',batchId:batch.id,buildings:proposed.sourceBuildings,rowsWritten:verified.length,
   recoveredImageOccurrences:recovered,distinctPlannedUrls:proposed.distinctUrls,runUuid:journal.runUuid,headHash:finish.ack.hash,nextBatchAuthorized:false};
 }catch(error){
  if(currentId)try{error.observed=await transport.control('batch_row',rowArgs(currentId));}catch{}
  try{await journal.record({type:'CLIENT_STOP',stage:'BATCH_STOP',batchId:batch.id,id:currentId,confirmedRows:verified.length,code:'BATCH_HALTED_RECONCILIATION_REQUIRED',...rpcFailureDetails(error)});}catch{}
  error.batchRunUuid=journal.runUuid;throw error;
 }
}
async function main(){
 validateBatchDispatch(process.env);
 if(process.argv[2]==='github-gate'){await checkGitHub(process.env);console.log('Manual owner/main batch gate verified.');return;}
 if(process.argv.length!==3||process.argv[2]!=='batch')throw Error('BATCH_ONLY_COMMAND_REQUIRED');verifySource(process.env.APPROVED_SOURCE_DIR);
 console.log(JSON.stringify(await executeBatch({env:process.env,transport:postgresTransport({url:PROJECT_URL,key:process.env.SUPABASE_SECRET_KEY}),onPlan:p=>{
  const text='BATCH PLAN — no authorization issued\n'+JSON.stringify(p,null,2)+'\nReview active run and exact scope, then explicitly Run this block in the owner SQL Editor within ten minutes:\n'+batchApprovalSql(p);
  console.log(text);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text+'\n',{mode:0o600});
 }})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify({code:/^(BATCH|POSTGRES)_[A-Z_]+$/.test(e.message)?e.message:'BATCH_BLOCKED',runUuid:e.batchRunUuid,...rpcFailureDetails(e)}));process.exitCode=1;});
