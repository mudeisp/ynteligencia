// Orchestration only. No direct writes. Each target requires an independently
// authorized audited executor and verified CAS readback. Unknown outcomes stop.
const LOCAL_PREWRITE = new Set([
 'BATCH_SOURCE_HTTP_FAILED','BATCH_SOURCE_NETWORK_FAILED',
 'BATCH_IMAGE_UNAVAILABLE','BATCH_SOURCE_IMAGE_MISSING',
 'BATCH_SOURCE_PLAN_MISMATCH'
]);
export async function runV5Batch({manifest,authorize,execute,record}) {
  if (!manifest || manifest.writeEnabled!==false || !Array.isArray(manifest.targets) ||
      !manifest.targets.length || typeof authorize!=='function' ||
      typeof execute!=='function' || typeof record!=='function')
    throw Error('V5_RUNNER_INVALID');
  const approval=await authorize(manifest);
  if (!approval || approval.manifestHash!==manifest.manifestHash || approval.verified!==true)
    throw Error('V5_RUNNER_NOT_AUTHORIZED');
  const result={manifestHash:manifest.manifestHash,completed:[],isolated:[],halted:false};
  for(const target of manifest.targets){
    let receipt;
    try {
      receipt=await execute({manifest,target,approval});
    } catch(error) {
      // Only failures proven to occur before any CAS intent may be isolated.
      // CAS conflicts, timeouts, uncertain responses and journal failures halt.
      if (!LOCAL_PREWRITE.has(error?.message) || error?.phase!=='PREWRITE' ||
          error?.casAttempted!==false) {
        result.halted=true;
        throw Object.assign(Error('V5_GLOBAL_STOP'),{cause:error,result});
      }
      try { await record({buildingId:target.buildingId,status:'ISOLATED',code:error.message}); }
      catch(e){throw Object.assign(Error('V5_GLOBAL_STOP'),{cause:e,result:{...result,halted:true}});}
      result.isolated.push({buildingId:target.buildingId,code:error.message});
      continue;
    }
    if (!receipt || receipt.verified!==true || receipt.buildingId!==target.buildingId ||
        receipt.casReadbackVerified!==true || receipt.auditReceiptVerified!==true) {
      result.halted=true;
      throw Object.assign(Error('V5_GLOBAL_STOP'),{cause:Error('V5_RECEIPT_UNVERIFIED'),result});
    }
    try { await record({buildingId:target.buildingId,status:'VERIFIED',receipt}); }
    catch(e){throw Object.assign(Error('V5_GLOBAL_STOP'),{cause:e,result:{...result,halted:true}});}
    result.completed.push(target.buildingId);
  }
  return result;
}
