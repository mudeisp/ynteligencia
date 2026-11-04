import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {executePilot,validatePilotDispatch,PILOT_BUILDING_ID,pilotAuthorizationSql,pilotApprovalSummary} from './orulo-media-recovery-pilot.mjs';
const {PGlite}=process.env.PGLITE_MODULE?await import(process.env.PGLITE_MODULE):createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const db=new PGlite(),id='00000000-0000-0000-0000-000000000001',id2='00000000-0000-0000-0000-000000000002';
await db.exec(`create role anon;create role authenticated;create role service_role;
create table public.properties(id uuid primary key,external_id text,source text,state text,active boolean,raw_data jsonb,price numeric,created_at timestamptz,updated_at timestamptz);
grant usage on schema public to service_role,anon,authenticated;alter table public.properties enable row level security;`);
for(const f of ['20261104093722_orulo_postgres_audit.sql','20261104102956_orulo_paged_snapshots.sql','20261104114348_orulo_pilot_authorization.sql'])
 await db.exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
let runCounter=50000;
const env=()=>({GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ID:String(++runCounter),GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:'a'.repeat(40),ORULO_PILOT_APPROVED_SHA:'a'.repeat(40),ORULO_PILOT_READY:'true',ORULO_POSTGRES_AUDIT_READY:'true',ORULO_CLIENT_ID:'fixture',ORULO_CLIENT_SECRET:'fixture',SUPABASE_SECRET_KEY:'fixture'});
async function service(sql,args){await db.exec('set role service_role');try{return (await db.query(sql,args)).rows[0].r;}finally{await db.exec('reset role').catch(()=>{});}}
async function reset(){
 await db.exec('reset role');
 await db.query("select orulo_audit.admin_event(r.run_uuid,'ABORTED','synthetic failure reconciled',true) from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and kind in ('FINISHED','ABORTED'))");
 await db.exec('truncate public.properties');
 for(const pk of [id,id2])await db.query("insert into public.properties values($1,'fixture','novos','SP',true,$2,100,'2026-01-01','2026-01-02')",[pk,JSON.stringify({building_id:PILOT_BUILDING_ID,photos:['photo'],building:{floor_plans:[{id:'p',description:'original'}],stock:7,videos:['video'],tour:'tour'}})]);
}
async function run(options={}){
 await reset();const fingerprintBefore=(await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h;
 const e=env(),calls=[];let currentRun;
 const transport={control:async(a,p={})=>{
  calls.push(a);if(a==='start')currentRun=p.p_run;
  if(a==='health')return {version:2,snapshotProtocol:'paged-v2',pilotProtocol:1,storage:'postgres',durable:true,appendOnly:true,synchronousCommit:'on',writeEnabled:false};
  if(options.beforeControl)await options.beforeControl(a,p,currentRun);
  return service('select public.orulo_audit_control($1,$2,$3,$4,$5) r',[a,p.p_run??null,p.p_sequence??null,p.p_previous_hash??null,JSON.stringify(p.p_event||{})]);
 },apply:async(r,op)=>{
  calls.push('APPLY');if(options.beforeApply)await options.beforeApply(r,op);
  const result=await service('select public.orulo_audited_cas($1,$2) r',[r,op]);
  if(options.loseAck)throw Error('fixture lost CAS ACK after commit');return result;
 }};
 let result,error;
 try{result=await executePilot({env:e,transport,fetchPlans:async()=>[{id:'p',description:'untrusted metadata',image_url:'https://example.invalid/plan.jpg'}],checkImage:async()=>{},
  onPlan:async p=>{
   if(options.authorize!==false)await db.query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5)',[p.runUuid,p.headHash,p.githubRunId,p.controlSha,'synthetic explicit authorization']);
   if(options.onPlan)await options.onPlan(p);
  },wait:async()=>{},now:(()=>{let n=0;return()=>n+=600001;})()});}catch(e){error=e;}
 return {result,error,calls,run:currentRun,env:e,propertyFingerprintBefore:fingerprintBefore};
}
test('pilot gate rejects unset readiness, unapproved control SHA, non-owner/ref/rerun and locks first manifest member',()=>{
 assert.equal(PILOT_BUILDING_ID,'43126');validatePilotDispatch(env());
 for(const patch of [{ORULO_PILOT_READY:''},{ORULO_PILOT_APPROVED_SHA:'b'.repeat(40)},{GITHUB_ACTOR:'other'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_RUN_ATTEMPT:'2'}])assert.throws(()=>validatePilotDispatch({...env(),...patch}));
 const workflow=readFileSync(new URL('../.github/workflows/orulo-pilot-manual.yml',import.meta.url),'utf8');
 assert.match(workflow,/workflow_dispatch: \{\}/);assert.match(workflow,/group: orulo-lote1-production/);assert.match(workflow,/ref: \$\{\{ github.workflow_sha \}\}/);
 assert.doesNotMatch(workflow,/push:|schedule:|--write|inputs:|id-token:|aws-actions/);
});
test('full pilot success: explicit admin event then fresh baseline, durable INTENT/CAS_RESULT, readback and finish',async()=>{
 const r=await run();if(r.error)throw r.error;
 assert.equal(r.result.result,'APROVADO');assert.equal(r.result.rowsWritten,2);assert.equal(r.result.imagesBefore,0);assert.equal(r.result.imagesAfter,2);assert.equal(r.result.remainingBatchEnabled,false);
 const entries=(await db.query('select kind,event from orulo_audit.entries where run_uuid=$1 order by sequence',[r.run])).rows;
 assert.ok(entries.findIndex(e=>e.kind==='WRITE_AUTHORIZED')<entries.findIndex(e=>e.kind==='BASELINE_V2'));
 assert.equal(entries.filter(e=>e.kind==='INTENT').length,2);assert.equal(entries.filter(e=>e.kind==='CAS_RESULT').length,2);assert.equal(entries.at(-1).kind,'FINISHED');
 const rows=(await db.query('select * from public.properties order by id')).rows;
 for(const row of rows){assert.equal(row.price,'100');assert.equal(row.raw_data.building.stock,7);assert.equal(row.raw_data.building.floor_plans[0].description,'original');assert.equal(row.raw_data.building.tour,'tour');assert.deepEqual(row.raw_data.photos,['photo']);}
});
test('no authorization times out with zero CAS; service_role cannot invoke admin authorization',async()=>{
 const r=await run({authorize:false,onPlan:async p=>{
  await assert.rejects(service('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5) r',[p.runUuid,p.headHash,p.githubRunId,p.controlSha,'forged fixture reason']),/permission denied/);
 }});assert.match(r.error.message,/AUTHORIZATION_WAIT_TIMEOUT/);assert.equal(r.calls.filter(c=>c==='APPLY').length,0);
 assert.equal((await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h,r.propertyFingerprintBefore);
 const entries=(await db.query('select * from orulo_audit.entries where run_uuid=$1 order by sequence',[r.run])).rows;
 assert.deepEqual(entries.map(e=>e.kind),['START','CLIENT_READBACK','CLIENT_STOP']);assert.equal(entries[2].event.confirmedRows,0);
 let procedure=readFileSync(new URL('../supabase/orulo_reconcile_41832262256.sql',import.meta.url),'utf8')
  .replaceAll('26556e29-7a3b-450e-9169-3f894f231077',r.run)
  .replaceAll('41832262256',r.env.GITHUB_RUN_ID)
  .replaceAll('628b9ae4d3255871b0c5412cd815c66bf850428a',r.env.GITHUB_WORKFLOW_SHA)
  .replaceAll('bacc0b0416e26104e2b8974e070525d4de17d15fa6360bb76508e6652ffb0f71',entries[2].hash)
  .replace(/expected_targets constant jsonb := '[^']+'::jsonb;/,()=>"expected_targets constant jsonb := '"+JSON.stringify([id,id2])+"'::jsonb;");
 await db.exec(procedure);
 assert.equal((await db.query('select kind from orulo_audit.entries where run_uuid=$1 and sequence=4',[r.run])).rows[0].kind,'ABORTED');
 assert.deepEqual((await db.query('select * from orulo_audit.entries where run_uuid=$1 and sequence<=3 order by sequence',[r.run])).rows,entries);
 assert.equal((await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h,r.propertyFingerprintBefore);
 await assert.rejects(db.exec(procedure),/UNEXPECTED_EVENTS/);await db.exec('rollback');
});
test('owner summary presents filled SQL without authorizing; explicit admin execution uses existing function and rejects reuse',async()=>{
 const r=await run({authorize:false,onPlan:async p=>{
  assert.equal(p.candidateRows,2);assert.equal(p.candidateImages,2);assert.equal(p.distinctImages,1);
  const summary=pilotApprovalSummary(p),command=pilotAuthorizationSql(p);
  for(const text of [p.runUuid,p.headHash,p.controlSha,p.githubRunId,id,id2,'43126','/sql/new'])assert.ok(summary.includes(text));
  assert.doesNotMatch(summary,/SUPABASE_SECRET_KEY|ORULO_CLIENT_SECRET|Bearer/);
  assert.match(command,/interval '10 minutes'/);assert.match(command,/orulo_audit.authorize_pilot\(/);
  assert.equal((await db.query("select count(*)::int n from orulo_audit.entries where run_uuid=$1 and kind='WRITE_AUTHORIZED'",[p.runUuid])).rows[0].n,0);
  await db.exec(command); // Synthetic analogue of the owner's explicit SQL Editor Run.
  await assert.rejects(db.exec(command),/EXPIRED_OR_CHANGED/);await db.exec('rollback');
 }});if(r.error)throw r.error;assert.equal(r.result.result,'APROVADO');
});
test('filled authorization rejects unsafe identifiers and a reconciled old plan without emitting authorization',async()=>{
 assert.throws(()=>pilotAuthorizationSql({runUuid:"';delete",headHash:'a'.repeat(64),githubRunId:'1',controlSha:'a'.repeat(40)}),/IDENTIFIERS_INVALID/);
 const r=await run({authorize:false}),entries=(await db.query('select * from orulo_audit.entries where run_uuid=$1 order by sequence',[r.run])).rows;
 const plan={runUuid:r.run,headHash:entries[1].hash,githubRunId:r.env.GITHUB_RUN_ID,controlSha:r.env.GITHUB_WORKFLOW_SHA};
 await db.query("select orulo_audit.admin_event($1,'ABORTED','synthetic timeout reconciled',true)",[r.run]);
 await assert.rejects(db.exec(pilotAuthorizationSql(plan)),/EXPIRED_OR_CHANGED/);await db.exec('rollback');
 assert.equal((await db.query("select count(*)::int n from orulo_audit.entries where run_uuid=$1 and kind='WRITE_AUTHORIZED'",[r.run])).rows[0].n,0);
});
test('concurrent price mutation after committed INTENT stops on conflict and never reaches next UUID',async()=>{
 let count=0;const r=await run({beforeApply:async()=>{if(++count===1)await db.query('update public.properties set price=200 where id=$1',[id]);}});
 assert.match(r.error.message,/STOP_CONFLICT/);assert.equal(count,1);assert.equal((await db.query('select raw_data from public.properties where id=$1',[id2])).rows[0].raw_data.building.floor_plans[0].image_url,undefined);
});
test('lost response after commit reads durable result, never retries CAS or advances to next UUID',async()=>{
 const r=await run({loseAck:true});assert.match(r.error.message,/COMMITTED_RECONCILE_REQUIRED/);assert.equal(r.calls.filter(c=>c==='APPLY').length,1);
 assert.equal((await db.query("select count(*)::int n from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[r.run])).rows[0].n,1);
 assert.equal((await db.query('select raw_data from public.properties where id=$1',[id2])).rows[0].raw_data.building.floor_plans[0].image_url,undefined);
});
test('fresh full-row baseline comparison blocks inventory changes before any CAS',async()=>{
 let changed=false;const r=await run({beforeControl:async(a,p)=>{if(a==='pilot_row'&&!changed && (await db.query("select count(*)::int n from orulo_audit.entries where kind='BASELINE_V2' and run_uuid=$1",[p.p_run])).rows[0].n){changed=true;await db.query('update public.properties set price=300 where id=$1',[id]);}}});
 assert.match(r.error.message,/CONCURRENT_CHANGE_BEFORE_CAS/);assert.equal(r.calls.filter(c=>c==='APPLY').length,0);
});
test('admin authorization binds head, GitHub run and control SHA; other authorized buildings and UUIDs are rejected',async()=>{
 const r=await run({authorize:false,onPlan:async p=>{
  for(const [head,gh,sha] of [['bad',p.githubRunId,p.controlSha],[p.headHash,'999',p.controlSha],[p.headHash,p.githubRunId,'b'.repeat(40)]])
   await assert.rejects(db.query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5)',[p.runUuid,head,gh,sha,'synthetic explicit authorization']),/MISMATCH/);
  const auth=(await db.query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5) r',[p.runUuid,p.headHash,p.githubRunId,p.controlSha,'synthetic explicit authorization'])).rows[0].r;
  const other='00000000-0000-0000-0000-000000000003';
  await db.query("insert into public.properties(id,state,source,active,raw_data) values($1,'SP','novos',true,'{\"building_id\":\"4969\",\"building\":{\"floor_plans\":[]}}')",[other]);
  const expected=(await db.query('select to_jsonb(p) r from public.properties p where id=$1',[other])).rows[0].r;
  await assert.rejects(service("select public.orulo_audit_control('append',$1,$2,$3,$4) r",[p.runUuid,auth.sequence+1,auth.hash,JSON.stringify({type:'INTENT',eventUuid:randomUUID(),operationId:randomUUID(),id:other,expected,desiredPlans:[]})]),/ROW_SCOPE_DENIED/);
  throw Error('TEST_STOP_AFTER_GUARDS');
 }});assert.match(r.error.message,/TEST_STOP/);assert.equal(r.calls.filter(c=>c==='APPLY').length,0);
});
test('expired authorization and missing fresh baseline reject CAS before property mutation',async()=>{
 const expired=await run({authorize:false,onPlan:async p=>{
  await db.query('select orulo_audit.append($1,$2,$3,$4)',[p.runUuid,3,p.headHash,JSON.stringify({type:'WRITE_AUTHORIZED',eventUuid:randomUUID(),mode:'PILOT_ONE_BUILDING',buildingId:PILOT_BUILDING_ID,manifestHash:'1c8b002b5a3b4b6caf614e3b4e6d84383b8e306ae2773f3d7de48cc7daaa6d03',targetIds:p.targetIds,controlSha:p.controlSha,expiresAt:'2000-01-01T00:00:00Z'})]);
 }});assert.match(expired.error.message,/EXPIRED/);assert.equal(expired.calls.filter(c=>c==='APPLY').length,0);
 const missing=await run({onPlan:async p=>{
  const head=(await db.query('select sequence,hash from orulo_audit.entries where run_uuid=$1 order by sequence desc limit 1',[p.runUuid])).rows[0];
  const expected=(await db.query('select to_jsonb(p) r from public.properties p where id=$1',[id])).rows[0].r,op=randomUUID();
  await db.query('select orulo_audit.append($1,$2,$3,$4)',[p.runUuid,head.sequence+1,head.hash,JSON.stringify({type:'INTENT',eventUuid:randomUUID(),operationId:op,id,expected,desiredPlans:[{id:'p',description:'original',image_url:'https://example.invalid/plan.jpg'}]})]);
  await assert.rejects(service('select public.orulo_audited_cas($1,$2) r',[p.runUuid,op]),/FRESH_BASELINE/);
  throw Error('TEST_STOP_AFTER_GUARDS');
 }});assert.match(missing.error.message,/TEST_STOP/);
});
test.after(()=>db.close());
