import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {attestOriginalNationalArtifact, readFrozenLedgerLines} from './orulo-national-frozen-attestation.mjs';

test('refuses any source that does not match ORIGINAL historical document SHA-256',async()=>{
  let read=false;
  async function* rows(){read=true;yield {sequence:1};}
  await assert.rejects(attestOriginalNationalArtifact({
    originalBytes:Buffer.from('{}'),ledgerRows:rows()
  }),/ATTEST_MANIFEST_HASH_MISMATCH/);
  assert.equal(read,false);
});
test('refuses untrusted/non-stream ledger and non-buffer source',async()=>{
  await assert.rejects(attestOriginalNationalArtifact({
    originalBytes:'unsafe',ledgerRows:[]
  }),/ATTEST_INPUT_REQUIRED/);
  await assert.rejects(attestOriginalNationalArtifact({
    originalBytes:Buffer.from('abc'),ledgerRows:[]
  }),/ATTEST_INPUT_REQUIRED/);
});
test('streams only valid NDJSON records; no implicit skip of malformed row',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'orulo-frozen-readonly-test-'));
  try {
    const file=join(dir,'ledger.ndjson');
    writeFileSync(file,'{"sequence":1,"kind":"START"}\n{"sequence":2,"kind":"NATIONAL_MANIFEST_PART"}\n');
    const actual=[];
    for await(const row of readFrozenLedgerLines(file))actual.push(row);
    assert.deepEqual(actual.map(row=>row.sequence),[1,2]);
    writeFileSync(file,'{"sequence":1}\nBROKEN\n');
    await assert.rejects(async()=>{
      for await(const _ of readFrozenLedgerLines(file)) {}
    },/ATTEST_LEDGER_JSON_INVALID/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
