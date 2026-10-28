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
const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
const parseTotal=value=>{const match=/\/(\d+)$/.exec(String(value||''));return match?Number(match[1]):null;};

async function fetchListingPage(request,state,offset,{count=false}={}) {
  const params=new URLSearchParams({select:'*',state:`eq.${state}`,order:'id.asc',limit:'1000',offset:String(offset)});
  const response=await request(`portal_inventory_listing?${params}`,{method:'GET',signal:AbortSignal.timeout(20000),prefer:count?'count=exact':undefined,includeContentRange:count});
  if(!response.ok || !Array.isArray(response.data)) throw new Error('portal_listing_unavailable');
  return response;
}
async function readListingView(request,state) {
  const first=await fetchListingPage(request,state,0,{count:true});
  const rows=[...first.data];
  const total=parseTotal(first.contentRange);
  if(first.data.length<1000 || total===rows.length)return rows;
  if(total!==null) {
    if(total>50000)throw new Error('inventory_read_limit');
    const offsets=[];for(let offset=1000;offset<total;offset+=1000)offsets.push(offset);
    for(const batch of chunks(offsets,6)) {
      const pages=await Promise.all(batch.map(offset=>fetchListingPage(request,state,offset)));
      for(const page of pages)rows.push(...page.data);
    }
    if(rows.length<total)throw new Error('inventory_incomplete');
    return rows;
  }
  for(let offset=1000;offset<50000;offset+=1000) {
    const page=await fetchListingPage(request,state,offset);
    rows.push(...page.data);
    if(page.data.length<1000)return rows;
  }
  throw new Error('inventory_read_limit');
}

export async function readInventory(state,{request,configured,now=Date.now,cacheable=false,mode='full',ids=[]}={}) {
  if(!STATES[state]) throw new Error('invalid_state');
  if(!configured()) throw new Error('inventory_not_configured');
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
  const cacheKey=`${state}:listing:${PORTAL_SOURCE}`;
  const cached=cache.get(cacheKey);
  if(cacheable && cached && cached.expires>now()) return cached.rows;
  if(mode==='listing') {
    const rows=await readListingView(request,state);
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
