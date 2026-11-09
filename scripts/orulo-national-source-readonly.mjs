// Preparation companion only. No Supabase client, RPC, ledger or authorization call.
import {readFileSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchOruloFloorPlans} from '../orulo-floor-plans.js';
import {verifyBatchImage} from './orulo-media-recovery-batch.mjs';
import {sha,bytes,readJSON,pinnedJSON,saveNew,checkpoint,newDirectory,verifyQueue,options,fail,urlsOf,imageKeys} from './orulo-national-transfer-common.mjs';

const API='https://www.orulo.com.br',CDN='https://static.orulo.com.br';
const sourceUrl=id=>{const u=new URL(`/api/v2/buildings/${id}/floor_plans`,API);for(const d of ['520x280','1024x1024','2280x1800'])u.searchParams.append('dimensions[]',d);return u.href;};
const safeError=e=>['SOURCE_RESPONSE_TOO_LARGE','SOURCE_INVALID_JSON','SOURCE_INVALID_RESPONSE','SOURCE_INCOMPLETE_RESPONSE',
 'SOURCE_PLAN_IDS_INVALID','SOURCE_BUILDING_MISMATCH','SOURCE_NETWORK_OR_TIMEOUT','SOURCE_HTTP_ERROR','SOURCE_CREDENTIALS_UNAVAILABLE',
 'SOURCE_AUTH_INVALID','SOURCE_AUTH_HTTP_ERROR','FORBIDDEN_REQUEST','IMAGE_NETWORK_OR_TIMEOUT',
 'BATCH_UNTRUSTED_IMAGE_URL','BATCH_IMAGE_UNAVAILABLE','BATCH_IMAGE_SIGNATURE_INVALID','BATCH_IMAGE_REQUEST_FAILED',
 'IMAGE_MIME_MISMATCH','IMAGE_TOO_SHORT','IMAGE_CHECKPOINT_INVALID','INTERRUPTED_BUILDING_REQUIRES_REVIEW',
 'SHARED_SERVICE_REQUIRES_DIAGNOSIS_AND_NEW_RUN','RESUME_QUEUE_MISMATCH','CHECKPOINT_RESULT_HASH_MISMATCH'].includes(e?.code||e?.message)?(e.code||e.message):'SOURCE_EVIDENCE_ERROR';
export function validateSource(data,buildingId){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.error||data.errors||data.error_message||!Array.isArray(data.floor_plans))throw fail('SOURCE_INVALID_RESPONSE');
 if(data.next_page||data.has_more||data.links?.next||data.pagination?.next||data.pagination?.next_page||data.pagination?.has_more||Number(data.pagination?.total_pages)>1||Number(data.total)>data.floor_plans.length)throw fail('SOURCE_INCOMPLETE_RESPONSE');
 const ids=data.floor_plans.map(p=>String(p?.id??''));
 if(ids.some(id=>!/^[1-9]\d*$/.test(id))||new Set(ids).size!==ids.length)throw fail('SOURCE_PLAN_IDS_INVALID');
 if(buildingId&&[data.building_id,data.building?.id,...data.floor_plans.map(p=>p.building_id)].some(id=>id!=null&&String(id)!==buildingId))throw fail('SOURCE_BUILDING_MISMATCH');
 return data;
}
async function limitedBytes(response,limit,{prefix=false}={}){
 if(!response.body)throw fail(prefix?'IMAGE_TOO_SHORT':'SOURCE_INVALID_RESPONSE');
 const reader=response.body.getReader();let length=0;const chunks=[];
 try{while(true){const n=await reader.read();if(n.done)break;
  const b=Buffer.from(n.value),remaining=limit-length;
  if(b.length>remaining&&!prefix)throw fail('SOURCE_RESPONSE_TOO_LARGE');
  const part=b.subarray(0,remaining);chunks.push(part);length+=part.length;
  if(prefix&&length>=limit)break;
 }}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}
function validImageFields(plan){
 return imageKeys.every(k=>plan[k]==null||(k==='images'?Array.isArray(plan[k])&&plan[k].every(u=>typeof u==='string'&&u.length):typeof plan[k]==='string'));
}
function sharedHttp(status){return [401,403,429].includes(status);}

export async function discover({queue,queueSha256,outputDir,env={},request=fetch,resume=false,maxBuildings=Infinity}){
 verifyQueue(queue);
 if(!/^[a-f0-9]{64}$/.test(queueSha256||'')||!/^[a-f0-9]{64}$/.test(queue.manifestSha256||'')||!(maxBuildings>0))throw fail('DISCOVERY_ARGUMENT_INVALID');
 const dir=resolve(outputDir),indexPath=resolve(dir,'index.json');
 let index;
 if(resume){
  index=pinnedJSON(indexPath,readFileSync(indexPath+'.sha256','utf8').trim());
  if(index.queueSha256!==queueSha256||index.logicalBatchId!==queue.logicalBatchId)throw fail('RESUME_QUEUE_MISMATCH');
  if(index.sharedServiceBlocked)throw fail('SHARED_SERVICE_REQUIRES_DIAGNOSIS_AND_NEW_RUN');
  for(const item of index.results){const raw=readFileSync(resolve(dir,`buildings/${item.buildingId}/result.json`));if(sha(raw)!==item.sha256)throw fail('CHECKPOINT_RESULT_HASH_MISMATCH');}
 }else{
  newDirectory(dir);index={version:1,logicalBatchId:queue.logicalBatchId,queueSha256,manifestSha256:queue.manifestSha256,
   startedAt:new Date().toISOString(),finishedAt:null,status:'RUNNING',productionWrites:0,realCASCalls:0,
   requests:{oauth:0,floorPlans:0,cdn:0},timings:[],results:[],incidents:[],sharedServiceBlocked:false};
 }
 const lock=resolve(dir,'.discovery.lock');const fd=openSync(lock,'wx',0o600);closeSync(fd);
 const save=()=>{checkpoint(indexPath,index);checkpoint(indexPath+'.sha256',Buffer.from(sha(bytes(index))+'\n'));};
 const done=new Set(index.results.map(r=>r.buildingId)),allowedSources=new Set(queue.buildings.map(b=>sourceUrl(b.buildingId)));
 const allowedImages=new Set(),imageCache=new Map();let token,processed=0;
 const http=async(url,o={})=>{
  const u=new URL(url),method=String(o.method||'GET').toUpperCase();
  const auth=u.href===API+'/oauth/token'&&method==='POST';
  const source=allowedSources.has(u.href)&&method==='GET';
  const image=u.origin===CDN&&allowedImages.has(u.href)&&method==='GET';
  if(!auth&&!source&&!image||u.username||u.password||u.hash||u.protocol!=='https:'||(!auth&&o.body!==undefined))throw fail('FORBIDDEN_REQUEST');
  const category=auth?'oauth':source?'floorPlans':'cdn',start=Date.now();index.requests[category]++;
  try{const r=await request(u.href,{...o,method,redirect:'error',signal:AbortSignal.timeout(image?15000:30000)});
   index.timings.push({category,url:u.href,method,httpStatus:r.status,headersDurationMs:Date.now()-start});return r;}
  catch{index.timings.push({category,url:u.href,method,httpStatus:null,headersDurationMs:Date.now()-start});throw fail(image?'IMAGE_NETWORK_OR_TIMEOUT':'SOURCE_NETWORK_OR_TIMEOUT');}
 };
 const authenticate=async()=>{
  if(!env.ORULO_CLIENT_ID||!env.ORULO_CLIENT_SECRET)throw fail('SOURCE_CREDENTIALS_UNAVAILABLE');
  const r=await http(API+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'client_credentials',client_id:env.ORULO_CLIENT_ID,client_secret:env.ORULO_CLIENT_SECRET})});
  if(!r.ok)throw Object.assign(fail('SOURCE_AUTH_HTTP_ERROR'),{httpStatus:r.status,retryAfter:r.headers.get('retry-after'),shared:true});
  let data;try{data=JSON.parse(await limitedBytes(r,65536));}catch{throw fail('SOURCE_AUTH_INVALID');}
  if(typeof data.access_token!=='string'||!data.access_token)throw fail('SOURCE_AUTH_INVALID');token=data.access_token;
 };
 const checkImage=async url=>{
  if(imageCache.has(url))return imageCache.get(url);
  const name=sha(url),metaPath=resolve(dir,`cdn/${name}.json`),prefixPath=resolve(dir,`cdn/${name}.bin`);
  if(existsSync(metaPath)){
   const meta=readJSON(metaPath),prefix=readFileSync(prefixPath);if(meta.url!==url||meta.prefixSha256!==sha(prefix))throw fail('IMAGE_CHECKPOINT_INVALID');
   if(meta.status==='VALIDATED_PREFIX'){
    const check=await verifyBatchImage(url,async()=>new Response(prefix,{status:meta.httpStatus}));
    const mime=(meta.contentType||'').split(';')[0].trim().toLowerCase();
    if(check.format!==meta.format||mime&&!['image/jpeg','image/png','image/webp','application/octet-stream','binary/octet-stream'].includes(mime))throw fail('IMAGE_CHECKPOINT_INVALID');
    if({'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mime]&&{'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mime]!==check.format)throw fail('IMAGE_CHECKPOINT_INVALID');
   }
   imageCache.set(url,meta);return meta;
  }
  let meta={url,observedAt:new Date().toISOString(),method:'GET',range:'bytes=0-4095',status:'REQUIRES_REVIEW'},prefix=Buffer.alloc(0);
  allowedImages.add(url);
  try{
   const validated=await verifyBatchImage(url,async(u,o)=>{
    const r=await http(u,o);meta.httpStatus=r.status;meta.contentType=r.headers.get('content-type')||null;
    meta.contentRange=r.headers.get('content-range')||null;meta.retryAfter=r.headers.get('retry-after')||null;
    if(r.status===429)throw Object.assign(fail('BATCH_IMAGE_UNAVAILABLE'),{httpStatus:429,shared:true});
    prefix=await limitedBytes(r,4096,{prefix:true});return new Response(prefix,{status:r.status});
   });
   const mime=(meta.contentType||'').split(';')[0].trim().toLowerCase();
   if(mime&&!['image/jpeg','image/png','image/webp','application/octet-stream','binary/octet-stream'].includes(mime))throw fail('IMAGE_MIME_MISMATCH');
   const expected={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[mime];
   if(expected&&expected!==validated.format)throw fail('IMAGE_MIME_MISMATCH');
   meta={...meta,status:'VALIDATED_PREFIX',format:validated.format};
  }catch(e){meta.code=safeError(e);meta.httpStatus??=e.httpStatus||e.sourceHttpStatus||null;meta.shared=!!e.shared||meta.httpStatus===429;}
  meta.classification=meta.status==='VALIDATED_PREFIX'?'NON_BLOCKER':'BLOCKER';
  meta.prefixSha256=sha(prefix);meta.prefixBytes=prefix.length;
  saveNew(prefixPath,prefix);saveNew(metaPath,meta);imageCache.set(url,meta);return meta;
 };
 try{
  save();
  for(const b of queue.buildings){
   if(done.has(b.buildingId)||processed>=maxBuildings)continue;
   const buildingDir=resolve(dir,`buildings/${b.buildingId}`);
   if(existsSync(buildingDir)){
    // Preserve interrupted evidence, quarantine only this building and continue.
    const path=resolve(buildingDir,'result.json');
    const digest=existsSync(path)?sha(readFileSync(path)):saveNew(path,{buildingId:b.buildingId,
     provenance:'INTERRUPTED_LOCAL_EVIDENCE',writeAuthorized:false,incidents:[{classification:'UNKNOWN',scope:'BUILDING',code:'INTERRUPTED_BUILDING_REQUIRES_REVIEW'}],
     plans:b.plans.map(p=>({planId:p.planId,status:'AMBIGUOUS',reason:'INTERRUPTED_BUILDING_REQUIRES_REVIEW',imageChecks:[]}))});
    index.results.push({buildingId:b.buildingId,sha256:digest,quarantined:true});
    index.incidents.push({classification:'UNKNOWN',scope:'BUILDING',buildingId:b.buildingId,code:'INTERRUPTED_BUILDING_REQUIRES_REVIEW'});
    done.add(b.buildingId);processed++;save();continue;
   }
   const result={buildingId:b.buildingId,sourceUrl:sourceUrl(b.buildingId),observedAt:new Date().toISOString(),
    provenance:'DIRECT_AUTHENTICATED_ORULO_API',writeAuthorized:false,plans:[],incidents:[]};
   try{
    if(!token)await authenticate();let raw;
    const plans=await fetchOruloFloorPlans(b.buildingId,{Authorization:`Bearer ${token}`,Accept:'application/json'},{fetchImpl:async(url,o)=>{
     const r=await http(url,o);result.httpStatus=r.status;
     if(!r.ok)throw Object.assign(fail('SOURCE_HTTP_ERROR'),{httpStatus:r.status,retryAfter:r.headers.get('retry-after'),shared:sharedHttp(r.status)});
     raw=await limitedBytes(r,8*1024*1024);let data;
     try{data=JSON.parse(raw);}catch{throw fail('SOURCE_INVALID_JSON');}
     result.responseSha256=saveNew(resolve(buildingDir,'source-response.json'),raw);
     validateSource(data,b.buildingId);return new Response(raw,{status:r.status});
    }});
    const original=JSON.parse(raw).floor_plans,byId=new Map(plans.map(p=>[String(p.id),p]));
    const originals=new Map(original.map(p=>[String(p.id),p]));
    const owners=new Map();for(const p of original)for(const u of urlsOf(p)){if(!owners.has(u))owners.set(u,new Set());owners.get(u).add(String(p.id));}
    for(const wanted of b.plans){
     const live=byId.get(wanted.planId),base=originals.get(wanted.planId);
     const item={planId:wanted.planId,status:'SOURCE_NOT_FOUND',imageChecks:[]};
     if(live){
      const urls=[...new Set([...urlsOf(base),...urlsOf(live)])];
      if(!validImageFields(base)){item.status='REQUIRES_REVIEW';item.reason='SOURCE_IMAGE_FIELDS_INVALID';}
      else if(urls.some(u=>owners.get(u)?.size>1)){item.status='AMBIGUOUS';item.reason='EXACT_URL_SHARED_BY_DISTINCT_SOURCE_PLANS';}
      else if(urls.length){
       for(const url of urls){const checked=await checkImage(url);item.imageChecks.push({url,evidence:`cdn/${sha(url)}.json`,sha256:sha(bytes(checked))});if(checked.shared){index.sharedServiceBlocked=true;break;}}
       item.status=urlsOf(live).length&&item.imageChecks.length===urls.length&&item.imageChecks.every(c=>imageCache.get(c.url).status==='VALIDATED_PREFIX')?'RECOVERABLE':'REQUIRES_REVIEW';
       item.reason=item.status==='RECOVERABLE'?'EXACT_SOURCE_PLAN_ID_AND_VALIDATED_URLS':'IMAGE_VALIDATION_FAILED';
       // A source observation is not production eligibility or an authorization.
       item.normalizedPlan=live;
      }
     }
     result.plans.push(item);if(index.sharedServiceBlocked)break;
    }
   }catch(e){
    const code=safeError(e),status=e.httpStatus||e.sourceHttpStatus||null;
    const shared=e.shared||code.startsWith('SOURCE_AUTH_')||code==='SOURCE_CREDENTIALS_UNAVAILABLE';
    result.incidents.push({classification:'BLOCKER',scope:shared?'SOURCE_SERVICE':'BUILDING',code,httpStatus:status,retryAfter:e.retryAfter||null});
    result.plans=b.plans.map(p=>({planId:p.planId,status:status===404?'SOURCE_NOT_FOUND':'SOURCE_ERROR',reason:code,imageChecks:[]}));
    if(shared)index.sharedServiceBlocked=true;
   }
   for(const item of result.plans)item.classification=item.status==='RECOVERABLE'?'NON_BLOCKER':item.status==='AMBIGUOUS'?'UNKNOWN':'BLOCKER';
   const digest=saveNew(resolve(buildingDir,'result.json'),result);
   index.results.push({buildingId:b.buildingId,sha256:digest});done.add(b.buildingId);processed++;save();
   if(index.sharedServiceBlocked)break;
  }
  index.unexaminedBuildingIds=queue.buildings.filter(b=>!done.has(b.buildingId)).map(b=>b.buildingId);
  index.status=index.sharedServiceBlocked?'BLOCKED':index.unexaminedBuildingIds.length?'PARTIAL':'COMPLETED_DISCOVERY_ONLY';
 }catch(e){index.status='BLOCKED';index.incidents.push({classification:'BLOCKER',scope:'LOCAL_EVIDENCE',code:safeError(e)});}
 finally{index.unexaminedBuildingIds=queue.buildings.filter(b=>!done.has(b.buildingId)).map(b=>b.buildingId);index.finishedAt=new Date().toISOString();save();unlinkSync(lock);}
 return index;
}
async function main(){
 const o=options(process.argv.slice(2),['--queue','--queue-sha256','--output-dir','--max-buildings','--resume']);
 if(!o['--queue']||!o['--output-dir'])throw fail('QUEUE_AND_OUTPUT_REQUIRED');
 const queue=pinnedJSON(o['--queue'],o['--queue-sha256']);
 const max=o['--max-buildings']?Number(o['--max-buildings']):Infinity;
 if(max!==Infinity&&(!Number.isSafeInteger(max)||max<1))throw fail('MAX_BUILDINGS_INVALID');
 const result=await discover({queue,queueSha256:o['--queue-sha256'],outputDir:o['--output-dir'],env:process.env,maxBuildings:max,resume:!!o['--resume']});
 console.log(JSON.stringify({status:result.status,examinedBuildings:result.results.length,pending:result.unexaminedBuildingIds?.length,requests:result.requests,productionWrites:0}));
 if(result.status!=='COMPLETED_DISCOVERY_ONLY')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(safeError(e));process.exitCode=1;});
