import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPROVED_SHA,MANIFEST_HASH,digest,runPrefix,PROJECT_URL,postgresTransport,openPostgresJournal } from './orulo-media-recovery-postgres.mjs';

const REPOSITORY='mudeisp/ynteligencia',ENVIRONMENT='orulo-lote1';
export const AUTHORIZED_INITIATOR=Object.freeze({login:'mudeisp',id:'323805541'});
const KEYS=['ORULO_CLIENT_ID','ORULO_CLIENT_SECRET','SUPABASE_SECRET_KEY'];
export function validateDispatch(env){
  if(env.GITHUB_REPOSITORY!==REPOSITORY || env.GITHUB_EVENT_NAME!=='workflow_dispatch' ||
     env.GITHUB_REF!=='refs/heads/main')throw Error('ONLY_MANUAL_MAIN_DISPATCH_ALLOWED');
  if(env.GITHUB_ACTOR!==AUTHORIZED_INITIATOR.login || env.GITHUB_ACTOR_ID!==AUTHORIZED_INITIATOR.id ||
     env.GITHUB_TRIGGERING_ACTOR!==AUTHORIZED_INITIATOR.login)throw Error('AUTHORIZED_OWNER_DISPATCH_REQUIRED');
  runPrefix(env.GITHUB_RUN_ID,env.GITHUB_RUN_ATTEMPT);
  if(env.ORULO_POSTGRES_AUDIT_READY!=='true')throw Error('BLOCKED_DURABLE_STORAGE_NOT_APPROVED');
}
export function validateEnvironment(environment,policies){
  // Single-owner operation: independent review/self-review settings are optional.
  if(environment?.name!==ENVIRONMENT || environment.can_admins_bypass!==false)
    throw Error('PROTECTED_ENVIRONMENT_SECURITY_REQUIRED');
  const branch=environment.deployment_branch_policy;
  const rules=policies?.branch_policies;
  if(!branch?.custom_branch_policies || branch.protected_branches!==false || !Array.isArray(rules) ||
     rules.length!==1 || rules[0].name!=='main' || rules[0].type!=='branch')throw Error('ENVIRONMENT_MAIN_BRANCH_ONLY_REQUIRED');
}
export function validateManifest(ids){
  if(!Array.isArray(ids) || ids.length!==99 || new Set(ids).size!==99 || ids.includes('86644') ||
     digest(JSON.stringify(ids))!==MANIFEST_HASH)throw Error('FIXED_LOTE1_MANIFEST_REQUIRED');
}
export function presence(env){
  const result=Object.fromEntries(KEYS.map(k=>[k,Boolean(env[k])]));
  if(Object.values(result).some(v=>!v))throw Error('REQUIRED_ENVIRONMENT_SECRETS_MISSING');
  return result;
}
export async function checkGitHub(env,request=fetch){
  validateDispatch(env);
  if(!env.GITHUB_TOKEN)throw Error('GITHUB_METADATA_ACCESS_REQUIRED');
  const get=async suffix=>{
    const response=await request(`https://api.github.com/repos/${REPOSITORY}/environments/${ENVIRONMENT}${suffix}`,{
      headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
      signal:AbortSignal.timeout(10000)
    });
    if(!response.ok)throw Error(`ENVIRONMENT_METADATA_UNVERIFIED_HTTP_${response.status}`);
    return response.json();
  };
  validateEnvironment(await get(''),await get('/deployment-branch-policies'));
}
export function verifySource(dir,read=readFileSync,git=execFileSync){
  const sha=git('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(sha!==APPROVED_SHA)throw Error('APPROVED_SOURCE_SHA_REQUIRED');
  validateManifest(JSON.parse(read(join(dir,'scripts/orulo-media-recovery-lote1.ids.json'),'utf8')));
}
export async function storagePreflight(env,transport,sourceCheck=verifySource){
  validateDispatch(env);sourceCheck(env.APPROVED_SOURCE_DIR);
  const initiator={login:env.GITHUB_ACTOR,id:env.GITHUB_ACTOR_ID};
  const present=presence(env);
  const journal=await openPostgresJournal(env,transport);
  await journal.record({type:'READ_ONLY_PREFLIGHT',approvedSha:APPROVED_SHA,initiator,secretsPresent:present,writeEnabled:false});
  await journal.snapshot('BASELINE_V2');
  await journal.snapshot('READBACK_V2');
  const {ack,entry}=await journal.finish();
  const comparison=entry.event.comparison;
  if(comparison.schemaMatch!==true || comparison.captureStable!==true ||
     ['contentChanges','timestampOnly','insertions','deletions'].some(k=>comparison[k]!==0))
    throw Error('POSTGRES_PREFLIGHT_CONCURRENT_CHANGES_REVIEW_REQUIRED');
  return {status:'READ_ONLY_PREFLIGHT_PASSED',storage:'postgres',runUuid:journal.runUuid,
    approvedSha:APPROVED_SHA,manifestCount:99,headHash:ack.hash,sequence:ack.sequence,comparison,
    secretsPresent:present,initiator,writeEnabled:false};
}
async function main(){
  const mode=process.argv[2];
  if(mode==='dispatch-gate'){validateDispatch(process.env);console.log('Authorized owner and manual main dispatch verified.');return;}
  if(mode==='github-gate'){await checkGitHub(process.env);console.log('Protected Environment and manual dispatch verified.');return;}
  if(mode!=='storage-preflight')throw Error('PREFLIGHT_ONLY_NO_BACKFILL_OPERATION');
  const report=await storagePreflight(process.env,postgresTransport({url:process.env.ORULO_AUDIT_SUPABASE_URL||PROJECT_URL,key:process.env.SUPABASE_SECRET_KEY}));
  console.log(JSON.stringify(report));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}

