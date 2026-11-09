// V5 integration readiness assessment against the existing audited batch
// protocol. This is a read-only compatibility gate, not a write adapter.
import {prepareAuditedBatch} from './orulo-v5-cas-preflight.mjs';
export function assessV5LegacyCompatibility({batch,options,legacyCatalog,legacyHealth}={}){
 const manifest=prepareAuditedBatch(batch,options);
 const blockers=[];
 const entry=legacyCatalog?.batches?.[batch.batchId];
 if(!entry)blockers.push('V5_BATCH_NOT_IN_LEGACY_CATALOG');
 if(legacyHealth?.batchProtocol!==1)blockers.push('LEGACY_BATCH_PROTOCOL_NOT_VERIFIED');
 if(!legacyHealth?.batchMasterHash || legacyHealth.batchMasterHash!==legacyCatalog?.masterHash)
   blockers.push('LEGACY_MASTER_HASH_NOT_VERIFIED');
 if(entry && entry.released!==true)blockers.push('LEGACY_PHASE_NOT_RELEASED');
 if(!legacyHealth || legacyHealth.writeEnabled!==false)
   blockers.push('AUDIT_WRITE_DISABLED_HEALTH_NOT_VERIFIED');
 // Existing batch executor checks targets against the original 99-building
 // master, and existing PostgreSQL journal is SHA-pinned. These are distinct
 // from V5 manifests; compatibility cannot be inferred from matching IDs.
 blockers.push('V5_MANIFEST_NOT_SUPPORTED_BY_LEGACY_RPC');
 blockers.push('V5_CONTROL_SHA_AND_SQL_APPROVAL_NOT_INSTALLED');
 return {manifestHash:manifest.manifestHash,writeEnabled:false,
  compatible:false,blockers,requiredChanges:[
   'versioned server-side V5 manifest registration and approved target scope',
   'V5-specific SQL authorization and owner/commit binding',
   'fresh per-target CAS baseline and durable journal reconciliation',
   'isolated prewrite errors with global integrity fail-stop',
   'readback proof for every committed image update'
  ]};
}
