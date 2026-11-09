// Convert signed national dry-run reports to a V5 read-only recovery queue.
// Reports must be verified against their SHA256 sidecar before this adapter is called.
import {planRecoveryQueue} from './orulo-v5-queue.mjs';
const isId=x=>/^[1-9][0-9]*$/.test(String(x));
export function queueFromVerifiedReports(reports,{batchSize=10}={}){
 if(!Array.isArray(reports))throw Error('V5_REPORTS_REQUIRED');
 const items=[], seen=new Set();
 for(const report of reports){
  if(!report || report.writes!==0 || !Array.isArray(report.items) ||
    !['COMPLETED','COMPLETED_WITH_SOURCE_ERRORS'].includes(report.status) ||
    !/^[A-F0-9]{2}$/.test(report.state||'') || !report.batchId)
      throw Error('V5_UNVERIFIED_OR_INCOMPLETE_REPORT');
  for(const row of report.items){
   const buildingId=String(row.buildingId||'');
   if(!isId(buildingId))throw Error('V5_INVALID_REPORT_BUILDING');
   const key=report.state+':'+buildingId;
   if(seen.has(key))throw Error('V5_REPORT_OVERLAP_RECONCILIATION_REQUIRED');
   seen.add(key);
   const plans=Array.isArray(row.recoverablePlans)?row.recoverablePlans:[];
   if(plans.some(p=>!isId(p.planId)||!Array.isArray(p.urls)||!p.urls.length))
     throw Error('V5_INVALID_RECOVERABLE_PLANS');
   const conflict=['DATA_CONFLICT','NEEDS_REVIEW'].includes(row.status) ||
     !['RECOVERABLE','COMPLETE','SOURCE_MISSING'].includes(row.status);
   items.push({state:report.state,buildingId,missingPlanIds:plans.map(p=>String(p.planId)),
    blocked:conflict,reason:conflict?row.reason||row.status:null,
    sourceStatus:row.status==='SOURCE_MISSING'?'UNAVAILABLE':null});
  }
 }
 return planRecoveryQueue(items,{batchSize});
}
