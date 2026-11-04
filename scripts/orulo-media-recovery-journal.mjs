import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const APPROVED_SHA='2fa6ec8b093346e1a2319e4c6833cdfb0c52825e';
export const MANIFEST_HASH='1c8b002b5a3b4b6caf614e3b4e6d84383b8e306ae2773f3d7de48cc7daaa6d03';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const checksum=bytes=>createHash('sha256').update(bytes).digest('base64');
export function runPrefix(runId,attempt){
  if(!/^[1-9]\d*$/.test(String(runId)) || String(attempt)!=='1')throw Error('NEW_MANUAL_RUN_REQUIRED');
  return `orulo-lote1/${APPROVED_SHA}/${runId}-1`;
}
export function validateStoreConfig({bucket,region,account}){
  if(!/^(?=.{3,63}$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket??'') ||
     !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region??'') || !/^\d{12}$/.test(account??''))throw Error('DURABLE_STORE_NOT_CONFIGURED');
}
export function validateStoreMetadata({versioning,encryption,publicAccess}){
  const block=publicAccess?.PublicAccessBlockConfiguration;
  if(versioning?.Status!=='Enabled')throw Error('BUCKET_VERSIONING_REQUIRED');
  if(!['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets'].every(k=>block?.[k]===true))throw Error('PRIVATE_BUCKET_REQUIRED');
  if(!encryption?.ServerSideEncryptionConfiguration?.Rules?.some(r=>r.ApplyServerSideEncryptionByDefault?.SSEAlgorithm==='AES256'))throw Error('SSE_S3_ENCRYPTION_REQUIRED');
}
// CLI credentials come only from GitHub's official AWS OIDC action, never from arguments/files in this repository.
export function awsTransport({bucket,region,account},exec=execFileSync){
  validateStoreConfig({bucket,region,account});
  const call=(operation,args=[])=>{
    try{
      const result=exec('aws',['s3api',operation,'--bucket',bucket,'--region',region,
        '--expected-bucket-owner',account,...args,'--output','json','--no-cli-pager'],{
        encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,
        env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_PAGER:''}
      });
      return JSON.parse(result);
    }catch{throw Error(`AUDIT_STORE_${operation.toUpperCase().replaceAll('-','_')}_FAILED`);}
  };
  return {
    async metadata(){return {
      versioning:call('get-bucket-versioning'),encryption:call('get-bucket-encryption'),
      publicAccess:call('get-public-access-block')
    };},
    async put(key,bytes){
      const dir=mkdtempSync(join(tmpdir(),'orulo-audit-'));
      try{
        const file=join(dir,'body');writeFileSync(file,bytes,{mode:0o600});
        return call('put-object',['--key',key,'--body',file,'--if-none-match','*',
          '--server-side-encryption','AES256','--storage-class','STANDARD',
          '--checksum-algorithm','SHA256','--checksum-sha256',checksum(bytes)]);
      }finally{rmSync(dir,{recursive:true,force:true});}
    },
    async get(key,versionId){
      const dir=mkdtempSync(join(tmpdir(),'orulo-audit-read-'));
      try{
        const file=join(dir,'body');
        const result=call('get-object',['--key',key,'--version-id',versionId,'--checksum-mode','ENABLED',file]);
        const {readFileSync}=await import('node:fs');
        return {...result,bytes:readFileSync(file)};
      }finally{rmSync(dir,{recursive:true,force:true});}
    }
  };
}
function assertKey(key){
  if(!new RegExp(`^orulo-lote1/${APPROVED_SHA}/[1-9][0-9]*-1/[a-zA-Z0-9._/-]+$`).test(key) || key.includes('..'))throw Error('AUDIT_KEY_OUT_OF_SCOPE');
}
export function durableStore(transport){
  return {
    async put(key,bytes){
      assertKey(key);const data=Buffer.from(bytes);
      const result=await transport.put(key,data); // No retry: an ambiguous acknowledgement freezes the caller.
      if(!result?.VersionId || result.VersionId==='null' || result.ChecksumSHA256!==checksum(data))throw Error('DURABLE_ACK_INVALID');
      return {key,versionId:result.VersionId,hash:digest(data)};
    },
    async verify(receipt){
      assertKey(receipt.key);const result=await transport.get(receipt.key,receipt.versionId);
      if(result.VersionId!==receipt.versionId || digest(result.bytes)!==receipt.hash ||
         result.ChecksumSHA256!==checksum(result.bytes))throw Error('DURABLE_READBACK_DIVERGENCE');
      return true;
    }
  };
}
// Each immutable object is one JSONL shard. A combined download is a derived view, never the only audit copy.
export async function openDurableJournal(store,prefix){
  await store.put(`${prefix}/start.json`,Buffer.from(JSON.stringify({approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH})+'\n'));
  let sequence=0,previousHash='',busy=false,failed=false;
  return async event=>{
    if(failed)throw Error('JOURNAL_FROZEN_MANUAL_RECONCILIATION_REQUIRED');
    if(busy){failed=true;throw Error('CONCURRENT_JOURNAL_APPEND_DENIED');}
    busy=true;
    try{
      const next=sequence+1;
      const bytes=Buffer.from(JSON.stringify({...event,_journal:{sequence:next,previousHash}})+'\n');
      const receipt=await store.put(`${prefix}/ledger/${String(next).padStart(12,'0')}.jsonl`,bytes);
      if(failed)throw Error('JOURNAL_FROZEN_MANUAL_RECONCILIATION_REQUIRED');
      sequence=next;previousHash=receipt.hash;
      return receipt;
    }catch(error){failed=true;throw error;}finally{busy=false;}
  };
}
