import { readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const AUTHORIZED_BUILDINGS = Object.freeze(JSON.parse(readFileSync(new URL('./orulo-media-recovery-lote1.ids.json',import.meta.url),'utf8')));
const allowed = new Set(AUTHORIZED_BUILDINGS);
const imageKeys = ['image_url','images','2280x1800','1024x1024','520x280','url'];
export const buildingIdOf = row => String(row?.raw_data?.building_id ?? row?.raw_data?.building?.id ?? '');
const stable = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));
  return value;
}
export function preserved(row) {
  const copy = structuredClone(row);
  delete copy.updated_at;
  if (copy.raw_data?.building) delete copy.raw_data.building.floor_plans;
  return stable(copy);
}
export function imageOnlyPlans(rawData, livePlans) {
  const live = new Map(livePlans.filter(p=>p?.id!=null).map(p=>[String(p.id),p]));
  return (rawData?.building?.floor_plans ?? []).map(plan=>{
    const extra = live.get(String(plan?.id ?? ''));
    if (!extra) return plan;
    const next = {...plan};
    for (const key of imageKeys) {
      const value = extra[key];
      if ((typeof value === 'string' && value.length) ||
          (key === 'images' && Array.isArray(value) && value.length && value.every(v=>typeof v === 'string' && v.length))) next[key]=value;
    }
    return next;
  });
}
export function validateWriteScope(args) {
  if (!Array.isArray(args.buildingIds) || !args.buildingIds.length ||
      args.buildingId != null || args.states?.join(',') !== 'SP' ||
      args.buildingIds.some(id=>!allowed.has(id))) throw new Error('CAS_EXPLICIT_AUTHORIZED_IDS_REQUIRED');
}
export function openLedger(path) {
  if (!path) throw new Error('CAS_LEDGER_REQUIRED');
  // Never reuse an operation ledger or retry an unfinished run implicitly.
  const fd = openSync(path,'ax',0o600);
  const record = async event => {
    const bytes = Buffer.from(JSON.stringify({at:new Date().toISOString(),...event})+'\n');
    for (let offset=0; offset<bytes.length;) {
      const written = writeSync(fd,bytes,offset,bytes.length-offset);
      if (!written) throw new Error('CAS_LEDGER_SHORT_WRITE');
      offset += written;
    }
    fsyncSync(fd);
  };
  record.close = () => closeSync(fd);
  return record;
}
export async function casFloorPlans({id,buildingId,livePlans,fetchImpl=fetch,record,url,key}) {
  if (!id || !allowed.has(buildingId) || typeof record !== 'function') throw new Error('CAS_SCOPE_OR_LEDGER_INVALID');
  const headers = {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const read = async () => {
    const response = await fetchImpl(`${url}/rest/v1/properties?select=*&id=eq.${encodeURIComponent(id)}`,
      {headers,signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('CAS_READBACK_FAILED');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length>1) throw new Error('CAS_READBACK_INVALID');
    return rows[0] ?? null;
  };
  const operationId = randomUUID();
  let expected;
  try { expected = await read(); }
  catch (error) {
    await record({type:'PREWRITE_READ_FAILURE',operationId,id,buildingId,error:error?.message});
    throw error;
  }
  if (!expected) {
    await record({type:'RESULT',operationId,id,buildingId,status:'NOT_FOUND'});
    return {status:'NOT_FOUND',id};
  }
  if (expected.id!==id || buildingIdOf(expected)!==buildingId || expected.state!=='SP' || expected.source!=='novos' || expected.active!==true) {
    await record({type:'RESULT',operationId,id,buildingId,status:'CONFLICT'});
    return {status:'CONFLICT',id};
  }
  const plans = imageOnlyPlans(expected.raw_data,livePlans);
  const desired = {...expected,raw_data:{...expected.raw_data,building:{...expected.raw_data.building,floor_plans:plans}}};
  const event = {operationId,id,buildingId,expected,desiredPlans:plans};
  await record({type:'INTENT',...event}); // durable before the only mutating request
  let result;
  try {
    const response = await fetchImpl(`${url}/rest/v1/rpc/orulo_media_cas`,{
      method:'POST',headers,signal:AbortSignal.timeout(30000),
      body:JSON.stringify({p_id:id,p_expected:expected,p_floor_plans:plans})
    });
    if (!response.ok) throw new Error(`CAS_RPC_HTTP_${response.status}`);
    result = await response.json();
    if (result?.id !== id || !['UPDATED','UNCHANGED','CONFLICT','NOT_FOUND'].includes(result?.status)) throw new Error('CAS_RPC_INVALID_RESULT');
  } catch (error) {
    // A timeout/error can happen after commit. Read; never issue a second mutation automatically.
    let observed = null, readFailed = false;
    try { observed = await read(); } catch { readFailed = true; }
    const matchesDesired = observed && preserved(observed)===preserved(expected) &&
      stable(observed.raw_data?.building?.floor_plans)===stable(plans);
    result = {id,status:readFailed?'AMBIGUOUS':!observed?'NOT_FOUND':matchesDesired?'UNCHANGED':
      stable(observed)===stable(expected)?'AMBIGUOUS':'CONFLICT',
      resolution:matchesDesired?'EXPECTED_STATE_OBSERVED_ACTOR_UNPROVEN':'NO_RETRY_READBACK_REQUIRED',
      ambiguousResponse:true,error:error?.message,observed};
    await record({type:'READBACK_AFTER_AMBIGUOUS_RESPONSE',operationId,...result});
    return result;
  }
  if (['UPDATED','UNCHANGED'].includes(result.status)) {
    let observed;
    try { observed = await read(); }
    catch {
      const pending = {...result,status:'AMBIGUOUS',confirmedRpcStatus:result.status,resolution:'POST_COMMIT_READBACK_FAILED'};
      await record({type:'RESULT',operationId,...pending}); return pending;
    }
    if (!observed || preserved(observed)!==preserved(expected) ||
        stable(observed.raw_data?.building?.floor_plans)!==stable(plans)) {
      await record({type:'POST_WRITE_DIVERGENCE',operationId,id,rpcStatus:result.status,observed});
      throw new Error('CAS_STOP_POST_WRITE_DIVERGENCE');
    }
    result = {...result,observed};
  }
  await record({type:'RESULT',operationId,...result});
  return result;
}

