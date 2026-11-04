// Real multi-session PostgreSQL test; deliberately impossible to target the production project.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {APPROVED_SHA,MANIFEST_HASH} from './orulo-media-recovery-postgres.mjs';
import {storagePreflight} from './orulo-media-recovery-actions.mjs';
import {executePilot,PILOT_BUILDING_ID} from './orulo-media-recovery-pilot.mjs';
if(process.env.ORULO_SYNTHETIC_PG!=='true' || process.env.PGHOST!=='127.0.0.1' || process.env.PGDATABASE!=='orulo_audit_test')throw Error('ISOLATED_LOCAL_TEST_DATABASE_REQUIRED');
const args=['-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=s=>execFileSync('psql',args,{input:s,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const quote=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const id='00000000-0000-0000-0000-000000000001',run=randomUUID();
sql(`create role anon;create role authenticated;create role service_role;
create table public.properties(id uuid primary key,external_id text,source text,state text,active boolean,raw_data jsonb,price numeric,created_at timestamptz,updated_at timestamptz);
grant usage on schema public to service_role,anon,authenticated;
alter table public.properties enable row level security;
insert into public.properties values('${id}','fixture','novos','SP',true,'{"building_id":"43126","building":{"floor_plans":[{"id":"p"}]}}',100,'2026-01-01','2026-01-02');`);
sql(readFileSync(new URL('../supabase/migrations/20261104093722_orulo_postgres_audit.sql',import.meta.url),'utf8'));
sql(readFileSync(new URL('../supabase/migrations/20261104102956_orulo_paged_snapshots.sql',import.meta.url),'utf8'));
const rpc=(action,sequence=null,hash=null,event={})=>JSON.parse(sql(`set role service_role;select public.orulo_audit_control('${action}','${run}',${sequence??'null'},${hash===null?'null':"'"+hash+"'"},${quote(event)});`));
let head=rpc('start',null,null,{eventUuid:randomUUID(),repository:'mudeisp/ynteligencia',actor:'mudeisp',actorId:'323805541',triggeringActor:'mudeisp',eventName:'workflow_dispatch',ref:'refs/heads/main',attempt:'1',githubRunId:'12345',workflowSha:'a'.repeat(40),approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH});
function append(action,event){
 if(action==='snapshot'){
  append('snapshot_begin',event);const e=rpc('read',head.sequence);
  for(let offset=0;offset<e.event.keys.length;offset+=50)append('snapshot_page',{...event,offset,size:50});
  return append('snapshot_seal',event);
 }
 return head=rpc(action,head.sequence+1,head.hash,{eventUuid:randomUUID(),...event});
}
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
test('21,646 large synthetic rows: full baseline/readback fit bounded page statements, hashes and UUID coverage match',()=>{
 sql(`select orulo_audit.admin_event('${run}','ABORTED','synthetic run fully reconciled',true);truncate public.properties;
 insert into public.properties select md5(g::text)::uuid,'fixture-'||g,'novos','SP',true,
 jsonb_build_object('building_id','43126','payload',repeat(md5(g::text),512),'building',jsonb_build_object('floor_plans',jsonb_build_array(jsonb_build_object('id','p')))),100,'2026-01-01','2026-01-02' from generate_series(1,21646) g;
 analyze public.properties;`);
 const r=randomUUID(),meta={eventUuid:randomUUID(),repository:'mudeisp/ynteligencia',actor:'mudeisp',actorId:'323805541',triggeringActor:'mudeisp',eventName:'workflow_dispatch',ref:'refs/heads/main',attempt:'1',githubRunId:'12346',workflowSha:'a'.repeat(40),approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH};
 let h=JSON.parse(sql(`set role service_role;select public.orulo_audit_control('start','${r}',null,null,${quote(meta)});`));
 const timings=[];const mutate=(action,event)=>{
  const start=performance.now();h=JSON.parse(sql(`set statement_timeout='8s';set role service_role;select public.orulo_audit_control('${action}','${r}',${h.sequence+1},'${h.hash}',${quote({eventUuid:randomUUID(),...event})});`));timings.push(performance.now()-start);
 };
 const started=performance.now();
 for(const kind of ['BASELINE_V2','READBACK_V2']){
  mutate('snapshot_begin',{kind});
  for(let offset=0;offset<21646;offset+=50)mutate('snapshot_page',{kind,offset,size:50});
  mutate('snapshot_seal',{kind});
 }
 mutate('finish',{});
 const result=JSON.parse(sql(`set role service_role;select public.orulo_audit_control('read','${r}',${h.sequence});`)).event.comparison;
 assert.equal(result.compared,21646);assert.equal(result.contentChanges,0);assert.equal(result.timestampOnly,0);assert.equal(result.insertions,0);assert.equal(result.deletions,0);assert.equal(result.captureStable,true);
 const metrics=JSON.parse(sql(`select jsonb_build_object('records',count(*),'uniqueIds',count(distinct id),'maxPageRows',(select max(event->>'count')::int from orulo_audit.entries where run_uuid='${r}' and kind='SNAPSHOT_PAGE')) from orulo_audit.snapshot_records where run_uuid='${r}';`));
 assert.equal(metrics.records,43292);assert.equal(metrics.uniqueIds,21646);assert.equal(metrics.maxPageRows,50);
 const valid=sql(`select bool_and(e.hash=encode(sha256(convert_to(e.canonical,'UTF8')),'hex') and e.previous_hash=coalesce(p.hash,'')) from orulo_audit.entries e left join orulo_audit.entries p on p.run_uuid=e.run_uuid and p.sequence=e.sequence-1 where e.run_uuid='${r}';`);assert.equal(valid,'t');
 const hashes=sql(`select r.record->>4=md5(c.j::text) and r.record->>5=md5((c.j-'updated_at')::text) from orulo_audit.snapshot_records r join public.properties p using(id) cross join lateral(select to_jsonb(p)||jsonb_build_object('created_at',p.created_at at time zone 'UTC','updated_at',p.updated_at at time zone 'UTC') j)c where r.run_uuid='${r}' and r.kind='BASELINE_V2' limit 1;`);assert.equal(hashes,'t');
 console.log(JSON.stringify({syntheticRows:21646,payloadBytesPerRow:16384,pageSize:50,statements:timings.length,maxStatementMs:Math.round(Math.max(...timings)),totalMs:Math.round(performance.now()-started),dbStatementTimeout:'8s'}));
 assert.ok(Math.max(...timings)<8000);
});
test('actual page statement_timeout rolls back its audit fragment; a fresh connection sees partial capture and no reuse',()=>{
 const r=randomUUID(),meta={eventUuid:randomUUID(),repository:'mudeisp/ynteligencia',actor:'mudeisp',actorId:'323805541',triggeringActor:'mudeisp',eventName:'workflow_dispatch',ref:'refs/heads/main',attempt:'1',githubRunId:'12347',workflowSha:'a'.repeat(40),approvedSha:APPROVED_SHA,manifestHash:MANIFEST_HASH};
 let h=JSON.parse(sql(`set role service_role;select public.orulo_audit_control('start','${r}',null,null,${quote(meta)});`));
 h=JSON.parse(sql(`set role service_role;select public.orulo_audit_control('snapshot_begin','${r}',${h.sequence+1},'${h.hash}',${quote({kind:'BASELINE_V2',eventUuid:randomUUID()})});`));
 sql("create function public.timeout_page() returns trigger language plpgsql as $$begin perform pg_sleep(1);return new;end$$;create trigger fixture_timeout before insert on orulo_audit.snapshot_records for each row execute function public.timeout_page()");
 assert.throws(()=>sql(`set statement_timeout='100ms';set role service_role;select public.orulo_audit_control('snapshot_page','${r}',${h.sequence+1},'${h.hash}',${quote({kind:'BASELINE_V2',offset:0,size:1,eventUuid:randomUUID()})});`),e=>String(e.stderr).includes('statement timeout'));
 sql('drop trigger fixture_timeout on orulo_audit.snapshot_records;drop function public.timeout_page()');
 assert.equal(sql(`select count(*) from orulo_audit.snapshot_records where run_uuid='${r}';`),'0');
 assert.equal(sql(`select count(*) from orulo_audit.entries where run_uuid='${r}';`),'2');
 const persisted=JSON.parse(sql(`set role service_role;select public.orulo_audit_control('read','${r}',2);`));assert.equal(persisted.hash,h.hash);
 assert.throws(()=>sql(`set role service_role;select public.orulo_audit_control('start','${randomUUID()}',null,null,${quote({...meta,eventUuid:randomUUID(),githubRunId:'12348'})});`),e=>String(e.stderr).includes('ACTIVE_RUN_REQUIRES_RECONCILIATION'));
});
test('scoped PostgreSQL/client integration: two external changes pass; internal price/stock and unknown deletions block',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8'));
 const inside=manifest[0],outside=['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
 const env={GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:'a'.repeat(40),ORULO_POSTGRES_AUDIT_READY:'true',ORULO_CLIENT_ID:'fixture',ORULO_CLIENT_SECRET:'fixture',SUPABASE_SECRET_KEY:'fixture'};
 let counter=30000;
 async function scenario(change,prepare=''){
  sql("select orulo_audit.admin_event(r.run_uuid,'ABORTED','synthetic interrupted fixture reconciled',true) from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and kind in ('ABORTED','FINISHED'));truncate public.properties;");
  sql(`insert into public.properties(id,external_id,source,state,active,raw_data,price) values
   ('${id}','inside','novos','SP',true,'{"building_id":"${inside}","building":{"stock":7,"floor_plans":[]}}',100),
   ('${outside[0]}','orulo:47422:73063','novos','RS',true,'{"building_id":"47422","building":{"floor_plans":[]}}',100),
   ('${outside[1]}','orulo:47422:73066','novos','RS',true,'{"building_id":"47422","building":{"floor_plans":[]}}',100);`);
  if(prepare)sql(prepare);
  let currentRun,applies=0;
  const transport={control:async(a,p={})=>{
   if(a==='start')currentRun=p.p_run;
   if(a==='snapshot_begin' && p.p_event.kind==='READBACK_V2')sql(change);
   return JSON.parse(sql(`set role service_role;select public.orulo_audit_control('${a}',${p.p_run?"'"+p.p_run+"'":'null'},${p.p_sequence??'null'},${p.p_previous_hash==null?'null':"'"+p.p_previous_hash+"'"},${quote(p.p_event||{})});`));
  },apply:async()=>{applies++;throw Error('must not write');}};
  let result,error;try{result=await storagePreflight({...env,GITHUB_RUN_ID:String(++counter)},transport,()=>{});}catch(e){error=e;}
  const review=JSON.parse(sql(`select event->'scopeReview' from orulo_audit.entries where run_uuid='${currentRun}' and kind='CLIENT_READBACK';`));
  assert.equal(applies,0);assert.equal(sql(`select kind from orulo_audit.entries where run_uuid='${currentRun}' order by sequence desc limit 1;`),'FINISHED');
  return {result,error,review};
 }
 const external=await scenario(`update public.properties set price=101 where id in ('${outside[0]}','${outside[1]}');`);
 assert.equal(external.result.status,'READ_ONLY_PREFLIGHT_PASSED_WITH_OUT_OF_SCOPE_CHANGES');assert.equal(external.review.counts.OUT_OF_SCOPE.contentChanges,2);assert.equal(external.review.counts.IN_SCOPE.contentChanges,0);
 assert.equal(external.review.changes[0].before.buildingId,'47422');assert.ok(external.review.changes[0].after.fullHash);
 for(const change of [`update public.properties set price=102 where id='${id}';`,`update public.properties set raw_data=jsonb_set(raw_data,'{building,stock}','8') where id='${id}';`]){
  const insideResult=await scenario(change);assert.match(insideResult.error.message,/REVIEW_REQUIRED/);assert.equal(insideResult.review.counts.IN_SCOPE.contentChanges,1);
 }
 const unknown=await scenario(`update public.properties set raw_data='{}' where id='${outside[0]}';delete from public.properties where id='${outside[1]}';`);
 assert.match(unknown.error.message,/REVIEW_REQUIRED/);assert.equal(unknown.review.counts.UNKNOWN.contentChanges,1);
 assert.equal(unknown.review.changes.find(c=>c.type==='deletions').before.buildingId,'47422');
 const deletion=await scenario(`delete from public.properties where id='${outside[1]}';`,`update public.properties set raw_data='{}' where id='${outside[1]}';`);
 assert.match(deletion.error.message,/REVIEW_REQUIRED/);assert.equal(deletion.review.counts.UNKNOWN.deletions,1);
 const insertion=await scenario("insert into public.properties(id,raw_data) values('00000000-0000-0000-0000-000000000004','{}');");
 assert.match(insertion.error.message,/REVIEW_REQUIRED/);assert.equal(insertion.review.counts.UNKNOWN.insertions,1);
});
test('operational pilot on real PostgreSQL: scoped atomic updates, actual concurrent row lock and lost commit ACK',async()=>{
 sql(readFileSync(new URL('../supabase/migrations/20261104114348_orulo_pilot_authorization.sql',import.meta.url),'utf8'));
 let attempt=40000;
 async function scenario(mode){
  sql("select orulo_audit.admin_event(r.run_uuid,'ABORTED','synthetic pilot reconciled',true) from orulo_audit.runs r where not exists(select 1 from orulo_audit.entries e where e.run_uuid=r.run_uuid and kind in ('ABORTED','FINISHED'));truncate public.properties;");
  for(const pk of [id,'00000000-0000-0000-0000-000000000002'])sql(`insert into public.properties values('${pk}','pilot-fixture','novos','SP',true,'{"building_id":"${PILOT_BUILDING_ID}","photos":["photo"],"building":{"stock":7,"videos":["video"],"tour":"tour","floor_plans":[{"id":"p","description":"original"}]}}',100,'2026-01-01','2026-01-02');`);
  const env={GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ID:String(++attempt),GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:'a'.repeat(40),ORULO_PILOT_APPROVED_SHA:'a'.repeat(40),ORULO_PILOT_READY:'true',ORULO_POSTGRES_AUDIT_READY:'true',ORULO_CLIENT_ID:'fixture',ORULO_CLIENT_SECRET:'fixture',SUPABASE_SECRET_KEY:'fixture'};
  let calls=0,pilotRun,result,error;
  const transport={control:async(a,p={})=>{
   if(a==='start')pilotRun=p.p_run;
   return JSON.parse(sql(`set role service_role;select public.orulo_audit_control('${a}',${p.p_run?"'"+p.p_run+"'":'null'},${p.p_sequence??'null'},${p.p_previous_hash==null?'null':"'"+p.p_previous_hash+"'"},${quote(p.p_event||{})});`));
  },apply:async(r,op)=>{
   calls++;let lock;
   if(mode==='conflict')lock=await heldLock(`update public.properties set price=200 where id='${id}'`);
   const result=JSON.parse(sql(`set role service_role;select public.orulo_audited_cas('${r}','${op}');`));
   if(lock)await lock.complete;if(mode==='lost')throw Error('lost ACK after actual commit');return result;
  }};
  try{result=await executePilot({env,transport,fetchPlans:async()=>[{id:'p',image_url:'https://example.invalid/plan.jpg'}],checkImage:async()=>{},onPlan:async p=>{
   sql(`select orulo_audit.authorize_pilot('${p.runUuid}','${p.headHash}','${p.githubRunId}','${p.controlSha}','synthetic explicit owner authorization');`);
  }});}catch(e){error=e;}
  const events=JSON.parse(sql(`select jsonb_agg(jsonb_build_object('kind',kind,'event',event) order by sequence) from orulo_audit.entries where run_uuid='${pilotRun}';`));
  return {result,error,calls,events};
 }
 const success=await scenario('success');if(success.error)throw success.error;
 assert.equal(success.result.rowsWritten,2);assert.equal(success.result.buildings,1);assert.equal(success.events.at(-1).kind,'FINISHED');
 assert.equal(sql("select bool_and(price=100 and raw_data->'building'->>'stock'='7' and raw_data->'building'->'floor_plans'->0->>'description'='original') from public.properties;"),'t');
 const conflict=await scenario('conflict');assert.match(conflict.error.message,/STOP_CONFLICT/);assert.equal(conflict.calls,1);assert.equal(conflict.events.find(e=>e.kind==='CAS_RESULT').event.result.status,'CONFLICT');
 const lost=await scenario('lost');assert.match(lost.error.message,/COMMITTED_RECONCILE_REQUIRED/);assert.equal(lost.calls,1);assert.equal(lost.events.filter(e=>e.kind==='CAS_RESULT').length,1);
 assert.equal(sql("select raw_data->'building'->'floor_plans'->0 ? 'image_url' from public.properties where id='00000000-0000-0000-0000-000000000002';"),'f');
});
test('indexed pilot lookup on 21,646 rows preserves COALESCE/null/empty/conflicting semantics and private ACL',()=>{
 sql(`truncate public.properties;
 insert into public.properties select md5(g::text)::uuid,'lookup-'||g,
 case when g=25 then 'used' else 'novos' end,case when g=24 then 'RS' else 'SP' end,
 case when g=23 then false when g=26 then null else true end,
 jsonb_build_object('building_id',case when g<=18 or g between 23 and 26 then '43126' when g in (19,20) then null when g=22 then '' else '12345' end,
 'building',jsonb_build_object('id',case when g between 19 and 22 then '43126' else '12345' end),'payload',repeat(md5(g::text),64)),100,'2026-01-01','2026-01-02'
 from generate_series(1,21646)g;
 update public.properties set raw_data=raw_data-'building_id' where external_id='lookup-20';
 create index properties_portal_building_id_idx on public.properties((raw_data->>'building_id')) where active is true and source='novos';
 analyze public.properties;`);
 const reference=JSON.parse(sql("select orulo_audit.pilot_targets();"));assert.equal(reference.length,20);
 const migration=readFileSync(new URL('../supabase/migrations/20261104135027_orulo_pilot_indexed_targets.sql',import.meta.url),'utf8');
 sql(migration);
 const started=performance.now(),actual=JSON.parse(sql("set statement_timeout='8s';set role service_role;select public.orulo_audit_control('pilot_targets');"));
 assert.deepEqual(actual,reference);assert.ok(performance.now()-started<8000);
 const body=migration.match(/as \$\$\n([\s\S]*?)\n\$\$/)[1];
 const plan=sql("set role orulo_audit_owner;explain (analyze,buffers,format json) "+body);
 assert.match(plan,/properties_portal_building_id_idx/);assert.doesNotMatch(plan,/Seq Scan/);
 assert.equal(sql("select has_schema_privilege('service_role','orulo_audit','USAGE') or has_function_privilege('service_role','orulo_audit.pilot_targets()','EXECUTE') or has_function_privilege('anon','orulo_audit.pilot_targets()','EXECUTE');"),'f');
 console.log(JSON.stringify({indexedLookupRows:21646,selected:actual.length,lookupMs:Math.round(performance.now()-started),timeoutChanged:false}));
});
