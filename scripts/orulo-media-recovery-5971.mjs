// Fixed extension of the existing batch authorization path, not a writer or ledger.
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {digest} from './orulo-media-recovery-postgres.mjs';
export const PILOT_5971='pilot-5971-images';
export const PROPOSAL_5971_SHA='4c6a3576d91fcca4f7c526daf7f62981df756dd9bab9bbb7f3b96a4d3c242eae';
export const UUID_5971='55701ebd-747e-4968-92f1-647d2e6a79d9';
const masterHash='d670eb2cc7ab60cfc76e0ef08b466e9c9b503df64047d57519a34e7ed57f63b2';
const planIds=['251614','251615'];
export function proposal5971(bytes=readFileSync(new URL('./orulo-media-recovery-batches/pilot-5971-v6-proposal.json',import.meta.url))){
 if(digest(bytes)!==PROPOSAL_5971_SHA)throw Error('PILOT5971_PROPOSAL_HASH_MISMATCH');
 const proposal=JSON.parse(bytes);
 if(proposal.buildingId!=='5971'||proposal.state!=='SP'||!isDeepStrictEqual(proposal.targetIds,[UUID_5971])||!isDeepStrictEqual(proposal.planIds,planIds)||
    !isDeepStrictEqual(proposal.targets,[{id:UUID_5971,buildingId:'5971',patches:planIds.map(id=>({id,image_url:`https://static.orulo.com.br/images/properties/large/${id}.JPG`}))}]))throw Error('PILOT5971_PROPOSAL_SCOPE_INVALID');
 return {proposal,proposalText:bytes.toString('utf8'),proposalHash:PROPOSAL_5971_SHA};
}
export function manifest5971(){
 proposal5971();
 return {version:1,id:PILOT_5971,phase:0,masterHash,prerequisite:null,buildingIds:['5971'],targets:[{id:UUID_5971,buildingId:'5971',missingPlanIds:[...planIds]}]};
}
export function entry5971(){return{hash:digest(JSON.stringify(manifest5971())),released:true};}
export function validate5971Row(row){
 if(row.id!==UUID_5971||row.state!=='SP'||row.source!=='novos'||row.active!==true||String(row.raw_data?.building_id)!=='5971'||String(row.raw_data?.building?.id)!=='5971'||
  !isDeepStrictEqual(row.raw_data?.building?.floor_plans?.map(p=>String(p.id)),planIds))throw Error('PILOT5971_ROW_SCOPE_INVALID');
}
export function source5971(fetchPlans){
 return async id=>{
  if(id!=='5971')throw Error('PILOT5971_SOURCE_SCOPE_INVALID');
  const live=await fetchPlans(id),target=proposal5971().proposal.targets[0];
  if(!Array.isArray(live)||new Set(live.map(p=>String(p.id))).size!==live.length)throw Error('PILOT5971_SOURCE_PLAN_IDS_INVALID');
  return target.patches.map(p=>{
   const source=live.find(x=>String(x.id)===p.id);
   const urls=source?['image_url','url','2280x1800','1024x1024','520x280'].map(k=>source[k]).concat(source.images||[]):[];
   if(!urls.includes(p.image_url))throw Error('PILOT5971_SOURCE_IMAGE_CHANGED');
   return {...p}; // Only exact proposal image_url; provider metadata never enters the patch.
  });
 };
}
