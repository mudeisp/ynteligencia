import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readFileSync as readText,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {casFloorPlans,imageOnlyPlans,preserved,openLedger,validateWriteScope} from './orulo-media-cas.mjs';
import {parseArgs,runRecovery} from './orulo-media-recovery.mjs';

const {PGlite} = process.env.PGLITE_MODULE ? await import(process.env.PGLITE_MODULE) :
  createRequire(new URL('../test-support/orulo-cas/package.json',import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const id='00000000-0000-0000-0000-000000000001';
const missing='00000000-0000-0000-0000-000000000099';
const plans=[{id:'p',description:'Original typology',image_url:'https://example.com/plan.jpg',images:['https://example.com/plan.jpg']}];
const raw={building_id:'43126',images:['photo'],building:{id:43126,videos:[{url:'video'}],virtual_tour:'tour',
  stock:5,floor_plans:[{id:'p',description:'Original typology'}]}};
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.properties(
 id uuid primary key,external_id text unique,source text,state text,city text,
 development_name text,active boolean,price numeric,bedrooms int,stock int,
 raw_data jsonb,created_at timestamptz,updated_at timestamptz
);
grant usage on schema public to service_role,anon,authenticated;
grant select,insert,update on public.properties to service_role;
`);
await db.exec(readFileSync(new URL('../supabase/orulo_media_cas.sql',import.meta.url),'utf8'));
async function reset(){
 await db.exec('reset role; truncate public.properties');
 await db.query(`insert into public.properties values ($1,'orulo:43126:unit','novos','SP','São Paulo','Fixture',true,100,2,7,$2,'2026-01-01','2026-01-02')`,[id,JSON.stringify(raw)]);
}
async function row(){
 return (await db.query('select to_jsonb(p) as row from public.properties p where id=$1',[id])).rows[0]?.row;
}
async function rpc(expected,floorPlans=plans,pk=id){
 await db.exec('set role service_role');
 try{return (await db.query('select public.orulo_media_cas($1,$2,$3) as result',[pk,JSON.stringify(expected),JSON.stringify(floorPlans)])).rows[0].result;}
 finally{await db.exec('reset role');}
}
test('SQL CAS success preserves all non-authorized fields',async()=>{
 await reset();const before=await row();const result=await rpc(before);
 assert.equal(result.status,'UPDATED');const after=await row();
 assert.equal(result.receipt.verified,true);
 assert.equal(result.receipt.id,id);
 assert.deepEqual(result.receipt.allowedChangedPaths,['raw_data.building.floor_plans','updated_at']);
 const actual=(await db.query(`select md5(((to_jsonb(p)||jsonb_build_object('created_at',created_at at time zone 'UTC','updated_at',updated_at at time zone 'UTC'))-'updated_at')::text) as hash from public.properties p where id=$1`,[id])).rows[0].hash;
 assert.equal(result.receipt.expectedAfterContentHash,actual);
 assert.notEqual(result.receipt.expectedBeforeContentHash,actual);
 assert.equal(preserved(after),preserved(before));
 assert.deepEqual(after.raw_data.building.floor_plans,plans);
 assert.notEqual(after.updated_at,before.updated_at);
});
test('SQL rejects a concurrent content update even when updated_at did not change',async()=>{
 await reset();const expected=await row();
 await db.query('update public.properties set price=200 where id=$1',[id]);
 assert.equal((await rpc(expected)).status,'CONFLICT');
 assert.equal((await row()).price,200);
 assert.equal((await row()).raw_data.building.floor_plans[0].image_url,undefined);
});
test('SQL missing PK and repeated operation',async()=>{
 await reset();const before=await row();
 assert.equal((await rpc(before,plans,missing)).status,'NOT_FOUND');
 assert.equal((await rpc(before)).status,'UPDATED');
 const after=await row();
 assert.equal((await rpc(before)).status,'UNCHANGED');
 assert.deepEqual(await row(),after);
});
test('SQL stale second writer with a different image cannot overwrite the first',async()=>{
 await reset();const before=await row();await rpc(before);
 assert.equal((await rpc(before,[{...plans[0],image_url:'https://example.com/other.jpg'}])).status,'CONFLICT');
 assert.equal((await row()).raw_data.building.floor_plans[0].image_url,plans[0].image_url);
});
test('SQL cannot change descriptions, plan order/count, price or other fields',async()=>{
 await reset();const before=await row();
 await assert.rejects(rpc(before,[{...plans[0],description:'Unauthorized'}]),/IMAGE_FIELDS_ONLY/);
 await assert.rejects(rpc(before,[...plans,plans[0]]),/IMAGE_FIELDS_ONLY/);
 assert.equal((await rpc({...before,price:999})).status,'CONFLICT');
 assert.deepEqual(await row(),before);
});
test('SQL enforces service_role and database-side SP batch scope',async()=>{
 await reset();const before=await row();
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{await assert.rejects(db.query('select public.orulo_media_cas($1,$2,$3)',[id,JSON.stringify(before),JSON.stringify(plans)]),/permission denied/);}
  finally{await db.exec('reset role');}
 }
 for(const [field,value] of [['state','ES'],['source','other'],['active',false]]){
  await reset();await db.query('update public.properties set '+field+'=$1 where id=$2',[value,id]);
  await assert.rejects(rpc(await row()),/SCOPE_DENIED/);
 }
 await reset();await db.query(`update public.properties set raw_data=jsonb_set(raw_data,'{building_id}','"86644"') where id=$1`,[id]);
 await assert.rejects(rpc(await row()),/SCOPE_DENIED/);
 const metadata=(await db.query(`select prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') as anon_exec,has_function_privilege('authenticated',oid,'EXECUTE') as auth_exec from pg_proc where proname='orulo_media_cas'`)).rows[0];
 assert.equal(metadata.prosecdef,false);assert.equal(metadata.anon_exec,false);assert.equal(metadata.auth_exec,false);
 assert.ok(metadata.proconfig.some(v=>v.startsWith('search_path=')));
});
test('SQL rolls back trigger-induced changes to protected fields',async()=>{
 await reset();const before=await row();
 await db.exec(`create function public.test_bad_trigger() returns trigger language plpgsql as $$begin new.price=999;return new;end$$;
 create trigger test_bad before update on public.properties for each row execute function public.test_bad_trigger();`);
 try{await assert.rejects(rpc(before),/PRESERVATION_FAILED/);assert.deepEqual(await row(),before);}
 finally{await db.exec('drop trigger test_bad on public.properties; drop function public.test_bad_trigger()');}
});
function transport({timeoutAfter=false,timeoutBefore=false,concurrent=false,afterChange=false}={}){
 const calls=[];let intentRecorded=false;
 const events=[];
 const record=async event=>{events.push(event);if(event.type==='INTENT')intentRecorded=true;};
 const fetchImpl=async(url,options={})=>{
  calls.push({url,method:options.method??'GET'});
  assert.notEqual(options.method,'PATCH');
  if(options.method==='POST'){
   assert.ok(intentRecorded,'Intent must be durable before mutation');
   if(timeoutBefore)throw new Error('timeout before response');
   const p=JSON.parse(options.body);
   if(concurrent)await db.query('update public.properties set price=300 where id=$1',[id]);
   const result=await rpc(p.p_expected,p.p_floor_plans,p.p_id);
   if(afterChange)await db.query('update public.properties set price=400 where id=$1',[id]);
   if(timeoutAfter)throw new Error('timeout after commit');
   return {ok:true,json:async()=>result};
  }
  return {ok:true,json:async()=>{const current=await row();return current?[current]:[];}};
 };
 return {fetchImpl,record,calls,events};
}
const call=t=>casFloorPlans({id,buildingId:'43126',livePlans:plans,...t,url:'https://fixture.invalid',key:'test-only'});
test('client fresh read -> RPC -> readback; durable intent and known result',async()=>{
 await reset();const t=transport();const result=await call(t);
 assert.equal(result.status,'UPDATED');
 assert.deepEqual(t.calls.map(c=>c.method),['GET','POST','GET']);
 assert.deepEqual(t.events.map(e=>e.type),['INTENT','RESULT']);
});
test('client timeout after commit resolves through readback without retry or false attribution',async()=>{
 await reset();const t=transport({timeoutAfter:true});const result=await call(t);
 assert.equal(result.status,'UNCHANGED');assert.equal(result.ambiguousResponse,true);
 assert.equal(result.resolution,'EXPECTED_STATE_OBSERVED_ACTOR_UNPROVEN');
 assert.equal(t.calls.filter(c=>c.method==='POST').length,1);
 assert.equal((await row()).raw_data.building.floor_plans[0].image_url,plans[0].image_url);
});
test('client ambiguous timeout without observed commit stays blocked; no automatic retry',async()=>{
 await reset();const t=transport({timeoutBefore:true});const result=await call(t);
 assert.equal(result.status,'AMBIGUOUS');assert.equal(t.calls.filter(c=>c.method==='POST').length,1);
 assert.equal((await row()).raw_data.building.floor_plans[0].image_url,undefined);
});
test('client concurrent update returns conflict and never overwrites it',async()=>{
 await reset();const t=transport({concurrent:true});assert.equal((await call(t)).status,'CONFLICT');
 assert.equal((await row()).price,300);
});
test('client unexplained post-write readback divergence halts immediately',async()=>{
 await reset();const t=transport({afterChange:true});
 await assert.rejects(call(t),/STOP_POST_WRITE_DIVERGENCE/);
 assert.equal(t.calls.filter(c=>c.method==='POST').length,1);
 assert.equal(t.events.at(-1).type,'POST_WRITE_DIVERGENCE');
});
test('image enrichment preserves all declared plans and metadata',()=>{
 const result=imageOnlyPlans(raw,[{...plans[0],description:'Live description must not overwrite',id:'p'},{id:'new',image_url:'new'}]);
 assert.equal(result.length,1);assert.equal(result[0].description,'Original typology');assert.equal(result[0].image_url,plans[0].image_url);
});
test('explicit authorized list is mandatory before any network call',async()=>{
 for(const args of [
 {write:true,states:['SP'],buildingId:'43126'},
 {write:true,states:['SP'],buildingIds:['86644']},
 {write:true,states:['ES'],buildingIds:['43126']}
 ])await assert.rejects(runRecovery({args,fetchImpl:()=>assert.fail('network must not run')}),/CAS_EXPLICIT_AUTHORIZED_IDS_REQUIRED/);
 assert.deepEqual(parseArgs(['--building-ids=43126,43126']).buildingIds,['43126']);
 for(const argv of [['--building-ids='],['--building-ids=43126,'],['--building-id=43126','--building-ids=4969']])
  assert.throws(()=>parseArgs(argv));
 validateWriteScope({states:['SP'],buildingIds:['43126']});
});
test('ledger is exclusive, durable and reusable only through explicit manual reconciliation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'orulo-cas-')),path=join(dir,'ledger.jsonl');
 const ledger=openLedger(path);
 try{
  await ledger({type:'INTENT',id});
  assert.equal(JSON.parse(readText(path,'utf8').trim()).type,'INTENT');
  assert.throws(()=>openLedger(path),/EEXIST/);
 }finally{ledger.close();unlinkSync(path);rmdirSync(dir);}
});

test('SQL timestamp-only concurrent update is a conflict, not a version-only proof',async()=>{
 await reset();const expected=await row();
 await db.query("update public.properties set updated_at=updated_at+interval '1 second' where id=$1",[id]);
 assert.equal((await rpc(expected)).status,'CONFLICT');
});
test('client post-commit readback failure stays ambiguous without a retry',async()=>{
 await reset();const t=transport();let gets=0;
 const underlying=t.fetchImpl;
 t.fetchImpl=async(url,options={})=>{
  if(!options.method && ++gets===2)throw Error('readback timeout');
  return underlying(url,options);
 };
 const result=await call(t);
 assert.equal(result.status,'AMBIGUOUS');assert.equal(result.confirmedRpcStatus,'UPDATED');
 assert.equal(t.calls.filter(c=>c.method==='POST').length,1);
});
test('client refuses mutation if the durable intent cannot be saved',async()=>{
 await reset();const t=transport();
 t.record=async()=>{throw Error('disk full');};
 await assert.rejects(call(t),/disk full/);
 assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
});
test('client missing row is recorded without a mutating request',async()=>{
 await reset();await db.query('delete from public.properties where id=$1',[id]);
 const t=transport();const result=await call(t);
 assert.equal(result.status,'NOT_FOUND');
 assert.equal(t.events.at(-1).status,'NOT_FOUND');
 assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
});

test.after(async()=>{await db.close();});

