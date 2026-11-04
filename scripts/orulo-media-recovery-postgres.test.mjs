import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {APPROVED_SHA,MANIFEST_HASH,PROJECT_URL,digest,verifyEntry,postgresTransport,openPostgresJournal} from './orulo-media-recovery-postgres.mjs';
import {storagePreflight} from './orulo-media-recovery-actions.mjs';
const {PGlite}=process.env.PGLITE_MODULE?await import(process.env.PGLITE_MODULE):createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const db=new PGlite();
const id='00000000-0000-0000-0000-000000000001';
const plans=[{id:'p',description:'original',image_url:'https://example.invalid/plan.jpg'}];
const metadata=()=>({eventUuid:randomUUID(),repository:'mudeisp/ynteligencia',actor:'mudeisp',actorId:'323805541',triggeringActor:'mudeisp',eventName:'workflow_dispatch',ref:'refs/heads/main',attempt:'1',githubRunId:String(Date.now())+String(Math.floor(Math.random()*100000)),workflowSha:'a'.repeat(40),approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH});
await db.exec(`create role anon; create role authenticated; create role service_role;
create table public.properties(id uuid primary key,external_id text,source text,state text,active boolean,raw_data jsonb,price numeric,created_at timestamptz,updated_at timestamptz);
grant usage on schema public to service_role,anon,authenticated;
alter table public.properties enable row level security;`);
await db.exec(readFileSync(new URL('../supabase/migrations/20261104093722_orulo_postgres_audit.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/migrations/20261104102956_orulo_paged_snapshots.sql',import.meta.url),'utf8'));
async function service(sql,args=[]){await db.exec('set role service_role');try{return (await db.query(sql,args)).rows[0]?.r;}finally{await db.exec('reset role').catch(()=>{});}}
async function control(action,run=null,seq=null,prev=null,event={}){return service('select public.orulo_audit_control($1,$2,$3,$4,$5) r',[action,run,seq,prev,JSON.stringify(event)]);}
async function current(){return (await db.query('select to_jsonb(p) r from public.properties p where id=$1',[id])).rows[0]?.r;}
let run,head;
async function append(action,event){
 if(action==='snapshot'){
  await append('snapshot_begin',event);
  const e=await control('read',run,head.sequence);
  for(let offset=0;offset<e.event.keys.length;offset+=50)await append('snapshot_page',{...event,offset,size:50});
  return append('snapshot_seal',event);
 }
 head=await control(action,run,head.sequence+1,head.hash,{...event,eventUuid:randomUUID()});return head;}
async function reset(authorize=false){
 await db.exec('reset role');
 // Test administrator reconciles old synthetic runs; never delete audit evidence.
 const active=(await db.query("select r.run_uuid from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and kind in ('ABORTED','FINISHED'))")).rows;
 for(const r of active)await db.query("select orulo_audit.admin_event($1,'ABORTED','synthetic test reconciliation',true)",[r.run_uuid]);
 await db.exec('truncate public.properties');
 await db.query("insert into public.properties values($1,'orulo-fixture','novos','SP',true,$2,100,'2026-01-01','2026-01-02')",[id,JSON.stringify({building_id:'43126',photos:['photo'],building:{floor_plans:[{id:'p',description:'original'}],stock:7,videos:['video'],tour:'tour'}})]);
 run=randomUUID();head=await control('start',run,null,null,metadata());
 await append('snapshot',{kind:'BASELINE_V2'});
 if(authorize){head=(await db.query("select orulo_audit.admin_event($1,'WRITE_AUTHORIZED','synthetic test authorization') r",[run])).rows[0].r;}
}
async function intent(expected,operation=randomUUID(),desiredPlans=plans){expected??=await current();await append('append',{type:'INTENT',id:expected.id,expected,desiredPlans,operationId:operation});return operation;}
const cas=op=>service('select public.orulo_audited_cas($1,$2) r',[run,op]);
const recover=op=>control('recover',run,null,null,{operationId:op});

test('private append-only audit: no table/schema access or RPC for anonymous/authenticated; no direct service DML',async()=>{
 await reset();
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  await assert.rejects(db.query('select * from orulo_audit.entries'),/permission denied/);
  await assert.rejects(db.query('truncate orulo_audit.entries'),/permission denied/);
  if(role!=='service_role')await assert.rejects(db.query("select public.orulo_audit_control('health')"),/permission denied/);
  await assert.rejects(db.query("select public.orulo_media_cas(null,null,null)"),/permission denied/);
  await db.exec('reset role');
 }
 await assert.rejects(db.exec('update orulo_audit.entries set event=event'),/AUDIT_APPEND_ONLY/);
 await assert.rejects(db.exec('delete from orulo_audit.runs'),/AUDIT_APPEND_ONLY/);
 await assert.rejects(db.exec('truncate orulo_audit.entries cascade'),/AUDIT_APPEND_ONLY/);
 await assert.rejects(control('health'),/AUDIT_DURABILITY_UNVERIFIED/,'in-memory fsync off must fail closed');
});
test('run reuse, active interrupted run, sequence races, reserved events and unauthorised writes rejected',async()=>{
 await reset();const original=run,oldHead=head;
 await assert.rejects(control('start',randomUUID(),null,null,metadata()),/ACTIVE_RUN/);
 await assert.rejects(control('append',run,head.sequence+1,head.hash,{eventUuid:randomUUID(),type:'WRITE_AUTHORIZED'}),/RESERVED/);
 await assert.rejects(intent(),/OPERATIONAL_WRITE_BLOCKED/);
 await assert.rejects(cas(randomUUID()),/OPERATIONAL_WRITE_BLOCKED/);
 await append('append',{type:'READ_ONLY_PREFLIGHT'});
 await assert.rejects(control('append',run,oldHead.sequence+1,oldHead.hash,{eventUuid:randomUUID(),type:'CLIENT_STOP'}),/SEQUENCE_CONFLICT/);
 await append('snapshot',{kind:'READBACK_V2'});await append('finish',{});
 await assert.rejects(control('append',original,head.sequence+1,head.hash,{eventUuid:randomUUID(),type:'CLIENT_STOP'}),/RUN_CLOSED/);
 const m=(await db.query('select metadata from orulo_audit.runs where run_uuid=$1',[original])).rows[0].metadata;
 await assert.rejects(control('start',randomUUID(),null,null,{...m,eventUuid:randomUUID()}),/duplicate key/);
 for(const patch of [{actor:'other'},{actorId:'0'},{triggeringActor:'other'},{ref:'refs/heads/other'},{eventName:'push'},{attempt:'2'},{workflowSha:''},{manifestHash:''}])
  await assert.rejects(control('start',randomUUID(),null,null,{...metadata(),...patch}),/MANUAL_OWNER_SCOPE/);
});
test('durable V2 snapshots compare keys, content, timestamps, insertions/deletions independent of row order',async()=>{
 await reset();
 await db.query("update public.properties set updated_at='2026-01-03' where id=$1",[id]);
 await append('snapshot',{kind:'READBACK_V2'});await append('finish',{});
 let result=await control('read',run,head.sequence);
 assert.deepEqual({...result.event.comparison},{compared:1,contentChanges:0,timestampOnly:1,insertions:0,deletions:0,schemaMatch:true,captureStable:true,attribution:'concurrent_or_unattributed_no_backfill_in_preflight'});
 await reset();await db.query('update public.properties set price=101 where id=$1',[id]);
 await db.query("insert into public.properties(id) values('00000000-0000-0000-0000-000000000002')");
 await append('snapshot',{kind:'READBACK_V2'});await append('finish',{});
 result=await control('read',run,head.sequence);assert.equal(result.event.comparison.contentChanges,1);assert.equal(result.event.comparison.insertions,1);
 await reset();await db.query('delete from public.properties where id=$1',[id]);
 await append('snapshot',{kind:'READBACK_V2'});await append('finish',{});
 assert.equal((await control('read',run,head.sequence)).event.comparison.deletions,1);
});
test('CAS with previously committed INTENT atomically stores result and preserves every forbidden field',async()=>{
 await reset(true);const before=await current(),op=await intent(before);const result=await cas(op),after=await current();
 assert.equal(result.status,'UPDATED');assert.equal(result.receipt.verified,true);
 assert.deepEqual(after.raw_data.building.floor_plans,plans);
 const preserved=r=>({...r,updated_at:null,raw_data:{...r.raw_data,building:{...r.raw_data.building,floor_plans:null}}});
 assert.deepEqual(preserved(after),preserved(before));
 const recovered=await recover(op);assert.equal(recovered.result.result.status,'UPDATED');
 const ack=result.auditReceipt;verifyEntry(await control('read',run,ack.sequence),ack);
 await assert.rejects(cas(op),/DUPLICATE_OPERATION/);
 assert.deepEqual(await current(),after);
});
test('real content concurrency without timestamp change returns audited CONFLICT',async()=>{
 await reset(true);const expected=await current(),op=await intent(expected);
 await db.query('update public.properties set price=200 where id=$1',[id]);
 assert.equal((await cas(op)).status,'CONFLICT');assert.equal((await current()).price,200);
 assert.equal((await current()).raw_data.building.floor_plans[0].image_url,undefined);
 assert.equal((await recover(op)).result.result.status,'CONFLICT');
});
test('missing row, repeated payload, pending INTENT and scope exclusions fail safely',async()=>{
 await reset(true);let expected=await current(),op=await intent(expected);
 await assert.rejects(intent(),/PENDING_INTENT/);await assert.rejects(append('snapshot',{kind:'READBACK_V2'}),/PENDING_INTENT/);
 await db.query('delete from public.properties where id=$1',[id]);assert.equal((await cas(op)).status,'NOT_FOUND');
 await reset(true);expected=await current();op=await intent(expected);const result=await cas(op);head=result.auditReceipt;
 op=await intent(expected);assert.equal((await cas(op)).status,'UNCHANGED');
 await reset(true);expected=await current();
 for(const building of ['86644','46939','999999'])await assert.rejects(intent({...expected,raw_data:{...expected.raw_data,building_id:building}}),/SCOPE_INVALID/);
 op=await intent(expected);await db.query("update public.properties set raw_data=jsonb_set(raw_data,'{building_id}','\"86644\"') where id=$1",[id]);
 assert.equal((await cas(op)).status,'NOT_FOUND','RLS hides newly out-of-scope row from UPDATE lock');
 assert.equal((await current()).raw_data.building_id,'86644');
});
test('same-transaction INTENT is forbidden; audit insertion failure rolls back CAS but preserves committed INTENT',async()=>{
 await reset(true);const expected=await current(),op=randomUUID();
 await db.exec('begin');await intent(expected,op);await assert.rejects(cas(op),/PREVIOUSLY_COMMITTED/);await db.exec('rollback');
 // Restore client head after rollback.
 head=(await db.query("select jsonb_build_object('sequence',sequence,'hash',hash) r from orulo_audit.entries where run_uuid=$1 order by sequence desc limit 1",[run])).rows[0].r;
 const committed=await intent(expected);
 await db.exec("create function public.reject_result() returns trigger language plpgsql as $$begin if new.kind='CAS_RESULT' then raise exception 'fixture audit unavailable'; end if; return new; end$$; create trigger fixture_reject before insert on orulo_audit.entries for each row execute function public.reject_result()");
 await assert.rejects(cas(committed),/fixture audit unavailable/);assert.deepEqual(await current(),expected);
 assert.ok((await recover(committed)).intent);assert.equal((await recover(committed)).result,null);
 await db.exec('drop trigger fixture_reject on orulo_audit.entries; drop function public.reject_result()');
});
test('typology edits and trigger side effects abort the whole audited transaction',async()=>{
 await reset(true);const expected=await current();let op=await intent(expected,randomUUID(),[{...plans[0],description:'changed'}]);
 await assert.rejects(cas(op),/IMAGE_FIELDS_ONLY/);assert.deepEqual(await current(),expected);
 await reset(true);op=await intent();
 await db.exec("create function public.bad_trigger() returns trigger language plpgsql as $$begin new.price=999; return new; end$$; create trigger fixture_bad before update on public.properties for each row execute function public.bad_trigger()");
 await assert.rejects(cas(op),/PRESERVATION_FAILED/);assert.equal((await current()).price,100);
 await db.exec('drop trigger fixture_bad on public.properties;drop function public.bad_trigger()');
});
test('paged capture rejects gaps/repeats/oversized pages and preserves tombstones and IDs inserted behind cursor',async()=>{
 await reset();await append('snapshot_begin',{kind:'READBACK_V2'});
 await assert.rejects(append('snapshot_seal',{kind:'READBACK_V2'}),/INCOMPLETE/);
 await assert.rejects(append('snapshot_page',{kind:'READBACK_V2',offset:1}),/CURSOR_CONFLICT/);
 await assert.rejects(append('snapshot_page',{kind:'READBACK_V2',offset:0,size:101}),/SIZE_INVALID/);
 await db.query('delete from public.properties where id=$1',[id]);
 await db.query("insert into public.properties(id) values('00000000-0000-0000-0000-000000000000')");
 await append('snapshot_page',{kind:'READBACK_V2',offset:0,size:1});
 const page=await control('read',run,head.sequence);assert.equal(page.event.records[0][0],id);assert.equal(page.event.records[0][4],null);
 await assert.rejects(append('snapshot_page',{kind:'READBACK_V2',offset:0}),/NO_MORE_PAGES/);
 await append('snapshot_seal',{kind:'READBACK_V2'});
 const seal=(await control('read',run,head.sequence)).event.snapshot;
 assert.equal(seal.membershipStable,false);assert.deepEqual(seal.deletedDuringCapture,[id]);assert.equal(seal.insertedDuringCapture.length,1);
 await append('finish',{});assert.equal((await control('read',run,head.sequence)).event.comparison.captureStable,false);
});
test('page cancellation rolls back event AND records; partial capture remains durable and blocks a new run',async()=>{
 await reset();await append('snapshot_begin',{kind:'READBACK_V2'});const previous={...head};
 await db.exec("create function public.cancel_page() returns trigger language plpgsql as $$begin raise query_canceled using message='fixture statement timeout'; end$$;create trigger fixture_cancel before insert on orulo_audit.snapshot_records for each row execute function public.cancel_page()");
 await assert.rejects(append('snapshot_page',{kind:'READBACK_V2',offset:0}),/statement timeout/);
 assert.equal((await db.query("select count(*)::int n from orulo_audit.snapshot_records where run_uuid=$1 and kind='READBACK_V2'",[run])).rows[0].n,0);
 assert.equal((await control('read',run,previous.sequence)).hash,previous.hash);
 await assert.rejects(control('read',run,previous.sequence+1),/NOT_FOUND/);
 await assert.rejects(control('start',randomUUID(),null,null,metadata()),/ACTIVE_RUN/);
 await assert.rejects(control('snapshot',run,head.sequence+1,head.hash,{kind:'READBACK_V2'}),/PAGED_SNAPSHOT_REQUIRED/);
 await db.exec('drop trigger fixture_cancel on orulo_audit.snapshot_records;drop function public.cancel_page()');
});
test('schema change during capture stops before another page and all capture tables remain private/immutable',async()=>{
 await reset();await append('snapshot_begin',{kind:'READBACK_V2'});
 await db.exec('alter table public.properties add column fixture_drift text');
 await assert.rejects(append('snapshot_page',{kind:'READBACK_V2',offset:0}),/SCHEMA_CHANGED/);
 await db.exec('alter table public.properties drop column fixture_drift');
 for(const table of ['snapshot_sets','snapshot_records']){
  await assert.rejects(db.exec('truncate orulo_audit.'+table+' cascade'),/APPEND_ONLY/);
  await db.exec('set role service_role');await assert.rejects(db.query('select * from orulo_audit.'+table),/permission denied/);await db.exec('reset role');
 }
});
test('known-failure administrative procedure verifies anchored chain, only appends ABORTED and refuses repetition',async()=>{
 await reset();await db.query("select orulo_audit.admin_event($1,'ABORTED','fixture reconciliation',true)",[run]);
 run=randomUUID();head=await control('start',run,null,null,{...metadata(),githubRunId:'41813891981'});
 await append('append',{type:'READ_ONLY_PREFLIGHT',writeEnabled:false});
 const saved=[await control('read',run,1),await control('read',run,2)];
 const procedure=readFileSync(new URL('../supabase/orulo_reconcile_41813891981.sql',import.meta.url),'utf8')
  .replaceAll('6e5290ce-971a-404c-ae18-881a01e30f7c',run)
  .replaceAll('ba1dc5ecd0cfe0bdf0c9d048369926bf3d9154a6bf500beee4d580141ee292f4',head.hash);
 await db.exec(procedure);assert.deepEqual([await control('read',run,1),await control('read',run,2)],saved);
 assert.equal((await control('read',run,3)).event.type,'ABORTED');
 await assert.rejects(db.exec(procedure),/UNEXPECTED_EVENTS/);await db.exec('rollback');
});
test('real SQL bridge: preflight verifies every paginated ACK and compares 105 UUIDs without property mutations',async()=>{
 await reset();await db.query("select orulo_audit.admin_event($1,'ABORTED','fixture reconciled before client test',true)",[run]);
 await db.exec("truncate public.properties;insert into public.properties(id,external_id) select md5(g::text)::uuid,'fixture-'||g from generate_series(1,105)g");
 const before=(await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h;
 const f=fakePostgres();let pages=0,applies=0;
 const transport={control:async(a,p={})=>{
  if(a==='health')return f.transport.control(a,p); // In-memory durability intentionally fails the separate health test.
  if(a==='snapshot_page')pages++;
  return control(a,p.p_run,p.p_sequence,p.p_previous_hash,p.p_event);
 },apply:()=>{applies++;throw Error('must not write');}};
 const env={GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ID:'111111',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:'a'.repeat(40),ORULO_POSTGRES_AUDIT_READY:'true',ORULO_CLIENT_ID:'fixture',ORULO_CLIENT_SECRET:'fixture',SUPABASE_SECRET_KEY:'fixture'};
 const result=await storagePreflight(env,transport,()=>{});assert.equal(result.comparison.compared,105);assert.equal(result.writeEnabled,false);assert.equal(pages,6);assert.equal(applies,0);
 assert.equal((await db.query('select md5(jsonb_agg(to_jsonb(p) order by id)::text) h from public.properties p')).rows[0].h,before);
});

export function fakePostgres(){
 const entries=new Map();let run,head={sequence:0,hash:''};const calls=[];
 const transport={async control(action,args={}){
  calls.push(action);
  if(action==='health')return {version:2,snapshotProtocol:'paged-v2',storage:'postgres',durable:true,appendOnly:true,synchronousCommit:'on',writeEnabled:false};
  if(action==='read')return entries.get(args.p_sequence);
  if(action==='recover')return {intent:{},result:{result:{status:'UPDATED'}}};
  let event=JSON.parse(JSON.stringify(args.p_event||{}));if(action==='start'){run=args.p_run;event.type='START';}
  if(action==='snapshot_begin'){event.type='SNAPSHOT_BEGIN';event.keys=[];}
  if(action==='snapshot_seal')event.type=event.kind;
  if(action==='finish'){event.type='FINISHED';event.comparison={contentChanges:0,timestampOnly:0,insertions:0,deletions:0,schemaMatch:true,captureStable:true};}
  const canonical=JSON.stringify({runUuid:run,sequence:head.sequence+1,previousHash:head.hash,event});
  head={runUuid:run,sequence:head.sequence+1,hash:digest(canonical),eventUuid:event.eventUuid};
  entries.set(head.sequence,{...head,canonical,event});return {...head};
 },async apply(){calls.push('apply');throw Error('timeout after commit');}};
 return {transport,calls,entries};
}
test('client verifies committed INTENT ACK/readback before apply; lost CAS ACK recovers read-only and freezes',async()=>{
 const f=fakePostgres(),j=await openPostgresJournal({},f.transport),op=randomUUID();
 await j.record({type:'INTENT',operationId:op});
 await assert.rejects(j.apply(op),e=>e.message==='POSTGRES_CAS_COMMITTED_RECONCILE_REQUIRED' && e.recovery.result.result.status==='UPDATED');
 assert.deepEqual(f.calls,['health','start','read','append','read','apply','recover']);
 await assert.rejects(j.apply(op),/FROZEN/);assert.equal(f.calls.filter(c=>c==='apply').length,1);
});
test('checksum tampering or ambiguous append freezes client; no CAS or retries',async()=>{
 const f=fakePostgres(),j=await openPostgresJournal({},f.transport),base=f.transport.control;
 f.transport.control=async(a,p)=>{const r=await base(a,p);return a==='read'?{...r,canonical:'tampered'}:r;};
 await assert.rejects(j.record({type:'INTENT'}),/READBACK_DIVERGENCE/);await assert.rejects(j.apply(randomUUID()),/FROZEN/);
 assert.equal(f.calls.includes('apply'),false);
 const g=fakePostgres(),k=await openPostgresJournal({},g.transport),normal=g.transport.control;
 g.transport.control=async(a,p)=>{const r=await normal(a,p);if(a==='append')throw Error('lost ACK after persistence');return r;};
 await assert.rejects(k.record({type:'INTENT'}),/lost ACK/);assert.equal(g.entries.size,2);await assert.rejects(k.record({type:'INTENT'}),/FROZEN/);
});
test('lost page acknowledgement preserves event but freezes capture without retry or seal',async()=>{
 const f=fakePostgres(),base=f.transport.control;let pages=0;
 f.transport.control=async(a,p)=>{
  if(a==='snapshot_begin'){
   const ack=await base(a,p),entry=f.entries.get(ack.sequence);entry.event.keys=[id];entry.canonical=JSON.stringify({runUuid:ack.runUuid,sequence:ack.sequence,previousHash:JSON.parse(entry.canonical).previousHash,event:entry.event});entry.hash=ack.hash=digest(entry.canonical);return ack;
  }
  if(a==='snapshot_page'){pages++;await base(a,p);throw Error('page ACK lost after commit');}
  return base(a,p);
 };
 const j=await openPostgresJournal({},f.transport);await assert.rejects(j.snapshot('BASELINE_V2'),/page ACK lost/);
 await assert.rejects(j.snapshot('BASELINE_V2'),/FROZEN/);assert.equal(pages,1);assert.equal(f.calls.includes('snapshot_seal'),false);
});
test('concurrent local appends freeze both callers; health and transport fail closed without revealing secrets',async()=>{
 const f=fakePostgres(),j=await openPostgresJournal({},f.transport),normal=f.transport.control;let release;
 f.transport.control=async(a,p)=>{if(a==='append')await new Promise(r=>release=r);return normal(a,p);};
 const one=j.record({type:'INTENT'}),rejected=assert.rejects(one,/FROZEN/);
 await assert.rejects(j.record({type:'INTENT'}),/CONCURRENT/);release();await rejected;
 await assert.rejects(openPostgresJournal({},{control:async()=>({})}),/HEALTH_UNVERIFIED/);
 assert.throws(()=>postgresTransport({url:'https://other.invalid',key:'secret'}),/CONFIGURATION_REQUIRED/);
 const transport=postgresTransport({url:PROJECT_URL,key:'private-fixture'},async()=>{throw Error('private-fixture');});
 await assert.rejects(transport.apply(randomUUID(),randomUUID()),e=>!e.message.includes('private-fixture'));
});
test.after(()=>db.close());
