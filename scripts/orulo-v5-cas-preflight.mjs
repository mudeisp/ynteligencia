// V5 approval boundary. Produces immutable, scoped inputs for the existing
// audited CAS executor. Does not grant authorization or perform writes.
import {createHash} from 'node:crypto';
import {STATES,OUTCOMES} from './orulo-v5-queue.mjs';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validId=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v);
export function prepareAuditedBatch(batch,{approvedReportHashes,protectedBuildingIds=[],pendingReconciliationIds=[]}={}){
 if(!batch||!STATES.includes(batch.state)||!Array.isArray(batch.items)||
   !batch.items.length||batch.items.length>10||!Array.isArray(approvedReportHashes)||
   !approvedReportHashes.length||approvedReportHashes.some(h=>!/^[a-f0-9]{64}$/.test(h))||
   !Array.isArray(protectedBuildingIds)||!Array.isArray(pendingReconciliationIds))
   throw Error('V5_BATCH_APPROVAL_INPUT_INVALID');
 const forbidden=new Set([...protectedBuildingIds,...pendingReconciliationIds].map(String));
 const seen=new Set();
 const targets=batch.items.map(item=>{
  if(item.state!==batch.state||!validId(item.buildingId)||
    item.outcome!==OUTCOMES.READY||!Array.isArray(item.missingPlanIds)||
    !item.missingPlanIds.length||item.missingPlanIds.some(x=>!validId(x))||
    new Set(item.missingPlanIds).size!==item.missingPlanIds.length)
    throw Error('V5_BATCH_TARGET_INVALID');
  if(forbidden.has(item.buildingId))throw Error('V5_PROTECTED_BUILDING');
  if(seen.has(item.buildingId))throw Error('V5_DUPLICATE_TARGET');
  seen.add(item.buildingId);
  return {buildingId:item.buildingId,missingPlanIds:[...item.missingPlanIds].sort()};
 });
 const payload={protocol:'orulo-v5-cas-preflight-v1',state:batch.state,
   batchId:batch.batchId,targets,approvedReportHashes:[...new Set(approvedReportHashes)].sort()};
 return {...payload,manifestHash:sha(payload),writeEnabled:false,
  authorization:'REQUIRES_EXISTING_AUDITED_CAS_APPROVAL_AND_FRESH_ROW_READBACK'};
}
export function assertAuditedExecutionReady({manifest,health,approval,baseline}={}){
 if(!manifest||manifest.writeEnabled!==false||
   manifest.authorization!=='REQUIRES_EXISTING_AUDITED_CAS_APPROVAL_AND_FRESH_ROW_READBACK'||
   !health?.durable||health?.synchronousCommit!=='on'||
   health?.writeEnabled!==false||!approval?.explicit||!approval?.verified||
   approval.manifestHash!==manifest.manifestHash||
   !baseline?.fresh||baseline.manifestHash!==manifest.manifestHash)
   throw Error('V5_AUDITED_EXECUTION_NOT_READY');
 // This readiness check is not a write capability. The existing CAS executor
 // must separately enforce owner, workflow, row CAS, ledger and readback.
 return {readyForExistingExecutor:true,manifestHash:manifest.manifestHash};
}
