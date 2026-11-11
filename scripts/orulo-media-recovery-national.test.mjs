import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {loadNationalManifest,nationalPlans,executeNational,nationalApprovalSql} from './orulo-media-recovery-national.mjs';
import {digest,PROJECT_URL} from './orulo-media-recovery-postgres.mjs';
const {PGlite}=createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const dir=new URL('../supabase/migrations/',import.meta.url);
const files=['20261104093722_orulo_postgres_audit.sql','20261104102956_orulo_paged_snapshots.sql',
 '20261104114348_orulo_pilot_authorization.sql','20261104135027_orulo_pilot_indexed_targets.sql','20261104151850_orulo_manifest_batches.sql'];
const migration=readdirSync(dir).find(f=>f.endsWith('_orulo_national_v2_once.sql'));
const native=process.env.ORULO_NATIONAL_NATIVE==='true';
if(native&&(process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='orulo_national_test'))throw Error('ISOLATED_NATIVE_NATIONAL_DATABASE_REQUIRED');
class NativeDatabase {
 role=null;
 call(statement){return execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:(this.role?'set role '+this.role+';':'')+statement,encoding:'utf8',maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
 async exec(statement){
  const match=statement.match(/^set role ([a-z_]+)$/);if(match){this.role=match[1];return;}
  if(statement==='reset role'){this.role=null;return;}
  this.call(statement);
 }
 async query(statement,args=[]){
  statement=statement.replace(/\$(\d+)/g,(_,n)=>{const value=args[Number(n)-1];return value==null?'null':"'"+String(value).replaceAll("'","''")+"'";});
  if(/^(insert|update|delete)/i.test(statement)){this.call(statement);return {rows:[]};}
  const result=this.call("select coalesce(json_agg(q),'[]'::json) from ("+statement.replace(/;\s*$/,'')+") q;");
  return {rows:JSON.parse(result)};
 }
}
const db=native?new NativeDatabase():new PGlite();
await db.exec(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role;end if;end$$;
create table public.properties(id uuid primary key,external_id text,source text,title text,development_name text,neighborhood text,city text,state text,
 price numeric,bedrooms integer,bathrooms integer,parking_spaces integer,area numeric,has_balcony boolean,has_pool boolean,near_metro boolean,
 image_url text,property_url text,active boolean,raw_data jsonb,created_at timestamptz,updated_at timestamptz,latitude double precision,longitude double precision);
alter table public.properties enable row level security;grant usage on schema public to service_role,anon,authenticated;`);
for(const file of files)await db.exec(readFileSync(new URL(file,dir),'utf8'));
const production=JSON.parse(readFileSync(new URL('../test-support/orulo-cas/production-contract.json',import.meta.url),'utf8'));
for(const routine of production.functions){
 await db.exec(routine.definition+';');
 await db.exec('alter function '+routine.signature+' owner to orulo_audit_owner;');
 if(routine.schema==='orulo_audit')await db.exec('revoke all on function '+routine.signature+' from public,anon,authenticated,service_role;');
}
const historical=(await db.query("select pg_get_functiondef('orulo_audit.cas_core(uuid,jsonb,jsonb)'::regprocedure) definition")).rows[0].definition;
await db.exec(readFileSync(new URL(migration,dir),'utf8'));
await db.exec(readFileSync(new URL('../test-support/orulo-cas/portal-trigger-production.sql',import.meta.url),'utf8'));
async function query(sql,args=[]){return (await db.query(sql,args)).rows[0]?.r;}
async function service(sql,args=[]){await db.exec('set role service_role');try{return await query(sql,args);}finally{await db.exec('reset role');}}
const transport={control:(action,args={})=>!native&&action==='national_health'?Promise.resolve({version:2,snapshotProtocol:'paged-v2',storage:'postgres',durable:true,appendOnly:true,synchronousCommit:'on',writeEnabled:false,nationalProtocol:1}):service('select public.orulo_audit_control($1,$2,$3,$4,$5) r',
 [action,args.p_run??null,args.p_sequence??null,args.p_previous_hash??null,JSON.stringify(args.p_event||{})]),
 apply:(run,op)=>service('select public.orulo_audited_cas($1,$2) r',[run,op])};
const id='00000000-0000-0000-0000-000000000001';
const url='https://static.orulo.com.br/images/properties/large/1.jpg';
const patch={id:'1',images:[url],checks:[{url,evidenceSha256:'b'.repeat(64),evidence:{url,status:'VALIDATED_PREFIX',prefixSha256:'c'.repeat(64),prefixBytes:32,format:'jpeg'}}]};
let env,bytes,manifest;
async function reset(){
 for(const row of (await db.query("select run_uuid from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and e.kind in ('FINISHED','ABORTED'))")).rows)
 await query("select orulo_audit.admin_event($1,'ABORTED','isolated test reconciliation complete',true) r",[row.run_uuid]);
 await db.exec('truncate public.properties');
 await db.query("insert into public.properties(id,external_id,source,state,active,raw_data,price,created_at,updated_at) values($1,'orulo:593:fixture','novos','RS',false,$2,100,'2026-01-01','2026-01-02')",[id,JSON.stringify({building_id:'593',building:{id:'593',stock:5,floor_plans:[{id:'1',description:'preserved'}]}})]);
 const hash=await query("select encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') r from public.properties p");
 const columns=await query('select orulo_audit.columns_v2() r');
 manifest={schemaVersion:1,id:'national-v2-once',operationUuid:randomUUID(),columns,
 sourceManifestSha256:'6f6248375b5d5459496465d1c202e38e10adfade30bdef2442a7d59f00f313cc',
 reconciliationSha256:'2a9e409d6db81e4d70a6ddaee942eedb9887f4302347e333dec4c122cab8e66e',
 stats:{properties:1,buildings:1,eligibleOccurrences:1,distinctUrls:1},targets:[{id,buildingId:'593',baselineSha256:hash,patches:[patch]}]};
 bytes=Buffer.from(JSON.stringify(manifest));
 env={GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
 GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ATTEMPT:'1',
 GITHUB_RUN_ID:String(Date.now())+String(Math.floor(Math.random()*100000)),GITHUB_WORKFLOW_SHA:'a'.repeat(40),
 ORULO_POSTGRES_AUDIT_READY:'true',ORULO_NATIONAL_READY:'true',ORULO_NATIONAL_APPROVED_SHA:'a'.repeat(40),
 ORULO_NATIONAL_MANIFEST_SHA:digest(bytes),SUPABASE_SECRET_KEY:'fixture'};
}
const authorize=p=>query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5) r',[p.runUuid,p.headHash,p.githubRunId,p.controlSha,'Explicit isolated national manifest approval']);
const execute=(options={})=>executeNational({env,bytes,transport,onPlan:authorize,verifyImages:async()=>{},...options});

test('historical CAS body is unchanged and new administrative helpers stay private',async()=>{
 assert.equal(await query("select pg_get_functiondef('orulo_audit.cas_core(uuid,jsonb,jsonb)'::regprocedure) r"),historical);
 for(const role of ['anon','authenticated','service_role']){
 await db.exec('set role '+role);
 await assert.rejects(db.query('select orulo_audit.national_authorize(null,null,null,null,null)'),/permission denied/);
 await db.exec('reset role');
 }
});
test('manifest tampering, duplicate target identity and missing source proof fail closed',async()=>{
 await reset();assert.throws(()=>loadNationalManifest(bytes,'0'.repeat(64)),/HASH_MISMATCH/);
 for(const change of [m=>m.targets.push(m.targets[0]),m=>m.targets[0].patches[0].checks=[]]){
 const m=structuredClone(manifest);change(m);const b=Buffer.from(JSON.stringify(m));assert.throws(()=>loadNationalManifest(b,digest(b)),/TARGET_INVALID|PROVENANCE_INVALID/);
 }
});
test('national operation uses installed INTENT/CAS_RESULT ledger and preserves inactive RS commercial fields',async()=>{
 await reset();const before=await query('select to_jsonb(p) r from public.properties p');
 const result=await execute();assert.equal(result.status,'FINISHED');assert.equal(result.rowsWritten,1);
 const after=await query('select to_jsonb(p) r from public.properties p');
 assert.deepEqual(after,{...before,raw_data:{...before.raw_data,building:{...before.raw_data.building,floor_plans:[{...before.raw_data.building.floor_plans[0],images:[url]}]}}});
 assert.equal(await query("select count(*)::int r from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[manifest.operationUuid]),1);
 assert.equal(await query("select count(*)::int r from information_schema.tables where table_schema='orulo_recovery'"),0);
 await assert.rejects(execute(),/duplicate key|ACTIVE_RUN/);
});
test('existing images and duplicate plan IDs cannot be replaced',async()=>{
 await reset();const row=await query('select to_jsonb(p) r from public.properties p');
 row.raw_data.building.floor_plans[0].image_url=url;
 assert.throws(()=>nationalPlans(row,manifest.targets[0]),/EXISTING_IMAGE/);
 row.raw_data.building.floor_plans=[{id:'1'},{id:'1'}];
 assert.throws(()=>nationalPlans(row,manifest.targets[0]),/IDENTITY_CONFLICT/);
});
test('target drift after authorization prevents CAS without rebasing frozen commercial data',async()=>{
 await reset();await assert.rejects(execute({onPlan:async p=>{await authorize(p);await db.exec('update public.properties set price=200');}}),/FROZEN_BASELINE_CHANGED/);
 assert.equal(await query('select price::int r from public.properties'),200);
 assert.equal(await query("select count(*)::int r from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[manifest.operationUuid]),0);
});
test('external change blocks FINISHED but preserves confirmed target receipts for reconciliation',async()=>{
 await reset();const base=transport.control;const t={...transport,control:async(action,args)=>{
 if(action==='snapshot_begin'&&args.p_event?.kind==='READBACK_V2')await db.exec("insert into public.properties(id,title) values('00000000-0000-0000-0000-000000000099','outside')".replace('(id,title)', '(id,external_id)'));
 return base(action,args);
 }};
 const result=await execute({transport:t});assert.equal(result.status,'NATIONAL_RECONCILIATION_REQUIRED');
 const report=await t.control('national_report',{p_run:manifest.operationUuid});assert.equal(report.rowsWritten,1);assert.equal(report.reconciliation.unattributed,1);
});
test('same operation continues only with owner grant, skips prior committed CAS and verifies its entire row',async()=>{
 await reset();const base=transport.control;let stopped=false;
 const t={...transport,control:async(action,args)=>{
 const value=await base(action,args);
 if(action==='national_row'&&value.result&&!stopped){stopped=true;throw Error('SIMULATED_RUNNER_LOSS_AFTER_COMMIT');}return value;
 }};
 await assert.rejects(execute({transport:t}),/SIMULATED_RUNNER_LOSS/);
 const report=await base('national_report',{p_run:manifest.operationUuid});assert.equal(report.rowsWritten,1);assert.equal(report.pendingIntents,0);
 env={...env,GITHUB_RUN_ID:env.GITHUB_RUN_ID+'1',ORULO_NATIONAL_ACTION:'continue'};
 const result=await execute({onPlan:async p=>query('select orulo_audit.authorize_national_continuation($1,$2,$3,$4,$5) r',
 [p.runUuid,p.headHash,p.githubRunId,p.controlSha,'Owner confirms previous runner terminated and committed receipt reconciled'])});
 assert.equal(result.status,'FINISHED');assert.equal(result.rowsWritten,1);
 assert.equal(await query("select count(*)::int r from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[manifest.operationUuid]),1);
});
test('approval SQL binds full hashes, UUID, code and GitHub run without source credentials',()=>{
 assert.throws(()=>nationalApprovalSql({}),/APPROVAL_INVALID/);
});

test('production portal trigger body remains enabled and image-only CAS preserves its derived index',async()=>{
 await reset();const before=await query("select coalesce(jsonb_agg(to_jsonb(p)),'[]') r from public.portal_development_index p");
 assert.equal(await query("select tgenabled::text r from pg_trigger where tgname='properties_refresh_portal_development_index'"),'O');
 await execute();assert.deepEqual(await query("select coalesce(jsonb_agg(to_jsonb(p)),'[]') r from public.portal_development_index p"),before);
});
test('failure inserting transactional CAS_RESULT rolls back property and portal trigger together',async()=>{
 await reset();const before=await query('select to_jsonb(p) r from public.properties p');
 const portal=await query("select coalesce(jsonb_agg(to_jsonb(p)),'[]') r from public.portal_development_index p");
 await db.exec("create function public.fixture_ledger_failure() returns trigger language plpgsql as $$begin if NEW.kind='CAS_RESULT' then raise exception 'FIXTURE_LEDGER_FAILED'; end if;return NEW;end$$;create trigger fixture_ledger_failure before insert on orulo_audit.entries for each row execute function public.fixture_ledger_failure();");
 try{await assert.rejects(execute(),/POSTGRES_CAS_AMBIGUOUS_RECONCILE_REQUIRED/);
 assert.deepEqual(await query('select to_jsonb(p) r from public.properties p'),before);
 assert.deepEqual(await query("select coalesce(jsonb_agg(to_jsonb(p)),'[]') r from public.portal_development_index p"),portal);
 assert.equal(await query("select count(*)::int r from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[manifest.operationUuid]),0);
 }finally{await db.exec('drop function public.fixture_ledger_failure() cascade');}
});
test('ambiguous response after committed CAS is recovered once and is never retried automatically',async()=>{
 await reset();let calls=0;const t={...transport,apply:async(r,op)=>{calls++;await transport.apply(r,op);throw Error('FIXTURE_NETWORK_LOSS');}};
 await assert.rejects(execute({transport:t}),/POSTGRES_CAS_COMMITTED_RECONCILE_REQUIRED/);assert.equal(calls,1);
 const report=await transport.control('national_report',{p_run:manifest.operationUuid});assert.equal(report.rowsWritten,1);assert.equal(report.pendingIntents,0);
});
test('manifest accepts a frozen universe above historical record limits without independent batches',async()=>{
 await reset();const m=structuredClone(manifest);
 m.targets=Array.from({length:2501},(_,i)=>({...structuredClone(m.targets[0]),id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0')}));
 m.stats={properties:2501,buildings:1,eligibleOccurrences:2501,distinctUrls:1};const b=Buffer.from(JSON.stringify(m));
 assert.equal(loadNationalManifest(b,digest(b)).targets.length,2501);
});
