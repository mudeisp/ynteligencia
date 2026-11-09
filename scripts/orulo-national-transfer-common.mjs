import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export const PRELIMINARY_SHA256='f94cf3139fa2516d55b98c0e242c64193107f0f65be924f36c936dc7952ab070';
export const PROJECT_ID='wzaegidwtdjuhqchpdpd';
export const imageKeys=['image_url','images','2280x1800','1024x1024','520x280','url'];
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const fail=code=>Object.assign(new Error(code),{code});
export const readJSON=path=>JSON.parse(readFileSync(path,'utf8'));
export function pinnedJSON(path,expected){
 if(!/^[a-f0-9]{64}$/.test(expected||''))throw fail('EXPECTED_SHA256_REQUIRED');
 const raw=readFileSync(path);if(sha(raw)!==expected)throw fail('INPUT_SHA256_MISMATCH');
 return JSON.parse(raw);
}
export function saveNew(path,value){
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const raw=Buffer.isBuffer(value)?value:bytes(value);
 writeFileSync(path,raw,{flag:'wx',mode:0o600});return sha(raw);
}
export function checkpoint(path,value){
 const temp=path+'.tmp';writeFileSync(temp,Buffer.isBuffer(value)?value:bytes(value),{flag:'wx',mode:0o600});renameSync(temp,path);
}
export function newDirectory(path){
 if(existsSync(path))throw fail('OUTPUT_DIRECTORY_MUST_NOT_EXIST');
 mkdirSync(path,{recursive:true,mode:0o700});return resolve(path);
}
export function urlsOf(plan){
 return [...new Set(imageKeys.flatMap(k=>k==='images'?(Array.isArray(plan?.images)?plan.images:[]):[plan?.[k]])
  .filter(v=>typeof v==='string'&&v.length))];
}
export function verifyQueue(queue){
 if(queue.version!==1||queue.logicalBatchId!=='orulo-national-v2'||queue.writeAuthorized!==false||!Array.isArray(queue.buildings))throw fail('QUEUE_INVALID');
 const seen=new Set();
 for(const b of queue.buildings){
  if(!/^[1-9]\d*$/.test(b.buildingId)||seen.has(b.buildingId)||!Array.isArray(b.plans)||!b.plans.length)throw fail('QUEUE_BUILDING_INVALID');
  seen.add(b.buildingId);const plans=new Set();
  for(const p of b.plans){
   if(!/^[1-9]\d*$/.test(p.planId)||plans.has(p.planId)||!Array.isArray(p.propertyIds)||!p.propertyIds.length||
    new Set(p.propertyIds).size!==p.propertyIds.length||p.propertyIds.some(id=>!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)))throw fail('QUEUE_PLAN_INVALID');
   plans.add(p.planId);
  }
 }
 return queue;
}
export function options(args,allowed){
 const out={};
 for(let i=0;i<args.length;i++){
  const key=args[i];if(!allowed.includes(key)||out[key]!==undefined)throw fail('ARGUMENT_NOT_ALLOWED');
  if(key==='--resume'){out[key]=true;continue;}
  if(!args[i+1]||args[i+1].startsWith('--'))throw fail('ARGUMENT_VALUE_REQUIRED');
  out[key]=args[++i];
 }
 return out;
}
