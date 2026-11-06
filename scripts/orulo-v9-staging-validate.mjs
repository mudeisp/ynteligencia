import {createRequire} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';import {createHash,randomInt} from 'node:crypto';
import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {verifyStagingTarget,verifyProviderEvidence,stagingPoolConfig,cleanSessionQueries} from './orulo-v9-staging-guard.mjs';
import {createTransactionalWebhookWriter} from '../lib/orulo-webhook-provenance.js';
import {syntheticWebhook} from '../test-support/orulo-v9-staging/http-fixture.mjs';

export async function validateStaging({target,ca,passwords,Pool,Client,ci=false,samples=20}){
 verifyStagingTarget(target,{ci});if(!ci)verifyProviderEvidence(target);
 if(!Number.isInteger(samples)||samples<2||samples>100)throw Error('V9_BOUNDED_SAMPLE_REQUIRED');
 if(new Set(Object.values(passwords)).size!==3)throw Error('V9_SEPARATE_PASSWORDS_REQUIRED');
 class ObservedClient extends Client{
  constructor(config){super(config);this.v9Auth={mechanism:null,final:false};
   this.connection.on('authenticationSASLContinue',()=>{this.v9Auth.mechanism=this.saslSession?.mechanism??null;});
   this.connection.on('authenticationSASLFinal',()=>{this.v9Auth.final=true;});
  }
 }
 const pools=Object.fromEntries(['postgres','orulo_webhook_writer','orulo_provenance_reader'].map(role=>[role,new Pool({...stagingPoolConfig(target,role,passwords[role],ca,{ci}),Client:ObservedClient})]));
 const admin=pools.postgres,writer=pools.orulo_webhook_writer,reader=pools.orulo_provenance_reader;
 for(const p of Object.values(pools))p.on('error',()=>{}); // Errors are checked by queries; no secret-bearing error logs.
 const checks=[],check=(name,fn)=>Promise.resolve().then(fn).then(()=>checks.push({name,passed:true}));
 let fixture;const buildingId=String(8100000+randomInt(1,99999));
 const oldId=process.env.ORULO_CLIENT_ID,oldSecret=process.env.ORULO_CLIENT_SECRET;
 try{
  // Read-only preflight before any synthetic write. This does not provision roles.
  const q=await admin.query("select current_database() db,current_user actor,version() version,exists(select 1 from pg_namespace where nspname='orulo_audit') audit");
  assert.equal(q.rows[0].db,target.database);assert.equal(q.rows[0].audit,true);
  const unexpected=await admin.query("select count(*)::int n from public.properties where not(coalesce(development_name,'')='V9 synthetic building' and external_id like 'orulo:8%') and not($1::boolean and external_id='orulo:7000001:1')",[ci]);
  assert.equal(unexpected.rows[0].n,0,'V9_NON_SYNTHETIC_DATA_PRESENT');
  await check('dedicated sessions, real SCRAM exchange and verified TLS',async()=>{for(const [role,p]of Object.entries(pools)){const c=await p.connect();try{const r=await c.query('select session_user u,current_user c,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) ssl');assert.equal(r.rows[0].u,role);assert.equal(r.rows[0].c,role);assert.equal(r.rows[0].ssl,true);assert.equal(c.connection.stream.authorized,true);assert.ok(['SCRAM-SHA-256','SCRAM-SHA-256-PLUS'].includes(c.v9Auth.mechanism));assert.equal(c.v9Auth.final,true);}finally{c.release();}}});
  await check('invalid writer credential is rejected by actual PostgreSQL authentication',async()=>{const wrong=new Pool(stagingPoolConfig(target,'orulo_webhook_writer','deliberately-wrong-v9-probe',ca,{ci}));wrong.on('error',()=>{});try{await assert.rejects(wrong.query('select 1'),error=>error.code==='28P01');}finally{await wrong.end();}});
  await check('writer and reader ACL isolation',async()=>{await assert.rejects(writer.query('select * from orulo_audit.property_transitions'));await assert.rejects(reader.query("select orulo_audit.apply_webhook('1','[]',true,now())"));await assert.rejects(writer.query('set role orulo_provenance_reader'));});
  process.env.ORULO_CLIENT_ID='synthetic-staging-only';process.env.ORULO_CLIENT_SECRET='synthetic-staging-only';
  fixture=await syntheticWebhook({writer:createTransactionalWebhookWriter(cleanSessionQueries(writer)),buildingId});
  const current=async()=>{const r=await admin.query('select * from properties where external_id=$1',[`orulo:${buildingId}:1`]);return r.rows[0];};
  const receipts=async()=>{const r=await admin.query('select count(*)::int n from orulo_audit.property_transitions where id=(select id from properties where external_id=$1)',[`orulo:${buildingId}:1`]);return r.rows[0].n;};
  await check('unsigned HTTP is rejected without writes',async()=>{assert.equal((await fixture.post({authorized:false})).status,403);assert.equal(await current(),undefined);});
  await check('controlled HTTP webhook and source/media identity',async()=>{const r=await fixture.post();assert.equal(r.status,200);assert.equal((await r.json()).processed,true);const row=await current();assert.equal(row.raw_data.building_id,buildingId);assert.equal(String(row.raw_data.building.id),buildingId);assert.equal(row.raw_data.building.floor_plans[0].id,'900001');await fixture.verifyMedia(row.raw_data.building.floor_plans[0].image_url);assert.deepEqual(row.raw_data.building.videos,['synthetic-video']);assert.equal(row.raw_data.building.virtual_tour,'synthetic-tour');});
  await check('duplicate HTTP produces no additional property transition',async()=>{const before=await current(),n=await receipts();assert.equal((await(await fixture.post()).json()).processed,true);assert.deepEqual(await current(),before);assert.equal(await receipts(),n);});
  await check('foreign building and media source responses fail closed',async()=>{const before=await current(),n=await receipts();for(const field of ['foreignBuilding','badMedia']){fixture.state[field]=true;try{assert.equal((await(await fixture.post()).json()).processed,false);}finally{fixture.state[field]=false;}}assert.deepEqual(await current(),before);assert.equal(await receipts(),n);});
  const existing=await current(),row={external_id:existing.external_id,source:existing.source,active:existing.active,price:123,raw_data:existing.raw_data,updated_at:new Date().toISOString()};
  const invoke=(client,r)=>client.query('select orulo_audit.apply_webhook($1,$2::jsonb,false,now()) result',[buildingId,JSON.stringify([r])]);
  await check('pool rollback covers property and receipt together',async()=>{const before=await current(),n=await receipts(),c=await writer.connect();try{await c.query('begin');await invoke(c,row);await c.query('rollback');}finally{c.release(true);}assert.deepEqual(await current(),before);assert.equal(await receipts(),n);});
  await check('two pooled connections serialize and retain row locks',async()=>{const c=await writer.connect();let pending;try{await c.query('begin');await invoke(c,row);let completed=false;pending=invoke(writer,{...row,price:124}).then(()=>{completed=true;});await new Promise(r=>setTimeout(r,100));assert.equal(completed,false);await c.query('rollback');await pending;}finally{await c.query('rollback').catch(()=>{});c.release(true);await pending?.catch(()=>{});}assert.equal(Number((await current()).price),124);});
  await check('broken pooled session is discarded; next connection authenticates afresh',async()=>{const c=await writer.connect();const pid=(await c.query('select pg_backend_pid() p')).rows[0].p;c.on('error',()=>{});try{await assert.rejects(c.query('select pg_terminate_backend(pg_backend_pid())'));}finally{c.release(true);}const r=await writer.query('select session_user u,pg_backend_pid() p');assert.equal(r.rows[0].u,'orulo_webhook_writer');assert.notEqual(r.rows[0].p,pid);assert.equal(Number((await current()).price),124);});
  await check('candidate pool wrapper clears persistent session state before reuse',async()=>{const c=await writer.connect();try{await c.query("select set_config('orulo.v9_session_probe','must-not-leak',false)");}finally{c.release();}const r=await cleanSessionQueries(writer).query("select coalesce(current_setting('orulo.v9_session_probe',true),'') v");assert.equal(r.rows[0].v,'');});
  await check('receipt envelopes and hashes remain internally consistent',async()=>{const r=await admin.query("select count(*)::int n from orulo_audit.property_transitions where evidence_hash<>encode(sha256(convert_to(canonical,'UTF8')),'hex') or canonical::jsonb->>'uuid'<>id::text or canonical::jsonb->>'transactionId'<>transaction_id::text");assert.equal(r.rows[0].n,0);});
  const storage=async()=>(await admin.query("select pg_total_relation_size('orulo_audit.property_transitions')::text disk,coalesce(avg(pg_column_size(t)),0)::float avg_bytes,count(*)::int n from orulo_audit.property_transitions t")).rows[0];
  const before=await storage(),latencies=[];
  for(let i=0;i<samples;i++){fixture.state.price=200+i;const start=performance.now();assert.equal((await(await fixture.post()).json()).processed,true);latencies.push(performance.now()-start);}
  const after=await storage();latencies.sort((a,b)=>a-b);
  return{status:ci?'CI_DISPOSABLE_VALIDATED_NOT_STAGING':'STAGING_TESTS_PASSED_PENDING_REVIEW',stagingValidated:false,checks,
   measurements:{samples,httpEndToEndP50Ms:latencies[Math.floor(samples*.5)],httpEndToEndP95Ms:latencies[Math.min(samples-1,Math.ceil(samples*.95)-1)],receiptGrowth:after.n-before.n,relationGrowthBytes:Number(after.disk)-Number(before.disk),observedAverageTupleBytes:after.avg_bytes,environment:ci?'disposable CI':'independent staging',productionCapacityClaim:false},
   source:{kind:'controlled synthetic HTTP source',mediaSha256:fixture.sourceImageHash,realOruloQueries:0,providerSenderAuthValidated:false},policy:'STRICT_GLOBAL_V1',syntheticBuildingId:buildingId};
 }finally{
  if(oldId===undefined)delete process.env.ORULO_CLIENT_ID;else process.env.ORULO_CLIENT_ID=oldId;
  if(oldSecret===undefined)delete process.env.ORULO_CLIENT_SECRET;else process.env.ORULO_CLIENT_SECRET=oldSecret;
  await fixture?.close();await Promise.all(Object.values(pools).map(p=>p.end()));
 }
}

async function main(){
 const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.V9_STAGING_MODE==='disposable-ci';
 const target=ci?{mode:'disposable-ci',host:'127.0.0.1',port:Number(process.env.V9_STAGING_PORT),database:'orulo_v9_auth_test'}:JSON.parse(readFileSync(process.argv[2],'utf8'));
 verifyStagingTarget(target,{ci});if(!ci)verifyProviderEvidence(target);
 const {Pool,Client}=createRequire(new URL('../test-support/orulo-v9-staging/package.json',import.meta.url))('pg');
 const ca=readFileSync(process.env.V9_STAGING_CA_FILE,'utf8');
 const result=await validateStaging({target,ca,Pool,Client,ci,passwords:{postgres:process.env.V9_STAGING_ADMIN_PASSWORD,orulo_webhook_writer:process.env.V9_STAGING_WRITER_PASSWORD,orulo_provenance_reader:process.env.V9_STAGING_READER_PASSWORD}});
 const json=JSON.stringify(result,null,2)+'\n';const path=process.env.V9_STAGING_REPORT||'v9-staging-report.json';writeFileSync(path,json);writeFileSync(path+'.sha256',createHash('sha256').update(json).digest('hex')+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,measurements:result.measurements}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('V9_STAGING_VALIDATION_FAILED_NO_AUTOMATIC_RETRY');process.exitCode=1;});
