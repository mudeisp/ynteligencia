import { STATES } from './model.js';

// Read the existing inventory. No schema, import, credential, or supplier changes.
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

export async function readInventory(state,{request,configured,now=Date.now,cacheable=false,mode='full',ids=[]}={}) {
  if(!STATES[state]) throw new Error('invalid_state');
  if(!configured()) throw new Error('inventory_not_configured');
  const normalizedIds=[...new Set((ids||[]).map(String).filter(Boolean))];
  if(mode==='project') {
    if(!normalizedIds.length)return [];
    const rows=[];
    for(const part of chunks(normalizedIds,150)) {
      const params=new URLSearchParams({select:FULL_SELECT,active:'eq.true',state:`eq.${state}`,id:`in.(${part.join(',')})`,order:'id.asc'});
      const response=await request(`properties?${params}`,{method:'GET',signal:AbortSignal.timeout(20000)});
      if(!response.ok || !Array.isArray(response.data)) throw new Error('inventory_project_unavailable');
      rows.push(...response.data);
    }
    return rows;
  }
  const select=mode==='listing'?LIGHT_SELECT:FULL_SELECT;
  const cacheKey=`${state}:${mode}`;
  const cached=cache.get(cacheKey);
  if(cacheable && cached && cached.expires>now()) return cached.rows;
  const rows=[];
  for(let offset=0;offset<50000;offset+=500) {
    const params=new URLSearchParams({select,active:'eq.true',state:`eq.${state}`,order:'id.asc',limit:'500',offset:String(offset)});
    // Timeout is per page. Large states must not share a single 20s deadline across all pages.
    const response=await request(`properties?${params}`,{method:'GET',signal:AbortSignal.timeout(20000)});
    if(!response.ok || !Array.isArray(response.data)) throw new Error('inventory_unavailable');
    rows.push(...response.data);
    if(response.data.length<500) {
      if(cacheable) cache.set(cacheKey,{expires:now()+60000,rows});
      return rows;
    }
  }
  // Never index an apparently complete catalog that was silently truncated.
  throw new Error('inventory_read_limit');
}
