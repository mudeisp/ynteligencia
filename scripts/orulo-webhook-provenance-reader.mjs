// This adapter accepts a trusted DB connection, never a caller JSON attestation.
// The private function independently binds its proof to the sealed journal run.
export function createProvenanceReader(client) {
 if(typeof client?.query!=='function')throw Error('V9_DEDICATED_READER_CLIENT_REQUIRED');
 return async({runUuid,changes})=>{
  const proofs=new Map();
  for(const change of changes){
   if(change.scope!=='OUT_OF_SCOPE'||!change.before||!change.after)continue;
   const response=await client.query('select orulo_audit.read_webhook_provenance($1::uuid,$2::uuid) as proof',[runUuid,change.uuid]);
   const p=response?.rows?.[0]?.proof;
   if(p?.runUuid===runUuid&&p.uuid===change.uuid&&p.beforeFullHash===change.before.fullHash&&p.afterFullHash===change.after.fullHash&&p.policy==='STRICT_GLOBAL_V1')proofs.set(change.uuid,p);
  }
  return change=>proofs.get(change.uuid)??null;
 };
}
