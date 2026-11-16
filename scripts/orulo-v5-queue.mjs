// Órulo V5: pure, read-only queue planning. No database/network writes.
// This module does not authorize recovery or bypass existing audit/CAS gates.
export const STATES = Object.freeze(['SP','ES','SC','RS','RJ','PR','PE','PB']);
export const OUTCOMES = Object.freeze({
  READY:'READY_FOR_FRESH_SOURCE_VALIDATION',
  COMPLETE:'ALREADY_COMPLETE',
  ISOLATED:'CONFLICT_ISOLATED',
  SOURCE_UNAVAILABLE:'SOURCE_UNAVAILABLE',
  RECONCILE:'RECONCILIATION_REQUIRED'
});
const isId = v => typeof v === 'string' && /^[1-9][0-9]*$/.test(v);
export function planRecoveryQueue(items, {batchSize=10}={}) {
  if (!Array.isArray(items) || !Number.isInteger(batchSize) || batchSize<1 || batchSize>10)
    throw Error('V5_INVALID_INPUT');
  const seen=new Set(), eligible=[], exceptions=[], complete=[];
  for(const item of items) {
    const {state,buildingId,missingPlanIds=[],blocked=false,reason=null,sourceStatus=null}=item??{};
    if(!STATES.includes(state)||!isId(buildingId)||!Array.isArray(missingPlanIds)||
      missingPlanIds.some(id=>!isId(String(id)))) throw Error('V5_INVALID_ITEM');
    const key=state+':'+buildingId;
    if(seen.has(key)) throw Error('V5_DUPLICATE_BUILDING');
    seen.add(key);
    const ids=[...new Set(missingPlanIds.map(String))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
    const entry={state,buildingId,missingPlanIds:ids,missingPlans:ids.length};
    if(blocked || reason || sourceStatus==='AMBIGUOUS') {
      exceptions.push({...entry,outcome:sourceStatus==='AMBIGUOUS'?OUTCOMES.RECONCILE:OUTCOMES.ISOLATED,reason:reason||'PROTECTED'});
    } else if(sourceStatus==='UNAVAILABLE') {
      exceptions.push({...entry,outcome:OUTCOMES.SOURCE_UNAVAILABLE,reason:'SOURCE_UNAVAILABLE'});
    } else if(ids.length===0) {
      complete.push({...entry,outcome:OUTCOMES.COMPLETE});
    } else {
      eligible.push({...entry,outcome:OUTCOMES.READY});
    }
  }
  const order=new Map(STATES.map((s,i)=>[s,i]));
  eligible.sort((a,b)=>order.get(a.state)-order.get(b.state) ||
    b.missingPlans-a.missingPlans || a.buildingId.localeCompare(b.buildingId,'en',{numeric:true}));
  const batches=[];
  for(const state of STATES) {
    const subset=eligible.filter(x=>x.state===state);
    for(let i=0;i<subset.length;i+=batchSize)
      batches.push({batchId:`V5-${state}-${String(Math.floor(i/batchSize)+1).padStart(4,'0')}`,
        state,items:subset.slice(i,i+batchSize)});
  }
  return {schema:'orulo-v5-readonly-plan-v1',writeEnabled:false,
    summary:{eligibleBuildings:eligible.length,exceptionBuildings:exceptions.length,
      completeBuildings:complete.length,missingPlanCandidates:eligible.reduce((n,x)=>n+x.missingPlans,0)},
    batches,exceptions,complete};
}
