// Orchestration only. Never writes directly; delegates to an independently
// approved audited executor. Global integrity failures always stop the run.
const LOCAL = new Set(['BATCH_SOURCE_HTTP_FAILED','BATCH_SOURCE_NETWORK_FAILED','BATCH_IMAGE_UNAVAILABLE','BATCH_SOURCE_IMAGE_MISSING','BATCH_SOURCE_PLAN_MISMATCH','BATCH_CONCURRENT_CHANGE_BEFORE_CAS']);
export async function runV5Batch({manifest,authorize,execute,record}) {
  if (!manifest || manifest.writeEnabled!==false || !Array.isArray(manifest.targets) ||
      !manifest.targets.length || typeof authorize!=='function' ||
      typeof execute!=='function' || typeof record!=='function') throw Error('V5_RUNNER_INVALID');
  // Authorization must come from existing server-side audit controls.
  const approval=await authorize(manifest);
  if (!approval || approval.manifestHash!==manifest.manifestHash || approval.verified!==true)
    throw Error('V5_RUNNER_NOT_AUTHORIZED');
  const result={manifestHash:manifest.manifestHash,completed:[],isolated:[],halted:false};
  for(const target of manifest.targets){
    try {
      const receipt=await execute({manifest,target,approval});
      if (!receipt || receipt.verified!==true || receipt.buildingId!==target.buildingId)
        throw Error('V5_RECEIPT_UNVERIFIED');
      await record({buildingId:target.buildingId,status:'VERIFIED',receipt});
      result.completed.push(target.buildingId);
    } catch(error) {
      const code=error?.message;
      if(!LOCAL.has(code)) {
        result.halted=true;
        throw Object.assign(Error('V5_GLOBAL_STOP'),{cause:error,result});
      }
      try { await record({buildingId:target.buildingId,status:'ISOLATED',code}); }
      catch(e){throw Object.assign(Error('V5_GLOBAL_STOP'),{cause:e,result:{...result,halted:true}});}
      result.isolated.push({buildingId:target.buildingId,code});
    }
  }
  return result;
}
