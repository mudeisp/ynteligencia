import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {PILOT_5971,UUID_5971,PROPOSAL_5971_SHA,proposal5971,manifest5971,entry5971,validate5971Row,source5971} from './orulo-media-recovery-5971.mjs';
import {executeBatch,loadBatch,batchCatalog} from './orulo-media-recovery-batch.mjs';
const {PGlite}=process.env.PGLITE_MODULE?await import(process.env.PGLITE_MODULE):createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const sql=readFileSync(new URL('../supabase/orulo_pilot_5971.sql',import.meta.url),'utf8');
let count=700000;
async function fixture(t,options={}){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table public.properties(id uuid primary key,external_id text,source text,state text,active boolean,raw_data jsonb,price numeric,stock int,created_at timestamptz,updated_at timestamptz);
 grant usage on schema public to service_role,anon,authenticated;alter table public.properties enable row level security;`);
 for(const name of ['20261104093722_orulo_postgres_audit.sql','20261104102956_orulo_paged_snapshots.sql','20261104114348_orulo_pilot_authorization.sql','20261104135027_orulo_pilot_indexed_targets.sql','20261104151850_orulo_manifest_batches.sql','20261105170248_orulo_manifest_batches.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const catalog=(await db.query('select orulo_audit.batch_catalog() c')).rows[0].c;
 // A closed historical receipt is present before installing the adaptation.
 await db.query(`insert into orulo_audit.runs(run_uuid,github_run_id,metadata) values('00000000-0000-4000-8000-000000000109','109','{}')`);
 await db.query(`select orulo_audit.append('00000000-0000-4000-8000-000000000109',1,'',jsonb_build_object('type','START','eventUuid',gen_random_uuid()))`);
 await db.query(`select orulo_audit.admin_event('00000000-0000-4000-8000-000000000109','ABORTED','historical synthetic confirmed receipt',true)`);
 const historical=(await db.query('select * from orulo_audit.entries order by run_uuid,sequence')).rows;
 await db.exec(sql);
 assert.deepEqual((await db.query('select * from orulo_audit.entries order by run_uuid,sequence')).rows,historical);
 const extended=(await db.query('select orulo_audit.batch_catalog() c')).rows[0].c;delete extended.batches[PILOT_5971];assert.deepEqual(extended,catalog);
 const original={id:UUID_5971,external_id:'orulo:5971:14292',source:'novos',state:'SP',active:true,price:469000,stock:41,raw_data:{building_id:'5971',photos:['photo'],building:{id:'5971',stock:41,status:'Pronto novo',videos:['video'],tour:'tour',floor_plans:['251614','251615'].map(id=>({id,description:'preserve',associations:{typologies:[]}}))}},created_at:'2026-01-01',updated_at:'2026-01-02'};
 const seed=structuredClone(original);options.seed?.(seed);
 await db.query('insert into public.properties select * from jsonb_populate_record(null::public.properties,$1)',[JSON.stringify(seed)]);
 const before=(await db.query('select to_jsonb(p) row from public.properties p')).rows[0].row;
 const env={GITHUB_REPOSITORY:'mudeisp/ynteligencia',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'mudeisp',GITHUB_ACTOR_ID:'323805541',GITHUB_TRIGGERING_ACTOR:'mudeisp',GITHUB_RUN_ID:String(++count),GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:'a'.repeat(40),ORULO_BATCH_APPROVED_SHA:'a'.repeat(40),ORULO_BATCH_READY:'true',ORULO_BATCH_ID:PILOT_5971,ORULO_POSTGRES_AUDIT_READY:'true',ORULO_CLIENT_ID:'fixture',ORULO_CLIENT_SECRET:'fixture',SUPABASE_SECRET_KEY:'fixture'};
 const calls=[];let run,plan,result,error,applyError;
 const service=async(query,args)=>{await db.exec('set role service_role');try{return(await db.query(query,args)).rows[0]?.r;}finally{await db.exec('reset role');}};
 const transport={control:async(action,params={})=>{
  calls.push(action);if(action==='start')run=params.p_run;
  if(action==='health')return{version:2,snapshotProtocol:'paged-v2',batchProtocol:1,batchMasterHash:batchCatalog.masterHash,storage:'postgres',durable:true,appendOnly:true,synchronousCommit:'on',writeEnabled:false};
  if(action==='append'&&params.p_event.type==='CLIENT_READBACK'&&params.p_event.stage==='BATCH_PLAN')options.planEvent?.(params.p_event);
  if(action==='append'&&params.p_event.type==='INTENT')options.intent?.(params.p_event);
  await options.beforeControl?.(action,params,{db,run});
  return service('select public.orulo_audit_control($1,$2,$3,$4,$5) r',[action,params.p_run??null,params.p_sequence??null,params.p_previous_hash??null,JSON.stringify(params.p_event||{})]);
 },apply:async(r,operation)=>{
  calls.push('CAS');await options.beforeApply?.({db,run:r,operation});
  if(options.failBeforeCommit)throw Error('synthetic response uncertain before commit');
  let value;try{value=await service('select public.orulo_audited_cas($1,$2) r',[r,operation]);}catch(e){applyError=e;throw e;}
  if(options.loseAck)throw Error('synthetic response lost after commit');return value;
 }};
 try{result=await executeBatch({env,transport,fetchPlans:async()=>proposal5971().proposal.targets[0].patches.map(p=>({...p,images:['https://untrusted.invalid/provider-extra.jpg'],description:'provider must not replace metadata'})),checkImage:options.checkImage|| (async()=>({format:'jpeg'})),
  onPlan:async p=>{plan=p;await options.beforeAuthorization?.({db,run,plan:p});
   await db.query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5)',[run,p.headHash,env.GITHUB_RUN_ID,env.GITHUB_WORKFLOW_SHA,'explicit synthetic one-building authorization']);
   await options.afterAuthorization?.({db,run,plan:p});},wait:async()=>{},now:(()=>{let n=0;return()=>n+=600001;})()});}catch(e){error=e;}
 const after=(await db.query('select to_jsonb(p) row from public.properties p')).rows[0].row;
 const receipts=(await db.query("select * from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[run??null])).rows;
 assert.deepEqual((await db.query('select * from orulo_audit.entries where run_uuid=$1 order by sequence',['00000000-0000-4000-8000-000000000109'])).rows,historical);
 return{db,env,run,plan,result,error,applyError,calls,before,after,receipts,service,transport};
}
test('exact proposal bytes, building, UUID and plan IDs are immutable; tampered hash rejected',()=>{
 assert.equal(proposal5971().proposalHash,PROPOSAL_5971_SHA);assert.equal(entry5971().hash,'7b05ead9d4583ae07682ffda7d52fe490ca7450710879d2066b1cea467e7f188');
 assert.deepEqual(loadBatch(PILOT_5971),manifest5971());assert.equal(Object.keys(batchCatalog.batches).length,4);
 assert.throws(()=>proposal5971(Buffer.from(proposal5971().proposalText+' ')),/HASH_MISMATCH/);
 for(const change of [{id:'00000000-0000-4000-8000-000000000001'},{raw_data:{building_id:'1',building:{floor_plans:[{id:'251614'},{id:'251615'}]}}}])assert.throws(()=>validate5971Row({...{id:UUID_5971,state:'SP',source:'novos',active:true,raw_data:{building_id:'5971',building:{floor_plans:[{id:'251614'},{id:'251615'}]}}},...change}));
});
test('source identity and image URLs are fixed; no other provider fields enter patches',async()=>{
 const source=source5971(async()=>proposal5971().proposal.targets[0].patches.map(p=>({...p,price:0,images:['https://attacker.invalid/']})));
 assert.deepEqual(await source('5971'),proposal5971().proposal.targets[0].patches);await assert.rejects(source('5972'));
 await assert.rejects(source5971(async()=>[{id:'wrong',image_url:'https://attacker.invalid/'}])('5971'),/IMAGE_CHANGED/);
});
test('one exact UUID receives two image_url fields with audited receipt/readback; historical events unchanged',async t=>{
 const f=await fixture(t);if(f.error)throw f.error;assert.equal(f.result.rowsWritten,1);assert.equal(f.result.recoveredImageOccurrences,2);assert.equal(f.calls.filter(c=>c==='CAS').length,1);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].event.result.receipt.verified,true);
 const after=structuredClone(f.after);delete after.updated_at;for(const p of after.raw_data.building.floor_plans)delete p.image_url;const before=structuredClone(f.before);delete before.updated_at;assert.deepEqual(after,before);
 assert.equal(f.after.price,469000);assert.equal(f.after.stock,41);assert.deepEqual(f.after.raw_data.building.videos,['video']);assert.equal(f.after.updated_at,f.before.updated_at);
 for(const role of ['anon','authenticated','service_role']){await f.db.exec('set role '+role);await assert.rejects(f.db.query('select orulo_audit.cas_core($1,$2,$3)',[UUID_5971,JSON.stringify(f.before),'[]']),/permission denied/);await f.db.exec('reset role');}
});
test('wrong UUID, building or plant in the current row cannot be authorized',async t=>{
 for(const seed of [r=>r.id='00000000-0000-4000-8000-000000000001',r=>r.raw_data.building_id='1',r=>r.raw_data.building.floor_plans.push({id:'outside'})]){const f=await fixture(t,{seed});assert.ok(f.error);assert.equal(f.calls.includes('CAS'),false);assert.deepEqual(f.after,f.before);}
});
test('forged proposal hash, content, UUID, plan and non-image fields fail before any CAS',async t=>{
 for(const planEvent of [e=>e.proposalHash='0'.repeat(64),e=>e.proposalText+=' ',e=>e.targets[0].id='00000000-0000-4000-8000-000000000001',e=>e.targets[0].patches[0].id='outside',e=>e.targets[0].patches[0].images=['https://attacker.invalid/']]){
  const f=await fixture(t,{planEvent});assert.ok(f.error);assert.equal(f.calls.includes('CAS'),false);assert.deepEqual(f.after,f.before);
 }
});
test('price or stock change after plan blocks authorization rather than accepting stale snapshot',async t=>{
 for(const column of ['price','stock']){const f=await fixture(t,{beforeAuthorization:({db})=>db.exec('update public.properties set '+column+'='+column+'+1')});assert.match(f.error.message,/APPROVED_STATE_CHANGED/);assert.equal(f.calls.includes('CAS'),false);assert.ok(f.after.raw_data.building.floor_plans.every(p=>!p.image_url));}
});
test('concurrent commercial change after authorization blocks pre-CAS and preserves it',async t=>{
 const f=await fixture(t,{afterAuthorization:({db})=>db.exec('update public.properties set price=price+1')});assert.match(f.error.message,/APPROVED_STATE_CHANGED/);assert.equal(f.calls.includes('CAS'),false);assert.equal(f.after.price,469001);
});
test('forged stale expected row, metadata or extra image field in durable INTENT cannot bypass server checks',async t=>{
 for(const intent of [e=>e.expected.price=1,e=>e.expected.raw_data.building.stock=1,e=>e.desiredPlans[0].images=['https://attacker.invalid/'],e=>e.desiredPlans[0].description='overwrite']){const f=await fixture(t,{intent});assert.ok(f.error);assert.deepEqual(f.after,f.before);assert.equal(f.receipts.length,0);}
});
test('row change between INTENT and CAS is a conflict and consumes no unverified success',async t=>{
 const f=await fixture(t,{beforeApply:({db})=>db.exec('update public.properties set price=price+1')});assert.match(f.error.message,/STOP_CONFLICT/);assert.equal(f.after.price,469001);assert.equal(f.receipts[0].event.result.status,'CONFLICT');assert.ok(f.after.raw_data.building.floor_plans.every(p=>!p.image_url));
});
test('repeated administrative authorization and repeated apply are rejected without another mutation',async t=>{
 const f=await fixture(t);if(f.error)throw f.error;
 await assert.rejects(f.db.query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5)',[f.run,f.plan.headHash,f.env.GITHUB_RUN_ID,f.env.GITHUB_WORKFLOW_SHA,'explicit repeated synthetic authorization']));
 await assert.rejects(f.service('select public.orulo_audited_cas($1,$2) r',[f.run,f.receipts[0].operation_uuid]),/CONSUMED|CLOSED|ALREADY/);
 assert.equal((await f.db.query("select count(*) n from orulo_audit.entries where kind='CAS_RESULT'")).rows[0].n,1);
});
test('uncertain acknowledgement after commit recovers durable receipt once without automatic retry',async t=>{
 const f=await fixture(t,{loseAck:true});assert.match(f.error.message,/COMMITTED_RECONCILE_REQUIRED/);assert.equal(f.calls.filter(c=>c==='CAS').length,1);assert.equal(f.receipts.length,1);assert.ok(f.after.raw_data.building.floor_plans.every(p=>p.image_url));
});
test('a new run cannot reuse the consumed recovery even if another actor removes the image fields',async t=>{
 const f=await fixture(t);if(f.error)throw f.error;
 await f.db.query('update public.properties set raw_data=$1',[JSON.stringify(f.before.raw_data)]);
 await assert.rejects(executeBatch({env:{...f.env,GITHUB_RUN_ID:String(++count)},transport:f.transport,
  fetchPlans:async()=>proposal5971().proposal.targets[0].patches,checkImage:async()=>({format:'jpeg'}),
  onPlan:p=>f.db.query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5)',[p.runUuid,p.headHash,p.githubRunId,p.controlSha,'explicit second synthetic authorization'])}),/PREVIOUS_OPERATION_REQUIRES_REVIEW/);
 assert.equal(f.calls.filter(c=>c==='CAS').length,1);
 assert.deepEqual((await f.db.query("select * from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[f.run])).rows,f.receipts);
});
test('a trigger changing updated_at rolls back both images atomically rather than permitting another field',async t=>{
 const f=await fixture(t,{beforeApply:({db})=>db.exec(`create function public.test_stamp() returns trigger language plpgsql as $$ begin new.updated_at:=clock_timestamp();return new;end $$;
 create trigger synthetic_stamp before update on public.properties for each row execute function public.test_stamp();`)});
 assert.match(f.applyError.message,/NON_IMAGE_CHANGE/);assert.match(f.error.message,/AMBIGUOUS_RECONCILE_REQUIRED/);assert.deepEqual(f.after,f.before);assert.equal(f.receipts.length,0);
});
test('uncertain response before commit leaves pending INTENT with no partial image mutation',async t=>{
 const f=await fixture(t,{failBeforeCommit:true});assert.match(f.error.message,/AMBIGUOUS_RECONCILE_REQUIRED/);assert.equal(f.calls.filter(c=>c==='CAS').length,1);assert.equal(f.receipts.length,0);assert.deepEqual(f.after,f.before);
});
test('non-JPEG or failure of the second image stops the complete proposal with zero CAS',async t=>{
 let calls=0;
 for(const checkImage of [async()=>({format:'png'}),async()=>{if(++calls===2)throw Error('synthetic second image unavailable');return{format:'jpeg'};}]){
  const f=await fixture(t,{checkImage});assert.ok(f.error);assert.equal(f.calls.includes('CAS'),false);assert.deepEqual(f.after,f.before);
 }
});
test('divergent readback after commit halts and retains the individual receipt for reconciliation',async t=>{
 let applied=false;const f=await fixture(t,{beforeApply:()=>{applied=true;},beforeControl:async(action,params,{db})=>{if(applied&&action==='batch_row')await db.exec('update public.properties set price=price+1');}});
 assert.match(f.error.message,/POST_WRITE_DIVERGENCE/);assert.equal(f.receipts.length,1);assert.equal(f.calls.filter(c=>c==='CAS').length,1);
});
test('SQL preparation has no property DML, new ledger or production workflow; drift fails closed',async t=>{
 assert.doesNotMatch(sql,/create table|insert into public.properties|update public.properties|delete from public.properties/i);
 const f=await fixture(t);await assert.rejects(f.db.exec(sql),/already exists/);
});
test('the adapted SQL retains the historical batch path and its existing receipt semantics',async t=>{
 const f=await fixture(t);if(f.error)throw f.error;
 const target=loadBatch('phase1-20').targets[0],row={...f.before,id:target.id,external_id:`orulo:${target.buildingId}:fixture`,raw_data:{building_id:target.buildingId,building:{id:target.buildingId,stock:7,floor_plans:target.missingPlanIds.map(id=>({id,description:'legacy metadata'}))}}};
 await f.db.query('insert into public.properties select * from jsonb_populate_record(null::public.properties,$1)',[JSON.stringify(row)]);
 const result=await executeBatch({env:{...f.env,ORULO_BATCH_ID:'phase1-20',GITHUB_RUN_ID:String(++count)},transport:f.transport,
  fetchPlans:async()=>target.missingPlanIds.map(id=>({id,image_url:`https://static.orulo.com.br/images/properties/large/${id}.jpg`})),checkImage:async()=>{},
  onPlan:p=>f.db.query('select orulo_audit.authorize_pilot($1,$2,$3,$4,$5)',[p.runUuid,p.headHash,p.githubRunId,p.controlSha,'explicit synthetic legacy authorization'])});
 assert.equal(result.rowsWritten,1);
 const legacy=(await f.db.query('select to_jsonb(p) row from public.properties p where id=$1',[target.id])).rows[0].row;
 assert.equal(legacy.price,f.before.price);assert.notEqual(legacy.updated_at,row.updated_at);
 assert.deepEqual((await f.db.query("select * from orulo_audit.entries where run_uuid=$1 and kind='CAS_RESULT'",[f.run])).rows,f.receipts);
});
