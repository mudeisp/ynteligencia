// Real multi-session PostgreSQL test; deliberately impossible to target the production project.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {APPROVED_SHA,MANIFEST_HASH} from './orulo-media-recovery-postgres.mjs';
if(process.env.ORULO_SYNTHETIC_PG!=='true' || process.env.PGHOST!=='127.0.0.1' || process.env.PGDATABASE!=='orulo_audit_test')throw Error('ISOLATED_LOCAL_TEST_DATABASE_REQUIRED');
const args=['-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=s=>execFileSync('psql',args,{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const quote=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const id='00000000-0000-0000-0000-000000000001',run=randomUUID();
sql(`create role anon;create role authenticated;create role service_role;
create table public.properties(id uuid primary key,external_id text,source text,state text,active boolean,raw_data jsonb,price numeric,created_at timestamptz,updated_at timestamptz);
grant usage on schema public to service_role,anon,authenticated;
alter table public.properties enable row level security;
insert into public.properties values('${id}','fixture','novos','SP',true,'{"building_id":"43126","building":{"floor_plans":[{"id":"p"}]}}',100,'2026-01-01','2026-01-02');`);
sql(readFileSync(new URL('../supabase/migrations/20261104093722_orulo_postgres_audit.sql',import.meta.url),'utf8'));
const rpc=(action,sequence=null,hash=null,event={})=>JSON.parse(sql(`set role service_role;select public.orulo_audit_control('${action}','${run}',${sequence??'null'},${hash===null?'null':"'"+hash+"'"},${quote(event)});`));
let head=rpc('start',null,null,{eventUuid:randomUUID(),repository:'mudeisp/ynteligencia',actor:'mudeisp',actorId:'323805541',triggeringActor:'mudeisp',eventName:'workflow_dispatch',ref:'refs/heads/main',attempt:'1',githubRunId:'12345',workflowSha:'a'.repeat(40),approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH});
const append=(action,event)=>head=rpc(action,head.sequence+1,head.hash,{eventUuid:randomUUID(),...event});
async function heldLock(statement){
 const child=spawn('psql',args,{stdio:['pipe','pipe','pipe']});let output='',error='';
 const complete=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error)));});
 child.stderr.on('data',b=>error+=b);
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',b=>{output+=b;if(output.includes('LOCK_READY'))resolve();});child.on('exit',()=>{if(!output.includes('LOCK_READY'))reject(Error(error||'lock not obtained'));});});
 child.stdin.end('begin;'+statement+';\n\\echo LOCK_READY\nselect pg_sleep(1);commit;\n');
 await ready;return {complete};
}
test('native PostgreSQL health confirms durable WAL and restricted journal privileges',()=>{
 const h=JSON.parse(sql("set role service_role;select public.orulo_audit_control('health');"));
 assert.equal(h.durable,true);assert.equal(h.synchronousCommit,'on');assert.equal(h.writeEnabled,false);
});
test('overlapping run lock rejects a second session instead of racing the sequence',async()=>{
 const lock=await heldLock(`select pg_advisory_xact_lock(hashtextextended('${run}',0))`);
 assert.throws(()=>append('append',{type:'READ_ONLY_PREFLIGHT'}),e=>String(e.stderr).includes('AUDIT_CONCURRENT_ACCESS'));
 await lock.complete;append('append',{type:'READ_ONLY_PREFLIGHT'});
});
test('competing same-sequence appends allow exactly one committed event',async()=>{
 const seq=head.sequence+1,previous=head.hash;
 const command=()=>`set role service_role;select public.orulo_audit_control('append','${run}',${seq},'${previous}',${quote({type:'CLIENT_READBACK',eventUuid:randomUUID()})});`;
 const invoke=()=>new Promise(resolve=>{const c=spawn('psql',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.on('exit',code=>resolve({code,stdout,stderr}));c.stdin.end(command());});
 const results=await Promise.all([invoke(),invoke()]);
 assert.equal(results.filter(r=>r.code===0).length,1);assert.match(results.find(r=>r.code!==0).stderr,/AUDIT_CONCURRENT_ACCESS|AUDIT_SEQUENCE_CONFLICT/);
 head=JSON.parse(results.find(r=>r.code===0).stdout);
});
test('CAS waits for concurrent row writer, compares whole row and commits CONFLICT audit without overwriting',async()=>{
 append('snapshot',{kind:'BASELINE_V2'});
 head=JSON.parse(sql(`select orulo_audit.admin_event('${run}','WRITE_AUTHORIZED','synthetic concurrency test');`));
 const expected=JSON.parse(sql(`select to_jsonb(p) from public.properties p where id='${id}';`)),op=randomUUID();
 append('append',{type:'INTENT',operationId:op,id,expected,desiredPlans:[{id:'p',image_url:'https://example.invalid/plan.jpg'}]});
 const lock=await heldLock(`update public.properties set price=200 where id='${id}'`);
 const result=JSON.parse(sql(`set role service_role;select public.orulo_audited_cas('${run}','${op}');`));
 await lock.complete;assert.equal(result.status,'CONFLICT');
 const after=JSON.parse(sql(`select to_jsonb(p) from public.properties p where id='${id}';`));assert.equal(after.price,200);assert.equal(after.updated_at,expected.updated_at);assert.equal(after.raw_data.building.floor_plans[0].image_url,undefined);
 const recovery=rpc('recover',null,null,{operationId:op});assert.equal(recovery.result.result.status,'CONFLICT');
 assert.throws(()=>sql(`set role service_role;select public.orulo_audited_cas('${run}','${op}');`),e=>String(e.stderr).includes('DUPLICATE_OPERATION'));
 head=result.auditReceipt;
});
test('committed CAS survives connection loss: fresh session recovers once without repeating mutation',()=>{
 const expected=JSON.parse(sql(`select to_jsonb(p) from public.properties p where id='${id}';`)),op=randomUUID();
 append('append',{type:'INTENT',operationId:op,id,expected,desiredPlans:[{id:'p',image_url:'https://example.invalid/recovered.jpg'}]});
 // Suppress the CAS response completely, COMMIT, then close this connection.
 sql(`set role service_role;begin;do $$begin perform public.orulo_audited_cas('${run}','${op}');end$$;commit;`);
 const recovery=rpc('recover',null,null,{operationId:op});assert.equal(recovery.result.result.status,'UPDATED');
 const after=JSON.parse(sql(`select to_jsonb(p) from public.properties p where id='${id}';`));
 assert.equal(after.raw_data.building.floor_plans[0].image_url,'https://example.invalid/recovered.jpg');assert.equal(after.price,200);
 assert.throws(()=>sql(`set role service_role;select public.orulo_audited_cas('${run}','${op}');`),e=>String(e.stderr).includes('DUPLICATE_OPERATION'));
 assert.deepEqual(JSON.parse(sql(`select to_jsonb(p) from public.properties p where id='${id}';`)),after);
});
