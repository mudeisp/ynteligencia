import { STATES } from './model.js';

// Read the existing inventory. No schema, import, credential, or supplier changes.
const SELECT=['id','external_id','source','title','development_name','city','state','neighborhood','price','area','bedrooms','parking_spaces','image_url','active','updated_at','building_id:raw_data->>building_id','developer:raw_data->building->>developer','status:raw_data->building->>status','description:raw_data->building->>description','images:raw_data->images',
  ...['address','features','building_features','unit_features','floor_plans','finality','stage','stock','total_units','number_of_floors','number_of_towers','apts_per_floor','launch_date','opening_date','images','type','videos','virtual_tour','webpage','orulo_url'].map(field=>`${field==='stock'?'building_stock':field==='images'?'building_images':field==='type'?'building_type':field}:raw_data->building->${field}`),
  ...['type','reference','stock','features','parking','suites','bathrooms','private_area','discount_price','original_price'].map(field=>`${['type','reference','stock','features','parking'].includes(field)?'typology_':''}${field}:raw_data->typology->${field}`)
].join(',');
const cache=new Map();
export async function readInventory(state,{request,configured,now=Date.now,cacheable=false}={}) {
  if(!STATES[state]) throw new Error('invalid_state');
  const cached=cache.get(state);
  if(cacheable && cached && cached.expires>now()) return cached.rows;
  if(!configured()) throw new Error('inventory_not_configured');
  const rows=[], signal=AbortSignal.timeout(20000);
  for(let offset=0;offset<50000;offset+=500) {
    const params=new URLSearchParams({select:SELECT,active:'eq.true',state:`eq.${state}`,order:'id.asc',limit:'500',offset:String(offset)});
    const response=await request(`properties?${params}`,{method:'GET',signal});
    if(!response.ok || !Array.isArray(response.data)) throw new Error('inventory_unavailable');
    rows.push(...response.data);
    if(response.data.length<500) {
      if(cacheable) cache.set(state,{expires:now()+60000,rows});
      return rows;
    }
  }
  // Never index an apparently complete catalog that was silently truncated.
  throw new Error('inventory_read_limit');
}
