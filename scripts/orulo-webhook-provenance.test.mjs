import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {connect} from '../test-support/orulo-cas/local-postgres.mjs';
import {APPROVED_SHA,MANIFEST_HASH} from './orulo-media-recovery-postgres.mjs';
import {createProvenanceReader} from './orulo-webhook-provenance-reader.mjs';
import {classifyBatchIntegrity} from './orulo-media-recovery-scope.mjs';
const quote=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
const bootstrap=await connect('postgres','postgres');
await bootstrap.query('drop database if exists orulo_v9_test with (force)');
await bootstrap.query('drop role if exists orulo_webhook_writer,orulo_provenance_reader,orulo_webhook_owner');
await bootstrap.query('create database orulo_v9_test');bootstrap.close();
const clients=[];async function open(role='postgres'){const c=await connect(role);clients.push(c);return c;}
const db=await open();
after(()=>clients.forEach(c=>c.close()));
const json=async(c,sql)=>JSON.parse((await c.query(sql))[0].r);
const ddl=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
await db.query(`do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
 end$$;alter role anon login;alter role authenticated login;alter role service_role login;
 create table public.properties(id uuid primary key default gen_random_uuid(),external_id text unique,source text,title text,development_name text,neighborhood text,city text,state text,latitude numeric,longitude numeric,price numeric,bedrooms numeric,bathrooms numeric,parking_spaces numeric,area numeric,image_url text,property_url text,active boolean,raw_data jsonb,created_at timestamptz default now(),updated_at timestamptz);
 alter table public.properties enable row level security;grant usage on schema public to service_role,anon,authenticated;
 grant select,insert,update on public.properties to service_role;
 create policy legacy_service on public.properties to service_role using(true) with check(true);`);
await db.query(ddl('supabase/migrations/20261104093722_orulo_postgres_audit.sql'));
await db.query(ddl('supabase/migrations/20261104102956_orulo_paged_snapshots.sql'));
await db.query(ddl('supabase/migrations/20261106114525_orulo_webhook_provenance.sql'));
const initialRoles=await db.query("select rolname,rolcanlogin from pg_roles where rolname in ('orulo_webhook_writer','orulo_provenance_reader') order by rolname");
// Test-only trust-auth cluster. Never provision production credentials in code.
await db.query('alter role orulo_webhook_writer login;alter role orulo_provenance_reader login');
const writer=await open('orulo_webhook_writer'),reader=await open('orulo_provenance_reader'),service=await open('service_role');
const row=(building='64515',price=100,typology='1')=>({external_id:`orulo:${building}:${typology}`,source:'novos',state:'SP',price,active:true,raw_data:{building_id:building,building:{floor_plans:[{id:'p'}],videos:['video'],stock:5}},updated_at:'2026-01-02T00:00:00.000Z'});
const apply=(rows,c=writer,removed=false,building='64515')=>json(c,`select orulo_audit.apply_webhook(${quote(building)},${quote(JSON.stringify(rows))}::jsonb,${removed},'2026-01-03') r`);
const current=async id=>json(db,`select to_jsonb(p) r from public.properties p where id=${quote(id)}`);
const transitions=async id=>json(db,`select coalesce(jsonb_agg(to_jsonb(t) order by transition_id),'[]') r from orulo_audit.property_transitions t where id=${quote(id)}`);
const seed=async(b='64515')=>{const v=await apply([row(b)],writer,false,b);return v.savedRows[0].id;};
let run,head;
async function rpc(action,event={},seq=null,previous=null){return json(db,`set role service_role;select public.orulo_audit_control(${quote(action)},${quote(run)},${seq??'null'},${previous===null?'null':quote(previous)},${quote(JSON.stringify(event))}::jsonb) r;reset role;`);}
async function append(action,event){head=await rpc(action,{eventUuid:randomUUID(),...event},head.sequence+1,head.hash);}
async function snapshot(kind){await append('snapshot_begin',{kind});const s=await rpc('read',{},head.sequence);for(let offset=0;offset<s.event.keys.length;offset+=50)await append('snapshot_page',{kind,offset,size:50});await append('snapshot_seal',{kind});}
async function start(){
 if(run)await db.query(`select orulo_audit.admin_event(${quote(run)},'ABORTED','synthetic V9 local test',true)`);
 run=randomUUID();head=await rpc('start',{eventUuid:randomUUID(),repository:'mudeisp/ynteligencia',actor:'mudeisp',actorId:'323805541',triggeringActor:'mudeisp',eventName:'workflow_dispatch',ref:'refs/heads/main',attempt:'1',githubRunId:String(Date.now()),workflowSha:'a'.repeat(40),approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH});await snapshot('BASELINE_V2');
}
const proof=id=>json(reader,`select orulo_audit.read_webhook_provenance(${quote(run)},${quote(id)}) r`);

test('installation grants no login, authorization or direct writer/table rights',async()=>{
 assert.equal(initialRoles.length,2);assert.ok(initialRoles.every(r=>r.rolcanlogin==='f'));
 assert.equal((await db.query("select count(*) n from orulo_audit.entries where kind='WRITE_AUTHORIZED'"))[0].n,'0');
 for(const c of [writer,reader,service,await open('anon'),await open('authenticated')]){
  await assert.rejects(c.query('select * from orulo_audit.property_transitions'),/permission denied/);
  await assert.rejects(c.query('delete from orulo_audit.property_transitions'),/permission denied/);
 }
 await assert.rejects(writer.query('update public.properties set price=1'),/permission denied/);
 await assert.rejects(reader.query("select orulo_audit.apply_webhook('1','[]',true,now())"),/permission denied/);
 await assert.rejects(writer.query(`select orulo_audit.read_webhook_provenance('${randomUUID()}','${randomUUID()}')`),/permission denied/);
});
test('same transaction receipt has exact V2 UTC hashes, UUID, paths and authenticated session',async()=>{
 const id=await seed();await apply([row('64515',200)]);const ts=await transitions(id),last=ts.at(-1);
 assert.equal(last.writer_session,'orulo_webhook_writer');assert.equal(last.authenticated_webhook,true);
 assert.equal(last.operation,'UPDATE');assert.deepEqual(last.changed_fields,['/price']);assert.equal(ts[0].operation,'INSERT');assert.equal(ts[0].before_full_hash,null);
 const h=await json(db,`select jsonb_build_object('hash',md5((to_jsonb(p)||jsonb_build_object('created_at',p.created_at at time zone 'UTC','updated_at',p.updated_at at time zone 'UTC'))::text)) r from public.properties p where id='${id}'`);
 assert.equal(h.hash,last.after_full_hash);assert.equal(ts[0].after_full_hash,last.before_full_hash);
 await assert.rejects(db.query(`update orulo_audit.property_transitions set writer_session='forged' where id='${id}'`),/AUDIT_APPEND_ONLY/);
 await assert.rejects(db.query('truncate orulo_audit.property_transitions'),/AUDIT_APPEND_ONLY/);
});
test('shared service identity cannot impersonate dedicated session using role/GUC/JWT/application_name',async()=>{
 const id=await seed();
 await assert.rejects(service.query('set role orulo_webhook_writer'),/permission denied/);
 await service.query(`set application_name='orulo_webhook_writer';select set_config('request.jwt.claims','{"role":"orulo_webhook_writer"}',false);select set_config('orulo.writer','orulo_webhook_writer',false)`);
 await assert.rejects(apply([row('64515',300)],service),/permission denied/);
 await db.query(`create function public.synthetic_v9_forward() returns jsonb language sql security definer set search_path='' as $$select orulo_audit.apply_webhook('64515','[]',true,now())$$;alter function public.synthetic_v9_forward() owner to orulo_webhook_owner;grant execute on function public.synthetic_v9_forward() to service_role`);
 await assert.rejects(service.query('select public.synthetic_v9_forward()'),/V9_DEDICATED_LOGIN_REQUIRED/);
 await db.query('drop function public.synthetic_v9_forward()');
 await service.query(`update public.properties set price=301 where id='${id}'`);
 const last=(await transitions(id)).at(-1);assert.equal(last.authenticated_webhook,false);assert.equal(last.writer_session,'service_role');
});
test('row and all receipts roll back jointly when receipt insertion fails, including prior row updates',async()=>{
 const result=await apply([row('64515',100,'1'),row('64515',100,'2')]),ids=result.savedRows.map(r=>r.id),before=[],counts=[];
 for(const id of ids){before.push(await current(id));counts.push(await transitions(id));}
 // First row + receipt succeeds inside the statement; the second receipt fails.
 await db.query(`alter table orulo_audit.property_transitions add constraint synthetic_failure check(id<>'${ids[1]}') not valid`);
 await assert.rejects(apply([row('64515',900,'1'),row('64515',900,'2')]),/synthetic_failure/);
 await db.query('alter table orulo_audit.property_transitions drop constraint synthetic_failure');
 for(let i=0;i<ids.length;i++){assert.deepEqual(await current(ids[i]),before[i]);assert.deepEqual(await transitions(ids[i]),counts[i]);}
});
test('DELETE is observed but not a permission available to webhook; nested paths preserve media fields',async()=>{
 const id=await seed();await assert.rejects(writer.query(`delete from public.properties where id='${id}'`),/permission denied/);
 const changed=row();changed.raw_data.building.floor_plans[0].image_url='https://example.invalid/p.jpg';await apply([changed]);
 assert.deepEqual((await transitions(id)).at(-1).changed_fields,['/raw_data/building/floor_plans/0/image_url']);
 await db.query(`delete from public.properties where id='${id}'`);const t=(await transitions(id)).at(-1);assert.equal(t.operation,'DELETE');assert.equal(t.after_full_hash,null);assert.equal(t.authenticated_webhook,false);
});
test('multiple authenticated transitions compose the exact sealed snapshot chain; V8 remains blocking',async()=>{
 const id=await seed();await start();await apply([row('64515',201)]);await apply([row('64515',202)]);await snapshot('READBACK_V2');
 const p=await proof(id);assert.ok(p);assert.equal(p.transitions.length,2);assert.equal(p.transitions[0].afterFullHash,p.transitions[1].beforeFullHash);
 const records=await json(db,`select jsonb_object_agg(kind,record) r from orulo_audit.snapshot_records where run_uuid='${run}' and id='${id}'`);
 const capture=record=>({keys:[id],records:[record],columns:[['id','uuid']],seal:{processed:1,keysAtSeal:[id],columns:[['id','uuid']],membershipStable:true}});
 const change={uuid:id,scope:'OUT_OF_SCOPE',before:{fullHash:p.beforeFullHash},after:{fullHash:p.afterFullHash}};
 const adapter={query:async(sql,params)=>({rows:[{proof:await json(reader,sql.replace('$1::uuid',quote(params[0])+'::uuid').replace('$2::uuid',quote(params[1])+'::uuid').replace('as proof','as r'))}]})};
 const attest=await createProvenanceReader(adapter)({runUuid:run,changes:[change]});
 const classified=classifyBatchIntegrity(capture(records.BASELINE_V2),capture(records.READBACK_V2),{attestExternal:attest});
 assert.equal(classified.changes[0].classification,'EXTERNAL_CHANGE_VERIFIED');assert.equal(classified.blocked,true);assert.equal(classified.policy,'STRICT_GLOBAL_V1');
});
test('one unattributed intermediate write invalidates the entire chain, not only the last receipt',async()=>{
 const id=await seed();await start();await apply([row('64515',400)]);await service.query(`update public.properties set price=401 where id='${id}'`);await apply([row('64515',402)]);await snapshot('READBACK_V2');assert.equal(await proof(id),null);
});
test('upsert preserves id/created_at, rejects foreign IDs/fields, stale and removed operations are transactional',async()=>{
 const s=await apply([row('64515',1,'1'),row('64515',1,'2')]),first=s.savedRows[0];
 const u=await apply([row('64515',2,'1')]);assert.equal(u.savedRows[0].id,first.id);assert.equal(u.savedRows[0].created_at,first.created_at);assert.equal(u.deactivatedRows.length,1);assert.equal(u.deactivatedRows[0].active,false);
 await assert.rejects(apply([{...row(),id:randomUUID()}]),/FIELDS_DENIED/);await assert.rejects(apply([row('64516')]),/DENIED/);
 await assert.rejects(apply([row(),row()]),/DUPLICATE/);
 const removed=await apply([],writer,true);assert.equal(removed.deactivatedRows.length,2);assert.ok(removed.deactivatedRows.every(r=>r.active===false));
});
test('native concurrent writers serialize and preserve a continuous before/after chain',async()=>{
 const id=await seed(),w2=await open('orulo_webhook_writer');await writer.query('begin');await apply([row('64515',700)]);
 let resolved=false;const pending=apply([row('64515',701)],w2).then(r=>{resolved=true;return r;});
 await new Promise(r=>setTimeout(r,100));assert.equal(resolved,false);await writer.query('commit');await pending;
 const t=(await transitions(id)).slice(-2);assert.equal(t[0].after_full_hash,t[1].before_full_hash);assert.notEqual(t[0].transaction_id,t[1].transaction_id);assert.equal((await current(id)).price,701);
});
test('uncommitted/aborted changes have no durable receipts and do not contaminate a later writer',async()=>{
 const id=await seed(),before=await current(id),ts=await transitions(id);await writer.query('begin');await apply([row('64515',800)]);assert.deepEqual(await current(id),before);assert.deepEqual(await transitions(id),ts);await writer.query('rollback');assert.deepEqual(await current(id),before);assert.deepEqual(await transitions(id),ts);
});
test('CAS receipt matches transactional observation; CAS actor is not attested as webhook; receipt failure rolls CAS back',async()=>{
 const id=await seed('43126');await start();head=await json(db,`select orulo_audit.admin_event('${run}','WRITE_AUTHORIZED','synthetic V9 CAS') r`);
 let expected=await current(id),op=randomUUID();await append('append',{type:'INTENT',id,expected,desiredPlans:[{id:'p',image_url:'https://example.invalid/cas.jpg'}],operationId:op});
 const result=await json(db,`set role service_role;select public.orulo_audited_cas('${run}','${op}') r;reset role`);
 assert.equal(result.status,'UPDATED');assert.equal(result.receipt.verified,true);head=result.auditReceipt;
 const t=(await transitions(id)).at(-1);assert.equal(t.authenticated_webhook,false);assert.equal(t.after_full_hash,result.receipt.afterFullHash);assert.equal(t.before_full_hash,result.receipt.beforeFullHash);
 await snapshot('READBACK_V2');assert.equal(await proof(id),null);
 await assert.rejects(db.query(`set role service_role;select public.orulo_audited_cas('${run}','${op}')`),/DUPLICATE_OPERATION/);await db.query('reset role');
 // Fresh synthetic run, distinct INTENT. A trigger failure also rolls back CAS_RESULT.
 await start();head=await json(db,`select orulo_audit.admin_event('${run}','WRITE_AUTHORIZED','synthetic V9 CAS rollback') r`);expected=await current(id);op=randomUUID();
 await append('append',{type:'INTENT',id,expected,desiredPlans:[{id:'p',image_url:'https://example.invalid/cas2.jpg'}],operationId:op});
 await db.query('alter table orulo_audit.property_transitions add constraint synthetic_cas_failure check(after_full_hash is null) not valid');
 await assert.rejects(db.query(`set role service_role;select public.orulo_audited_cas('${run}','${op}')`),/synthetic_cas_failure/);await db.query('reset role');
 await db.query('alter table orulo_audit.property_transitions drop constraint synthetic_cas_failure');assert.deepEqual(await current(id),expected);
 assert.equal((await db.query(`select count(*) n from orulo_audit.entries where operation_uuid='${op}' and kind='CAS_RESULT'`))[0].n,'0');
});
test('concurrent webhook update defeats stale authorized CAS without overwrite; journal hashes remain valid',async()=>{
 const id=await seed('43126');await start();head=await json(db,`select orulo_audit.admin_event('${run}','WRITE_AUTHORIZED','synthetic V9 concurrent CAS') r`);
 const expected=await current(id),op=randomUUID();await append('append',{type:'INTENT',id,expected,desiredPlans:[{id:'p',image_url:'https://example.invalid/stale.jpg'}],operationId:op});
 await writer.query('begin');await apply([row('43126',1234)],writer,false,'43126');
 let done=false;const pending=json(db,`set role service_role;select public.orulo_audited_cas('${run}','${op}') r;reset role`).then(r=>{done=true;return r;});
 await new Promise(r=>setTimeout(r,100));assert.equal(done,false);await writer.query('commit');const result=await pending;assert.equal(result.status,'CONFLICT');
 assert.equal((await current(id)).price,1234);assert.equal((await current(id)).raw_data.building.floor_plans[0].image_url,undefined);
 assert.equal((await db.query("select count(*) n from orulo_audit.entries where hash<>encode(sha256(convert_to(canonical,'UTF8')),'hex')"))[0].n,'0');
});
test('missing sealed readback or transition evidence never produces an attestation',async()=>{
 const id=await seed();await start();assert.equal(await proof(id),null);await snapshot('READBACK_V2');assert.equal(await proof(id),null);
});
test('duplicate normalized events are no-ops for media, timestamps and receipts, including removed rows',async()=>{
 const building='64517',payload=row(building),first=await apply([payload],writer,false,building),id=first.savedRows[0].id;
 const before=await current(id),evidence=await transitions(id);
 const repeat={...payload,updated_at:'2026-05-05T00:00:00Z'};
 const duplicate=await apply([repeat],writer,false,building);
 assert.equal(duplicate.status,'APPLIED');assert.equal(duplicate.protocol,'ORULO_WEBHOOK_TRANSACTION_V1');
 assert.deepEqual(duplicate.savedRows[0],first.savedRows[0]);assert.deepEqual(await current(id),before);assert.deepEqual(await transitions(id),evidence);
 await apply([],writer,true,building);const removed=await current(id),receipts=await transitions(id);
 await apply([],writer,true,building);assert.deepEqual(await current(id),removed);assert.deepEqual(await transitions(id),receipts);
});
test('idempotent inactive-row operations retain row locks until commit against legacy writers',async()=>{
 const building='64519',id=await seed(building);await apply([],writer,true,building);const before=await transitions(id);
 await writer.query('begin');await apply([],writer,true,building);
 let released=false;const pending=service.query(`update public.properties set active=true where id='${id}'`).then(()=>{released=true;});
 let prematurelyReleased;
 try{await new Promise(r=>setTimeout(r,100));prematurelyReleased=released;}
 finally{await writer.query('commit');await pending;}
 assert.equal(prematurelyReleased,false);assert.equal((await transitions(id)).length,before.length+1);assert.equal((await current(id)).active,true);
});
test('conflicting nested building/typology identity cannot attach media to the wrong property',async()=>{
 const variants=[{building:{id:'64516'}},{typology_id:'2'},{typology:{id:2}}];
 for(const variant of variants){const v=row();v.raw_data={...v.raw_data,...variant};await assert.rejects(apply([v]),/V9_ROW_SCOPE_OR_FIELDS_DENIED/);}
});
test('invalid receipt hash is rejected by SQL, and a coherent hash cannot hide mismatched receipt fields',async()=>{
 const building='64518',id=await seed(building);await start();await apply([row(building,201)],writer,false,building);await snapshot('READBACK_V2');assert.ok(await proof(id));
 await db.query('begin;alter table orulo_audit.property_transitions disable trigger immutable_rows');
 await assert.rejects(db.query(`update orulo_audit.property_transitions set evidence_hash=repeat('0',64) where id='${id}'`),/check constraint/);
 await db.query('rollback');assert.ok(await proof(id));
 // Tamper inside a rollback-only administrative fixture, never remote history.
 await db.query(`begin;alter table orulo_audit.property_transitions disable trigger immutable_rows;update orulo_audit.property_transitions set changed_fields='["/forged"]' where id='${id}';set session authorization orulo_provenance_reader`);
 try{assert.equal(await json(db,`select orulo_audit.read_webhook_provenance('${run}','${id}') r`),null);}
 finally{await db.query('reset session authorization;rollback');}
 assert.ok(await proof(id));
});
test('even dedicated-writer evidence is rejected when its transaction also appears in the executor journal',async()=>{
 const id=await seed();await start();
 await db.query('begin;set session authorization orulo_webhook_writer');
 await apply([row('64515',999)],db);
 await db.query('reset session authorization');
 await append('append',{type:'CLIENT_READBACK',stage:'SYNTHETIC_SHARED_TRANSACTION'});
 await db.query('commit');await snapshot('READBACK_V2');assert.equal(await proof(id),null);
});
