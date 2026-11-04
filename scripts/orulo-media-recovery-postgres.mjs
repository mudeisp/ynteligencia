import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const APPROVED_SHA='2fa6ec8b093346e1a2319e4c6833cdfb0c52825e';
export const MANIFEST_HASH='1c8b002b5a3b4b6caf614e3b4e6d84383b8e306ae2773f3d7de48cc7daaa6d03';
export const PROJECT_URL='https://wzaegidwtdjuhqchpdpd.supabase.co';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// Exact server constants only: never publish arbitrary PostgreSQL message/details/hint.
const databaseReasons=new Set(['AUDIT_ACTIVE_RUN_REQUIRES_RECONCILIATION','AUDIT_CONCURRENT_RUN','AUDIT_CONCURRENT_ACCESS',
 'AUDIT_MANUAL_OWNER_SCOPE_REQUIRED','AUDIT_RUN_CLOSED','AUDIT_RUN_NOT_FOUND','AUDIT_PENDING_INTENT','AUDIT_CAPTURE_ALREADY_OPEN',
 'AUDIT_DUPLICATE_OPERATION_USE_RECOVERY','AUDIT_OPERATIONAL_WRITE_BLOCKED','BATCH_MANIFEST_DRIFT','BATCH_PHASE_NOT_RELEASED',
 'BATCH_ROW_SCOPE_DENIED','BATCH_EXPLICIT_AUTHORIZATION_REQUIRED','BATCH_AUTHORIZATION_INVALID_OR_EXPIRED','BATCH_FRESH_BASELINE_REQUIRED']);
export function rpcFailureDetails(error){
 const out={};
 if(['orulo_audit_control','orulo_audited_cas'].includes(error?.rpc))out.rpc=error.rpc;
 if(/^[a-z_]{1,40}$/.test(error?.rpcAction||''))out.rpcAction=error.rpcAction;
 if(Number.isInteger(error?.httpStatus) && error.httpStatus>=100 && error.httpStatus<=599)out.httpStatus=error.httpStatus;
 if(/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(error?.databaseCode||''))out.databaseCode=error.databaseCode;
 if(databaseReasons.has(error?.databaseReason))out.databaseReason=error.databaseReason;
 return out;
}
export function runPrefix(runId,attempt){
 if(!/^[1-9]\d*$/.test(String(runId))||String(attempt)!=='1')throw Error('NEW_MANUAL_RUN_REQUIRED');
 return 'orulo-lote1/'+APPROVED_SHA+'/'+runId+'-1';
}
export function postgresTransport({url,key},request=fetch){
 if(url!==PROJECT_URL || !key)throw Error('POSTGRES_AUDIT_CONFIGURATION_REQUIRED');
 const rpc=async(name,body)=>{
  let response;
  try{response=await request(url+'/rest/v1/rpc/'+name,{method:'POST',
   headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  }catch{throw Object.assign(Error('POSTGRES_AUDIT_RESPONSE_AMBIGUOUS'),rpcFailureDetails({rpc:name,rpcAction:body.p_action||'cas'}));}
  if(!response.ok){
   let bodyError;try{bodyError=await response.json();}catch{}
   const error=new Error('POSTGRES_AUDIT_RPC_FAILED');
   Object.assign(error,rpcFailureDetails({rpc:name,rpcAction:body.p_action||'cas',httpStatus:response.status,databaseCode:bodyError?.code,databaseReason:bodyError?.message}));
   throw error; // Never log message/details/hint, which may contain row data or secrets.
  }
  try{return await response.json();}catch{throw Object.assign(Error('POSTGRES_AUDIT_RESPONSE_AMBIGUOUS'),rpcFailureDetails({rpc:name,rpcAction:body.p_action||'cas'}));}
 };
 return {control:(action,args={})=>rpc('orulo_audit_control',{p_action:action,...args}),
  apply:(run,operation)=>rpc('orulo_audited_cas',{p_run:run,p_operation:operation})};
}
export function verifyEntry(entry,ack){
 if(!entry || entry.runUuid!==ack.runUuid || entry.sequence!==ack.sequence ||
    entry.hash!==ack.hash || digest(entry.canonical)!==ack.hash)throw Error('POSTGRES_AUDIT_READBACK_DIVERGENCE');
 const canonical=JSON.parse(entry.canonical);
 if(canonical.runUuid!==ack.runUuid || canonical.sequence!==ack.sequence ||
    canonical.event.eventUuid!==ack.eventUuid || !isDeepStrictEqual(canonical.event,entry.event))
  throw Error('POSTGRES_AUDIT_CANONICAL_DIVERGENCE');
 return entry;
}
export async function openPostgresJournal(env,transport){
 const health=await transport.control('health');
 if(health.version!==2 || health.snapshotProtocol!=='paged-v2' || health.storage!=='postgres' || health.durable!==true || health.appendOnly!==true ||
    health.synchronousCommit!=='on' || health.writeEnabled!==false)throw Error('POSTGRES_AUDIT_HEALTH_UNVERIFIED');
 const run= randomUUID();
 let head,failed=false,busy=false;
 const metadata={eventUuid:randomUUID(),repository:env.GITHUB_REPOSITORY,actor:env.GITHUB_ACTOR,
  actorId:env.GITHUB_ACTOR_ID,triggeringActor:env.GITHUB_TRIGGERING_ACTOR,eventName:env.GITHUB_EVENT_NAME,
  ref:env.GITHUB_REF,attempt:env.GITHUB_RUN_ATTEMPT,githubRunId:env.GITHUB_RUN_ID,
  workflowSha:env.GITHUB_WORKFLOW_SHA,approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH};
 const verify=async ack=>{
  const entry=await transport.control('read',{p_run:run,p_sequence:ack.sequence});
  return verifyEntry(entry,ack);
 };
 // Existing UUID/GitHub run ID or active interrupted run is never reopened.
 try{
  head=await transport.control('start',{p_run:run,p_event:metadata});
  const start=await verify(head);
  if(head.sequence!==1 || start.event.type!=='START' || JSON.parse(start.canonical).previousHash!=='')throw Error('POSTGRES_AUDIT_START_DIVERGENCE');
 }catch(error){error.auditRunUuid=run;throw error;} // Identifier for read-only reconciliation, never an automatic retry.
 const locked=async operation=>{
  if(failed)throw Error('POSTGRES_JOURNAL_FROZEN_RECONCILE_REQUIRED');
  if(busy){failed=true;throw Error('POSTGRES_JOURNAL_CONCURRENT_APPEND_DENIED');}
  busy=true;
  try{const result=await operation();if(failed)throw Error('POSTGRES_JOURNAL_FROZEN_RECONCILE_REQUIRED');return result;}
  catch(error){failed=true;throw error;}finally{busy=false;}
 };
 const mutate=async(action,event)=>{
  const ack=await transport.control(action,{p_run:run,p_sequence:head.sequence+1,p_previous_hash:head.hash,
   p_event:{...event,eventUuid:randomUUID()}});
  const entry=await verify(ack);
  if(JSON.parse(entry.canonical).previousHash!==head.hash)throw Error('POSTGRES_CHAIN_DIVERGENCE');
  head=ack;return {ack,entry};
 };
 return {
  runUuid:run,
  record:event=>locked(()=>mutate('append',event)),
  adoptPilotAuthorization:(buildingId,targetIds)=>locked(async()=>{
   const ack=await transport.control('pilot_status',{p_run:run});if(!ack)return false;
   const e=await verify(ack);
   if(ack.sequence!==head.sequence+1 || JSON.parse(e.canonical).previousHash!==head.hash ||
      e.event.type!=='WRITE_AUTHORIZED' || e.event.mode!=='PILOT_ONE_BUILDING' || e.event.buildingId!==buildingId ||
      !isDeepStrictEqual(e.event.targetIds,targetIds) || e.event.controlSha!==env.GITHUB_WORKFLOW_SHA)
    throw Error('PILOT_AUTHORIZATION_DIVERGENCE');
   head=ack;return true;
  }),
  pilotFinish:()=>locked(()=>mutate('pilot_finish',{})),
  adoptBatchAuthorization:(batchId,planHash,targetIds)=>locked(async()=>{
   const ack=await transport.control('batch_status',{p_run:run});if(!ack)return false;const e=await verify(ack);
   if(ack.sequence!==head.sequence+1||JSON.parse(e.canonical).previousHash!==head.hash||e.event.type!=='WRITE_AUTHORIZED'||e.event.mode!=='BATCH_IMAGES'||e.event.batchId!==batchId||e.event.planHash!==planHash||!isDeepStrictEqual(e.event.targetIds,targetIds)||e.event.controlSha!==env.GITHUB_WORKFLOW_SHA)throw Error('BATCH_AUTHORIZATION_DIVERGENCE');
   head=ack;return true;
  }),
  batchFinish:()=>locked(()=>mutate('batch_finish',{})),
  snapshot:kind=>locked(async()=>{
   const begin=await mutate('snapshot_begin',{kind});
   const keys=begin.entry.event.keys;
   const records=[];
   if(!Array.isArray(keys) || new Set(keys).size!==keys.length || keys.some((id,i)=>typeof id!=='string' || (i>0 && id<=keys[i-1])))
    throw Error('POSTGRES_SNAPSHOT_MANIFEST_INVALID');
   for(let offset=0;offset<keys.length;offset+=50){
    const page=await mutate('snapshot_page',{kind,offset,size:50});
    if(page.entry.event.offset!==offset || !isDeepStrictEqual(page.entry.event.records?.map(r=>r[0]),keys.slice(offset,offset+50)))
     throw Error('POSTGRES_SNAPSHOT_PAGE_DIVERGENCE');
    records.push(...page.entry.event.records);
   }
   const seal=await mutate('snapshot_seal',{kind});
   return {...seal,capture:{keys,records,columns:begin.entry.event.columns,seal:seal.entry.event.snapshot}};
  }),
  finish:()=>locked(()=>mutate('finish',{})),
  recover:operation=>transport.control('recover',{p_run:run,p_event:{operationId:operation}}),
  read:sequence=>transport.control('read',{p_run:run,p_sequence:sequence}),
  async apply(operation){
   return locked(async()=>{
    let result;
    try{result=await transport.apply(run,operation);}
    catch{
     // Read-only recovery, once. Never repeat an apply after an uncertain response.
     const recovered=await transport.control('recover',{p_run:run,p_event:{operationId:operation}});
     failed=true;
     const error=new Error(recovered.result?'POSTGRES_CAS_COMMITTED_RECONCILE_REQUIRED':'POSTGRES_CAS_AMBIGUOUS_RECONCILE_REQUIRED');
     error.recovery=recovered;throw error;
    }
    const ack=result.auditReceipt;
    const entry=await verify(ack);
    if(entry.event.type!=='CAS_RESULT' || entry.event.operationId!==operation ||
       JSON.parse(entry.canonical).previousHash!==head.hash)throw Error('POSTGRES_CAS_RECEIPT_DIVERGENCE');
    const body={...result};delete body.auditReceipt;
    if(!isDeepStrictEqual(body,entry.event.result))throw Error('POSTGRES_CAS_RESULT_DIVERGENCE');
    head=ack;return result;
   });
  }
 };
}

