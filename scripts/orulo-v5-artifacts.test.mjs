import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyArtifact,queueFromArtifacts} from './orulo-v5-artifacts.mjs';
const provenance={repository:'mudeisp/ynteligencia',workflow:'.github/workflows/orulo-national-dry-run.yml',conclusion:'success',commitSha:'a'.repeat(40),approvedCommitSha:'a'.repeat(40),runId:'12345'};
const report={runId:'12345',commitSha:'a'.repeat(40),workflowPath:provenance.workflow,writes:0,status:'COMPLETED',state:'SP',batchId:'V4-SP-P1-NEW-001',items:[{buildingId:'12',status:'RECOVERABLE',recoverablePlans:[{planId:'4',urls:['https://static.orulo.com.br/images/properties/a/b.jpg']}]}]};
const reportBytes=JSON.stringify(report);
const sidecar=createHash('sha256').update(reportBytes).digest('hex')+'  report.json';
test('verified artifact enters a read-only queue',()=>{
 const a={reportBytes,sidecar,provenance};
 assert.equal(verifyArtifact(a).batchId,report.batchId);
 const result=queueFromArtifacts([a]);
 assert.equal(result.summary.eligibleBuildings,1);
 assert.equal(result.writeEnabled,false);
});
test('rejects tampering, wrong commit, and missing approval',()=>{
 assert.throws(()=>verifyArtifact({reportBytes:reportBytes+' ',sidecar,provenance}),/HASH_MISMATCH/);
 assert.throws(()=>verifyArtifact({reportBytes,sidecar,provenance:{...provenance,approvedCommitSha:'b'.repeat(40)}}),/PROVENANCE_UNVERIFIED/);
 assert.throws(()=>verifyArtifact({reportBytes,sidecar,provenance:{...provenance,runId:'999'}}),/PROVENANCE_MISMATCH/);
});
