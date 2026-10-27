import { createHash } from 'node:crypto';

export const STATES = Object.freeze({AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'});
export const PAGE_SIZE = 18;
export const slug = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const positive = value => Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : null;
export const html = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const json = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export const money = value => positive(value) ? new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format(value) : 'Sob consulta';
export const bedroomLabel = value => value==='0'?'Sem dormitórios':value==='Sob consulta'?'Quartos sob consulta':`${value} ${value==='1'?'quarto':'quartos'}`;
export const parkingLabel = value => value==='0'?'Sem vaga':value==='Sob consulta'?'Vagas sob consulta':`${value} ${value==='1'?'vaga':'vagas'}`;
export const imageUrl = value => {try {const u=new URL(String(value)); return u.protocol==='https:' ? u.href : '';} catch {return '';}};
export function range(values, suffix='') {
  const nums=[...new Set(values.filter(v=>v!==null && v!==undefined && Number.isFinite(Number(v))).map(Number))].sort((a,b)=>a-b);
  if(!nums.length) return 'Sob consulta';
  const format=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n);
  return (nums[0]===nums.at(-1)?format(nums[0]):`${format(nums[0])} a ${format(nums.at(-1))}`)+suffix;
}
function projectId(row) {
  const id=String(row.building_id ?? '').trim() || /^orulo:(\d+):/.exec(row.external_id || '')?.[1];
  // Only a supplier ID authorizes merging. Similar names are never enough.
  if(/^\d+$/.test(id || '')) return `orulo-${id}`;
  return `imovel-${createHash('sha256').update(String(row.external_id || row.id)).digest('hex').slice(0,16)}`;
}
export function groupDevelopments(rows) {
  const groups=new Map();
  for(const row of rows) {
    if(row.active!==true || !STATES[row.state] || !row.city || !row.id) continue;
    const token=projectId(row), key=`${row.state}/${slug(row.city)}/${token}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(units=>{
    units.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const first=units[0], token=projectId(first);
    const prices=units.map(u=>positive(u.price)).filter(Boolean);
    const name=String(first.development_name || first.title || 'Imóvel');
    const path=`/${first.state.toLowerCase()}/${slug(first.city)}/empreendimento/${slug(name) || 'imovel'}--${token}`;
    const photos=[...new Set(units.flatMap(u=>[u.image_url,...(Array.isArray(u.images)?u.images.map(i=>typeof i==='string'?i:i?.url || i?.image_url):[])]).map(imageUrl).filter(Boolean))].slice(0,20);
    const newest=units.map(u=>u.updated_at).filter(v=>Number.isFinite(Date.parse(v))).sort().at(-1);
    return {token,path,name,city:first.city,state:first.state,neighborhood:first.neighborhood || '',developer:String(first.developer || ''),status:String(first.status || ''),description:String(first.description || '').slice(0,8000),units,photos,price:prices.length?Math.min(...prices):null,area:range(units.map(u=>positive(u.area)),' m²'),bedrooms:range(units.map(u=>u.bedrooms===null?null:Number(u.bedrooms))),parking:range(units.map(u=>u.parking_spaces===null?null:Number(u.parking_spaces))),updatedAt:newest};
  });
}
export function parseRoute(path) {
  let parts;
  try {parts=String(path).split('/').filter(Boolean).map(decodeURIComponent);}catch{return null;}
  const state=parts[0]?.toUpperCase();
  if(!STATES[state]) return null;
  if(parts.length===1) return {kind:'state',state};
  const city=parts[1];
  if(!/^[a-z0-9-]+$/.test(city)) return null;
  if(parts.length===2) return {kind:'city',state,city};
  if(parts.length===3 && parts[2]!=='empreendimento' && /^[a-z0-9-]+$/.test(parts[2])) return {kind:'neighborhood',state,city,neighborhood:parts[2]};
  const match=/--(orulo-\d+|imovel-[a-f0-9]{16})$/.exec(parts[3] || '');
  if(parts[2]==='empreendimento' && match && (parts.length===4 || (parts.length===6 && parts[4]==='tipologia' && /^[0-9a-f-]{36}$/i.test(parts[5])))) return {kind:parts.length===6?'unit':'development',state,city,token:match[1],unitId:parts[5]};
  return null;
}
export function parseFilters(params) {
  const number=key=>positive(params.get(key));
  const page=String(params.get('pagina') || '1');
  return {city:slug(params.get('cidade')),neighborhood:slug(params.get('bairro')),q:String(params.get('q')||'').trim().slice(0,100),max:number('preco'),bedrooms:number('quartos'),sort:['preco-asc','preco-desc','recentes'].includes(params.get('ordem'))?params.get('ordem'):'recentes',page:/^[1-9]\d{0,5}$/.test(page)?Number(page):0};
}
export function listDevelopments(groups,route,filters) {
  // Apply all unit constraints together, before aggregating the visible range.
  const selected=groups.filter(g=>g.state===route.state && (!route.city || slug(g.city)===route.city) && (!route.neighborhood || slug(g.neighborhood)===route.neighborhood) && (!filters.city || slug(g.city)===filters.city) && (!filters.neighborhood || slug(g.neighborhood)===filters.neighborhood) && (!filters.q || slug(`${g.name} ${g.developer} ${g.neighborhood} ${g.city}`).includes(slug(filters.q))));
  const visible=selected.flatMap(g=>{
    const units=g.units.filter(u=>(!filters.max || (positive(u.price) && Number(u.price)<=filters.max)) && (!filters.bedrooms || Number(u.bedrooms)>=filters.bedrooms));
    return units.length ? groupDevelopments(units) : [];
  });
  visible.sort((a,b)=>{
    if(filters.sort==='preco-asc') return (a.price??Infinity)-(b.price??Infinity) || a.path.localeCompare(b.path);
    if(filters.sort==='preco-desc') return (b.price??-Infinity)-(a.price??-Infinity) || a.path.localeCompare(b.path);
    return String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')) || a.path.localeCompare(b.path);
  });
  return {all:visible,total:visible.length,pages:Math.max(1,Math.ceil(visible.length/PAGE_SIZE)),items:visible.slice((filters.page-1)*PAGE_SIZE,filters.page*PAGE_SIZE)};
}
export function geography(groups,state) {
  const cities=new Map();
  for(const g of groups.filter(g=>g.state===state)) {
    const key=slug(g.city);
    if(!cities.has(key)) cities.set(key,{name:g.city,slug:key,count:0,neighborhoods:new Map()});
    const city=cities.get(key); city.count++;
    if(g.neighborhood) {const n=slug(g.neighborhood);const previous=city.neighborhoods.get(n);city.neighborhoods.set(n,{name:g.neighborhood,slug:n,count:(previous?.count||0)+1});}
  }
  return [...cities.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,'pt-BR'));
}
