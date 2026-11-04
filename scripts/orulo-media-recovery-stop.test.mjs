import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This test worker has only synthetic credentials. Every request is intercepted.
for (const key of ['ORULO_CLIENT_ID','ORULO_CLIENT_SECRET','SUPABASE_SECRET_KEY']) process.env[key] = 'test-only';
const { runRecovery } = await import('./orulo-media-recovery.mjs?batch-stop-tests');
const ids = [1,2,3].map(n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
const makeRow = (id, buildingId) => ({ id, external_id:`orulo:${buildingId}:${id}`, source:'novos', state:'SP',
  city:'São Paulo', development_name:`Fixture ${buildingId}`, active:true, price:500000,
  updated_at:'2026-01-01T00:00:00Z', raw_data:{building_id:buildingId, images:['ordinary-photo'],
    building:{id:buildingId,stock:7,floor_plans:[{id:'plan',description:'Original typology'}]}} });
const json = data => ({ok:true,json:async()=>structuredClone(data)});

function fixture(mode='success', failureId=ids[0]) {
  const rows=[makeRow(ids[0],'43126'),makeRow(ids[1],'43126'),makeRow(ids[2],'4969')];
  const current=new Map(rows.map(row=>[row.id,structuredClone(row)]));
  const calls=[],events=[],reads=new Map();
  const args={states:['SP'],buildingIds:['43126','4969'],write:true};
  const record=async event=>{
    if(mode==='intent-ledger-error' && event.type==='INTENT')throw Error('intent ledger unavailable');
    if(mode==='result-ledger-error' && event.type==='RESULT')throw Error('result ledger unavailable');
    if(mode==='stop-ledger-error' && event.type==='STOP')throw Error('stop ledger unavailable');
    events.push(structuredClone(event));
  };
  const fetchImpl=async(url,options={})=>{
    assert.ok(options.signal,'Every request must have a bounded timeout');
    calls.push({url,method:options.method??'GET'});
    if(url.endsWith('/oauth/token'))return json({access_token:'test-only'});
    if(url.includes('/floor_plans?')){
      if(mode==='source-error')throw Error('source timeout');
      if(mode==='source-http-error')return {ok:false,status:503};
      return json({floor_plans:[{id:'plan','1024x1024':'https://example.invalid/plan.jpg'}]});
    }
    if(url.includes('/rpc/orulo_media_cas')){
      const payload=JSON.parse(options.body),id=payload.p_id;
      const failing=id===failureId;
      if(failing && ['CONFLICT','stop-ledger-error'].includes(mode))return json({id,status:'CONFLICT'});
      if(failing && mode==='NOT_FOUND')return json({id,status:'NOT_FOUND'});
      if(failing && mode==='timeout-before')throw Error('RPC timeout before response');
      if(failing && mode==='invalid-response')return json({id,status:'UNKNOWN'});
      const next=structuredClone(current.get(id));
      next.raw_data.building.floor_plans=payload.p_floor_plans;
      next.updated_at='2026-01-02T00:00:00Z';
      if(failing && mode==='integrity-error')next.price+=1; // simulated concurrent fixture, never Supabase
      if(failing && mode==='plan-divergence')next.raw_data.building.floor_plans[0].description='Unexpected';
      current.set(id,next);
      if(failing && mode==='readback-missing')current.delete(id);
      if(failing && mode==='timeout-after')throw Error('RPC timeout after response was lost');
      return json({id,status:mode==='unchanged'?'UNCHANGED':'UPDATED'});
    }
    if(url.includes('/rest/v1/properties?')){
      const selected=new URL(url).searchParams.get('id');
      if(!selected)return json(rows);
      const id=selected.replace(/^eq\./,''),count=(reads.get(id)??0)+1;reads.set(id,count);
      if(id===failureId){
        if(mode==='pre-read-error')throw Error('fresh read failed');
        if(mode==='fresh-NOT_FOUND' && count===1)return json([]);
        if(mode==='fresh-CONFLICT' && count===1)return json([{...current.get(id),state:'ES'}]);
        if(mode==='readback-error' && count>1)throw Error('readback timeout');
      }
      return json(current.has(id)?[current.get(id)]:[]);
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  return {args,fetchImpl,record,calls,events,current,run:()=>runRecovery({args,fetchImpl,record})};
}
function assertNoLaterIds(f, failedId=ids[0]) {
  const allowed=new Set(ids.slice(0,ids.indexOf(failedId)+1));
  for(const call of f.calls){
    const id=new URL(call.url).searchParams.get('id')?.replace(/^eq\./,'');
    if(id)assert.ok(allowed.has(id),`Later UUID was processed: ${id}`);
  }
  assert.equal(f.calls.some(call=>call.url.includes('/buildings/4969/')),false,'Later building was fetched');
}

const stops=[
  ['CONFLICT',/CAS_STOP_CONFLICT/],['NOT_FOUND',/CAS_STOP_NOT_FOUND/],
  ['fresh-CONFLICT',/CAS_STOP_CONFLICT/],['fresh-NOT_FOUND',/CAS_STOP_NOT_FOUND/],
  ['timeout-before',/CAS_STOP_AMBIGUOUS/],['timeout-after',/CAS_STOP_AMBIGUOUS/],
  ['invalid-response',/CAS_STOP_AMBIGUOUS/],['readback-error',/CAS_STOP_AMBIGUOUS/],
  ['readback-missing',/CAS_STOP_POST_WRITE_DIVERGENCE/],['integrity-error',/CAS_STOP_POST_WRITE_DIVERGENCE/],
  ['plan-divergence',/CAS_STOP_POST_WRITE_DIVERGENCE/],['pre-read-error',/fresh read failed/],
  ['source-error',/source timeout/],['source-http-error',/ORULO_FLOOR_PLANS_FETCH_FAILED_503/],
  ['intent-ledger-error',/intent ledger unavailable/],['result-ledger-error',/result ledger unavailable/]
];
for(const [mode,message] of stops)test(`runner halts on ${mode} before another UUID or building`,async()=>{
  const f=fixture(mode);
  await assert.rejects(f.run(),error=>{
    assert.match(error.message,message);assert.equal(error.recoverySummary.failures.length,1);return true;
  });
  assertNoLaterIds(f);
  assert.ok(f.calls.filter(c=>c.url.includes('/rpc/orulo_media_cas')).length<=1,'No automatic mutation retry');
  assert.equal(f.events.at(-1).type,'STOP');
  if(['CONFLICT','NOT_FOUND'].includes(mode))assert.equal(f.events.at(-2).status,mode,'Original CAS result preserved');
  if(mode==='timeout-after')assert.equal(f.events.at(-2).ambiguousResponse,true,'Observed desired state is still uncertain');
  if(mode==='intent-ledger-error')assert.equal(f.calls.some(c=>c.url.includes('/rpc/')),false);
});
test('earlier confirmed updates remain diagnosed but the next UUID/building is never processed',async()=>{
  const f=fixture('CONFLICT',ids[1]);
  await assert.rejects(f.run(),error=>{
    assert.equal(error.message,'CAS_STOP_CONFLICT');assert.equal(error.recoverySummary.rowsWritten,1);
    assert.equal(error.recoverySummary.conflicts,1);assert.equal(error.recoverySummary.failures[0].id,ids[1]);return true;
  });
  assertNoLaterIds(f,ids[1]);assert.equal(f.events.filter(e=>e.type==='RESULT' && e.status==='UPDATED').length,1);
  assert.equal(f.events.at(-1).rowsWritten,1);
});
test('STOP ledger failure preserves the original CAS result/error and still cannot resume',async()=>{
  const f=fixture('stop-ledger-error');
  await assert.rejects(f.run(),error=>{
    assert.equal(error.message,'CAS_STOP_CONFLICT');assert.equal(error.ledgerError,'stop ledger unavailable');return true;
  });
  assert.equal(f.events.at(-1).status,'CONFLICT');assertNoLaterIds(f);
});
test('real exclusive JSONL ledger retains INTENT, RESULT and STOP after runner rejects',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'orulo-stop-test-')),path=join(dir,'audit.jsonl'),f=fixture('CONFLICT');
  try{
    await assert.rejects(runRecovery({args:{...f.args,ledger:path},fetchImpl:f.fetchImpl}),/CAS_STOP_CONFLICT/);
    const saved=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(saved.map(e=>e.type),['INTENT','RESULT','STOP']);
    assert.equal(saved[1].status,'CONFLICT');assert.equal(saved[2].id,ids[0]);assertNoLaterIds(f);
    await assert.rejects(runRecovery({args:{...f.args,ledger:path},fetchImpl:f.fetchImpl}),/EEXIST/);
    assert.equal(readFileSync(path,'utf8').trim().split('\n').length,3,'Existing evidence cannot be overwritten');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
for(const mode of ['success','unchanged'])test(`confirmed ${mode} may continue, with one RPC per UUID`,async()=>{
  const f=fixture(mode),summary=await f.run();
  assert.equal(summary.rowsWritten,mode==='success'?3:0);assert.equal(summary.unchanged,mode==='unchanged'?3:0);
  assert.equal(f.calls.filter(c=>c.url.includes('/rpc/')).length,3);
  assert.equal(f.events.some(e=>e.type==='STOP'),false);
});
