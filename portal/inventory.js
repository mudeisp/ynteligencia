import {newDevelopmentIndexFilters} from './eligibility.js';
import { STATES } from './model.js';

// Public editorial portal = development inventory. Used/resale listings remain in the app
// and must not be misclassified as one-project-per-listing SEO pages.
const PORTAL_SOURCE='novos';
const BASE=['id','external_id','source','title','development_name','city','state','neighborhood','price','area','bedrooms','parking_spaces','image_url','active','updated_at','building_id:raw_data->>building_id','developer:raw_data->building->>developer','status:raw_data->building->>status'];
const FULL_SELECT=[...BASE,'description:raw_data->building->>description','images:raw_data->images',
  ...['address','features','building_features','unit_features','floor_plans','finality','stage','stock','total_units','number_of_floors','number_of_towers','apts_per_floor','launch_date','opening_date','images','type','videos','virtual_tour','webpage','orulo_url'].map(field=>`${field==='stock'?'building_stock':field==='images'?'building_images':field==='type'?'building_type':field}:raw_data->building->${field}`),
  ...['type','reference','stock','features','parking','suites','bathrooms','private_area','discount_price','original_price'].map(field=>`${['type','reference','stock','features','parking'].includes(field)?'typology_':''}${field}:raw_data->typology->${field}`)
].join(',');
const cache=new Map();
const scopedCaches=new WeakMap();
const SUMMARY_SELECT='id,building_id,city,state,neighborhood,price,development_name,title,active';
// Cache only public listing snapshots, never contact/session data or full details.
async function snapshot(request,key,load,{cacheable,now}) {
  if(!cacheable)return load();
  let entries=scopedCaches.get(request);
  if(!entries){entries=new Map();scopedCaches.set(request,entries);}
  const previous=entries.get(key);
  if(previous?.pending)return previous.pending;
  if(previous?.expires>now())return previous.rows;
  const entry={};
  const pending=Promise.resolve().then(load).then(rows=>{
    if(entries.get(key)===entry){entry.rows=rows;entry.expires=now()+60000;delete entry.pending;}
    return rows;
  }).catch(error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
  entry.pending=pending;entries.set(key,entry);
  // Bound per-instance public snapshots; in-flight callers retain their promise.
  while(entries.size>128)entries.delete(entries.keys().next().value);
  return pending;
}
async function indexRequest(request,params) {
  const response=await request(`portal_development_index?${params}`,{method:'GET',signal:AbortSignal.timeout(20000)});
  if(!response.ok || !Array.isArray(response.data))throw new Error('portal_listing_unavailable');
  return response;
}
const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
const parseTotal=value=>{const match=/\/(\d+)$/.exec(String(value||''));return match?Number(match[1]):null;};

async function fetchListingPage(request,state,offset,{count=false,nationalEligibility=false}={}) {
  const params=new URLSearchParams({...nationalEligibility?newDevelopmentIndexFilters():{},select:'*',state:`eq.${state}`,order:'id.asc',limit:'1000',offset:String(offset)});
  const response=await request(`portal_development_index?${params}`,{method:'GET',signal:AbortSignal.timeout(20000),prefer:count?'count=exact':undefined,includeContentRange:count});
  if(!response.ok || !Array.isArray(response.data)) {
    const payload=response?.data && typeof response.data==='object' ? response.data : {};
    console.error('PORTAL_DEVELOPMENT_INDEX_ERROR',JSON.stringify({state,offset,status:response?.status || null,code:payload.code || null,message:String(payload.message || '').slice(0,180)}));
    throw new Error('portal_listing_unavailable');
  }
  return response;
}
async function readListingIndex(request,state,nationalEligibility=false) {
  const first=await fetchListingPage(request,state,0,{count:true,nationalEligibility});
  const rows=[...first.data];
  const total=parseTotal(first.contentRange);
  if(first.data.length<1000 || total===rows.length)return rows;
  if(total!==null) {
    if(total>50000)throw new Error('inventory_read_limit');
    const offsets=[];for(let offset=1000;offset<total;offset+=1000)offsets.push(offset);
    for(const batch of chunks(offsets,6)) {
      const pages=await Promise.all(batch.map(offset=>fetchListingPage(request,state,offset,{nationalEligibility})));
      for(const page of pages)rows.push(...page.data);
    }
    if(rows.length<total)throw new Error('inventory_incomplete');
    return rows;
  }
  for(let offset=1000;offset<50000;offset+=1000) {
    const page=await fetchListingPage(request,state,offset,{nationalEligibility});
    rows.push(...page.data);
    if(page.data.length<1000)return rows;
  }
  throw new Error('inventory_read_limit');
}

export async function readInventory(state,{request,configured,now=Date.now,cacheable=false,mode='full',ids=[],buildingIds=[],city,nationalEligibility=false,p0=process.env.PORTAL_P0!=='0'}={}) {
  if(!STATES[state]) throw new Error('invalid_state');
  if(!configured()) throw new Error('inventory_not_configured');
  if(mode==='project-index') {
    const buildings=[...new Set(buildingIds.map(String))];
    if(!buildings.length || buildings.length>3 || buildings.some(id=>!/^\d+$/.test(id)))throw new Error('invalid_building_ids');
    return snapshot(request,`${state}:${nationalEligibility}:projects:${buildings.slice().sort().join(',')}`,async()=>{
      const params=new URLSearchParams({...nationalEligibility?newDevelopmentIndexFilters():{},select:'*',state:`eq.${state}`,building_id:`in.(${buildings.join(',')})`,order:'id.asc',limit:'3'});
      return (await indexRequest(request,params)).data;
    },{cacheable,now});
  }
  if(mode==='city-summary') {
    if(typeof city!=='string' || !city || city.length>200)throw new Error('invalid_city');
    return snapshot(request,`${state}:city:${city}:${nationalEligibility}`,async()=>{
      const rows=[];
      // City names originate from the inventory, not route interpolation.
      for(let offset=0;offset<50000;offset+=1000){
        const params=new URLSearchParams({...nationalEligibility?newDevelopmentIndexFilters():{},select:nationalEligibility?'*':SUMMARY_SELECT,state:`eq.${state}`,city:`eq.${city}`,order:'id.asc',limit:'1000',offset:String(offset)});
        const response=await indexRequest(request,params);rows.push(...response.data);
        if(response.data.length<1000)return rows;
      }
      throw new Error('inventory_read_limit');
    },{cacheable,now});
  }
  const normalizedIds=[...new Set((ids||[]).map(String).filter(Boolean))];
  if(mode==='project') {
    if(!normalizedIds.length)return [];
    const rows=[];
    for(const part of chunks(normalizedIds,150)) {
      const params=new URLSearchParams({select:FULL_SELECT,active:'eq.true',state:`eq.${state}`,source:`eq.${PORTAL_SOURCE}`,id:`in.(${part.join(',')})`,order:'id.asc'});
      const response=await request(`properties?${params}`,{method:'GET',signal:AbortSignal.timeout(20000)});
      if(!response.ok || !Array.isArray(response.data)) throw new Error('inventory_project_unavailable');
      rows.push(...response.data);
    }
    return rows;
  }
  const cacheKey=`${state}:listing:${PORTAL_SOURCE}:${nationalEligibility}`;
  if(p0 && mode==='listing')return snapshot(request,cacheKey,()=>readListingIndex(request,state,nationalEligibility),{cacheable,now});
  const cached=cache.get(cacheKey);
  if(cacheable && cached && cached.expires>now()) return cached.rows;
  if(mode==='listing') {
    const rows=await readListingIndex(request,state,nationalEligibility);
    if(cacheable)cache.set(cacheKey,{expires:now()+60000,rows});
    return rows;
  }
  // Legacy full-state mode is retained only for callers outside the public portal.
  const rows=[];
  for(let offset=0;offset<50000;offset+=500) {
    const params=new URLSearchParams({select:FULL_SELECT,active:'eq.true',state:`eq.${state}`,source:`eq.${PORTAL_SOURCE}`,order:'id.asc',limit:'500',offset:String(offset)});
    const response=await request(`properties?${params}`,{method:'GET',signal:AbortSignal.timeout(20000)});
    if(!response.ok || !Array.isArray(response.data)) throw new Error('inventory_unavailable');
    rows.push(...response.data);
    if(response.data.length<500)return rows;
  }
  throw new Error('inventory_read_limit');
}
