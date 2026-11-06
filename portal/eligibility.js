// Public new-development policy. Never writes to inventory or changes resale rules.
export const NATIONAL_MARKETS=Object.freeze(['SP','ES','RS','SC','PR','RJ','PB','PE']);
const text=value=>String(value??'').trim();
const norm=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const positive=value=>value!==null && value!==undefined && typeof value!=='boolean' && text(value)!=='' && Number.isFinite(Number(value)) && Number(value)>0;
const classes=new Set(['lancamento','em construcao','pronto novo']);
const USED='Usado';
// Optional transport pruning only; the deterministic classifier remains authoritative.
// Keep null/unknown classifications so they can become CATALOG_ONLY.
export const newDevelopmentIndexFilters=()=>({active:'eq.true',source:'eq.novos',and:`(or(status.is.null,status.neq.${USED}),or(stage.is.null,stage.neq.${USED}))`});
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const image=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!/placeholder|no[-_]?image|sem[-_]?foto/i.test(url.pathname);}catch{return false;}};
export function classifyDevelopment(row) {
  const reasons=[];
  const reject=reason=>reasons.push(reason);
  const building=text(row.building_id)||/^orulo:(\d+):/.exec(text(row.external_id))?.[1];
  if(!NATIONAL_MARKETS.includes(row.state))reject('unauthorized_state');
  if(row.active!==true)reject('inactive');
  if(row.source!=='novos'||!/^\d+$/.test(building||''))reject('unverified_origin');
  const status=norm(row.status),stage=norm(row.stage);
  if(status===norm(USED)||stage===norm(USED))reject('explicit_used');
  if([status,stage].some(value=>value&&!classes.has(value)&&value!=='usado'))reject('unsupported_classification');
  if(!uuid.test(text(row.id)))reject('invalid_identifier');
  if(!/[a-z\u00c0-\u024f]/i.test(text(row.city))||/[<>\r\n]/.test(text(row.city)))reject('invalid_city');
  if(!text(row.development_name||row.title)||/^(imovel|empreendimento)$/i.test(norm(row.development_name||row.title)))reject('missing_name');
  if(reasons.length)return {classification:'EXCLUDED',reasons,units:[],key:building};
  if(!status&&!stage)reject('unknown_classification');
  const facets=Array.isArray(row.unit_facets)?row.unit_facets:[row];
  const units=facets.filter(unit=>uuid.test(text(unit.id))&&positive(unit.price)&&positive(unit.area)&&positive(unit.typology_stock));
  if(!units.length)reject('no_priced_sized_available_unit');
  if(row.building_stock!==null&&row.building_stock!==undefined&&!positive(row.building_stock))reject('building_unavailable');
  if(!image(row.image_url))reject('missing_valid_image');
  return {classification:reasons.length?'CATALOG_ONLY':'INDEXABLE',reasons,units,key:building};
}
export function classifyInventory(rows) {
  // Stable supplier identity authorizes deduplication. Names alone never do.
  const seen=new Map();
  return rows.map(row=>{
    const result=classifyDevelopment(row),key=result.key;
    if(key&&seen.has(key))return {row,...result,classification:'EXCLUDED',reasons:[...result.reasons,'duplicate_identity'],units:[]};
    if(key)seen.set(key,row);
    return {row,...result};
  });
}
