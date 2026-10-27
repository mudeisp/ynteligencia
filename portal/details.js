// Explicit public presentation model. No supplier contacts or commercial files.
export const text = v => typeof v==='string' ? v.trim() : '';
export function number(v) {
  if(v===null || v===undefined || typeof v==='boolean' || (typeof v==='string' && !v.trim()))return null;
  const n=Number(v);return Number.isFinite(n) && n>=0?n:null;
}
export function supplierDate(value) {
  const match=/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/.exec(text(value));
  if(!match)return null;
  const [,d,m,y]=match,dt=new Date(Date.UTC(+y,+m-1,+d));
  if(dt.getUTCFullYear()!==+y || dt.getUTCMonth()!==+m-1 || dt.getUTCDate()!==+d)return null;
  return {iso:`${y}-${m}-${d}`,label:`${d}/${m}/${y}`};
}
export function featureNames(...sources) {
  const names=new Map();
  for(const value of sources.flatMap(a=>Array.isArray(a)?a:[])) {
    const name=text(typeof value==='string'?value:value?.name);
    if(name)names.set(name.toLocaleLowerCase('pt-BR'),name);
  }
  return [...names.values()];
}
const https=v=>{try{const u=new URL(text(v));return u.protocol==='https:' && !u.username && !u.password?u.href:'';}catch{return '';}};
export function normalizeUnit(row) {
  return {...row,price:number(row.price) || number(row.discount_price) || number(row.original_price),
    area:number(row.area) || number(row.private_area),bedrooms:number(row.bedrooms),
    parking_spaces:number(row.parking_spaces)??number(row.typology_parking),suites:number(row.suites),
    bathrooms:number(row.bathrooms),stock:number(row.typology_stock),original_price:number(row.original_price),
    unitType:text(row.typology_type),reference:text(row.typology_reference),unitFeatures:featureNames(row.typology_features)};
}
export function projectDetails(rows) {
  const first=key=>rows.map(r=>r[key]).find(v=>v!==null && v!==undefined && v!=='');
  const a=first('address'),address=a && typeof a==='object' && !Array.isArray(a)?a:{};
  const street=[text(address.street_type),text(address.street),address.number===0?'0':text(String(address.number??''))].filter(Boolean).join(' ');
  const lat=Number(address.latitude),lng=Number(address.longitude);
  const coordinates=address.latitude!=null && address.longitude!=null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180 ? {lat,lng}:null;
  const plans=new Map();
  for(const plan of rows.flatMap(r=>Array.isArray(r.floor_plans)?r.floor_plans:[])) {
    if(!plan || typeof plan!=='object')continue;
    const description=text(plan.description),type=text(plan.type);
    // Only an explicit public image URL. IDs never authorize inventing a file URL.
    const image=https(plan.image_url || plan.image?.url || plan.url);
    if(description || type || image)plans.set(String(plan.id || `${type}:${description}:${image}`),{description,type,image});
  }
  return {street,zip:text(address.zip_code),coordinates,finality:text(first('finality')),type:text(first('building_type')),
    stage:text(first('stage')),stock:number(first('building_stock')),totalUnits:number(first('total_units')),
    floors:number(first('number_of_floors')),towers:number(first('number_of_towers')),perFloor:number(first('apts_per_floor')),
    launch:supplierDate(first('launch_date')),delivery:supplierDate(first('opening_date')),
    amenities:featureNames(...rows.flatMap(r=>[r.features,r.building_features])),
    unitAmenities:featureNames(...rows.flatMap(r=>[r.unit_features,r.typology_features])),plans:[...plans.values()]};
}
