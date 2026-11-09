import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepare} from './orulo-national-handoff.mjs';
import {discover,validateSource} from './orulo-national-source-readonly.mjs';
import {verifyRows,readSource,simulate,simulateProperty} from './orulo-national-simulate.mjs';
import {sha,bytes,pinnedJSON,verifyQueue} from './orulo-national-transfer-common.mjs';

const propertyId='11111111-1111-1111-1111-111111111111';
const cdn=id=>`https://static.orulo.com.br/images/properties/large/${id}.jpg`;
const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,1,1,0,72]);
const env={ORULO_CLIENT_ID:'synthetic-id',ORULO_CLIENT_SECRET:'synthetic-secret'};
const plan=(id='7',url=cdn(id))=>({id,description:'source label','1024x1024':url});
function makeQueue(ids=['1']){return {version:1,logicalBatchId:'orulo-national-v2',writeAuthorized:false,manifestSha256:'0'.repeat(64),
 buildings:ids.map(id=>({buildingId:id,plans:[{planId:String(Number(id)+6),propertyIds:[propertyId]}]}))};}
function fixtureRequest({sources={},imageStatus=206,mime='image/jpeg',image=jpeg,authStatus=200}={}){
 const calls=[];
 const request=async(url,o={})=>{
  calls.push({url,method:o.method||'GET'});assert.equal(o.redirect,'error');
  const u=new URL(url);
  assert.ok(!u.hostname.includes('supabase'),'No database HTTP is permitted');
  if(u.pathname==='/oauth/token'){
   assert.equal(o.method,'POST');return new Response(JSON.stringify({access_token:'synthetic-token'}),{status:authStatus});
  }
  if(u.hostname==='www.orulo.com.br'){
   assert.equal(o.headers.Authorization,'Bearer synthetic-token');
   const id=u.pathname.split('/')[4],source=sources[id]??{floor_plans:[plan(String(Number(id)+6))]};
   if(typeof source==='number')return new Response('{}',{status:source});
   return new Response(JSON.stringify(source),{status:200});
  }
  assert.equal(u.hostname,'static.orulo.com.br');assert.equal(o.headers.Range,'bytes=0-4095');assert.equal(o.headers.Authorization,undefined);
  return new Response(image,{status:imageStatus,headers:{'content-type':mime}});
 };
 return {request,calls};
}
function output(){return join(mkdtempSync(join(tmpdir(),'orulo-transfer-')),'evidence');}
async function discoverFixture(queue=makeQueue(),config={}){
 const f=fixtureRequest(config),dir=output(),hash=sha(bytes(queue));
 const index=await discover({queue,queueSha256:hash,outputDir:dir,env,request:f.request});
 return {dir,queue,hash,index,...f};
}
function rowFixture(){
 const row={id:propertyId,external_id:'orulo:1:1',source:'novos',state:'SP',active:true,price:100,
 raw_data:{building_id:'1',images:['photo'],building:{videos:['video'],floor_plans:[{id:'7',description:'preserve metadata',associations:{typologies:[1]}},{id:'99',image_url:cdn('old'),description:'already present'}]}}};
 const recordCanonical=JSON.stringify(row),recordSha256=sha(recordCanonical),records=[{id:row.id,recordCanonical,recordSha256}];
 const fingerprint=sha(row.id+':'+recordSha256),recheck={properties:1,inventory_sha256:fingerprint};
 const manifest={inventoryFingerprint:fingerprint,properties:[{id:row.id,buildingId:'1',recordSha256,candidateKeys:['1:7'],plans:[['7',false],['99',true]]}]};
 return {row,records,recheck,manifest};
}

test('queue deduplication preserves exact associations and refuses fabricated candidate data',()=>{
 const f=rowFixture();Object.assign(f.manifest,{version:2,writeAuthorized:false,operations:[],candidates:[{key:'1:7',buildingId:'1',planId:'7',propertyIds:[propertyId],candidateImage:null,proposedPatch:null}]});
 assert.equal(prepare(f.manifest).buildings.length,1);
 f.manifest.candidates[0].propertyIds=['22222222-2222-2222-2222-222222222222'];assert.throws(()=>prepare(f.manifest),/ASSOCIATION/);
});
test('input hash tampering is rejected before discovery',()=>{
 const dir=mkdtempSync(join(tmpdir(),'orulo-input-')),path=join(dir,'queue.json');writeFileSync(path,bytes(makeQueue()));
 assert.throws(()=>pinnedJSON(path,'0'.repeat(64)),/SHA256/);
 const q=makeQueue();q.buildings.push(q.buildings[0]);assert.throws(()=>verifyQueue(q),/BUILDING/);
});
test('missing credentials are a shared blocker with no network calls',async()=>{
 const queue=makeQueue(['1','2']);let calls=0;
 const report=await discover({queue,queueSha256:sha(bytes(queue)),outputDir:output(),env:{},request:async()=>{calls++;throw Error('no');}});
 assert.equal(calls,0);assert.equal(report.status,'BLOCKED');assert.equal(report.unexaminedBuildingIds.length,1);assert.equal(report.productionWrites,0);
});
test('direct source and CDN evidence join into an offline patch, with existing metadata preserved',async()=>{
 const f=await discoverFixture(),source=await readSource(f.dir,f.queue,f.hash),row=rowFixture();
 const result=await simulate({...row,source});
 assert.equal(result.readOnlySimulation,'PASS');assert.equal(result.result,'UNKNOWN');assert.equal(result.diagnosticProposals.length,1);
 assert.equal(result.items[0].localChecks.idempotency,'PASS');assert.equal(result.items[0].productionEligible,false);
 assert.equal(result.diagnosticProposals[0].patches[0].image_url,cdn('7'));
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(result.realCASCalls,0);
});
test('paginated or malformed source does not become SOURCE_NOT_FOUND and independent buildings continue',async()=>{
 const f=await discoverFixture(makeQueue(['1','2']),{sources:{'1':{floor_plans:[plan()],has_more:true}}});
 assert.equal(f.index.status,'COMPLETED_DISCOVERY_ONLY');assert.equal(f.index.results.length,2);
 const first=JSON.parse(readFileSync(join(f.dir,'buildings/1/result.json')));
 assert.equal(first.plans[0].status,'SOURCE_ERROR');assert.equal(first.incidents[0].code,'SOURCE_INCOMPLETE_RESPONSE');
 assert.throws(()=>validateSource({floor_plans:[plan(),plan()]}),/PLAN_IDS/);
 assert.throws(()=>validateSource({building_id:'2',floor_plans:[plan()]},'1'),/BUILDING_MISMATCH/);
});
test('an absent plan is SOURCE_NOT_FOUND, without invented URL or CDN request',async()=>{
 const f=await discoverFixture(makeQueue(),{sources:{'1':{floor_plans:[]}}});
 const result=JSON.parse(readFileSync(join(f.dir,'buildings/1/result.json')));
 assert.equal(result.plans[0].status,'SOURCE_NOT_FOUND');assert.equal(f.index.requests.cdn,0);
});
test('untrusted image hosts are rejected before request and another building is still examined',async()=>{
 const f=await discoverFixture(makeQueue(['1','2']),{sources:{'1':{floor_plans:[plan('7','http://127.0.0.1/private')]}}});
 assert.equal(f.index.results.length,2);assert.ok(f.calls.every(c=>!c.url.includes('127.0.0.1')));
 assert.equal(JSON.parse(readFileSync(join(f.dir,'buildings/1/result.json'))).plans[0].status,'REQUIRES_REVIEW');
});
test('source 429 stops dependent calls, preserves evidence and forbids automatic shared-service resume',async()=>{
 const f=await discoverFixture(makeQueue(['1','2']),{sources:{'1':429}});
 assert.equal(f.index.sharedServiceBlocked,true);assert.equal(f.index.requests.floorPlans,1);
 await assert.rejects(()=>discover({queue:f.queue,queueSha256:f.hash,outputDir:f.dir,env,request:f.request,resume:true}),/SHARED_SERVICE/);
});
test('MIME and binary signature failures stay blocked',async()=>{
 const f=await discoverFixture(makeQueue(),{mime:'text/html'});
 assert.equal(JSON.parse(readFileSync(join(f.dir,'buildings/1/result.json'))).plans[0].status,'REQUIRES_REVIEW');
 const g=await discoverFixture(makeQueue(),{image:Buffer.from('HTML masquerading as JPEG')});
 assert.equal(JSON.parse(readFileSync(join(g.dir,'buildings/1/result.json'))).plans[0].status,'REQUIRES_REVIEW');
});
test('partial discovery resumes pending work without repeating successful buildings',async()=>{
 const queue=makeQueue(['1','2']),f=fixtureRequest(),dir=output(),hash=sha(bytes(queue));
 const first=await discover({queue,queueSha256:hash,outputDir:dir,env,request:f.request,maxBuildings:1});assert.equal(first.status,'PARTIAL');
 const second=await discover({queue,queueSha256:hash,outputDir:dir,env,request:f.request,resume:true});
 assert.equal(second.status,'COMPLETED_DISCOVERY_ONLY');assert.equal(second.requests.floorPlans,2);assert.equal(second.results.length,2);
});
test('orphan building evidence is quarantined and independent buildings continue',async()=>{
 const queue=makeQueue(['1','2','3']),f=fixtureRequest(),dir=output(),hash=sha(bytes(queue));
 await discover({queue,queueSha256:hash,outputDir:dir,env,request:f.request,maxBuildings:1});
 mkdirSync(join(dir,'buildings/2'));writeFileSync(join(dir,'buildings/2/source-response.json'),'interrupted');
 const result=await discover({queue,queueSha256:hash,outputDir:dir,env,request:f.request,resume:true});
 assert.equal(result.results.length,3);assert.equal(result.results[1].quarantined,true);assert.equal(result.requests.floorPlans,2);
 assert.equal(result.incidents[0].classification,'UNKNOWN');
});
test('tampered image prefix is a local building blocker rather than trusted recovery',async()=>{
 const f=await discoverFixture();writeFileSync(join(f.dir,`cdn/${sha(cdn('7'))}.bin`),'tampered');
 const source=await readSource(f.dir,f.queue,f.hash);assert.equal(source.buildings.size,0);assert.equal(source.incidents[0].classification,'BLOCKER');
});
test('fresh row drift and incomplete snapshots block proposals, while current complete rows are excluded',async()=>{
 const f=await discoverFixture(),source=await readSource(f.dir,f.queue,f.hash),r=rowFixture();
 r.manifest.properties[0].recordSha256='f'.repeat(64);
 const result=await simulate({...r,source});assert.equal(result.diagnosticProposals.length,0);assert.equal(result.items[0].reason,'THIRD_PARTY_CHANGE_OR_STALE_MANIFEST');
 assert.throws(()=>verifyRows(r.records,{...r.recheck,properties:2}),/MEMBERSHIP/);
 assert.throws(()=>verifyRows(r.records,{...r.recheck,inventory_sha256:'f'.repeat(64)}),/FINGERPRINT/);
});
test('the existing patch helper rejects unvalidated URLs; no alternate patch path exists',async()=>{
 const {row}=rowFixture();await assert.rejects(()=>simulateProperty(row,[{id:'7',image_url:cdn('7')}],new Map()),/UNVALIDATED/);
});
