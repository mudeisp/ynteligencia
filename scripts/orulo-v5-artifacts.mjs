import {createHash} from 'node:crypto';
import {queueFromVerifiedReports} from './orulo-v5-reports.mjs';
// SHA-256 sidecars detect accidental artifact corruption; they are NOT digital signatures.
// Trust requires provenance from the approved GitHub Actions run and approved commit.
export function verifyArtifact({reportBytes,sidecar,provenance}){
 if(typeof reportBytes!=='string'||typeof sidecar!=='string'||!provenance ||
   provenance.repository!=='mudeisp/ynteligencia' ||
   provenance.workflow!=='.github/workflows/orulo-national-dry-run.yml' ||
   provenance.conclusion!=='success' || !/^[a-f0-9]{40}$/.test(provenance.commitSha||'') ||
   !/^[1-9][0-9]*$/.test(String(provenance.runId||'')) ||
   provenance.approvedCommitSha!==provenance.commitSha)throw Error('V5_PROVENANCE_UNVERIFIED');
 const actual=createHash('sha256').update(reportBytes).digest('hex');
 const expected=sidecar.trim().split(/\s+/)[0];
 if(!/^[a-f0-9]{64}$/.test(expected)||actual!==expected)throw Error('V5_ARTIFACT_HASH_MISMATCH');
 let report;try{report=JSON.parse(reportBytes);}catch{throw Error('V5_REPORT_INVALID_JSON');}
 if(report.runId!==String(provenance.runId) || report.commitSha!==provenance.commitSha ||
   report.workflowPath!==provenance.workflow || report.writes!==0)
   throw Error('V5_REPORT_PROVENANCE_MISMATCH');
 return Object.freeze(report);
}
export function queueFromArtifacts(artifacts,options){
 if(!Array.isArray(artifacts)||!artifacts.length)throw Error('V5_ARTIFACTS_REQUIRED');
 return queueFromVerifiedReports(artifacts.map(verifyArtifact),options);
}
