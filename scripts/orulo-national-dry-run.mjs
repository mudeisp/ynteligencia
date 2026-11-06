import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {fetchOruloFloorPlans} from '../orulo-floor-plans.js';
import {NATIONAL_MARKETS} from '../portal/eligibility.js';

export const MANIFEST_SHA256='0536bb7bec9a788967624a4b94edf7cf62c7b2636215db6a06ac73e7181637e9';
export const WORKFLOW='.github/workflows/orulo-national-dry-run.yml';
export const PROJECT='https://wzaegidwtdjuhqchpdpd.supabase.co';
export const SELECT='id,external_id,state,active,source,building_id:raw_data->>building_id,status:raw_data->building->>status,stage:raw_data->building->>stage,plans:raw_data->building->floor_plans';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
const ids=value=>Array.isArray(value)&&value.length&&value.every(x=>typeof x==='string'&&/^[1-9]\d*$/.test(x))&&new Set(value).size===value.length;
export function selectBatch(bytes,batchId){
  if(digest(bytes)!==MANIFEST_SHA256)throw fail('MANIFEST_HASH_MISMATCH');
  const manifest=JSON.parse(bytes),batch=manifest.batches.find(b=>b.batchId===batchId);
  if(!batch||!/^V4-[A-Z]{2}-P[123]-(NEW|HIST)-\d{3}$/.test(batchId))throw fail('BATCH_UNKNOWN_OR_DIAGNOSTIC');
  if(!NATIONAL_MARKETS.includes(batch.state)||!ids(batch.buildingIds)||batch.buildings!==batch.buildingIds.length||batch.buildings>(batch.previousState==='no_recovery_operation_history'?10:30))throw fail('BATCH_SCOPE_INVALID');
  if(digest(JSON.stringify(batch.buildingIds))!==batch.buildingIdsSha256)throw fail('BATCH_HASH_MISMATCH');
  const protectedIds=new Set([...manifest.protectedBuildingIds,...manifest.pendingReconciliationBuildingIds,...manifest.priorSourceSampleIds]);
  if(batch.buildingIds.some(id=>protectedIds.has(id)))throw fail('BATCH_CONTAINS_PROTECTED_HISTORY_OR_PRIOR_SAMPLE');
  if(batch.buildingIds.some(id=>!manifest.baseline.some(b=>b.state===batch.state&&b.buildingId===id)))throw fail('BATCH_BASELINE_MISSING');
  return {manifest,batch};
}
export function validateDispatch(env){
  if(env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_REPOSITORY!=='mudeisp/ynteligencia'||env.GITHUB_ACTOR!=='mudeisp'||env.GITHUB_ACTOR_ID!=='323805541'||env.GITHUB_TRIGGERING_ACTOR!=='mudeisp')throw fail('OWNER_MAIN_FIRST_ATTEMPT_REQUIRED');
  if(!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||env.GITHUB_SHA!==env.GITHUB_WORKFLOW_SHA||env.ORULO_DRY_RUN_APPROVED_SHA!==env.GITHUB_SHA)throw fail('REVIEWED_INTEGRATED_SHA_REQUIRED');
  if(!/^[1-9]\d*$/.test(env.GITHUB_RUN_ID||''))throw fail('RUN_ID_REQUIRED');
}
export function publicCredential(source){
  const url=/const SUPABASE_URL\s*=\s*"([^"]+)"/.exec(source)?.[1];
  const key=/const SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/.exec(source)?.[1];
  if(url!==PROJECT||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key||''))throw fail('PUBLIC_READ_CREDENTIAL_REQUIRED');
  return key;
}
export const inventoryUrl=(batch,id)=>PROJECT+'/rest/v1/properties?'+new URLSearchParams({select:SELECT,source:'eq.novos',active:'eq.true',state:`eq.${batch.state}`,'raw_data->>building_id':`eq.${id}`,order:'id.asc',limit:'501'});
export function readOnlyTransport({batch,request=fetch,signal,httpTimeoutMs=15000,counters}){
  const allowed=new Set(batch.buildingIds),seenSource=new Set(),seenInventory=new Set();let authSeen=false;
  return async(url,options={})=>{
    let u;try{u=new URL(url);}catch{throw fail('FORBIDDEN_REQUEST');}
    const method=String(options.method||'GET').toUpperCase(),headers=new Headers(options.headers);
    if(u.protocol!=='https:'||u.username||u.password||u.hash||headers.has('x-http-method-override')||headers.has('x-method-override')||method==='GET'&&options.body!==undefined)throw fail('FORBIDDEN_REQUEST');
    let category;
    if(u.origin===PROJECT&&u.pathname==='/rest/v1/properties'&&method==='GET'){
      const id=u.searchParams.get('raw_data->>building_id')?.slice(3);
      if(!allowed.has(id)||u.href!==inventoryUrl(batch,id)||seenInventory.has(id))throw fail('FORBIDDEN_OR_REPEATED_INVENTORY_REQUEST');
      seenInventory.add(id);category='inventory';
    }else if(u.origin==='https://www.orulo.com.br'&&u.pathname==='/oauth/token'&&!u.search&&method==='POST'){
      const body=new URLSearchParams(options.body);const keys=[...body.keys()].sort().join(',');
      if(authSeen||keys!=='client_id,client_secret,grant_type'||body.get('grant_type')!=='client_credentials'||!body.get('client_id')||!body.get('client_secret'))throw fail('FORBIDDEN_AUTH_REQUEST');
      authSeen=true;category='authentication';
    }else if(u.origin==='https://www.orulo.com.br'&&method==='GET'){
      const match=/^\/api\/v2\/buildings\/([1-9]\d*)\/floor_plans$/.exec(u.pathname),dimensions=u.searchParams.getAll('dimensions[]');
      if(!match||!allowed.has(match[1])||seenSource.has(match[1])||[...u.searchParams.keys()].some(k=>k!=='dimensions[]')||dimensions.length!==3||new Set(dimensions).size!==3||dimensions.some(d=>!['520x280','1024x1024','2280x1800'].includes(d)))throw fail('FORBIDDEN_OR_REPEATED_SOURCE_REQUEST');
      seenSource.add(match[1]);category='floorPlans';
    }else throw fail('FORBIDDEN_REQUEST');
    counters[category]++;
    let response;
    try{response=await request(u.href,{...options,method,redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(httpTimeoutMs)])});}
    catch{throw fail(signal?.aborted?'TIME_LIMIT':'HTTP_NETWORK_OR_TIMEOUT');}
    if(!response.ok)throw fail((category==='authentication'?'AUTH':category==='floorPlans'?'SOURCE':'INVENTORY')+'_HTTP_'+response.status,response.status);
    if(category==='floorPlans'){
      let data;try{data=await response.clone().json();}catch(error){throw fail(signal?.aborted?'TIME_LIMIT':error instanceof SyntaxError?'SOURCE_INVALID_JSON':'HTTP_NETWORK_OR_TIMEOUT');}
      if(data.error||data.errors||data.error_message||!Array.isArray(data?.floor_plans)||data.floor_plans.some(p=>p?.id==null)||new Set(data.floor_plans.map(p=>String(p.id))).size!==data.floor_plans.length)throw fail('SOURCE_INVALID_RESPONSE');
      if(data.next_page||data.has_more||data.links?.next||data.pagination?.next||data.pagination?.next_page||data.pagination?.has_more||Number(data.pagination?.total_pages)>1||Number(data.total)>data.floor_plans.length)throw fail('SOURCE_INCOMPLETE_RESPONSE');
    }
    return response;
  };
}
const imageUrls=p=>[...new Set(['image_url','url','520x280','1024x1024','2280x1800'].map(k=>p?.[k]).concat(Array.isArray(p?.images)?p.images:[]).filter(v=>typeof v==='string'&&v))];
const sourceImage=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='static.orulo.com.br'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.startsWith('/images/properties/');}catch{return false;}};
export async function dryRun({selection,metadata,readKey,clientId,clientSecret,request=fetch,save=()=>{},maxDurationMs=420000,httpTimeoutMs=15000,signal}){
  const {batch,manifest}=selection,start=Date.now(),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),maxDurationMs),combined=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
  const report={runId:metadata.runId,batchId:batch.batchId,state:batch.state,buildingIds:[...batch.buildingIds],batchHash:batch.buildingIdsSha256,commitSha:metadata.commitSha,workflowPath:WORKFLOW,scriptSha256:metadata.scriptSha256,manifestHash:MANIFEST_SHA256,startedAt:new Date(start).toISOString(),finishedAt:null,queries:{authentication:0,inventory:0,floorPlans:0},examinedIds:[],sourceQueriedIds:[],unexaminedIds:[...batch.buildingIds],plantsFound:0,existingImages:0,recoverableImages:0,sourceErrors:[],sourceMissing:[],conflicts:[],stockDivergences:[],items:[],status:'RUNNING',writes:0};
  const checkpoint=()=>{report.unexaminedIds=batch.buildingIds.filter(id=>!report.examinedIds.includes(id));save(report);};
  const transport=readOnlyTransport({batch,request,signal:combined,httpTimeoutMs,counters:report.queries});let token,currentId;
  try{
    checkpoint();
    if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(readKey||''))throw fail('PUBLIC_READ_CREDENTIAL_REQUIRED');
    if(!clientId||!clientSecret)throw fail('ORULO_AUTH_CONFIGURATION_REQUIRED');
    for(const id of batch.buildingIds){
      currentId=id;
      if(combined.aborted)throw fail('TIME_LIMIT');
      const item={buildingId:id,status:'NEEDS_REVIEW',reason:null,plansFound:0,existingImages:0,recoverableImages:0};
      try{
        const response=await transport(inventoryUrl(batch,id),{headers:{apikey:readKey,Accept:'application/json'}});let rows;try{rows=await response.json();}catch(error){throw fail(combined.aborted?'TIME_LIMIT':error instanceof SyntaxError?'INVENTORY_INVALID_JSON':'HTTP_NETWORK_OR_TIMEOUT');}
        if(!Array.isArray(rows)||rows.length>500||rows.some(r=>r.state!==batch.state||String(r.building_id)!==id||r.active!==true||r.source!=='novos'||!String(r.external_id).startsWith(`orulo:${id}:`)))throw fail('INVENTORY_INCOMPLETE_OR_INVALID');
        const baseline=manifest.baseline.find(b=>b.state===batch.state&&b.buildingId===id);
        if(rows.length!==baseline.unitCount)report.stockDivergences.push({buildingId:id,field:'activeUnitCount',before:baseline.unitCount,current:rows.length});
        const missing=new Map(),planIds=new Set(),storedImages=new Set();
        for(const row of rows){
          if(!Array.isArray(row.plans))throw fail('INVENTORY_PLANS_INVALID');
          if(row.plans.some(p=>!p||!String(p.id||''))||new Set(row.plans.map(p=>String(p.id))).size!==row.plans.length)throw fail('PLAN_IDENTIFIERS_INVALID');
          for(const p of row.plans){const pid=String(p.id),images=imageUrls(p);planIds.add(pid);for(const u of images)storedImages.add(u);if(!images.length)missing.set(pid,(missing.get(pid)||0)+1);}
        }
        item.plansFound=planIds.size;item.existingImages=storedImages.size;
        if(!rows.length){item.status='NEEDS_REVIEW';item.reason='NO_ACTIVE_ROWS';}
        else if(rows.some(r=>[r.status,r.stage].some(s=>String(s||'').trim().toLowerCase()==='usado'))){item.status='NEEDS_REVIEW';item.reason='COMMERCIAL_STATUS_USED';}
        else if(JSON.stringify([...planIds].sort())!==JSON.stringify([...baseline.planIds].sort())){item.status='DATA_CONFLICT';item.reason='DECLARED_PLAN_IDS_CHANGED';report.conflicts.push({buildingId:id,field:'floor_plans.id'});}
        else if(!missing.size){item.status='COMPLETE';item.reason='ALREADY_COMPLETE_NO_SOURCE_QUERY';}
        else{
          if(!token){const auth=await transport('https://www.orulo.com.br/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'client_credentials'}).toString()});let data;try{data=await auth.json();}catch{throw fail('AUTH_INVALID_RESPONSE');}if(typeof data?.access_token!=='string'||!data.access_token)throw fail('AUTH_INVALID_RESPONSE');token=data.access_token;}
          report.sourceQueriedIds.push(id);
          const live=await fetchOruloFloorPlans(id,{Authorization:`Bearer ${token}`,Accept:'application/json'},{fetchImpl:transport});
          const byId=new Map(live.map(p=>[String(p.id),p]));item.sourcePlans=live.length;item.recoverablePlans=[];item.missingSourcePlans=[];
          for(const [pid,occurrences]of missing){const plan=byId.get(pid),images=imageUrls(plan);if(images.some(u=>!sourceImage(u)))throw fail('SOURCE_UNTRUSTED_IMAGE_URL');if(!plan||!images.length)item.missingSourcePlans.push(pid);else item.recoverablePlans.push({planId:pid,urls:images,occurrences});}
          item.recoverableImages=item.recoverablePlans.length;item.status=item.recoverableImages?'RECOVERABLE':'SOURCE_MISSING';item.reason=item.missingSourcePlans.length?'SOURCE_HAS_MISSING_PLAN_IMAGES':'MATCHED_EXISTING_PLAN_IDS';
          if(item.missingSourcePlans.length)report.sourceMissing.push({buildingId:id,planIds:item.missingSourcePlans});
        }
      }catch(error){
        const code=error.code||'INVALID_OR_INCOMPLETE_RESPONSE';
        if(code.startsWith('FORBIDDEN')||code.startsWith('AUTH_')||code==='TIME_LIMIT'||[401,403,429].includes(error.status))throw error;
        item.reason=code;
        if(code.startsWith('INVENTORY_')||code==='PLAN_IDENTIFIERS_INVALID'){item.status='NEEDS_REVIEW';report.conflicts.push({buildingId:id,field:'inventory_read',code});}
        else{item.status='SOURCE_ERROR';report.sourceErrors.push({buildingId:id,code,httpStatus:error.status||null});}
      }
      report.items.push(item);report.examinedIds.push(id);report.plantsFound+=item.plansFound;report.existingImages+=item.existingImages;report.recoverableImages+=item.recoverableImages;checkpoint();
    }
    report.status=report.sourceErrors.length?'COMPLETED_WITH_SOURCE_ERRORS':'COMPLETED';
  }catch(error){report.status=combined.aborted||error.code==='TIME_LIMIT'?'TIME_LIMIT':'BLOCKED';report.errors=[{code:error.code||'UNCLASSIFIED_ERROR',httpStatus:error.status||null}];if(error.code?.startsWith('AUTH_')||[401,403,429].includes(error.status))report.sourceErrors.push({buildingId:currentId,code:error.code,httpStatus:error.status||null});}
  finally{clearTimeout(timer);report.finishedAt=new Date().toISOString();report.durationMs=Date.now()-start;checkpoint();}
  return report;
}
const reportPath=resolve('.orulo-national-dry-run/report.json');
export function saveReport(report,path=reportPath){const bytes=JSON.stringify(report,null,2)+'\n';mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',bytes,{mode:0o600});renameSync(path+'.tmp',path);writeFileSync(path+'.sha256.tmp',digest(bytes)+'  report.json\n',{mode:0o600});renameSync(path+'.sha256.tmp',path+'.sha256');}
export function verifyReport(path=reportPath){
  const bytes=readFileSync(path),report=JSON.parse(bytes);
  if(readFileSync(path+'.sha256','utf8')!==digest(bytes)+'  report.json\n')throw fail('REPORT_SHA256_MISMATCH');
  return report;
}
export function sealReport(path=reportPath){
  const bytes=readFileSync(path),report=JSON.parse(bytes);
  if(report.status==='RUNNING'){report.status='INTERRUPTED';report.finishedAt=new Date().toISOString();saveReport(report,path);}
  else{writeFileSync(path+'.sha256.tmp',digest(bytes)+'  report.json\n',{mode:0o600});renameSync(path+'.sha256.tmp',path+'.sha256');}
  verifyReport(path);return report;
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&['--seal','--verify'].includes(args[0])){
    try{if(args[0]==='--seal')sealReport();else verifyReport();}
    catch{console.error('REPORT_ARTIFACT_INTEGRITY_FAILED');process.exitCode=1;}
    return;
  }
  let selection;
  try{if(args.length&&!(args.length===1&&args[0]==='--check'))throw fail('ARGUMENT_NOT_ALLOWED');validateDispatch(process.env);selection=selectBatch(readFileSync(new URL('./orulo-national-dry-run-manifest.json',import.meta.url)),process.env.BATCH_ID);}
  catch(error){saveReport({runId:process.env.GITHUB_RUN_ID||null,batchId:null,status:'BLOCKED',errors:[{code:error.code||'MANIFEST_UNAVAILABLE'}],writes:0});process.exitCode=1;return;}
  const metadata={runId:process.env.GITHUB_RUN_ID,commitSha:process.env.GITHUB_SHA,scriptSha256:digest(readFileSync(new URL(import.meta.url)))};
  if(args[0]==='--check'){saveReport({...metadata,batchId:selection.batch.batchId,state:selection.batch.state,buildingIds:selection.batch.buildingIds,batchHash:selection.batch.buildingIdsSha256,manifestHash:MANIFEST_SHA256,workflowPath:WORKFLOW,status:'PREFLIGHT_VALIDATED',writes:0});return;}
  const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
  const report=await dryRun({selection,metadata,readKey:publicCredential(readFileSync(new URL('../assets/js/delivery-5.js',import.meta.url),'utf8')),clientId:process.env.ORULO_CLIENT_ID,clientSecret:process.env.ORULO_CLIENT_SECRET,signal:stop.signal,save:saveReport});
  console.log(JSON.stringify({runId:report.runId,batchId:report.batchId,status:report.status,queries:report.queries,examined:report.examinedIds.length,unexamined:report.unexaminedIds.length,writes:0}));
  if(report.status!=='COMPLETED')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{let report;try{report=JSON.parse(readFileSync(reportPath,'utf8'));}catch{report={batchId:null,writes:0};}report.status='BLOCKED';report.finishedAt=new Date().toISOString();report.errors=[{code:/^[A-Z_0-9]{1,60}$/.test(error.code||'')?error.code:'EXECUTOR_CONFIGURATION_OR_IO_FAILED'}];saveReport(report);process.exitCode=1;});
