import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stageCheckpointPages} from './orulo-national-checkpoint-staging.mjs';

const hash = x => createHash('sha256').update(Buffer.from(JSON.stringify(x))).digest('hex');
const document = {
  operationUuid: '1c8ec62a-9c38-41ac-8091-f1ceef98ca91',
  manifestSha256: 'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288',
  targets: Array.from({length: 7}, (_,i)=>({
    id: '00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),
    buildingId: String(i+1000), patches:[{id:String(i+1),images:[]}]
  }))
};
const checkpoints = [0,3,5].map((offset,i)=> {
  const targetCount = [3,2,2][i];
  return {offset,targetCount,pageSha256:hash(document.targets.slice(offset,offset+targetCount))};
});
const call = (overrides={}) => stageCheckpointPages({
  checkpoints,document,expectedTargetCount:7, ...overrides
});
test('writes bounded page receipts in order and reports progress',async()=>{
  const seen=[],events=[];
  const receipts=await call({
    checkpointPage:async p=>{seen.push(p);return {status:'VERIFIED',pageOffset:p.p_offset,nextOffset:p.p_offset+p.p_expected_targets.length};},
    onCheckpoint:p=>events.push(p.offset)
  });
  assert.deepEqual(seen.map(x=>x.p_offset),[0,3,5]);
  assert.deepEqual(seen.map(x=>x.p_expected_targets.length),[3,2,2]);
  assert.deepEqual(events,[0,3,5]);
  assert.equal(receipts.reduce((s,x)=>s+x.count,0),7);
});
test('detects page overlap, gap or missing coverage before any RPC',async()=>{
  let calls=0;const checkpointPage=async()=>{calls++;return {status:'VERIFIED',pageOffset:0,nextOffset:3};};
  await assert.rejects(call({checkpoints:[checkpoints[0],checkpoints[0]],checkpointPage}),/GAP_OR_OVERLAP/);
  await assert.rejects(call({checkpoints:checkpoints.slice(0,2),checkpointPage}),/INCOMPLETE/);
  await assert.rejects(call({checkpoints:[checkpoints[0],checkpoints[2]],checkpointPage}),/GAP_OR_OVERLAP/);
  assert.equal(calls,0);
});
test('rejects modified target bytes in proof plan before any RPC',async()=>{
  let calls=0;const altered=structuredClone(document);
  altered.targets[3].buildingId='tampered';
  await assert.rejects(call({document:altered,checkpointPage:async()=>{calls++;}}),/HASH_DIVERGED/);
  assert.equal(calls,0);
});
test('does not accept a failed or ambiguous RPC as a successful receipt',async()=>{
  await assert.rejects(call({checkpointPage:async p=>({status:'ERROR',pageOffset:p.p_offset,nextOffset:7})}),/RECEIPT_INVALID/);
  await assert.rejects(call({checkpointPage:async()=>null}),/RECEIPT_INVALID/);
  await assert.rejects(call({checkpointPage:async p=>({status:'VERIFIED',pageOffset:p.p_offset,nextOffset:p.p_offset})}),/RECEIPT_INVALID/);
});
test('interrupted coordinator can replay verified pages idempotently',async()=>{
  const durable=new Map();let failOnce=true;
  const checkpointPage=async p=>{
    const offset=p.p_offset,n=p.p_expected_targets.length;
    if(offset===5&&failOnce){failOnce=false;throw new Error('connection_lost');}
    if(durable.has(offset))return {status:'ALREADY_VERIFIED',pageOffset:offset,nextOffset:7};
    durable.set(offset,hash(p.p_expected_targets));
    return {status:'VERIFIED',pageOffset:offset,nextOffset:offset+n};
  };
  await assert.rejects(call({checkpointPage}),/connection_lost/);
  assert.deepEqual([...durable.keys()],[0,3]);
  const result=await call({checkpointPage});
  assert.deepEqual(result.map(r=>r.status),['ALREADY_VERIFIED','ALREADY_VERIFIED','VERIFIED']);
  assert.deepEqual([...durable.keys()],[0,3,5]);
});
test('cannot stage when provided malformed plan or non-50-sized pages',async()=>{
  const oversized={...checkpoints[0],targetCount:51};
  await assert.rejects(call({checkpoints:[oversized],checkpointPage:async()=>{}}),/GAP_OR_OVERLAP/);
  await assert.rejects(call({document:{targets:[]},checkpointPage:async()=>{}}),/PLAN_INVALID/);
});
