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
import {PILOT_5971,manifest5971,entry5971,proposal5971,validate5971Row,source5971} from './orulo-media-recovery-5971.mjs';
const dir=new URL('./orulo-media-recovery-batches/',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,dir),'utf8'));
export const batchCatalog=read('catalog.json'),batchMaster=read('master.json');
const original=JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8'));validateManifest(original);
if(digest(JSON.stringify(batchMaster))!==batchCatalog.masterHash || batchMaster.originalManifestHash!==digest(JSON.stringify(original)) ||
 new Set(batchMaster.buildings.map(b=>b.buildingId)).size!==batchMaster.buildings.length ||
 batchMaster.buildings.some(b=>!original.includes(b.buildingId)||b.buildingId==='43126'||b.buildingId==='86644'))throw Error('BATCH_MASTER_INVALID');
const imageKeys=['image_url','images','2280x1800','1024x1024','520x280','url'];
const hasImage=p=>imageKeys.some(k=>typeof p?.[k]==='string'&&p[k].length || k==='images'&&Array.isArray(p?.images)&&p.images.length);
// CDN extensions can be uppercase; keep the host and path rules unchanged.
const pattern=/^https:\/\/static\.orulo\.com\.br\/images\/properties\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:[jJ][pP][eE]?[gG]|[pP][nN][gG]|[wW][eE][bB][pP])$/;
const stages=new Set(['HEALTH','JOURNAL_START','INVENTORY','TARGET_READ','SOURCE_AUTH','SOURCE_PLANS','IMAGE_VALIDATION',
 'PLAN','AUTHORIZATION_WAIT','BASELINE','PRE_CAS','INTENT','CAS','ROW_READBACK','GLOBAL_READBACK','INTEGRITY','FINISH']);
const failureCodes=new Set([
 'BATCH_UNKNOWN','BATCH_MANIFEST_INVALID','BATCH_REVIEWED_CONTROL_SHA_REQUIRED','BATCH_PHASE_NOT_RELEASED','BATCH_UNTRUSTED_IMAGE_URL',
 'BATCH_IMAGE_UNAVAILABLE','BATCH_IMAGE_SIGNATURE_INVALID','BATCH_SOURCE_PLAN_IDS_INVALID','BATCH_EXISTING_PLAN_IDS_INVALID',
 'BATCH_SOURCE_PLAN_MISMATCH','BATCH_SOURCE_IMAGE_MISSING','BATCH_APPROVAL_INVALID','BATCH_APPROVAL_VIEW_INVALID','BATCH_ORULO_AUTH_FAILED',
 'BATCH_SOURCE_NETWORK_FAILED','BATCH_SOURCE_HTTP_FAILED','BATCH_SOURCE_INVALID_RESPONSE','BATCH_IMAGE_REQUEST_FAILED',
 'BATCH_MIGRATION_OR_CATALOG_REQUIRED','BATCH_INVENTORY_INVALID_OR_EMPTY','BATCH_PLAN_COVERAGE_INVALID','BATCH_AUTHORIZATION_WAIT_TIMEOUT',
 'BATCH_BASELINE_UNSTABLE','BATCH_CONCURRENT_CHANGE_BEFORE_CAS','BATCH_POST_WRITE_DIVERGENCE','BATCH_RECEIPT_ATTRIBUTION_FAILED',
 'BATCH_UNATTRIBUTED_GLOBAL_CHANGE','BATCH_ONLY_COMMAND_REQUIRED','BATCH_STOP_CONFLICT','BATCH_STOP_NOT_FOUND','BATCH_STOP_UNCHANGED',
 'BATCH_AUTHORIZATION_DIVERGENCE','POSTGRES_AUDIT_RPC_FAILED','POSTGRES_AUDIT_RESPONSE_AMBIGUOUS','POSTGRES_AUDIT_HEALTH_UNVERIFIED',
 'POSTGRES_CAS_COMMITTED_RECONCILE_REQUIRED','POSTGRES_CAS_AMBIGUOUS_RECONCILE_REQUIRED','POSTGRES_JOURNAL_FROZEN_RECONCILE_REQUIRED',
 'POSTGRES_AUDIT_READBACK_DIVERGENCE','POSTGRES_AUDIT_CANONICAL_DIVERGENCE','POSTGRES_CHAIN_DIVERGENCE']);
const networkCodes=new Set(['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT',
 'ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','TIMEOUT','NETWORK_FAILURE']);
export function batchFailureDetails(error){
 const out={code:failureCodes.has(error?.message)?error.message:'BATCH_BLOCKED',...rpcFailureDetails(error)};
 const run=error?.batchRunUuid||error?.auditRunUuid;
 if(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(run||''))out.runUuid=run;
 if(stages.has(error?.batchStage))out.batchStage=error.batchStage;
 if(['orulo','orulo_cdn'].includes(error?.sourceService))out.sourceService=error.sourceService;
 if(['oauth','floor_plans','image'].includes(error?.sourceAction))out.sourceAction=error.sourceAction;
 if(networkCodes.has(error?.networkFailure))out.networkFailure=error.networkFailure;
 if(Number.isInteger(error?.sourceHttpStatus)&&error.sourceHttpStatus>=100&&error.sourceHttpStatus<=599)out.sourceHttpStatus=error.sourceHttpStatus;
 if(batchMaster.buildings.some(b=>b.buildingId===error?.buildingId))out.buildingId=error.buildingId;
 return out;
}
function sourceError(code,context,error){
 const networkFailure=error?.name==='TimeoutError'||error?.name==='AbortError'?'TIMEOUT':networkCodes.has(error?.cause?.code)?error.cause.code:'NETWORK_FAILURE';
 return Object.assign(Error(code),context,error?{networkFailure}:{});
}
export async function batchSourceClient(env,request=fetch){
 const get=async(url,options,context)=>{
  let r;try{r=await request(url,{...options,signal:AbortSignal.timeout(30000)});}
  catch(error){throw sourceError('BATCH_SOURCE_NETWORK_FAILED',context,error);}
  if(!r.ok)throw sourceError(context.sourceAction==='oauth'?'BATCH_ORULO_AUTH_FAILED':'BATCH_SOURCE_HTTP_FAILED',{...context,sourceHttpStatus:r.status});
  return r;
 };
 const auth={sourceService:'orulo',sourceAction:'oauth',batchStage:'SOURCE_AUTH'};
 const r=await get('https://www.orulo.com.br/oauth/token',{method:'POST',body:new URLSearchParams({client_id:env.ORULO_CLIENT_ID,client_secret:env.ORULO_CLIENT_SECRET,grant_type:'client_credentials'})},auth);
 let d;try{d=await r.json();}catch(error){throw sourceError(error instanceof SyntaxError?'BATCH_SOURCE_INVALID_RESPONSE':'BATCH_SOURCE_NETWORK_FAILED',auth,error instanceof SyntaxError?undefined:error);}
 if(typeof d?.access_token!=='string'||!d.access_token)throw sourceError('BATCH_ORULO_AUTH_FAILED',auth);
 return async buildingId=>{
  const context={sourceService:'orulo',sourceAction:'floor_plans',batchStage:'SOURCE_PLANS',buildingId};
  try{return await fetchOruloFloorPlans(buildingId,{Authorization:'Bearer '+d.access_token},{fetchImpl:(url,o)=>get(url,o,context)});}
  catch(error){if(error?.sourceService==='orulo')throw error;throw sourceError(error instanceof SyntaxError?'BATCH_SOURCE_INVALID_RESPONSE':'BATCH_SOURCE_NETWORK_FAILED',context,error instanceof SyntaxError?undefined:error);}
 };
}
export function loadBatch(id){
 if(id===PILOT_5971)return manifest5971();
 const entry=batchCatalog.batches[id];if(!entry)throw Error('BATCH_UNKNOWN');const m=read(entry.file);
 if(digest(JSON.stringify(m))!==entry.hash || m.masterHash!==batchCatalog.masterHash || m.id!==id || m.buildingIds.length>(m.phase===1?20:30) ||
  new Set(m.buildingIds).size!==m.buildingIds.length || m.buildingIds.some(id=>!batchMaster.buildings.some(b=>b.buildingId===id)) ||
  new Set(m.targets.map(t=>t.id)).size!==m.targets.length || m.targets.some(t=>!m.buildingIds.includes(t.buildingId)||!batchMaster.buildings.find(b=>b.buildingId===t.buildingId)?.eligibleUuids.includes(t.id)))throw Error('BATCH_MANIFEST_INVALID');
 return m;
}
export function validateBatchDispatch(env){
 validateDispatch(env);loadBatch(env.ORULO_BATCH_ID);
 if(env.ORULO_BATCH_READY!=='true' || env.ORULO_BATCH_APPROVED_SHA!==env.GITHUB_WORKFLOW_SHA || !/^[a-f0-9]{40}$/.test(env.ORULO_BATCH_APPROVED_SHA||''))throw Error('BATCH_REVIEWED_CONTROL_SHA_REQUIRED');
 if(!batchEntry(env.ORULO_BATCH_ID)?.released)throw Error('BATCH_PHASE_NOT_RELEASED');
}
const batchEntry=id=>id===PILOT_5971?entry5971():batchCatalog.batches[id];
export async function verifyBatchImage(url,request=fetch){
 if(typeof url!=='string'||!pattern.test(url))throw Error('BATCH_UNTRUSTED_IMAGE_URL');
 let r;const context={sourceService:'orulo_cdn',sourceAction:'image',batchStage:'IMAGE_VALIDATION'};
 try{r=await request(url,{headers:{Range:'bytes=0-4095'},redirect:'error',signal:AbortSignal.timeout(15000)});}
 catch(error){throw sourceError('BATCH_IMAGE_REQUEST_FAILED',context,error);}
 if(!r.ok||!r.body)throw sourceError('BATCH_IMAGE_UNAVAILABLE',{...context,sourceHttpStatus:r.status});
 const reader=r.body.getReader();let bytes=Buffer.alloc(0);
 try{while(bytes.length<16){const n=await reader.read();if(n.done)break;bytes=Buffer.concat([bytes,Buffer.from(n.value)]);}}
 catch(error){throw sourceError('BATCH_IMAGE_REQUEST_FAILED',context,error);}
 finally{await reader.cancel().catch(()=>{});}
 const format=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
 if(!format)throw sourceError('BATCH_IMAGE_SIGNATURE_INVALID',context);return {status:r.status,format};
}
export async function batchPatches(rows,fetchPlans,checkImage=verifyBatchImage){
 const byBuilding=new Map(),checks=new Map(),targets=[];let currentBuildingId,batchStage='SOURCE_PLANS';
 const check=async url=>{batchStage='IMAGE_VALIDATION';return checkImage(url);};
 try{
 for(const row of rows){const id=buildingIdOf(row);currentBuildingId=id;if(!byBuilding.has(id)){
  const live=await fetchPlans(id);if(!Array.isArray(live)||new Set(live.map(p=>String(p.id))).size!==live.length)throw Error('BATCH_SOURCE_PLAN_IDS_INVALID');
  byBuilding.set(id,new Map(live.map(p=>[String(p.id),p])));
 }}
 for(const row of rows){
  const buildingId=buildingIdOf(row),old=row.raw_data?.building?.floor_plans;currentBuildingId=buildingId;batchStage='SOURCE_PLANS';
  if(!Array.isArray(old)||old.some(p=>p?.id==null)||new Set(old.map(p=>String(p.id))).size!==old.length)throw Error('BATCH_EXISTING_PLAN_IDS_INVALID');
  const patches=[];
  for(const plan of old){if(hasImage(plan))continue;const live=byBuilding.get(buildingId).get(String(plan.id));if(!live)throw Error('BATCH_SOURCE_PLAN_MISMATCH');
   const patch={id:String(plan.id)};
   for(const k of imageKeys){const v=live[k];if(k==='images'){
    if(Array.isArray(v)&&v.length){for(const url of v){if(!checks.has(url))checks.set(url,await check(url));}patch.images=[...v];}
   }else if(typeof v==='string'&&v.length){if(!checks.has(v))checks.set(v,await check(v));patch[k]=v;}}
   patch.image_url=patch.image_url||patch['2280x1800']||patch['1024x1024']||patch['520x280']||patch.url||patch.images?.[0];
   if(!patch.image_url)throw Error('BATCH_SOURCE_IMAGE_MISSING');patches.push(patch);
  }
  if(patches.length)targets.push({id:row.id,buildingId,patches});
 }
 return {targets:targets.sort((a,b)=>a.id.localeCompare(b.id)),distinctUrls:checks.size,patchableOccurrences:targets.reduce((s,t)=>s+t.patches.length,0),sourceBuildings:byBuilding.size};
 }catch(error){error.batchStage??=batchStage;error.buildingId??=currentBuildingId;throw error;}
}
const merge=(row,patches)=>imageOnlyPlans(row.raw_data,patches).map((p,i)=>hasImage(row.raw_data.building.floor_plans[i])?row.raw_data.building.floor_plans[i]:p);
export function batchApprovalSql(p){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.runUuid)||!/^[a-f0-9]{64}$/.test(p.headHash)||!/^[1-9][0-9]*$/.test(p.githubRunId)||!/^[a-f0-9]{40}$/.test(p.controlSha)||!batchEntry(p.batchId))throw Error('BATCH_APPROVAL_INVALID');
 return `-- Explicit owner confirmation in authenticated SQL Editor only. No public endpoint.\nbegin;\nset local lock_timeout='5s';\ndo $batch_approval$\nbegin\n perform orulo_audit.lock_run('${p.runUuid}'::uuid);\n if not exists(select 1 from orulo_audit.entries e where run_uuid='${p.runUuid}'::uuid and sequence=(select max(sequence) from orulo_audit.entries where run_uuid=e.run_uuid) and hash='${p.headHash}' and event->>'stage'='BATCH_PLAN' and event->>'batchId'='${p.batchId}' and created_at>=clock_timestamp()-interval '10 minutes') then raise exception 'BATCH_PLAN_EXPIRED_OR_CHANGED'; end if;\n perform orulo_audit.authorize_pilot('${p.runUuid}'::uuid,'${p.headHash}','${p.githubRunId}','${p.controlSha}','Owner explicitly confirms only this reviewed batch, UUIDs and image patches');\nend $batch_approval$;\ncommit;`;
}
export function batchApprovalView(p){
 // Render only typed approval metadata. The complete source patches stay in the durable ledger.
 const sql=batchApprovalSql(p),manifest=loadBatch(p.batchId);
 if(!Array.isArray(p.targetIds)||!p.targetIds.length||new Set(p.targetIds).size!==p.targetIds.length||
  p.targetIds.some(id=>!manifest.targets.some(t=>t.id===id))||
  !Array.isArray(p.buildingIds)||!p.buildingIds.length||new Set(p.buildingIds).size!==p.buildingIds.length||
  p.buildingIds.some(id=>!manifest.buildingIds.includes(id))||
  !Number.isSafeInteger(p.patchableOccurrences)||p.patchableOccurrences<0||
  !Number.isSafeInteger(p.distinctUrls)||p.distinctUrls<0)throw Error('BATCH_APPROVAL_VIEW_INVALID');
 const buildings=[...p.buildingIds].sort((a,b)=>Number(a)-Number(b));
 const expectedBuildings=[...new Set(p.targetIds.map(id=>manifest.targets.find(t=>t.id===id).buildingId))].sort((a,b)=>Number(a)-Number(b));
 if(!isDeepStrictEqual(buildings,expectedBuildings))throw Error('BATCH_APPROVAL_VIEW_INVALID');
 const lines=[
  'ÓRULO BATCH_PLAN — AUTORIZAÇÃO ADMINISTRATIVA PENDENTE',
  'Lote: '+p.batchId,
  'Run UUID: '+p.runUuid,
  'GitHub Run ID: '+p.githubRunId,
  'Head Hash: '+p.headHash,
  'Commit SHA: '+p.controlSha,
  'Imóveis: '+p.targetIds.length,
  'Empreendimentos: '+buildings.length+' — IDs: '+buildings.join(', '),
  'Ocorrências de plantas: '+p.patchableOccurrences,
  'URLs distintas: '+p.distinctUrls,
  'Status ao gerar o plano: PENDENTE — WRITE_AUTHORIZED NÃO EMITIDO',
  'Prazo: 10 minutos desde BATCH_PLAN. Não reutilizar plano expirado ou execução encerrada.',
  'Revise o plano completo no ledger antes de confirmar no SQL Editor autenticado do proprietário.'
 ];
 const inspect=`select sequence, hash, event\nfrom orulo_audit.entries\nwhere run_uuid='${p.runUuid}'::uuid\n  and hash='${p.headHash}'\n  and event->>'stage'='BATCH_PLAN';`;
 const editor='https://supabase.com/dashboard/project/wzaegidwtdjuhqchpdpd/sql/new';
 return {
  log:[...lines,'SQL Editor: '+editor,'',
   '========== SQL ADMINISTRATIVO — COPIAR SOMENTE O BLOCO ABAIXO ==========',sql,
   '========== FIM DO SQL ADMINISTRATIVO ==========',
   '::group::Consultar plano completo no ledger — somente leitura',inspect,'::endgroup::'].join('\n'),
  summary:['## Órulo — confirmação administrativa pendente',...lines.slice(1).map(l=>'- '+l),
   '[Abrir SQL Editor autenticado]('+editor+')',
   '### SQL administrativo — confirmação explícita do proprietário','```sql',sql,'```',
   '<details><summary>Consultar plano completo no ledger — somente leitura</summary>','',
   '```sql',inspect,'```','','</details>',
   'Este resumo retrata a geração do plano. A validade e o estado atual são verificados novamente pelo SQL.'].join('\n\n')
 };
}
export async function executeBatch({env,transport,fetchPlans,checkImage=verifyBatchImage,onPlan=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
 validateBatchDispatch(env);presence(env);const batch=loadBatch(env.ORULO_BATCH_ID);let health;
 try{health=await transport.control('health');}catch(error){error.batchStage='HEALTH';throw error;}
 if(health.batchProtocol!==1||health.batchMasterHash!==batchCatalog.masterHash)throw Error('BATCH_MIGRATION_OR_CATALOG_REQUIRED');
 let journal;try{journal=await openPostgresJournal(env,transport);}catch(error){error.batchStage='JOURNAL_START';throw error;}
 const rowArgs=id=>({p_run:journal.runUuid,p_event:{batchId:batch.id,id}});let currentId=null,batchStage='INVENTORY';const verified=[];let recovered=0,confirmed=0;
 try{
  const inventory=await transport.control('batch_inventory',{p_run:journal.runUuid,p_event:{batchId:batch.id}});
  if(inventory.masterHash!==batchCatalog.masterHash||inventory.batchManifestHash!==batchEntry(batch.id).hash||!inventory.targets?.length||inventory.targets.some(t=>!batch.targets.some(a=>a.id===t.id&&a.buildingId===t.buildingId)))throw Error('BATCH_INVENTORY_INVALID_OR_EMPTY');
  batchStage='TARGET_READ';const rows=[];let expectedFullHash;
  for(const t of inventory.targets){const current=await transport.control('batch_row',rowArgs(t.id));if(batch.id===PILOT_5971){validate5971Row(current.row);expectedFullHash=current.fullHash;}rows.push(current.row);}
  if(batch.id===PILOT_5971&&rows.length!==1)throw Error('PILOT5971_ROW_SCOPE_INVALID');
  batchStage='SOURCE_AUTH';const rawSource=fetchPlans||await batchSourceClient(env),source=batch.id===PILOT_5971?source5971(rawSource):rawSource;
  const imageCheck=batch.id===PILOT_5971?async url=>{const checked=await checkImage(url);if(checked?.format!=='jpeg')throw Error('PILOT5971_JPEG_REQUIRED');return checked;}:checkImage;
  batchStage='SOURCE_PLANS';const proposed=await batchPatches(rows,source,imageCheck);
  const targetIds=proposed.targets.map(t=>t.id);if(!isDeepStrictEqual(targetIds,inventory.targets.map(t=>t.id)))throw Error('BATCH_PLAN_COVERAGE_INVALID');
  if(batch.id===PILOT_5971&&!isDeepStrictEqual(proposed.targets,proposal5971().proposal.targets))throw Error('PILOT5971_PATCH_SCOPE_INVALID');
  batchStage='PLAN';const plan=await journal.record({type:'CLIENT_READBACK',stage:'BATCH_PLAN',batchId:batch.id,masterHash:batchCatalog.masterHash,batchManifestHash:batchEntry(batch.id).hash,
   ...(batch.id===PILOT_5971?{proposalText:proposal5971().proposalText,proposalHash:proposal5971().proposalHash,expectedFullHash}:{}),
   buildingIds:[...new Set(proposed.targets.map(t=>t.buildingId))].sort((a,b)=>Number(a)-Number(b)),targetIds,...proposed,writeEnabled:false});
  await onPlan({runUuid:journal.runUuid,githubRunId:env.GITHUB_RUN_ID,controlSha:env.GITHUB_WORKFLOW_SHA,headHash:plan.ack.hash,batchId:batch.id,
   buildingIds:[...new Set(proposed.targets.map(t=>t.buildingId))],targetIds,targets:proposed.targets,patchableOccurrences:proposed.patchableOccurrences,distinctUrls:proposed.distinctUrls,masterHash:batchCatalog.masterHash,batchManifestHash:batchEntry(batch.id).hash});
  batchStage='AUTHORIZATION_WAIT';const deadline=now()+600000;while(!await journal.adoptBatchAuthorization(batch.id,plan.ack.hash,targetIds)){
   if(now()>=deadline)throw Error('BATCH_AUTHORIZATION_WAIT_TIMEOUT');await wait(5000);
  }
  batchStage='BASELINE';const before=await journal.snapshot('BASELINE_V2');if(classifyCaptures(before.capture,before.capture).decision!=='PASSED')throw Error('BATCH_BASELINE_UNSTABLE');
  const baseline=new Map(before.capture.records.map(r=>[r[0],r]));
  for(const target of proposed.targets){batchStage='PRE_CAS';currentId=target.id;const pre=await transport.control('batch_row',rowArgs(currentId)),row=pre.row;
   if(row.id!==target.id||buildingIdOf(row)!==target.buildingId||row.state!=='SP'||row.source!=='novos'||row.active!==true||pre.fullHash!==baseline.get(currentId)?.[4])throw Error('BATCH_CONCURRENT_CHANGE_BEFORE_CAS');
   if(batch.id===PILOT_5971){validate5971Row(row);if(pre.fullHash!==expectedFullHash)throw Error('PILOT5971_APPROVED_STATE_CHANGED');}
   const desired=merge(row,target.patches);if(isDeepStrictEqual(desired,row.raw_data.building.floor_plans))continue;
   batchStage='INTENT';const operationId=randomUUID();await journal.record({type:'INTENT',operationId,id:currentId,buildingId:target.buildingId,expected:row,desiredPlans:desired});
   batchStage='CAS';const result=await journal.apply(operationId);if(result.status!=='UPDATED'||result.id!==currentId||result.receipt?.verified!==true)throw Error('BATCH_STOP_'+result.status);
   confirmed++; // Trusted transactional receipt confirms commit, even if subsequent readback fails.
   batchStage='ROW_READBACK';const post=await transport.control('batch_row',rowArgs(currentId));
   if(preserved(post.row)!==preserved(row)||!isDeepStrictEqual(post.row.raw_data.building.floor_plans,desired)||pre.fullHash!==result.receipt.beforeFullHash||pre.contentHash!==result.receipt.expectedBeforeContentHash||post.fullHash!==result.receipt.afterFullHash||post.contentHash!==result.receipt.expectedAfterContentHash)throw Error('BATCH_POST_WRITE_DIVERGENCE');
   await journal.record({type:'CLIENT_READBACK',stage:'BATCH_ROW_VERIFIED',operationId,id:currentId,fullHash:post.fullHash,contentHash:post.contentHash});
   recovered+=desired.filter((p,i)=>hasImage(p)&&!hasImage(row.raw_data.building.floor_plans[i])).length;
   verified.push({id:currentId,operationId,receipt:result.receipt});
  }
  batchStage='GLOBAL_READBACK';const after=await journal.snapshot('READBACK_V2'),review=classifyCaptures(before.capture,after.capture),attributed=new Set();
  for(const r of verified){const d=review.changes.find(c=>c.uuid===r.id);if(!d||d.before?.fullHash!==r.receipt.beforeFullHash||d.after?.fullHash!==r.receipt.afterFullHash||d.before?.contentHash!==r.receipt.expectedBeforeContentHash||d.after?.contentHash!==r.receipt.expectedAfterContentHash)throw Error('BATCH_RECEIPT_ATTRIBUTION_FAILED');attributed.add(r.id);}
  batchStage='INTEGRITY';const unexplained=review.changes.filter(c=>!attributed.has(c.uuid));await journal.record({type:'CLIENT_READBACK',stage:'BATCH_INTEGRITY',batchId:batch.id,review,attributedIds:[...attributed],unexplained});
  if(!review.schemaMatch||!review.captureStable||unexplained.length)throw Error('BATCH_UNATTRIBUTED_GLOBAL_CHANGE');
  batchStage='FINISH';const finish=await journal.batchFinish();verifyScopeComparison(review,finish.entry.event.comparison);
  return {result:verified.length?'APROVADO':'COMPLETED_NO_CHANGES',batchId:batch.id,buildings:proposed.sourceBuildings,rowsWritten:verified.length,
   recoveredImageOccurrences:recovered,distinctPlannedUrls:proposed.distinctUrls,runUuid:journal.runUuid,headHash:finish.ack.hash,nextBatchAuthorized:false};
 }catch(error){
  error.batchStage??=batchStage;error.batchRunUuid=journal.runUuid;const diagnostic=batchFailureDetails(error);
  if(currentId)try{error.observed=await transport.control('batch_row',rowArgs(currentId));}catch{}
  try{await journal.record({type:'CLIENT_STOP',stage:'BATCH_STOP',batchId:batch.id,id:currentId,confirmedRows:confirmed,verifiedRows:verified.length,code:'BATCH_HALTED_RECONCILIATION_REQUIRED',diagnostic});}catch{}
  error.batchRunUuid=journal.runUuid;throw error;
 }
}
async function main(){
 validateBatchDispatch(process.env);
 if(process.argv[2]==='github-gate'){await checkGitHub(process.env);console.log('Manual owner/main batch gate verified.');return;}
 if(process.argv.length!==3||process.argv[2]!=='batch')throw Error('BATCH_ONLY_COMMAND_REQUIRED');verifySource(process.env.APPROVED_SOURCE_DIR);
 console.log(JSON.stringify(await executeBatch({env:process.env,transport:postgresTransport({url:PROJECT_URL,key:process.env.SUPABASE_SECRET_KEY}),onPlan:p=>{
  const view=batchApprovalView(p);
  console.log(view.log);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,view.summary+'\n',{mode:0o600});
 }})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(JSON.stringify(batchFailureDetails(e)));process.exitCode=1;});
