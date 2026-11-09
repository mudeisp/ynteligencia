import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PRELIMINARY_SHA256,pinnedJSON,sha,saveNew,newDirectory,verifyQueue,options,fail} from './orulo-national-transfer-common.mjs';

export function prepare(manifest){
 if(manifest.version!==2||manifest.writeAuthorized!==false||manifest.operations?.length||!Array.isArray(manifest.candidates)||!Array.isArray(manifest.properties))throw fail('PRELIMINARY_MANIFEST_INVALID');
 const properties=new Map(manifest.properties.map(r=>[r.id,r]));
 if(properties.size!==manifest.properties.length)throw fail('DUPLICATE_PROPERTY');
 const buildings=new Map(),keys=new Set();
 for(const c of manifest.candidates){
  if(c.key!==`${c.buildingId}:${c.planId}`||keys.has(c.key)||c.candidateImage!==null||c.proposedPatch!==null)throw fail('CANDIDATE_INVALID');
  keys.add(c.key);
  for(const id of c.propertyIds){
   const row=properties.get(id);
   if(!row||row.buildingId!==c.buildingId||!row.plans.some(([pid,has])=>pid===c.planId&&has===false)||!row.candidateKeys.includes(c.key))throw fail('CANDIDATE_ASSOCIATION_INVALID');
  }
  if(!buildings.has(c.buildingId))buildings.set(c.buildingId,{buildingId:c.buildingId,plans:[]});
  buildings.get(c.buildingId).plans.push({planId:c.planId,propertyIds:[...c.propertyIds].sort()});
 }
 const queue={version:1,logicalBatchId:'orulo-national-v2',writeAuthorized:false,
  purpose:'AUTHENTICATED_READ_ONLY_SOURCE_DISCOVERY',buildings:[...buildings.values()].sort((a,b)=>a.buildingId.localeCompare(b.buildingId))};
 for(const b of queue.buildings)b.plans.sort((a,b)=>a.planId.localeCompare(b.planId));
 verifyQueue(queue);
 return queue;
}
function main(){
 const o=options(process.argv.slice(2),['--manifest','--manifest-sha256','--output-dir']);
 if(!o['--manifest']||!o['--output-dir'])throw fail('MANIFEST_AND_OUTPUT_REQUIRED');
 const expected=o['--manifest-sha256']||PRELIMINARY_SHA256;
 const manifest=pinnedJSON(o['--manifest'],expected),queue=prepare(manifest);
 const dir=newDirectory(o['--output-dir']);queue.manifestSha256=expected;
 const digest=saveNew(resolve(dir,'source-queue.json'),queue);
 saveNew(resolve(dir,'source-queue.sha256'),Buffer.from(digest+'  source-queue.json\n'));
 saveNew(resolve(dir,'inventory-summary.json'),{logicalBatches:1,writeAuthorized:false,
  manifestSha256:expected,queueSha256:digest,buildings:queue.buildings.length,
  distinctBuildingPlans:queue.buildings.reduce((n,b)=>n+b.plans.length,0),
  properties:new Set(queue.buildings.flatMap(b=>b.plans.flatMap(p=>p.propertyIds))).size,
  sourceEvidence:'NOT_EXECUTED_IN_WORK',originalInventoryFingerprint:manifest.inventoryFingerprint,
  sourceScriptSha256:sha(readFileSync(new URL('./orulo-national-source-readonly.mjs',import.meta.url)))});
 console.log(JSON.stringify({status:'PREPARED',directory:dir,queueSha256:digest,writeAuthorized:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{main();}catch(e){console.error(e.code||'LOCAL_PREPARATION_ERROR');process.exitCode=1;}
}
