// Connect Órulo source recovery to the existing authorized, audited CAS executor.
// This module never performs an unaudited SQL UPDATE or grants write permission.
import {createHash} from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const imageKeys = new Set(['image_url','images','2280x1800','1024x1024','520x280','url']);
const validUrl = v => typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v);
const id = v => String(v??'');
const clone = v => structuredClone(v);
const plansOf = row => row?.raw_data?.building?.floor_plans;
const planId = p => id(p?.id);
const imageOnly = (before,after) => {
 const a=clone(before),b=clone(after);
 for(const key of imageKeys){delete a[key];delete b[key];}
 return hash(a)===hash(b);
};
function assertImages(plan) {
 const urls=[plan.image_url,...(Array.isArray(plan.images)?plan.images.map(x=>typeof x==='string'?x:x?.url):[])].filter(Boolean);
 if (!urls.length || !urls.every(validUrl)) throw Error('V5_SOURCE_IMAGE_MISSING');
 return urls;
}
export async function recoverAuditedBuilding({
 buildingId,manifest,approval,source,loadRows,backup,checkImage,
 authorize,commitIntent,auditedCas,readback,record
}) {
 if(!manifest || manifest.writeEnabled!==false || !Array.isArray(manifest.targets) ||
    !manifest.targets.some(t=>t.buildingId===buildingId) ||
    !approval?.verified || approval.manifestHash!==manifest.manifestHash ||
    ![source,loadRows,backup,checkImage,authorize,commitIntent,auditedCas,readback,record].every(f=>typeof f==='function'))
   throw Error('V5_CONNECTOR_NOT_AUTHORIZED');
 const target=manifest.targets.find(t=>t.buildingId===buildingId);
 const fresh=await source(buildingId); // fetch Órulo by ID, never from cached database values
 if(!Array.isArray(fresh?.floor_plans)) throw Error('V5_SOURCE_PLANS_INVALID');
 const sourceMap=new Map();
 for(const p of fresh.floor_plans){
   if(!/^\d+$/.test(planId(p)) || sourceMap.has(planId(p))) throw Error('V5_SOURCE_PLAN_IDS_INVALID');
   sourceMap.set(planId(p),p);
 }
 const allowed=new Set(target.missingPlanIds);
 if(!allowed.size) throw Error('V5_EMPTY_SCOPE');
 for(const p of allowed) if(!sourceMap.has(p)) throw Error('V5_SOURCE_PLAN_MISMATCH');
 const rows=await loadRows(buildingId);
 if(!Array.isArray(rows)||!rows.length) throw Error('V5_NO_ROWS');
 const prepared=[];
 for(const row of rows) {
   if(row.source!=='novos'||row.state!==manifest.state||row.active!==true ||
      id(row.raw_data?.building?.id??row.raw_data?.building_id)!==buildingId)
     throw Error('V5_ROW_SCOPE_MISMATCH');
   const before=plansOf(row);
   if(!Array.isArray(before)) throw Error('V5_ROW_PLANS_INVALID');
   const desired=clone(before);let changes=0;
   for(let i=0;i<desired.length;i++){
     const old=before[i], pid=planId(old);
     if(!allowed.has(pid))continue;
     const src=sourceMap.get(pid);
     if(!src)throw Error('V5_SOURCE_PLAN_MISMATCH');
     // Do not replace already-populated images, even when a plan is in the manifest.
     if(old.image_url || (Array.isArray(old.images)&&old.images.length))continue;
     const urls=assertImages(src);
     for(const url of urls) if(await checkImage(url)!==true)throw Error('V5_SOURCE_IMAGE_UNAVAILABLE');
     for(const key of imageKeys) if(src[key]!==undefined)desired[i][key]=clone(src[key]);
     if(!imageOnly(old,desired[i]))throw Error('V5_NONIMAGE_CHANGE');
     if(hash(old)!==hash(desired[i]))changes++;
   }
   if(changes)prepared.push({row,desired,changes});
 }
 if(!prepared.length)return {buildingId,status:'ALREADY_COMPLETE',rows:0,images:0};
 // Full original records must be durably backed up AND independently restore-tested.
 const proof=await backup({buildingId,rows:rows.map(clone),hash:hash(rows)});
 if(proof?.durable!==true||proof?.restoreTested!==true||proof?.hash!==hash(rows))
   throw Error('V5_BACKUP_NOT_VERIFIED');
 const authorized=await authorize({manifest,approval,buildingId,rows:prepared.map(x=>x.row.id)});
 if(authorized?.verified!==true)throw Error('V5_EXECUTION_AUTHORIZATION_FAILED');
 const receipts=[];
 for(const item of prepared) {
   // commitIntent must durably commit before auditedCas, with a unique operation ID.
   const intent=await commitIntent({manifest,approval,buildingId,row:item.row,
     expected:clone(item.row),desiredPlans:clone(item.desired)});
   if(!intent?.committed||!intent.operationId||!intent.runUuid)
     throw Error('V5_INTENT_NOT_COMMITTED');
   // Ambiguous failures are fatal: no automatic retry.
   const receipt=await auditedCas({intent,manifest,approval});
   if(receipt?.auditReceiptVerified!==true||receipt?.casReadbackVerified!==true)
     throw Error('V5_CAS_RECEIPT_UNVERIFIED');
   const after=await readback(item.row.id);
   if(!after || hash(plansOf(after))!==hash(item.desired) ||
      hash({...item.row,raw_data:{...item.row.raw_data,building:{...item.row.raw_data.building,floor_plans:item.desired}},updated_at:after.updated_at})!==hash(after))
     throw Error('V5_POSTWRITE_DRIFT');
   receipts.push({id:item.row.id,operationId:intent.operationId,changes:item.changes,receipt});
 }
 const result={buildingId,status:'VERIFIED',rows:receipts.length,images:receipts.reduce((n,r)=>n+r.changes,0),receipts};
 await record(result);
 return result;
}
