import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectBatch,validateDispatch,publicCredential,readOnlyTransport,inventoryUrl,dryRun,saveReport,sealReport,digest,MANIFEST_SHA256,PROJECT} from './orulo-national-dry-run.mjs';
const bytes=readFileSync(new URL('./orulo-national-dry-run-manifest.json',import.meta.url)),manifest=JSON.parse(bytes);
const selection=()=>selectBatch(bytes,'V4-SP-P1-NEW-002');
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const metadata={runId:'123',commitSha:'a'.repeat(40),scriptSha256:'b'.repeat(64)};
function fixture({floorStatus={},authStatus=200,complete=false,changePlans=false,partial=false,invalid=false,hangId,stopId}={}){
  const selected=selection(),calls=[];
  const request=async(url,options)=>{
    const u=new URL(url);calls.push({url,method:options.method,redirect:options.redirect});assert.equal(options.redirect,'error');
    if(u.pathname==='/oauth/token')return json({access_token:'TOKEN_DO_NOT_LOG'},authStatus);
    const id=u.origin===PROJECT?u.searchParams.get('raw_data->>building_id').slice(3):/buildings\/(\d+)/.exec(u.pathname)?.[1];
    const base=manifest.baseline.find(b=>b.state===selected.batch.state&&b.buildingId===id);
    const plans=base.planIds.map(pid=>({id:pid,...complete?{image_url:`https://static.orulo.com.br/images/properties/large/${pid}.jpg`}:{}}));
    if(u.origin===PROJECT){if(changePlans)plans.push({id:'9999999999'});return json([{id:'00000000-0000-4000-8000-000000000001',state:'SP',building_id:id,source:'novos',active:true,external_id:`orulo:${id}:1`,plans}]);}
    if(id===hangId)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
    if(id===stopId)return json({},429);
    if(floorStatus[id])return json({},floorStatus[id]);
    if(invalid)return json({unexpected:'missing floor_plans'});
    return json({floor_plans:plans.map(p=>({id:p.id,'1024x1024':`https://static.orulo.com.br/images/properties/large/${p.id}.jpg`})),...partial?{pagination:{next_page:2}}:{}});
  };
  const checkpoints=[];
  return {selected,calls,checkpoints,run:opts=>dryRun({selection:selected,metadata,readKey:'sb_publishable_fixture',clientId:'CLIENT_DO_NOT_LOG',clientSecret:'SECRET_DO_NOT_LOG',request,save:r=>checkpoints.push(structuredClone(r)),...opts})};
}
test('exact V4 batch identity, order, original hash and all 257 batches are retained',()=>{
  const {batch}=selection();assert.equal(manifest.batches.length,257);assert.equal(digest(bytes),MANIFEST_SHA256);
  assert.deepEqual(batch.buildingIds,['4942','5302','5375','5971','6099','6784','7475','7561','9669','9756']);
  assert.equal(batch.buildingIdsSha256,'6a7aa1e95680d401d006bdbc0ca64c1d0ca704ca60b3cea0023481b666bb44ef');
  for(const original of manifest.batches)assert.equal(digest(JSON.stringify(original.buildingIds)),original.buildingIdsSha256);
});
test('unknown IDs, legacy runs, diagnostic lots and prior source samples are blocked',()=>{
  for(const id of ['unknown','phase1-20','phase2-30-a','V4-ES-DIAG-001','V4-SP-P1-NEW-001'])assert.throws(()=>selectBatch(bytes,id));
  assert.ok(manifest.protectedBuildingIds.includes('43126'));assert.ok(manifest.protectedBuildingIds.includes('86644'));
  assert.equal(manifest.priorSourceSampleIds.length,8);assert.ok(manifest.priorSourceSampleIds.includes('63731'));
  assert.ok(selection().batch.buildingIds.every(id=>!manifest.pendingReconciliationBuildingIds.includes(id)&&!manifest.protectedBuildingIds.includes(id)&&!manifest.priorSourceSampleIds.includes(id)));
});
test('manifest alteration cannot be authorized by changing its embedded batch hash',()=>{
  const tampered=structuredClone(manifest);tampered.batches[0].buildingIds.push('999');tampered.batches[0].buildingIdsSha256=digest(JSON.stringify(tampered.batches[0].buildingIds));
  assert.throws(()=>selectBatch(Buffer.from(JSON.stringify(tampered)),tampered.batches[0].batchId),/MANIFEST_HASH_MISMATCH/);
  assert.throws(()=>selectBatch(Buffer.from('{}'),'x'),/MANIFEST_HASH_MISMATCH/);
});
test('only owner, integrated main, approved exact SHA and first attempt can use credentials',()=>{
  const env={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_SHA:'a'.repeat(40),GITHUB_WORKFLOW_SHA:'a'.repeat(40),ORULO_DRY_RUN_APPROVED_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123'};
  assert.doesNotThrow(()=>validateDispatch(env));
  for(const change of [{GITHUB_REF:'refs/heads/unreviewed'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_ACTOR:'other'},{ORULO_DRY_RUN_APPROVED_SHA:''},{GITHUB_WORKFLOW_SHA:'b'.repeat(40)}])assert.throws(()=>validateDispatch({...env,...change}));
});
test('transport blocks writes, RPCs, audit endpoints, redirects, overrides and cross-batch reads before fetch',async()=>{
  const {batch}=selection();let calls=0;const transport=readOnlyTransport({batch,counters:{inventory:0,authentication:0,floorPlans:0},request:async()=>{calls++;return json([]);}});
  for(const method of ['PATCH','PUT','DELETE','POST','HEAD','OPTIONS'])await assert.rejects(transport(inventoryUrl(batch,batch.buildingIds[0]),{method}),/FORBIDDEN/);
  for(const url of [PROJECT+'/rest/v1/rpc/orulo_audited_cas',PROJECT+'/rest/v1/orulo_audit.entries',PROJECT+'/rest/v1/properties?select=*','https://attacker.test/',inventoryUrl(batch,'9999999999'),inventoryUrl({...batch,state:'ES'},batch.buildingIds[0])])await assert.rejects(transport(url),/FORBIDDEN/);
  await assert.rejects(transport(inventoryUrl(batch,batch.buildingIds[0]),{headers:{'X-HTTP-Method-Override':'PATCH'}}),/FORBIDDEN/);
  await assert.rejects(transport('https://www.orulo.com.br/oauth/token',{method:'POST',body:'client_id=x&client_secret=y&grant_type=delete_all'}),/FORBIDDEN/);
  assert.equal(calls,0);
});
test('write credentials are rejected and the existing bundled key is publishable only',async()=>{
  assert.throws(()=>publicCredential(`const SUPABASE_URL="${PROJECT}";const SUPABASE_PUBLISHABLE_KEY="sb_secret_bad";`));
  assert.match(publicCredential(readFileSync(new URL('../assets/js/delivery-5.js',import.meta.url),'utf8')),/^sb_publishable_/);
  const f=fixture(),r=await f.run({readKey:'service_role'});assert.equal(r.status,'BLOCKED');assert.equal(f.calls.length,0);
});
test('one selected lot uses one OAuth, one scoped inventory read and one source call per building',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.status,'COMPLETED');assert.deepEqual(r.examinedIds,f.selected.batch.buildingIds);assert.deepEqual(r.unexaminedIds,[]);assert.deepEqual(r.queries,{authentication:1,inventory:10,floorPlans:10});assert.equal(r.writes,0);assert.equal(r.items.filter(i=>i.status==='RECOVERABLE').length,10);
  assert.ok(r.stockDivergences.length>0); // Active count changes are recorded, never price/media corruption.
  for(const secret of ['SECRET_DO_NOT_LOG','TOKEN_DO_NOT_LOG','CLIENT_DO_NOT_LOG','sb_publishable_fixture'])assert.ok(!JSON.stringify(r).includes(secret));
});
test('already complete buildings and changed plan identities never query the provider',async()=>{
  const complete=fixture({complete:true}),a=await complete.run();assert.equal(a.queries.floorPlans,0);assert.equal(a.queries.authentication,0);assert.ok(a.items.every(i=>i.status==='COMPLETE'));
  const changed=fixture({changePlans:true}),b=await changed.run();assert.equal(b.queries.floorPlans,0);assert.equal(b.conflicts.length,10);
});
test('auth failure stops with all IDs pending and a sanitized partial artifact',async()=>{
  const f=fixture({authStatus:401}),r=await f.run();assert.equal(r.status,'BLOCKED');assert.equal(r.queries.authentication,1);assert.equal(r.queries.floorPlans,0);assert.equal(r.sourceErrors[0].code,'AUTH_HTTP_401');assert.equal(r.unexaminedIds.length,10);assert.ok(f.checkpoints.length>=2);
});
test('404 is SOURCE_ERROR, never missing imagery, and transient 500 is not retried',async()=>{
  const [first,second]=selection().batch.buildingIds,f=fixture({floorStatus:{[first]:404,[second]:500}}),r=await f.run();assert.equal(r.status,'COMPLETED_WITH_SOURCE_ERRORS');assert.equal(r.sourceErrors.length,2);assert.equal(r.sourceMissing.length,0);
  for(const id of [first,second])assert.equal(f.calls.filter(c=>c.url.includes(`/buildings/${id}/floor_plans`)).length,1);
});
test('missing images are classified only from a valid complete provider response',async()=>{
  const f=fixture();const r=await f.run({request:async(url,options)=>{
    const u=new URL(url);if(u.origin==='https://www.orulo.com.br'&&u.pathname.includes('/floor_plans'))return json({floor_plans:[]});
    if(u.pathname==='/oauth/token')return json({access_token:'token'});
    const id=u.searchParams.get('raw_data->>building_id').slice(3),base=manifest.baseline.find(b=>b.buildingId===id&&b.state==='SP');return json([{id:'1',building_id:id,state:'SP',source:'novos',active:true,external_id:`orulo:${id}:1`,plans:base.planIds.map(id=>({id}))}]);
  }});assert.equal(r.sourceErrors.length,0);assert.equal(r.sourceMissing.length,10);assert.ok(r.items.every(i=>i.status==='SOURCE_MISSING'));
});
test('invalid and paginated/incomplete responses fail closed without automatic follow-up calls',async()=>{
  for(const mode of [{invalid:true},{partial:true}]){const f=fixture(mode),r=await f.run();assert.equal(r.sourceErrors.length,10);assert.equal(r.sourceMissing.length,0);assert.equal(r.queries.floorPlans,10);}
});
test('deadline preserves completed prefix and lists remaining IDs; rate limit stops the batch',async()=>{
  const ids=selection().batch.buildingIds,f=fixture({hangId:ids[1]}),r=await f.run({maxDurationMs:150,httpTimeoutMs:1000});assert.equal(r.status,'TIME_LIMIT');assert.deepEqual(r.examinedIds,[ids[0]]);assert.deepEqual(r.unexaminedIds,ids.slice(1));assert.ok(f.checkpoints.some(c=>c.examinedIds.length===1));
  const limited=fixture({stopId:ids[0]}),b=await limited.run();assert.equal(b.status,'BLOCKED');assert.equal(b.queries.floorPlans,1);assert.equal(b.sourceErrors[0].httpStatus,429);
});
test('report bytes, SHA256, terminal checkpoint and immutable manifest agree',async()=>{
  const f=fixture(),r=await f.run(),path=join(mkdtempSync(join(tmpdir(),'orulo-readonly-')),'report.json');saveReport(r,path);assert.equal(JSON.parse(readFileSync(path)).status,'COMPLETED');assert.ok(readFileSync(path+'.sha256','utf8').startsWith(digest(readFileSync(path))));assert.equal(digest(readFileSync(new URL('./orulo-national-dry-run-manifest.json',import.meta.url))),MANIFEST_SHA256);
});
test('an interrupted checkpoint is sealed without losing its completed items',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'orulo-seal-')),'report.json');saveReport({status:'RUNNING',items:[{buildingId:'4942',status:'RECOVERABLE'}],unexaminedIds:['5302'],writes:0},path);const r=sealReport(path);assert.equal(r.status,'INTERRUPTED');assert.equal(r.items.length,1);assert.deepEqual(r.unexaminedIds,['5302']);assert.ok(readFileSync(path+'.sha256','utf8').startsWith(digest(readFileSync(path))));
});
test('workflow is manual for operational access and has no deploy Environment or write key',()=>{
  const yml=readFileSync(new URL('../.github/workflows/orulo-national-dry-run.yml',import.meta.url),'utf8');assert.match(yml,/workflow_dispatch:/);assert.match(yml,/timeout-minutes: 10/);assert.match(yml,/cancel-in-progress: false/);assert.match(yml,/run_attempt == '1'/);assert.match(yml,/if: always\(\)/);assert.doesNotMatch(yml,/schedule:|environment:|SUPABASE_SECRET_KEY|SERVICE_ROLE|actions: write|contents: write|\$\{\{ inputs.batch_id \}\}.*run:/);
});
