import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {executeBatch,loadBatch,batchCatalog,validateBatchDispatch,batchPatches,verifyBatchImage,batchApprovalSql,batchSourceClient,batchFailureDetails} from './orulo-media-recovery-batch.mjs';
const {PGlite}=process.env.PGLITE_MODULE?await import(process.env.PGLITE_MODULE):createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create table public.properties(id uuid primary key,external_id text,source text,state text,active boolean,raw_data jsonb,price numeric,created_at timestamptz,updated_at timestamptz);
grant usage on schema public to service_role,anon,authenticated;alter table public.properties enable row level security;`);
for(const f of ['20261104093722_orulo_postgres_audit.sql','20261104102956_orulo_paged_snapshots.sql','20261104114348_orulo_pilot_authorization.sql','20261104135027_orulo_pilot_indexed_targets.sql','20261104151850_orulo_manifest_batches.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
const batch=loadBatch('phase1-20'),targets=[batch.targets[0],batch.targets.find(t=>t.buildingId!==batch.targets[0].buildingId)];
let counter=90000;
const env=()=>({GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ID:String(++counter),GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:'a'.repeat(40),ORULO_BATCH_APPROVED_SHA:'a'.repeat(40),ORULO_BATCH_READY:'true',ORULO_BATCH_ID:'phase1-20',ORULO_POSTGRES_AUDIT_READY:'true',ORULO_CLIENT_ID:'fixture',ORULO_CLIENT_SECRET:'fixture',SUPABASE_SECRET_KEY:'fixture'});
async function service(sql,args){await db.exec('set role service_role');try{return(await db.query(sql,args)).rows[0].r;}finally{await db.exec('reset role');}}
const image=id=>'https://static.orulo.com.br/images/properties/large/'+id+'.jpg';
async function run(o={}){
 const fixtureTargets=o.allManifest?batch.targets:targets;
 await db.exec('rollback');await db.exec('reset role');await db.query("select orulo_audit.admin_event(r.run_uuid,'ABORTED','synthetic reconciled no ambiguous operations',true) from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and kind in ('FINISHED','ABORTED'))");await db.exec('truncate public.properties');
 for(const t of fixtureTargets)await db.query("insert into public.properties values($1,'fixture','novos','SP',true,$2,100,'2026-01-01','2026-01-02')",[t.id,JSON.stringify({building_id:t.buildingId,photos:['photo'],building:{stock:7,tour:'tour',videos:['video'],floor_plans:[...t.missingPlanIds.map(id=>({id,description:'preserve',...(o.completedIds?.includes(t.id)?{image_url:'https://old.invalid/'+id+'.jpg'}:{})})),{id:'already',image_url:'https://old.invalid/original.jpg',description:'keep'}]}})]);
 const fingerprint=(await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h;
 const calls=[];let uuid,plan,e=env();
 const transport={control:async(a,p={})=>{calls.push(a);if(a==='start')uuid=p.p_run;
 if(a==='health')return {version:2,snapshotProtocol:'paged-v2',pilotProtocol:1,batchProtocol:1,batchMasterHash:batchCatalog.masterHash,storage:'postgres',durable:true,appendOnly:true,synchronousCommit:'on',writeEnabled:false};
 if(o.beforeControl)await o.beforeControl(a,p,uuid);
 const out=await service('select public.orulo_audit_control($1,$2,$3,$4,$5) r',[a,p.p_run??null,p.p_sequence??null,p.p_previous_hash??null,JSON.stringify(p.p_event||{})]);
 if(o.tamper&&a==='read'&&out)out.event={...out.event,tampered:true};return out;
 },apply:async(r,op)=>{calls.push('CAS');if(o.beforeApply)await o.beforeApply(r,op);const v=await service('select public.orulo_audited_cas($1,$2) r',[r,op]);if(o.loseAck)throw Error('synthetic timeout after commit');return v;}};
 let result,error;
 try{result=await executeBatch({env:e,transport,fetchPlans:o.fetchPlans|| (async id=>fixtureTargets.filter(t=>t.buildingId===id).slice(0,1).flatMap(t=>t.missingPlanIds.map(id=>({id,image_url:image(id),description:'untrusted'})))),checkImage:async()=>{if(o.badImage)throw Error('BATCH_IMAGE_UNAVAILABLE');},onPlan:async p=>{plan=p;if(o.authorize!==false)await db.exec(batchApprovalSql(p));if(o.onPlan)await o.onPlan(p);},wait:async()=>{},now:(()=>{let n=0;return()=>n+=600001;})()});}catch(x){error=x;}
 return {result,error,calls,uuid,plan,env:e,fingerprint};
}
const kinds=async r=>(await db.query('select kind from orulo_audit.entries where run_uuid=$1 order by sequence',[r.uuid])).rows.map(x=>x.kind);
test('immutable manifests partition exactly 83 buildings and 314 UUIDs; phases 20/30/30/3; gates owner/manual/main/first attempt',()=>{
 const all=Object.keys(batchCatalog.batches).map(loadBatch);assert.deepEqual(all.map(b=>b.buildingIds.length),[20,30,30,3]);assert.equal(new Set(all.flatMap(b=>b.buildingIds)).size,83);assert.equal(new Set(all.flatMap(b=>b.targets.map(t=>t.id))).size,314);validateBatchDispatch(env());
 for(const p of [{GITHUB_ACTOR:'other'},{GITHUB_REF:'refs/heads/other'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:'2'},{ORULO_BATCH_READY:''},{ORULO_BATCH_ID:'phase2-30-a'},{ORULO_BATCH_APPROVED_SHA:'b'.repeat(40)}])assert.throws(()=>validateBatchDispatch({...env(),...p}));
 const w=readFileSync(new URL('../.github/workflows/orulo-batch-manual.yml',import.meta.url),'utf8');assert.match(w,/workflow_dispatch:/);assert.match(w,/group: orulo-lote1-production/);assert.match(w,/ref: \$\{\{ github.workflow_sha \}\}/);assert.doesNotMatch(w,/schedule:|--write|id-token:|aws-actions/);
});
test('registration push is self-file/main only; registration is inert and all operational jobs require manual owner/main/first attempt',()=>{
 const w=readFileSync(new URL('../.github/workflows/orulo-batch-manual.yml',import.meta.url),'utf8');
 assert.match(w,/on:\n  push:\n    branches: \[main\]\n    paths: \['\.github\/workflows\/orulo-batch-manual.yml'\]\n  workflow_dispatch:/);
 assert.doesNotMatch(w,/pull_request_target:|workflow_run:|workflow_call:|repository_dispatch:/);
 const jobs=Object.fromEntries([...w.matchAll(/^  (register|gate|batch):\n([\s\S]*?)(?=^  \w+:|$(?![\s\S]))/gm)].map(m=>[m[1],m[2]]));
 assert.deepEqual(Object.keys(jobs),['register','gate','batch']);
 assert.match(jobs.register,/permissions: \{\}/);assert.match(jobs.register,/timeout-minutes: 1/);
 assert.doesNotMatch(jobs.register,/uses:|env:|environment:|secrets\.|vars\.|GITHUB_TOKEN|node |curl |fetch|supabase|orulo\.com/i);
 assert.match(jobs.register,/run: printf '%s\\n' 'Manual workflow registered; no operational jobs were requested\.'/);
 const condition=name=>jobs[name].match(/if: (?:>-\n)?\s*\$\{\{([\s\S]*?)\}\}/)[1].replace(/\s+/g,' ').trim();
 const evaluate=(name,github)=>Function('github','return ('+condition(name)+')')(github);
 const manual={event_name:'workflow_dispatch',ref:'refs/heads/main',actor:'mudeisp',actor_id:'323805541',triggering_actor:'mudeisp',run_attempt:'1'};
 assert.equal(condition('gate'),condition('batch'));assert.match(jobs.batch,/needs: gate/);assert.match(jobs.batch,/environment: orulo-lote1/);
 for(const job of ['gate','batch']){
  assert.equal(evaluate(job,manual),true);
  for(const patch of [{event_name:'push'},{event_name:'pull_request'},{event_name:'schedule'},{event_name:'workflow_run'},{ref:'refs/heads/feature'},{actor:'other'},{actor_id:'1'},{triggering_actor:'other'},{run_attempt:'2'}])assert.equal(evaluate(job,{...manual,...patch}),false,job+JSON.stringify(patch));
 }
 assert.equal(evaluate('register',{...manual,event_name:'push'}),true);assert.equal(evaluate('register',manual),false);assert.equal(evaluate('register',{...manual,event_name:'push',ref:'refs/heads/feature'}),false);
 for(const id of ['phase2-30-a','phase2-30-b','phase3-rest']){assert.equal(batchCatalog.batches[id].released,false);assert.throws(()=>validateBatchDispatch({...env(),ORULO_BATCH_ID:id}),/PHASE_NOT_RELEASED/);}
});
test('multiple buildings and plans: fresh baseline, durable INTENT, atomic CAS and full readback preserve existing images and commercial data',async()=>{
 const r=await run();if(r.error)throw r.error;assert.equal(r.result.rowsWritten,2);assert.equal(r.result.nextBatchAuthorized,false);assert.equal(r.result.recoveredImageOccurrences,targets.reduce((n,t)=>n+t.missingPlanIds.length,0));
 const k=await kinds(r);assert.ok(k.indexOf('WRITE_AUTHORIZED')<k.indexOf('BASELINE_V2'));assert.equal(k.filter(x=>x==='INTENT').length,2);assert.equal(k.at(-1),'FINISHED');
 for(const row of(await db.query('select * from public.properties')).rows){assert.equal(row.price,'100');assert.equal(row.raw_data.building.stock,7);assert.deepEqual(row.raw_data.photos,['photo']);assert.deepEqual(row.raw_data.building.videos,['video']);assert.equal(row.raw_data.building.tour,'tour');for(const p of row.raw_data.building.floor_plans){assert.equal(p.description,p.id==='already'?'keep':'preserve');assert.equal(p.image_url,p.id==='already'?'https://old.invalid/original.jpg':image(p.id));}}
 const again=await service('select public.orulo_audit_control($1,null,null,null,$2) r',['batch_inventory',JSON.stringify({batchId:batch.id})]);assert.deepEqual(again.targets,[]);
});
test('authorization absent: zero CAS, unchanged rows, durable STOP and administrative reconciliation preserve original events',async()=>{
 const r=await run({authorize:false});assert.match(r.error.message,/AUTHORIZATION_WAIT_TIMEOUT/);assert.equal(r.calls.includes('CAS'),false);assert.deepEqual(await kinds(r),['START','CLIENT_READBACK','CLIENT_STOP']);
 assert.equal((await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h,r.fingerprint);
 const before=(await db.query('select * from orulo_audit.entries where run_uuid=$1 order by sequence',[r.uuid])).rows;
 await db.query("select orulo_audit.admin_event($1,'ABORTED','synthetic owner reviewed timeout zero CAS',true)",[r.uuid]);assert.equal((await kinds(r)).at(-1),'ABORTED');assert.deepEqual((await db.query('select * from orulo_audit.entries where run_uuid=$1 and sequence<=3 order by sequence',[r.uuid])).rows,before);
});
test('RPC failure after START or inaccessible source halts before plan or CAS',async()=>{
 for(const options of [{beforeControl:async a=>{if(a==='batch_inventory')throw Error('POSTGRES_AUDIT_RPC_FAILED');}},{badImage:true}]){const r=await run(options);assert.ok(r.error);assert.equal(r.calls.includes('CAS'),false);assert.deepEqual(await kinds(r),['START','CLIENT_STOP']);}
});
test('expired authorization, reused approval and service_role privilege escalation rejected',async()=>{
 const r=await run({onPlan:async p=>{
 await assert.rejects(db.exec(batchApprovalSql(p)),/EXPIRED_OR_CHANGED/);await db.exec('rollback');
 await assert.rejects(service('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5) r',[p.runUuid,p.headHash,p.githubRunId,p.controlSha,'synthetic escalation']),/permission denied/);
 await db.exec(`alter table orulo_audit.entries disable trigger user;update orulo_audit.entries set event=jsonb_set(event,'{expiresAt}','"2000-01-01T00:00:00Z"') where run_uuid='${p.runUuid}' and kind='WRITE_AUTHORIZED';alter table orulo_audit.entries enable trigger user;`);
 }});assert.match(r.error.message,/EXPIRED/);assert.equal(r.calls.includes('CAS'),false);
});
test('whole-row concurrency conflict preserves competing update and stops before next UUID',async()=>{
 const r=await run({beforeApply:async()=>{await db.query('update public.properties set price=222 where id=$1',[targets[0].id]);}});assert.match(r.error.message,/CONFLICT/);assert.equal(r.calls.filter(x=>x==='CAS').length,1);assert.equal((await db.query('select price from public.properties where id=$1',[targets[0].id])).rows[0].price,'222');assert.ok((await kinds(r)).includes('CAS_RESULT'));assert.ok(!(await kinds(r)).includes('FINISHED'));
});
test('timeout after commit: one CAS, read-only recovery, frozen journal and no retry',async()=>{
 const r=await run({loseAck:true});assert.ok(r.error);assert.equal(r.calls.filter(x=>x==='CAS').length,1);assert.ok(r.calls.includes('recover'));assert.equal((await kinds(r)).filter(x=>x==='CAS_RESULT').length,1);assert.ok(!(await kinds(r)).includes('FINISHED'));
});
test('readback failure after trusted commit records one confirmed row separately from zero verified rows',async()=>{
 let failed=false;const r=await run({beforeControl:async(a,p,uuid)=>{
  if(a==='batch_row'&&!failed&&(await db.query("select count(*) n from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[uuid])).rows[0].n>0){failed=true;throw Error('POSTGRES_AUDIT_RPC_FAILED');}
 }});assert.ok(r.error);assert.equal(r.calls.filter(x=>x==='CAS').length,1);
 const stop=(await db.query("select event from orulo_audit.entries where run_uuid=$1 and kind='CLIENT_STOP'",[r.uuid])).rows[0].event;
 assert.equal(stop.confirmedRows,1);assert.equal(stop.verifiedRows,0);assert.ok(!(await kinds(r)).includes('FINISHED'));
});
test('unexpected global insertion blocks FINISHED with durable evidence',async()=>{
 let added=false;const r=await run({beforeControl:async(a,p)=>{if(a==='snapshot_begin'&&p.p_event.kind==='READBACK_V2'&&!added){added=true;await db.exec(`insert into public.properties values('00000000-0000-0000-0000-000000000099','outside','novos','RS',true,'{"building_id":"47422"}',777,now(),now())`);}}});assert.match(r.error.message,/GLOBAL_CHANGE/);assert.ok(!(await kinds(r)).includes('FINISHED'));
});
test('hash-chain tamper rejected before authorization or CAS',async()=>{const r=await run({tamper:true});assert.ok(r.error);assert.equal(r.calls.includes('CAS'),false);});
test('mismatched/duplicate source IDs, untrusted/unavailable/invalid images rejected; existing images skipped',async()=>{
 const row={raw_data:{building_id:'2920',building:{floor_plans:[{id:'1'},{id:'2',image_url:'old'}]}}};
 await assert.rejects(batchPatches([row],async()=>[{id:'3',image_url:image('3')}],async()=>{}),/MISMATCH/);await assert.rejects(batchPatches([row],async()=>[{id:'1'},{id:'1'}],async()=>{}),/IDS_INVALID/);
 await assert.rejects(verifyBatchImage('https://evil.invalid/x.jpg'),/UNTRUSTED/);await assert.rejects(verifyBatchImage(image('1'),async()=>new Response('bad',{status:404})),/UNAVAILABLE/);await assert.rejects(verifyBatchImage(image('1'),async()=>new Response('not an image')),/SIGNATURE/);
 assert.equal((await verifyBatchImage(image('1'),async()=>new Response(new Uint8Array([255,216,255,1])))).format,'jpeg');
 const p=await batchPatches([row],async()=>[{id:'1',image_url:image('1')},{id:'2',image_url:image('2')}],async()=>{});assert.deepEqual(p.targets[0].patches,[{id:'1',image_url:image('1')}]);
});
test('private admin stays inaccessible to all API roles; audited CAS only service; duplicate stored IDs rejected',async()=>{
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'orulo_audit.authorize_pilot(uuid,text,text,text,text)','EXECUTE') b",[role])).rows[0].b,false);
 assert.equal((await db.query("select has_function_privilege('service_role','public.orulo_audited_cas(uuid,uuid)','EXECUTE') b")).rows[0].b,true);assert.equal((await db.query("select has_function_privilege('authenticated','public.orulo_audited_cas(uuid,uuid)','EXECUTE') b")).rows[0].b,false);
 await assert.rejects(db.query("select orulo_audit.batch_merge($1,$2)",[JSON.stringify({building:{floor_plans:[{id:'1'},{id:'1'}]}}),JSON.stringify([{id:'1',image_url:image('1')}])]),/EXISTING_PLAN_IDS/);
});
test('safe source diagnostics distinguish OAuth HTTP/timeout, plan HTTP/JSON and CDN failure without secrets or retries',async()=>{
 const secret='private_fixture_do_not_log';let calls=0;
 const reject=async(promise,expected)=>assert.rejects(promise,e=>{
  const d=batchFailureDetails(e);for(const [k,v] of Object.entries(expected))assert.equal(d[k],v);
  assert.doesNotMatch(JSON.stringify(d),/private_fixture|Bearer|client_secret|https:/);return true;
 });
 await reject(batchSourceClient(env(),async()=>{calls++;return new Response(secret,{status:401});}),{code:'BATCH_ORULO_AUTH_FAILED',sourceAction:'oauth',sourceHttpStatus:401,batchStage:'SOURCE_AUTH'});assert.equal(calls,1);
 await reject(batchSourceClient(env(),async()=>{throw Object.assign(Error(secret),{name:'TimeoutError',cause:{code:secret}});}),{code:'BATCH_SOURCE_NETWORK_FAILED',networkFailure:'TIMEOUT',sourceAction:'oauth'});
 await reject(batchSourceClient(env(),async()=>new Response(secret)),{code:'BATCH_SOURCE_INVALID_RESPONSE',sourceAction:'oauth'});
 const plans=await batchSourceClient(env(),async url=>url.includes('/oauth/')?Response.json({access_token:secret}):new Response(secret,{status:503}));
 await reject(plans(targets[0].buildingId),{code:'BATCH_SOURCE_HTTP_FAILED',sourceAction:'floor_plans',sourceHttpStatus:503,buildingId:targets[0].buildingId});
 const malformed=await batchSourceClient(env(),async url=>url.includes('/oauth/')?Response.json({access_token:secret}):new Response(secret));
 await reject(malformed(targets[0].buildingId),{code:'BATCH_SOURCE_INVALID_RESPONSE',sourceAction:'floor_plans'});
 await reject(verifyBatchImage(image('1'),async()=>{throw Object.assign(Error(secret),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});}),{code:'BATCH_IMAGE_REQUEST_FAILED',networkFailure:'UND_ERR_CONNECT_TIMEOUT',sourceAction:'image'});
 assert.deepEqual(batchFailureDetails(Object.assign(Error('BATCH_'+secret),{databaseReason:secret,batchStage:secret,networkFailure:secret,buildingId:secret,sourceAction:secret})),{code:'BATCH_BLOCKED'});
});
test('source failure persists exact safe stage/building in STOP and never authorizes or applies CAS',async()=>{
 const r=await run({fetchPlans:async()=>{throw Error('raw secret-bearing unknown error');}});
 assert.equal(r.calls.includes('CAS'),false);assert.deepEqual(await kinds(r),['START','CLIENT_STOP']);
 const event=(await db.query("select event from orulo_audit.entries where run_uuid=$1 and kind='CLIENT_STOP'",[r.uuid])).rows[0].event;
 assert.equal(event.diagnostic.code,'BATCH_BLOCKED');assert.equal(event.diagnostic.batchStage,'SOURCE_PLANS');assert.equal(event.diagnostic.buildingId,targets[0].buildingId);
 assert.doesNotMatch(JSON.stringify(event),/secret-bearing/);assert.equal(event.confirmedRows,0);
});
test('original 33 UUID manifest safely narrows to 30 UUIDs/18 buildings/122 missing plans after three rows are filled',async()=>{
 const completedIds=['507a0489-1be8-4853-81a5-e7bd079cdb2b','7d839f0c-f0b3-495b-bed4-bc33a4b4beca','e582fe78-6167-4ed4-942f-9b5a63a73c5e'];
 const r=await run({allManifest:true,completedIds,authorize:false});
 assert.match(r.error.message,/AUTHORIZATION_WAIT_TIMEOUT/);assert.equal(r.calls.includes('CAS'),false);
 assert.equal(batch.targets.length,33);assert.equal(batch.buildingIds.length,20);
 assert.equal(r.plan.targetIds.length,30);assert.equal(r.plan.buildingIds.length,18);assert.equal(r.plan.patchableOccurrences,122);assert.equal(r.plan.distinctUrls,73);
 assert.deepEqual(r.plan.targetIds,batch.targets.filter(t=>!completedIds.includes(t.id)).map(t=>t.id).sort());
 for(const t of r.plan.targets){assert.ok(!completedIds.includes(t.id));assert.deepEqual(t.patches.map(p=>p.id).sort(),batch.targets.find(x=>x.id===t.id).missingPlanIds);}
 assert.equal((await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h,r.fingerprint);
 assert.deepEqual(await kinds(r),['START','CLIENT_READBACK','CLIENT_STOP']);
 for(const id of ['phase2-30-a','phase2-30-b','phase3-rest'])assert.equal(batchCatalog.batches[id].released,false);
});
