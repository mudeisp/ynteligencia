import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,existsSync,statSync } from 'node:fs';
import { APPROVED_SHA,MANIFEST_HASH,digest,runPrefix,validateStoreConfig,validateStoreMetadata,
  awsTransport,durableStore,openDurableJournal } from './orulo-media-recovery-journal.mjs';
import { AUTHORIZED_INITIATOR,validateDispatch,validateEnvironment,validateManifest,presence,checkGitHub,verifySource,storagePreflight } from './orulo-media-recovery-actions.mjs';
import { casFloorPlans } from './orulo-media-cas.mjs';

const ids=JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8'));
const env=()=>({GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
  GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',
  GITHUB_WORKFLOW_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',ORULO_POSTGRES_AUDIT_READY:'true',GITHUB_TOKEN:'fake-github-token',
  ORULO_CLIENT_ID:'do-not-log-id',ORULO_CLIENT_SECRET:'do-not-log-secret',SUPABASE_SECRET_KEY:'do-not-log-key',
  APPROVED_SOURCE_DIR:'/approved-source'});
const protectedEnv=()=>({name:'orulo-lote1',can_admins_bypass:false,
  deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
  protection_rules:[]});
const policies=()=>({branch_policies:[{name:'main',type:'branch'}]});
const metadata=()=>({versioning:{Status:'Enabled'},encryption:{ServerSideEncryptionConfiguration:{Rules:[
  {ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]}},publicAccess:{PublicAccessBlockConfiguration:{
  BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true}}});
const checksum=bytes=>createHash('sha256').update(bytes).digest('base64');
function remote(){
  const objects=new Map(),calls=[];
  const transport={metadata:async()=>metadata(),put:async(key,bytes)=>{
    calls.push(key);if(objects.has(key))throw Error('PreconditionFailed');
    const item={bytes:Buffer.from(bytes),VersionId:`version-${objects.size+1}`,ChecksumSHA256:checksum(bytes)};
    objects.set(key,item);return item;
  },get:async(key,version)=>{const item=objects.get(key);assert.equal(item.VersionId,version);return item;}};
  return {transport,objects,calls};
}

test('manual main dispatch, explicit storage approval and first attempt are mandatory',()=>{
  validateDispatch(env());
  for(const patch of [{GITHUB_REPOSITORY:'fork/ynteligencia'},{GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_REF:'refs/heads/unreviewed'},{GITHUB_REF:'refs/tags/main'},{GITHUB_RUN_ATTEMPT:'2'},
    {GITHUB_RUN_ID:'../../other'},{ORULO_POSTGRES_AUDIT_READY:''},{ORULO_POSTGRES_AUDIT_READY:'false'}]){
    assert.throws(()=>validateDispatch({...env(),...patch}));
  }
});
test('single-owner Environment accepts no reviewers while retaining no admin bypass and main-only policy',()=>{
  validateEnvironment(protectedEnv(),policies());
  validateEnvironment({...protectedEnv(),protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[]}]},policies());
  for(const mutate of [e=>e.name='other',e=>e.can_admins_bypass=true,e=>delete e.can_admins_bypass]){
    const e=protectedEnv();mutate(e);assert.throws(()=>validateEnvironment(e,policies()));
  }
  for(const rules of [[],[{name:'*',type:'branch'}],[{name:'main',type:'tag'}],
    [{name:'main',type:'branch'},{name:'preview',type:'branch'}]]){
    assert.throws(()=>validateEnvironment(protectedEnv(),{branch_policies:rules}));
  }
});
test('GitHub protection lookup is read-only and never requests secret values',async()=>{
  const calls=[];
  await checkGitHub(env(),async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/deployment-branch-policies')?policies():protectedEnv()};
  });
  assert.equal(calls.length,2);
  for(const c of calls){assert.equal(c.options.method,undefined);assert.ok(c.options.signal);assert.doesNotMatch(c.url,/secrets|decrypt/);}
  let invoked=false;
  await assert.rejects(checkGitHub({...env(),ORULO_POSTGRES_AUDIT_READY:''},()=>{invoked=true;}),/STORAGE_NOT_APPROVED/);
  assert.equal(invoked,false);
  await assert.rejects(checkGitHub(env(),async()=>({ok:false,status:403})),/METADATA_UNVERIFIED_HTTP_403/);
});
test('approved source and complete immutable 99-building manifest are required',()=>{
  validateManifest(ids);assert.equal(ids.length,99);assert.equal(digest(JSON.stringify(ids)),MANIFEST_HASH);
  for(const altered of [ids.slice(1),[...ids,'86644'],['86644',...ids.slice(1)],[...ids].reverse(),[ids[0],...ids.slice(0,98)]]){
    assert.throws(()=>validateManifest(altered));
  }
  verifySource('/source',()=>JSON.stringify(ids),()=>APPROVED_SHA+'\n');
  assert.throws(()=>verifySource('/source',()=>JSON.stringify(ids),()=> 'other-sha'),/SOURCE_SHA_REQUIRED/);
});
test('secret handling returns presence only and rejects missing bindings',()=>{
  const result=presence(env());assert.deepEqual(Object.values(result),[true,true,true]);
  assert.doesNotMatch(JSON.stringify(result),/do-not-log/);
  for(const key of ['ORULO_CLIENT_ID','ORULO_CLIENT_SECRET','SUPABASE_SECRET_KEY'])assert.throws(()=>presence({...env(),[key]:''}));
});
test('durable store needs valid account/config, private bucket, encryption and versioning',()=>{
  validateStoreConfig({bucket:'private-orulo-audit',region:'us-east-1',account:'123456789012'});
  assert.throws(()=>validateStoreConfig({bucket:'',region:'us-east-1',account:'123456789012'}));
  validateStoreMetadata(metadata());
  const noVersion=metadata();noVersion.versioning.Status='Suspended';assert.throws(()=>validateStoreMetadata(noVersion));
  const publicBucket=metadata();publicBucket.publicAccess.PublicAccessBlockConfiguration.BlockPublicPolicy=false;
  assert.throws(()=>validateStoreMetadata(publicBucket));
  const noEncryption=metadata();noEncryption.encryption={};assert.throws(()=>validateStoreMetadata(noEncryption));
});
test('remote acknowledgement and matching version/checksum are required',async()=>{
  const r=remote(),store=durableStore(r.transport),key=`${runPrefix('1','1')}/baseline-v2.jsonl`;
  const receipt=await store.put(key,'baseline\n');
  assert.equal(await durableStore(r.transport).verify(receipt),true,'Fresh store instance reads remote durable data');
  await assert.rejects(store.put(key,'overwrite'),/PreconditionFailed/);
  await assert.rejects(store.put('other-prefix/ledger.jsonl','data'),/OUT_OF_SCOPE/);
  for(const bad of [{VersionId:'null',ChecksumSHA256:checksum('data')},{VersionId:'v',ChecksumSHA256:'wrong'}]){
    await assert.rejects(durableStore({put:async()=>bad}).put(`${runPrefix('2','1')}/test.json`,'data'),/ACK_INVALID/);
  }
  r.objects.get(key).bytes=Buffer.from('changed');await assert.rejects(store.verify(receipt),/READBACK_DIVERGENCE/);
});
test('immutable JSONL journal preserves root events, order and hash chain',async()=>{
  const r=remote(),prefix=runPrefix('3','1'),record=await openDurableJournal(durableStore(r.transport),prefix);
  const first=await record({type:'INTENT',id:'uuid'});await record({type:'RESULT',status:'UPDATED',receipt:{verified:true}});
  const entries=[...r.objects].filter(([key])=>key.endsWith('.jsonl')).map(([,v])=>JSON.parse(v.bytes));
  assert.equal(entries[0].type,'INTENT');assert.equal(entries[0]._journal.sequence,1);
  assert.equal(entries[1].receipt.verified,true);assert.equal(entries[1]._journal.previousHash,first.hash);
  await assert.rejects(openDurableJournal(durableStore(r.transport),prefix),/PreconditionFailed/);
});
test('ambiguous journal failure freezes subsequent appends without retry',async()=>{
  let puts=0;const r=remote(),base=r.transport.put;
  r.transport.put=async(key,bytes)=>{puts++;if(key.endsWith('.jsonl'))throw Error('lost acknowledgement');return base(key,bytes);};
  const record=await openDurableJournal(durableStore(r.transport),runPrefix('4','1'));
  await assert.rejects(record({type:'INTENT'}),/lost acknowledgement/);
  const count=puts;await assert.rejects(record({type:'INTENT'}),/FROZEN/);assert.equal(puts,count);
});
test('lost acknowledgement after remote persistence keeps evidence and forbids automatic reuse',async()=>{
  const r=remote(),base=r.transport.put;
  r.transport.put=async(key,bytes)=>{
    const result=await base(key,bytes);if(key.includes('/ledger/'))throw Error('acknowledgement lost after persistence');return result;
  };
  const prefix=runPrefix('40','1'),record=await openDurableJournal(durableStore(r.transport),prefix);
  await assert.rejects(record({type:'INTENT'}),/acknowledgement lost/);
  assert.equal([...r.objects.keys()].filter(k=>k.endsWith('.jsonl')).length,1);
  await assert.rejects(record({type:'INTENT'}),/FROZEN/);
  await assert.rejects(openDurableJournal(durableStore(r.transport),prefix),/PreconditionFailed/);
});
test('concurrent appends freeze both callers before either can proceed to CAS',async()=>{
  const r=remote(),base=r.transport.put;let release;
  r.transport.put=async(key,bytes)=>{
    if(key.includes('/ledger/'))await new Promise(resolve=>{release=resolve;});
    return base(key,bytes);
  };
  const record=await openDurableJournal(durableStore(r.transport),runPrefix('41','1'));
  const first=record({type:'INTENT'});const rejected=assert.rejects(first,/FROZEN/);
  await assert.rejects(record({type:'INTENT'}),/CONCURRENT/);release();await rejected;
  await assert.rejects(record({type:'RESULT'}),/FROZEN/);
});
test('CAS cannot issue a mutation before the durable INTENT acknowledgement',async()=>{
  const r=remote(),base=r.transport.put;let release,started=false,posts=0;
  r.transport.put=async(key,bytes)=>{
    if(key.includes('/ledger/')){started=true;await new Promise(resolve=>{release=resolve;});}
    return base(key,bytes);
  };
  const record=await openDurableJournal(durableStore(r.transport),runPrefix('5','1'));
  const row={id:'fixture-id',source:'novos',state:'SP',active:true,raw_data:{building_id:'43126',building:{floor_plans:[{id:'p'}]}}};
  const pending=casFloorPlans({id:row.id,buildingId:'43126',livePlans:[{id:'p',image_url:'https://example.invalid/plan'}],
    record,url:'https://fixture.invalid',key:'synthetic',fetchImpl:async(url,options={})=>{
      if(options.method==='POST'){posts++;return {ok:true,json:async()=>({id:row.id,status:'CONFLICT'})};}
      return {ok:true,json:async()=>[row]};
    }});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);assert.equal(posts,0);
  release();
  // The RESULT also needs its own durable acknowledgement.
  await new Promise(resolve=>setImmediate(resolve));release();
  const result=await pending;assert.equal(result.status,'CONFLICT');assert.equal(posts,1);
});
test('failed remote INTENT prevents CAS entirely',async()=>{
  const r=remote(),base=r.transport.put;let posts=0;
  r.transport.put=async(key,bytes)=>{if(key.includes('/ledger/'))throw Error('store unavailable');return base(key,bytes);};
  const record=await openDurableJournal(durableStore(r.transport),runPrefix('6','1'));
  await assert.rejects(casFloorPlans({id:'fixture',buildingId:'43126',livePlans:[{id:'p',image_url:'x'}],record,
    url:'https://fixture.invalid',key:'synthetic',fetchImpl:async(url,options={})=>{
      if(options.method==='POST')posts++;
      return {ok:true,json:async()=>[{id:'fixture',source:'novos',state:'SP',active:true,raw_data:{building_id:'43126',building:{floor_plans:[{id:'p'}]}}}]};
    }}),/store unavailable/);
  assert.equal(posts,0);
});
test('CLI adapter uses conditional encrypted writes, no retries and removes local scratch',async()=>{
  const paths=[];
  const transport=awsTransport({bucket:'private-orulo-audit',region:'us-east-1',account:'123456789012'},(cmd,args,options)=>{
    assert.equal(cmd,'aws');assert.equal(options.env.AWS_MAX_ATTEMPTS,'1');
    assert.equal(args[args.indexOf('--if-none-match')+1],'*');assert.equal(args[args.indexOf('--server-side-encryption')+1],'AES256');
    const file=args[args.indexOf('--body')+1];paths.push(file);if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);
    return JSON.stringify({VersionId:'v',ChecksumSHA256:checksum(readFileSync(file))});
  });
  await transport.put(`${runPrefix('7','1')}/test.json`,Buffer.from('probe'));
  assert.equal(paths.every(path=>!existsSync(path)),true);
});
function pgRemote(){
 const entries=new Map();let run,head={sequence:0,hash:''};
 const transport={async control(action,args={}){
  if(action==='health')return {version:1,storage:'postgres',durable:true,appendOnly:true,synchronousCommit:'on',writeEnabled:false};
  if(action==='read')return entries.get(args.p_sequence);
  const event=JSON.parse(JSON.stringify(args.p_event||{}));
  if(action==='start'){run=args.p_run;event.type='START';}
  if(action==='snapshot')event.type=event.kind;
  if(action==='finish'){event.type='FINISHED';event.comparison={contentChanges:0};}
  const canonical=JSON.stringify({runUuid:run,sequence:head.sequence+1,previousHash:head.hash,event});
  head={runUuid:run,sequence:head.sequence+1,hash:digest(canonical),eventUuid:event.eventUuid};
  entries.set(head.sequence,{...head,canonical,event});return {...head};
 }};
 return {transport,entries};
}
test('PostgreSQL preflight requires durable ACKs and never enables writes',async()=>{
 let accessed=false;
 const unused={control:()=>{accessed=true;throw Error('unexpected');}};
 await assert.rejects(storagePreflight({...env(),ORULO_POSTGRES_AUDIT_READY:''},unused,()=>{}),/NOT_APPROVED/);
 await assert.rejects(storagePreflight({...env(),SUPABASE_SECRET_KEY:''},unused,()=>{}),/SECRETS_MISSING/);
 assert.equal(accessed,false);
 await assert.rejects(storagePreflight(env(),{control:async()=>({durable:false})},()=>{}),/HEALTH_UNVERIFIED/);
 const r=pgRemote(),report=await storagePreflight(env(),r.transport,()=>{});
 assert.equal(report.writeEnabled,false);assert.equal(report.storage,'postgres');
 assert.deepEqual(report.initiator,AUTHORIZED_INITIATOR);assert.equal(report.manifestCount,99);
 assert.doesNotMatch(JSON.stringify(report),/do-not-log/);
 assert.deepEqual([...r.entries.values()].map(e=>e.event.type),['START','READ_ONLY_PREFLIGHT','BASELINE_V2','READBACK_V2','FINISHED']);
});

test('workflow is manual-only, protected, SHA-pinned and has no operational backfill step',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/orulo-lote1-manual.yml',import.meta.url),'utf8');
  assert.match(workflow,/on:\n  workflow_dispatch: \{\}/);assert.doesNotMatch(workflow,/pull_request:|push:|schedule:/);
  assert.match(workflow,/group: orulo-lote1-production\n  cancel-in-progress: false/);
  assert.match(workflow,/environment: orulo-lote1/);assert.match(workflow,new RegExp('ref: '+APPROVED_SHA));
  assert.doesNotMatch(workflow,/id-token:|aws-actions|AWS_|ORULO_AUDIT_BUCKET/);assert.doesNotMatch(workflow,/AWS_ACCESS_KEY_ID:|AWS_SECRET_ACCESS_KEY:/);
  assert.doesNotMatch(workflow,/--write|upload-artifact|runRecovery|secrets: inherit|printenv|set -x/);
  const storage=workflow.split('  storage:')[1];assert.match(storage,/needs: gate/);
  for(const key of ['ORULO_CLIENT_ID','ORULO_CLIENT_SECRET','SUPABASE_SECRET_KEY'])assert.match(storage,new RegExp('secrets\\.'+key));
});


test('only the pinned owner account can initiate or trigger the dispatch',()=>{
  assert.deepEqual(AUTHORIZED_INITIATOR,{login:'mudeisp',id:'323805541'});
  validateDispatch(env());
  for(const patch of [
    {GITHUB_ACTOR:'unauthorized',GITHUB_ACTOR_ID:'999'},
    {GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'999'},
    {GITHUB_ACTOR:'unauthorized',GITHUB_ACTOR_ID:'323805541'},
    {GITHUB_TRIGGERING_ACTOR:'unauthorized'},
    {GITHUB_ACTOR:undefined},{GITHUB_ACTOR_ID:undefined},{GITHUB_TRIGGERING_ACTOR:undefined}
  ])assert.throws(()=>validateDispatch({...env(),...patch}),/AUTHORIZED_OWNER_DISPATCH_REQUIRED/);
});
test('automatic events and every ref other than the main branch fail closed',()=>{
  for(const event of ['push','pull_request','pull_request_target','schedule','workflow_run','repository_dispatch','workflow_call',undefined])
    assert.throws(()=>validateDispatch({...env(),GITHUB_EVENT_NAME:event}),/ONLY_MANUAL_MAIN_DISPATCH_ALLOWED/);
  for(const ref of ['refs/heads/preview','refs/tags/main','refs/pull/1/merge','main',undefined])
    assert.throws(()=>validateDispatch({...env(),GITHUB_REF:ref}),/ONLY_MANUAL_MAIN_DISPATCH_ALLOWED/);
});
test('invalid initiator, automatic event or wrong ref cannot reach GitHub metadata or durable store',async()=>{
  for(const patch of [{GITHUB_ACTOR_ID:'999'},{GITHUB_TRIGGERING_ACTOR:'other'},{GITHUB_REF:'refs/heads/other'},
    {GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'}]){
    let calls=0;
    await assert.rejects(checkGitHub({...env(),...patch},()=>{calls++;throw Error('unexpected metadata access');}));
    await assert.rejects(storagePreflight({...env(),...patch},{metadata:()=>{calls++;}},()=>{calls++;}));
    assert.equal(calls,0);
  }
});
test('single-owner guard is repeated before secret access; protected job has matching immutable guards',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/orulo-lote1-manual.yml',import.meta.url),'utf8');
  const storage=workflow.split('  storage:')[1];
  for(const guard of ["github.event_name == 'workflow_dispatch'","github.ref == 'refs/heads/main'",
    "github.actor == 'mudeisp'","github.actor_id == '323805541'","github.triggering_actor == 'mudeisp'","github.run_attempt == '1'"])
    assert.ok(storage.includes(guard));
  const gate=storage.indexOf('orulo-media-recovery-actions.mjs dispatch-gate');
  const secret=storage.indexOf('secrets.ORULO_CLIENT_ID');
  assert.ok(gate>=0 && gate<secret);
  assert.match(workflow,/ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.doesNotMatch(workflow,/workflow_dispatch:[\s\S]*inputs:|--write|runRecovery|secrets: inherit/);
});
test('audit journal records the verified owner without leaking credentials or enabling writes',async()=>{
  const r=pgRemote(),report=await storagePreflight(env(),r.transport,()=>{});
  const events=[...r.entries.values()].map(e=>e.event);
  assert.deepEqual(events[1].initiator,AUTHORIZED_INITIATOR);
  assert.equal(events[1].writeEnabled,false);
  assert.equal(report.writeEnabled,false);
  assert.doesNotMatch(JSON.stringify({report,events}),/do-not-log|fake-github-token/);
});

