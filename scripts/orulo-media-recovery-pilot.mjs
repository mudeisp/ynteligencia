import {readFileSync,appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isIP} from 'node:net';
import {fetchOruloFloorPlans} from '../orulo-floor-plans.js';
import {imageOnlyPlans,preserved,buildingIdOf} from './orulo-media-cas.mjs';
import {validateDispatch,checkGitHub,verifySource,presence,validateManifest} from './orulo-media-recovery-actions.mjs';
import {openPostgresJournal,postgresTransport,PROJECT_URL,digest} from './orulo-media-recovery-postgres.mjs';
import {classifyCaptures,verifyScopeComparison} from './orulo-media-recovery-scope.mjs';
const ids=JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8'));
validateManifest(ids);
export const PILOT_BUILDING_ID=ids[0];
export function pilotAuthorizationSql({runUuid,headHash,githubRunId,controlSha}){
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runUuid) || !/^[0-9a-f]{64}$/.test(headHash) ||
    !/^[1-9][0-9]*$/.test(githubRunId) || !/^[0-9a-f]{40}$/.test(controlSha))throw Error('PILOT_APPROVAL_IDENTIFIERS_INVALID');
 return `-- Running this block explicitly confirms the reviewed plan. Administrator SQL Editor only.
begin;
set local lock_timeout='5s';
do $pilot_approval$
begin
 perform orulo_audit.lock_run('${runUuid}'::uuid);
 if not exists(select 1 from orulo_audit.entries e where e.run_uuid='${runUuid}'::uuid
  and e.sequence=(select max(sequence) from orulo_audit.entries where run_uuid=e.run_uuid)
  and e.hash='${headHash}' and e.kind='CLIENT_READBACK' and e.event->>'stage'='PILOT_PLAN'
  and e.event->>'buildingId'='43126' and e.created_at>=clock_timestamp()-interval '10 minutes') then
  raise exception 'PILOT_PLAN_EXPIRED_OR_CHANGED';
 end if;
 perform orulo_audit.authorize_pilot('${runUuid}'::uuid,'${headHash}','${githubRunId}','${controlSha}',
  'Owner explicitly confirms this reviewed building 43126 plan and its UUIDs');
end $pilot_approval$;
commit;`;
}
export function pilotApprovalSummary(plan){
 return ['## Órulo — confirmação administrativa pendente',
  `Run ID: ${plan.githubRunId} · Run UUID: ${plan.runUuid} · Building: ${PILOT_BUILDING_ID}`,
  `Commit: ${plan.controlSha} · Hash do plano: ${plan.headHash}`,
  `UUIDs: ${plan.targetIds.length} · Registros candidatos: ${plan.candidateRows} · Imagens candidatas nos registros: ${plan.candidateImages} · URLs distintas: ${plan.distinctImages}`,
  ...plan.targetIds.map(id=>'- '+id),
  'Nenhuma autorização foi emitida. Confirme que este run continua ativo, revise os dados e copie o bloco abaixo para o SQL Editor autenticado do proprietário. Clicar Run no SQL Editor é a confirmação explícita. Prazo: 10 minutos desde PILOT_PLAN; não reutilize planos antigos.',
  '[Abrir SQL Editor](https://supabase.com/dashboard/project/wzaegidwtdjuhqchpdpd/sql/new)',
  '```sql',pilotAuthorizationSql(plan),'```'].join('\n\n');
}
const imageKeys=['image_url','images','2280x1800','1024x1024','520x280','url'];
const hasImage=p=>imageKeys.some(k=>typeof p?.[k]==='string' && p[k].length || k==='images' && Array.isArray(p?.images) && p.images.length);
export function validatePilotDispatch(env){
 validateDispatch(env);
 if(env.ORULO_PILOT_READY!=='true' || !/^[a-f0-9]{40}$/.test(env.ORULO_PILOT_APPROVED_SHA||'') ||
    env.ORULO_PILOT_APPROVED_SHA!==env.GITHUB_WORKFLOW_SHA)throw Error('PILOT_REVIEWED_CONTROL_SHA_REQUIRED');
}
function checkUrl(value){
 const u=new URL(value);
 if(u.protocol!=='https:' || u.username || u.password || u.port || isIP(u.hostname.replaceAll(/[\[\]]/g,'')) ||
    !u.hostname.includes('.') || /\.(local|internal|localhost)$/.test(u.hostname))throw Error('PILOT_PUBLIC_HTTPS_IMAGE_REQUIRED');
 return u.href;
}
async function validateImage(url){
 const r=await fetch(checkUrl(url),{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok || !r.headers.get('content-type')?.startsWith('image/'))throw Error('PILOT_IMAGE_VALIDATION_FAILED');
}
async function livePlans(env){
 const r=await fetch('https://www.orulo.com.br/oauth/token',{method:'POST',signal:AbortSignal.timeout(30000),
  body:new URLSearchParams({client_id:env.ORULO_CLIENT_ID,client_secret:env.ORULO_CLIENT_SECRET,grant_type:'client_credentials'})});
 const token=await r.json();if(!r.ok || !token.access_token)throw Error('PILOT_ORULO_AUTH_FAILED');
 return fetchOruloFloorPlans(PILOT_BUILDING_ID,{Authorization:'Bearer '+token.access_token},{fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})});
}
const desiredPlans=(row,live)=>imageOnlyPlans(row.raw_data,live).map((p,i)=>hasImage(row.raw_data.building.floor_plans[i])?row.raw_data.building.floor_plans[i]:p);
const imageCount=plans=>plans.filter(hasImage).length;
export async function executePilot({env,transport,fetchPlans=()=>livePlans(env),checkImage=validateImage,
 wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,onPlan=()=>{}}){
 validatePilotDispatch(env);presence(env);
 if((await transport.control('health')).pilotProtocol!==1)throw Error('PILOT_MIGRATION_REQUIRED');
 const journal=await openPostgresJournal(env,transport),results=[];let currentId=null;
 try{
  const targetIds=await transport.control('pilot_targets',{p_run:journal.runUuid});
  if(!Array.isArray(targetIds) || !targetIds.length || targetIds.length>500 || new Set(targetIds).size!==targetIds.length)throw Error('PILOT_TARGETS_INVALID');
  const rawLive=await fetchPlans(PILOT_BUILDING_ID);
  if(!Array.isArray(rawLive) || !rawLive.length || new Set(rawLive.map(p=>String(p.id))).size!==rawLive.length)throw Error('PILOT_LIVE_PLANS_INVALID');
  const live=rawLive.map(p=>Object.fromEntries(['id',...imageKeys].filter(k=>p[k]!=null).map(k=>[k,p[k]])));
  const imageUrls=new Set();let candidates=0,candidateImages=0;
  for(const id of targetIds){
   const {row}=await transport.control('pilot_row',{p_run:journal.runUuid,p_event:{id}}),plans=desiredPlans(row,live);
   if(imageCount(plans)>imageCount(row.raw_data.building.floor_plans))candidates++;
   plans.forEach((p,i)=>{if(!hasImage(row.raw_data.building.floor_plans[i]) && hasImage(p)){
    candidateImages++;
    for(const k of imageKeys)for(const url of Array.isArray(p[k])?p[k]:typeof p[k]==='string'?[p[k]]:[])checkUrl(url);
    imageUrls.add(p.image_url||p.url||p['2280x1800']||p['1024x1024']||p['520x280']||p.images?.[0]);
   }});
  }
  if(!candidates)throw Error('PILOT_NO_RECOVERABLE_IMAGES');
  for(const url of imageUrls)await checkImage(url);
  const plan=await journal.record({type:'CLIENT_READBACK',stage:'PILOT_PLAN',buildingId:PILOT_BUILDING_ID,targetIds,
   liveImagesHash:digest(JSON.stringify(live)),candidateRows:candidates,candidateImages,distinctImages:imageUrls.size,writeEnabled:false});
  await onPlan({runUuid:journal.runUuid,githubRunId:env.GITHUB_RUN_ID,buildingId:PILOT_BUILDING_ID,targetIds,
   headHash:plan.ack.hash,controlSha:env.GITHUB_WORKFLOW_SHA,candidateRows:candidates,candidateImages,distinctImages:imageUrls.size,authorization:'WAITING_FOR_DATABASE_ADMIN'});
  const deadline=now()+10*60*1000;
  while(!await journal.adoptPilotAuthorization(PILOT_BUILDING_ID,targetIds)){
   if(now()>=deadline)throw Error('PILOT_AUTHORIZATION_WAIT_TIMEOUT');await wait(5000);
  }
  // No network media discovery or human wait between this fresh baseline and CAS.
  const before=await journal.snapshot('BASELINE_V2');
  if(classifyCaptures(before.capture,before.capture).decision!=='PASSED')throw Error('PILOT_BASELINE_UNSTABLE');
  if(!isDeepStrictEqual(targetIds,await transport.control('pilot_targets',{p_run:journal.runUuid})))throw Error('PILOT_TARGETS_CHANGED');
  const baseline=new Map(before.capture.records.map(r=>[r[0],r]));
  for(const id of targetIds){
   currentId=id;
   const expected=await transport.control('pilot_row',{p_run:journal.runUuid,p_event:{id}}),row=expected.row;
   if(row.id!==id || buildingIdOf(row)!==PILOT_BUILDING_ID || row.state!=='SP' || row.source!=='novos' || row.active!==true || baseline.get(id)?.[4]!==expected.fullHash)
    throw Error('PILOT_CONCURRENT_CHANGE_BEFORE_CAS');
   const plans=desiredPlans(row,live);
   if(isDeepStrictEqual(plans,row.raw_data.building.floor_plans))continue;
   const operationId=randomUUID();
   await journal.record({type:'INTENT',operationId,id,buildingId:PILOT_BUILDING_ID,expected:row,desiredPlans:plans});
   const result=await journal.apply(operationId);
   if(result.status!=='UPDATED' || result.id!==id || result.receipt?.verified!==true)throw Error('PILOT_STOP_'+result.status);
   const after=await transport.control('pilot_row',{p_run:journal.runUuid,p_event:{id}});
   if(preserved(after.row)!==preserved(row) || !isDeepStrictEqual(after.row.raw_data.building.floor_plans,plans) ||
      after.fullHash!==result.receipt.afterFullHash || after.contentHash!==result.receipt.expectedAfterContentHash ||
      expected.fullHash!==result.receipt.beforeFullHash || expected.contentHash!==result.receipt.expectedBeforeContentHash)
    throw Error('PILOT_POST_WRITE_DIVERGENCE');
   await journal.record({type:'CLIENT_READBACK',stage:'ROW_VERIFIED',operationId,id,fullHash:after.fullHash,contentHash:after.contentHash});
   results.push({id,operationId,receipt:result.receipt,imagesBefore:imageCount(row.raw_data.building.floor_plans),imagesAfter:imageCount(plans)});
  }
  const after=await journal.snapshot('READBACK_V2'),review=classifyCaptures(before.capture,after.capture);
  const attributed=new Set();
  for(const r of results){
   const delta=review.changes.find(c=>c.uuid===r.id);
   if(!delta || delta.before?.fullHash!==r.receipt.beforeFullHash || delta.after?.fullHash!==r.receipt.afterFullHash ||
      delta.before.contentHash!==r.receipt.expectedBeforeContentHash || delta.after.contentHash!==r.receipt.expectedAfterContentHash)
    throw Error('PILOT_RECEIPT_ATTRIBUTION_FAILED');
   attributed.add(r.id);
  }
  const unexplained=review.changes.filter(c=>!attributed.has(c.uuid));
  await journal.record({type:'CLIENT_READBACK',stage:'PILOT_INTEGRITY',review,attributedIds:[...attributed],unexplained});
  if(!results.length || !review.schemaMatch || !review.captureStable || unexplained.some(c=>c.scope!=='OUT_OF_SCOPE'))throw Error('PILOT_INTEGRITY_REVIEW_REQUIRED');
  const finish=await journal.pilotFinish();verifyScopeComparison(review,finish.entry.event.comparison);
  return {result:'APROVADO',buildingId:PILOT_BUILDING_ID,buildings:1,rowsWritten:results.length,
   imagesBefore:results.reduce((s,r)=>s+r.imagesBefore,0),imagesAfter:results.reduce((s,r)=>s+r.imagesAfter,0),
   outOfScopeChanges:unexplained.length,runUuid:journal.runUuid,headHash:finish.ack.hash,remainingBatchEnabled:false};
 }catch(error){
  // Read-only reconciliation even when the CAS response or journal is ambiguous.
  if(currentId)try{error.observed=await transport.control('pilot_row',{p_run:journal.runUuid,p_event:{id:currentId}});}catch{}
  try{await journal.record({type:'CLIENT_STOP',stage:'PILOT_STOP',id:currentId,code:'PILOT_HALTED_RECONCILIATION_REQUIRED',confirmedRows:results.length});}catch{}
  error.pilotRunUuid=journal.runUuid;throw error;
 }
}
async function main(){
 validatePilotDispatch(process.env);
 if(process.argv[2]==='github-gate'){await checkGitHub(process.env);console.log('Pilot owner/main/control SHA verified.');return;}
 if(process.argv.length!==3 || process.argv[2]!=='pilot')throw Error('PILOT_ONLY_COMMAND_REQUIRED');
 verifySource(process.env.APPROVED_SOURCE_DIR);
 console.log(JSON.stringify(await executePilot({env:process.env,transport:postgresTransport({url:PROJECT_URL,key:process.env.SUPABASE_SECRET_KEY}),onPlan:p=>{
  console.log(JSON.stringify(p));
  const summary=pilotApprovalSummary(p);
  // Live logs are available during the wait. Step summaries may appear only after the step/job ends.
  console.log(summary);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary+'\n',{mode:0o600});
 }})));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(e=>{console.error(JSON.stringify({code:/^(PILOT|POSTGRES)_[A-Z_]+$/.test(e.message)?e.message:'PILOT_BLOCKED',runUuid:e.pilotRunUuid}));process.exitCode=1;});
