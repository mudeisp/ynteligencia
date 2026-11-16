import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyFrozenNationalSeal } from './orulo-national-seal-verifier.mjs';

const digest = b => createHash('sha256').update(b).digest('hex');
const runUuid = '1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
const targets = Array.from({length: 6}, (_, i) => ({
  id: '00000000-0000-0000-0000-' + String(i+1).padStart(12,'0'),
  buildingId: '593', baselineSha256: 'a'.repeat(64),
  patches: [{id:'1',validation:'SOURCE_IMAGE_VALID',images:['https://static.orulo.com.br/images/properties/large/1.jpg'],checks:[]}],
}));
const document = {id:'national-v2-once',operationUuid:runUuid,stats:{properties:6},targets};
const bytes = Buffer.from(JSON.stringify(document));
const manifestHash = digest(bytes);
const text = bytes.toString('utf8');
const fragments = [
  {part:0,text:text.slice(0,91)},
  {part:1,text:text.slice(91,207)},
  {part:2,text:text.slice(207)},
];
const pages = [{offset:0,targets:targets.slice(0,2)},{offset:2,targets:targets.slice(2,4)},{offset:4,targets:targets.slice(4)}];
async function verify(p={}) {
  return verifyFrozenNationalSeal({bytes,manifestHash,runUuid,fragments,targetPages:pages,
    parseAndValidateManifest: b => JSON.parse(b.toString('utf8')),
    maxPartCharacters:bytes.length,maxPageSize:2,...p});
}
test('checks exact SHA-256 original bytes and independent ledger fragments/pages',async()=>{
  const a=await verify();
  assert.equal(a.partsVerified,3);
  assert.equal(a.targetsVerified,6);
  assert.equal(a.pagesVerified,3);
  assert.equal(a.writeAuthorized,false);
  assert.equal(a.sealed,false);
  assert.deepEqual(a.checkpoints.map(x=>x.offset),[0,2,4]);
});
test('repeated identical verification is deterministic and makes no writes',async()=>{
  const a=await verify(),b=await verify();
  assert.deepEqual(a,b);
});
test('rejects modified source bytes, even if all target IDs agree',async()=>{
  await assert.rejects(verify({bytes:Buffer.concat([bytes,Buffer.from(' ')])}),/SOURCE_DOCUMENT_HASH_MISMATCH/);
});
test('rejects altered byte, duplicate, gap or missing fragment',async()=>{
  await assert.rejects(verify({fragments:[{part:0,text:'X'+fragments[0].text.slice(1)},...fragments.slice(1)]}),/FRAGMENT_BYTES_DIVERGE/);
  await assert.rejects(verify({fragments:[fragments[0],fragments[0],fragments[2]]}),/FRAGMENT_SEQUENCE_INVALID/);
  await assert.rejects(verify({fragments:fragments.slice(0,2)}),/LEDGER_DOCUMENT_HASH_MISMATCH/);
  await assert.rejects(verify({fragments:[fragments[1],fragments[0],fragments[2]]}),/FRAGMENT_SEQUENCE_INVALID/);
});
test('rejects modified target contents even when UUID and counts agree',async()=>{
  const bad=structuredClone(pages);
  bad[1].targets[0].patches[0].validation='INVALID';
  await assert.rejects(verify({targetPages:bad}),/FROZEN_TARGET_DIVERGENCE/);
});
test('rejects page omissions, overlaps, gaps and added targets',async()=>{
  await assert.rejects(verify({targetPages:pages.slice(0,2)}),/TARGET_COVERAGE_INCOMPLETE/);
  await assert.rejects(verify({targetPages:[pages[0],pages[0],pages[2]]}),/PAGE_SEQUENCE_INVALID/);
  await assert.rejects(verify({targetPages:[pages[0],pages[2]]}),/PAGE_SEQUENCE_INVALID/);
  await assert.rejects(verify({targetPages:[...pages,{offset:6,targets:[targets[0]]}]}),/EXTRA_TARGETS/);
});
test('rejects inconsistent target sorting even with matching pages',async()=>{
  const shuffled=structuredClone(document);
  [shuffled.targets[0],shuffled.targets[1]]=[shuffled.targets[1],shuffled.targets[0]];
  const altered=Buffer.from(JSON.stringify(shuffled));
  const t=altered.toString('utf8');
  await assert.rejects(verifyFrozenNationalSeal({bytes:altered,manifestHash:digest(altered),runUuid,
    fragments:[{part:0,text:t}],targetPages:[{offset:0,targets:shuffled.targets.slice(0,2)},{offset:2,targets:shuffled.targets.slice(2,4)},{offset:4,targets:shuffled.targets.slice(4)}],
    parseAndValidateManifest:b=>JSON.parse(b.toString('utf8')),maxPartCharacters:altered.length,maxPageSize:2}),/TARGET_ORDER_INVALID/);
});
