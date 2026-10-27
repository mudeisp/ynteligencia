// Supplier facts determine meaning. Names, prices and photography never classify a product.
const text=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const positive=v=>v!==null && v!==undefined && Number.isFinite(Number(v)) && Number(v)>0;
const format=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n);
const span=values=>{const nums=[...new Set(values.filter(positive).map(Number))].sort((a,b)=>a-b);return nums.length?(nums[0]===nums.at(-1)?format(nums[0]):`${format(nums[0])} a ${format(nums.at(-1))}`):'';};
export function unitNature(unit){
 const type=text(unit.unitType || unit.typology_type);
 if(/terreno|\blote\b|loteamento/.test(type))return 'land';
 if(/studio|estudio/.test(type))return 'studio';
 if(/\bcasa\b|sobrado/.test(type))return 'house';
 if(/apartamento|garden|cobertura|duplex|triplex/.test(type))return 'apartment';
 if(/\bloft\b/.test(type))return 'loft';
 if(type)return 'other';
 if(text(unit.building_type)==='vertical' && text(unit.finality)==='residencial')return 'apartment';
 return 'unknown';
}
export function productSemantics(g){
 const units=g.units||[],kinds=[...new Set(units.map(unitNature))],kind=kinds.length===1?kinds[0]:kinds.length?'mixed':'unknown';
 const land=kind==='land',residential=units.length>0 && kinds.every(k=>['apartment','studio','house','loft'].includes(k));
 const roomUnits=units.filter(u=>unitNature(u)!=='land');
 const bedrooms=span(roomUnits.map(u=>u.bedrooms));
 const studio=roomUnits.some(u=>unitNature(u)==='studio');
 const bedroomText=[studio?'Studio':'',bedrooms?`${bedrooms} ${bedrooms==='1'?'dormitório':'dormitórios'}`:''].filter(Boolean).join(' e ');
 const parking=span(roomUnits.map(u=>u.parking_spaces));
 const suites=span(roomUnits.map(u=>u.suites)),bathrooms=span(roomUnits.map(u=>u.bathrooms));
 const ready=/pronto|entregue|concluido/.test(text(`${g.status||''} ${g.details?.stage||''}`));
 const labels={land:'Lotes residenciais',house:'Casas',studio:'Studio',apartment:'Apartamentos',loft:'Lofts',mixed:'Configurações variadas',unknown:'',other:''};
 const vertical=text(g.details?.type)==='vertical';
 return {kind,kinds,land,residential,ready,bedrooms,bedroomText,parking,suites,bathrooms,
  cardAttribute:land?(/residencial/.test(text(g.details?.finality+' '+units.map(u=>u.unitType).join(' ')))?'Lotes residenciais':'Terrenos e lotes'):bedroomText||labels[kind]||g.details?.finality||'',
  areaLabel:land?'Área dos lotes':'Área privativa',areaCaption:land?'m² de área dos lotes':'m² de área privativa',
  countLabel:land?'lotes no projeto':'unidades no projeto',
  schemaType:units.length>0 && kinds.every(k=>['apartment','studio','loft'].includes(k)) && (vertical || kinds.every(k=>k==='apartment'))?'ApartmentComplex':'Place'};
}
export function essenceFacts(g){
 const s=productSemantics(g),d=g.details||{};
 const facts=[['area',g.area && g.area!=='Sob consulta'?g.area:'']];
 if(!s.land){if(s.bedrooms)facts.push(['bedrooms',s.bedrooms]);else if(s.bedroomText)facts.push(['product',s.bedroomText]);if(s.parking)facts.push(['parking',s.parking]);}
 if(s.land && positive(d.totalUnits))facts.push(['totalUnits',d.totalUnits]);
 if(s.ready)facts.push(['status',g.status||d.stage]);else if(d.delivery?.iso)facts.push(['delivery',d.delivery.iso.slice(0,4)]);
 for(const [key,value] of [['suites',s.suites],['totalUnits',d.totalUnits],['towers',s.residential?d.towers:null],['status',g.status||d.stage]])if(facts.filter(([,v])=>v).length<3 && value && value!=='Sob consulta' && !facts.some(([k])=>k===key))facts.push([key,value]);
 return facts.filter(([,value])=>value!=='' && value!==null && value!==undefined && value!==0).slice(0,5);
}
export function semanticTechnicalFields(g){
 const s=productSemantics(g),d=g.details||{};
 return [['Incorporadora',g.developer],['Status',g.status],['Finalidade',d.finality],['Tipo',d.type],['Tipos de unidade',[...new Set(g.units.map(u=>u.unitType).filter(Boolean))].join(', ')],['Estágio',d.stage],['Lançamento',d.launch?.label],['Entrega informada',d.delivery?.label],[s.land?'Lotes no projeto':'Unidades totais',d.totalUnits],['Estoque informado',d.stock],['Torres',!s.land && positive(d.towers)?d.towers:null],['Pavimentos',!s.land && positive(d.floors)?d.floors:null],['Apartamentos por andar',s.schemaType==='ApartmentComplex' && positive(d.perFloor)?d.perFloor:null],[s.areaLabel,g.area],['Dormitórios',s.bedroomText],['Suítes',s.suites],['Banheiros',s.bathrooms],['Vagas',s.parking]].filter(([,v])=>v!==null && v!==undefined && v!=='' && v!=='Sob consulta');
}
export function semanticDescription(g){
 const s=productSemantics(g),location=`${g.neighborhood?g.neighborhood+', ':''}${g.city}/${g.state}`;
 if(s.land)return `${g.name}. ${g.area!=='Sob consulta'?`Lotes de ${g.area}`:'Terrenos e lotes'} em ${location}.`;
 const facts=[g.area!=='Sob consulta'?g.area:'',s.bedroomText].filter(Boolean).join(', ');
 return `${g.name} em ${location}.${facts?' '+facts+'.':''}`;
}
