// Production Órulo OAuth + floor-plans adapter. No database writes.
import {fetchOruloFloorPlans} from '../orulo-floor-plans.js';
export function createOruloSource({clientId,clientSecret,fetchImpl=fetch,timeoutMs=15000}={}) {
 if(!clientId||!clientSecret||typeof fetchImpl!=='function')throw Error('ORULO_CONFIG_REQUIRED');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw Error('ORULO_TIMEOUT_INVALID');
 let token=null;
 const call=async(url,options={})=>fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
 return async buildingId=>{
  if(!/^[1-9][0-9]*$/.test(String(buildingId)))throw Error('ORULO_BUILDING_ID_INVALID');
  if(!token){
   const auth=await call('https://www.orulo.com.br/oauth/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'client_credentials'}).toString()
   });
   if(!auth.ok)throw Error('ORULO_AUTH_HTTP_'+auth.status);
   const data=await auth.json();
   if(typeof data?.access_token!=='string'||!data.access_token)throw Error('ORULO_AUTH_INVALID_RESPONSE');
   token=data.access_token;
  }
  const plans=await fetchOruloFloorPlans(buildingId,{Authorization:'Bearer '+token,Accept:'application/json'},{fetchImpl:call});
  if(!Array.isArray(plans)||plans.some(p=>p?.id==null)||new Set(plans.map(p=>String(p.id))).size!==plans.length)
   throw Error('ORULO_SOURCE_SCHEMA_MISMATCH');
  return {floor_plans:plans};
 };
}
export function createImageChecker({fetchImpl=fetch,timeoutMs=10000}={}) {
 return async url=>{
  try {
   const u=new URL(url);
   if(u.protocol!=='https:'||u.hostname!=='static.orulo.com.br'||!u.pathname.startsWith('/images/properties/')||u.username||u.password||u.port||u.search||u.hash)return false;
   const response=await fetchImpl(u.href,{method:'GET',headers:{Range:'bytes=0-0',Accept:'image/*'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   return response.ok && (response.headers.get('content-type')??'').toLowerCase().startsWith('image/');
  }catch{return false;}
 };
}
