import { STATES } from './model.js';

// Public editorial portal = development inventory. Used/resale listings remain in the app
// and must not be misclassified as one-project-per-listing SEO pages.
const PORTAL_SOURCE='novos';
const BASE=['id','external_id','source','title','development_name','city','state','neighborhood','price','area','bedrooms','parking_spaces','image_url','active','updated_at','building_id:raw_data->>building_id','developer:raw_data->building->>developer','status:raw_data->building->>status'];
const LIGHT_SELECT=[...BASE,
  'building_type:raw_data->building->type','finality:raw_data->building->finality','stage:raw_data->building->stage','building_stock:raw_data->building->stock','total_units:raw_data->building->total_units','opening_date:raw_data->building->opening_date',
  'typology_type:raw_data->typology->type','typology_stock:raw_data->typology->stock','typology_parking:raw_data->typology->parking','suites:raw_data->typology->suites','bathrooms:raw_data->typology->bathrooms','private_area:raw_data->typology->private_area','discount_price:raw_data->typology->discount_price','original_price:raw_data->typology->original_price'
].join(',');
const FULL_SELECT=[...BASE,'description:raw_data->building->>description','images:raw_data->images',
  ...['address','features','building_features','unit_features','floor_plans','finality','stage','stock','total_units','number_of_floors','number_of_towers','apts_per_floor','launch_date','opening_date','images','type','videos','virtual_tour','webpage','orulo_url'].map(field=>`${field==='stock'?'building_stock':field==='images'?'building_images':field==='type'?'building_type':field}:raw_data->building->${field}`),
  ...['type','reference','stock','features','parking','suites','bathrooms','private_area','discount_price','original_price'].map(field=>`${['type','reference','stock','features','parking'].includes(field)?'typology_':''}${field}:raw_data->typology->${field}`)
].join(',');
const cache=new Map();
const chunks=(values,size)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
const parseTotal=value=>{const match=/\/(\d+)$/.exec(String(value||''));return match?Number(match[1]):null;};
const pageParams=(state,select,offset,limit=500)=>new URLSearchParams({select,active:'eq.true',state:`eq.${state}`,source:`eq.${PORTAL_SOURCE}`,order:'id.asc',limit:String(limit),offset:String(offset)});
async function fetchPage(request,state,select,offset,{count=false}={}) {
  const response=await request(`properties?${pageParams(state,select,offset)}`,{method:'GET',signal:AbortSignal.timeout(20000),prefer:count?'count=exact':undefined,includeContentRange:count});
  if(!response.ok || !Array.isArray(response.data)) throw new Error('inventory_unavailable');
  return response;
}
async function readListingRpc(request,state) {
  const response=await request('rpc/portal_inventory_listing_v2',{method:'POST',body:{p_state:state},prefer:'return=representation',signal:AbortSignal.timeout(20000)});
  return response.ok && Array.isArray(response.data) ? response.data : null;
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
  const select=mode==='listing'?LIGHT_SELECT:FULL_SELECT;
  const cacheKey=`${state}:${mode}:${PORTAL_SOURCE}`;
  const cached=cache.get(cacheKey);
  if(cacheable && cached && cached.expires>now()) return cached.rows;

  if(mode==='listing') {
    const rpcRows=await readListingRpc(request,state);
    if(rpcRows) {
      if(cacheable)cache.set(cacheKey,{expires:now()+60000,rows:rpcRows});
      return rpcRows;
    }
    // Safe compatibility fallback while deployments/migrations roll independently.
  }

  const first=await fetchPage(request,state,select,0,{count:true});
  const rows=[...first.data];
  if(first.data.length<500) {
    if(cacheable)cache.set(cacheKey,{expires:now()+60000,rows});
    return rows;
  }
  const total=parseTotal(first.contentRange);
  if(total!==null) {
    if(total>50000)throw new Error('inventory_read_limit');
    const offsets=[];for(let offset=500;offset<total;offset+=500)offsets.push(offset);
    for(const batch of chunks(offsets,8)) {
      const pages=await Promise.all(batch.map(offset=>fetchPage(request,state,select,offset)));
      for(const page of pages)rows.push(...page.data);
    }
    if(rows.length<total)throw new Error('inventory_incomplete');
    if(cacheable)cache.set(cacheKey,{expires:now()+60000,rows});
    return rows;
  }

  for(let offset=500;offset<50000;offset+=500) {
    const response=await fetchPage(request,state,select,offset);
    rows.push(...response.data);
    if(response.data.length<500) {
      if(cacheable)cache.set(cacheKey,{expires:now()+60000,rows});
      return rows;
    }
  }
  throw new Error('inventory_read_limit');
}
