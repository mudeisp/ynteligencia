import {readFileSync} from 'node:fs';
export const forbiddenRefs=['wzaegidwtdjuhqchpdpd','bgggafirdjvxihqselha'];
export function verifyStagingTarget(target,{ci=false}={}){
 if(!target||forbiddenRefs.some(ref=>JSON.stringify(target).includes(ref)))throw Error('V9_PRODUCTION_TARGET_DENIED');
 if(ci){
  if(target.mode!=='disposable-ci'||target.host!=='127.0.0.1'||target.database!=='orulo_v9_auth_test')throw Error('V9_LOCAL_CI_TARGET_REQUIRED');
 }else if(target.mode!=='staging'||target.name!=='ynteligencia-v9-staging'||target.organizationId!=='xtqvxxncxirpujvxznly'||
   !/^[a-z]{20}$/.test(target.projectRef||'')||target.host!==`db.${target.projectRef}.supabase.co`||target.database!=='postgres'||
   target.isolationVerified!==true||target.syntheticWritesAuthorized!==true||!target.providerEvidenceFile||!target.approvalReference){
  throw Error('V9_ISOLATED_STAGING_EVIDENCE_REQUIRED');
 }
 if(!Number.isInteger(target.port)||target.port<1||target.port>65535)throw Error('V9_INVALID_PORT');
 return target;
}
export function stagingPoolConfig(target,user,password,ca,{ci=false,max=2}={}){
 verifyStagingTarget(target,{ci});
 if(!['postgres','orulo_webhook_writer','orulo_provenance_reader'].includes(user)||typeof password!=='string'||!password||!ca)throw Error('V9_EXCLUSIVE_CREDENTIALS_AND_CA_REQUIRED');
 return {host:target.host,port:target.port,database:target.database,user,password,max,
  ssl:{ca,rejectUnauthorized:true,servername:ci?'localhost':target.host},enableChannelBinding:true,
  connectionTimeoutMillis:5000,idleTimeoutMillis:1000,query_timeout:10000,statement_timeout:8000,
  application_name:'orulo-v9-synthetic-validation',options:'-c TimeZone=UTC'};
}
export function verifyProviderEvidence(target){
 verifyStagingTarget(target);
 const evidence=JSON.parse(readFileSync(target.providerEvidenceFile,'utf8'));
 if(evidence.id!==target.projectRef||evidence.name!==target.name||evidence.organization_id!==target.organizationId||
  evidence.database?.host!==target.host||evidence.status!=='ACTIVE_HEALTHY')throw Error('V9_PROVIDER_IDENTITY_MISMATCH');
 // This guards selection; it is not an administrative recovery authorization.
 return true;
}
export function cleanSessionQueries(pool){
 return {async query(sql,args){
  const client=await pool.connect();let destroy=false;
  try{
   await client.query('rollback');await client.query('discard all');
   return await client.query(sql,args);
  }catch(error){destroy=true;throw error;}
  finally{
   try{await client.query('rollback');await client.query('discard all');}
   catch{destroy=true;}
   client.release(destroy);
  }
 }};
}
