// Read-only Órulo API adapter. Requires explicit endpoint and a server-side token.
// Does not infer undocumented Órulo response shapes or leak credentials.
const numeric=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v);
const https=v=>{const u=new URL(v);if(u.protocol!=='https:')throw Error('ORULO_HTTPS_REQUIRED');return u;};
export function createOruloSource({baseUrl,token,fetchImpl=fetch,timeoutMs=12000}={}) {
 if(!baseUrl||!token||typeof token!=='string'||typeof fetchImpl!=='function')throw Error('ORULO_CONFIG_REQUIRED');
 const base=https(baseUrl);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw Error('ORULO_TIMEOUT_INVALID');
 return async function source(buildingId) {
  if(!numeric(buildingId))throw Error('ORULO_BUILDING_ID_INVALID');
  const endpoint=new URL(base.href.replace(/\/$/,'')+'/buildings/'+encodeURIComponent(buildingId));
  if(endpoint.origin!==base.origin)throw Error('ORULO_ORIGIN_MISMATCH');
  const response=await fetchImpl(endpoint.href,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  if(!response.ok)throw Error('ORULO_SOURCE_HTTP_'+response.status);
  const data=await response.json();
  const building=data?.building??data?.data?.building??data;
  if(String(building?.id)!==buildingId||!Array.isArray(building?.floor_plans))
    throw Error('ORULO_SOURCE_SCHEMA_MISMATCH');
  return {floor_plans:building.floor_plans};
 };
}
export function createImageChecker({fetchImpl=fetch,timeoutMs=10000}={}) {
 return async url=>{
  try {
   const parsed=https(url);
   if(parsed.username||parsed.password||!parsed.hostname)return false;
   const response=await fetchImpl(parsed.href,{method:'GET',headers:{Range:'bytes=0-0',Accept:'image/*'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   return response.ok && (response.headers.get('content-type')??'').toLowerCase().startsWith('image/');
  }catch{return false;}
 };
}
