// Read-only V5 PostgreSQL preflight. Existing V2 audit protocol is deliberately
// not assumed to authorize V5 writes. No calls to transport.apply or mutations.
import {assessV5LegacyCompatibility} from './orulo-v5-legacy-compat.mjs';
export async function inspectV5PostgresReadiness({batch,options,legacyCatalog,transport}={}){
 if(!transport || typeof transport.control!=='function')throw Error('V5_TRANSPORT_REQUIRED');
 const health=await transport.control('health');
 const assessment=assessV5LegacyCompatibility({batch,options,legacyCatalog,legacyHealth:health});
 const auditHealthy=health?.version===2 && health?.snapshotProtocol==='paged-v2' &&
   health?.storage==='postgres' && health?.durable===true &&
   health?.appendOnly===true && health?.synchronousCommit==='on' &&
   health?.writeEnabled===false;
 return {...assessment,auditHealthy,blockers:auditHealthy?assessment.blockers:
   [...assessment.blockers,'POSTGRES_AUDIT_HEALTH_UNVERIFIED']};
}
