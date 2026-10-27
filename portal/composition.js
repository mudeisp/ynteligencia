import {essenceFacts,semanticTechnicalFields,unitNature} from './semantics.js';
// Presentation planning only: no requests, persistence, prices or inventory mutations.
export const MODULE_ORDER=Object.freeze(['cover','manifesto','imageStory','film','essence','floorPlans','amenities','location','developer','availability','technical','related']);
export const IMAGE_COMPOSITIONS=Object.freeze({A:'full-width',B:'vertical-and-text',C:'asymmetric-pair',D:'large-and-detail'});
const present=value=>value!==null && value!==undefined && value!=='' && value!=='Sob consulta';
const knownNumber=value=>value!==null && value!==undefined && Number.isFinite(Number(value));
function photoUrl(value){try{const u=new URL(typeof value==='string'?value:value?.url||value?.image_url||'');return u.protocol==='https:' && !u.username && !u.password?u.href:'';}catch{return '';}}
export function photoAsset(value,metadata={}){
 const url=photoUrl(value);if(!url)return null;
 const object=typeof value==='object'?value:{},rawWidth=Number(object.width??metadata.width),rawHeight=Number(object.height??metadata.height),width=Number.isFinite(rawWidth)?rawWidth:0,height=Number.isFinite(rawHeight)?rawHeight:0;
 const ratio=width>0 && height>0?width/height:null;
 const orientation=['portrait','landscape','square'].includes(object.orientation||metadata.orientation)?object.orientation||metadata.orientation:ratio?ratio<.85?'portrait':ratio>1.25?'landscape':'square':'auto';
 return {url,caption:object.caption||metadata.caption||'Imagem do empreendimento',role:object.role||metadata.role||'',width:width>0?width:null,height:height>0?height:null,ratio,orientation,position:object.position||metadata.position||'center'};
}
function uniquePhotos(g){
 const metadata=new Map();
 for(const row of g.units||[])for(const item of [row.images,row.building_images].flatMap(a=>Array.isArray(a)?a:[]))if(item && typeof item==='object' && photoUrl(item))metadata.set(photoUrl(item),item);
 for(const item of g.photoAssets||[])if(photoUrl(item))metadata.set(photoUrl(item),item);
 return [...new Map((g.photos||[]).map(value=>photoAsset(value,metadata.get(photoUrl(value)))).filter(Boolean).map(p=>[p.url,p])).values()];
}
function imageStory(photos){
 const remaining=[...photos],take=orientation=>{const i=remaining.findIndex(p=>p.orientation===orientation);return remaining.splice(i<0?0:i,1)[0];};
 if(!remaining.length)return [];
 if(remaining.length===1){const asset=take('portrait');return [{type:asset.orientation==='landscape'?'A':'B',assets:[asset]}];}
 if(remaining.length===2)return [{type:remaining.some(p=>/detail|detalhe/i.test(p.role))?'D':'C',assets:remaining}];
 const modules=[{type:'A',assets:[take('landscape')]}];
 if(remaining.length===2)return [...modules,{type:'C',assets:remaining}];
 modules.push({type:'B',assets:[take('portrait')]});
 modules.push({type:'D',assets:remaining.slice(0,2)});
 return modules;
}
export function planComposition(g,profile={},related=[]){
 profile=profile.verified===true?profile:{};
 const d=g.details||{},approved=profile.approved===true,photos=uniquePhotos(g);
 const explicit=photoAsset(profile.cover),cover=explicit||photos.find(p=>/facade|fachada|exterior/i.test(p.role))||photos[0]||null;
 const available=photos.filter(p=>p.url!==cover?.url);
 const reserved=approved?photoAsset(profile.street):null;
 let stories;
 if(approved){
  const wide=photoAsset(profile.landscape),left=photoAsset(profile.portrait),right=photoAsset(profile.detail);
  stories=[...(wide?[{type:'A',assets:[wide]}]:[]),...(left&&right?[{type:'C',assets:[left,right]}]:left?[{type:'B',assets:[left]}]:right?[{type:'A',assets:[right]}]:[])];
 }else {const candidates=available.length>6?[0,Math.floor(available.length*.25),Math.floor(available.length*.5),Math.floor(available.length*.75)].map(i=>available[i]):available.slice(0,4);stories=imageStory(candidates);}
 const used=new Set([cover,...stories.flatMap(s=>s.assets)].filter(Boolean).map(p=>p.url));
 const amenityPhoto=reserved||available.find(p=>!used.has(p.url))||null;
 const media=[...new Map([...(profile.media||[]),...(d.videos||[]),...(d.virtualTour?[{url:d.virtualTour,embed:d.virtualTour,title:'Tour virtual'}]:[])].filter(v=>v?.url).map(v=>[v.url,v])).values()];
 const facts=essenceFacts(g);
 const plans=d.plans||[],planImages=plans.filter(p=>p.image),amenities=[...(d.amenities||[]),...(d.unitAmenities||[])];
 const technicalFields=semanticTechnicalFields(g).length;
 const modules={
  cover:{enabled:true,layout:cover?cover.orientation==='landscape'?'landscape':cover.orientation==='auto'?'auto':'portrait':'typographic'},
  manifesto:{enabled:Boolean(profile.headline||g.description||g.neighborhood||g.city),layout:g.description?'full':'compact'},
  imageStory:{enabled:stories.length>0,layout:stories.map(s=>s.type).join('+')},
  film:{enabled:media.length>0,layout:media.length>1?'episodes':'single'},
  essence:{enabled:facts.length>0,layout:String(facts.length)},
  floorPlans:{enabled:plans.length>0,layout:!planImages.length?'descriptions':planImages.length<=3?'sequence':planImages.length<=10?'directory':'categories'},
  amenities:{enabled:amenities.length>0,layout:amenityPhoto?'illustrated':amenities.length<=4?'brief':'typographic'},
  location:{enabled:Boolean(g.neighborhood||g.city||d.street||d.coordinates),layout:d.coordinates?'map':'text'},
  developer:{enabled:Boolean(g.developer),layout:'credit'},
  availability:{enabled:true,layout:present(g.price)?'priced':'on-request'},
  technical:{enabled:technicalFields>0||Boolean(g.description),layout:technicalFields>0?'sheet':'description'},
  related:{enabled:related.length>0,layout:String(Math.min(3,related.length))}
 };
 const priority=/piscina|academia|gourmet|playground|sal[aã]o de festas|pet place|coworking|seguran[cç]a/i;
 const highlights=[...new Set(amenities)].sort((a,b)=>Number(priority.test(b))-Number(priority.test(a))).slice(0,8);
 return {approved,cover,photos,stories,amenityPhoto,media,facts,highlights,allAmenities:[...new Set(amenities)],modules,order:MODULE_ORDER.filter(id=>modules[id].enabled),counts:{photos:photos.length,plans:plans.length,planImages:planImages.length,amenities:amenities.length,media:media.length},technicalFields};
}
const ordered=['land','studio','site','rooms-1','rooms-2','rooms-3','rooms-4','rooms-5','garden','penthouse','other'];
function category(description,bedrooms,type='',isPlan=false){
 const text=`${description||''} ${type||''}`;
 if(/garden|jardim privativo/i.test(text))return {id:'garden',name:'Garden'};
 if(/cobertura|duplex|penthouse/i.test(text))return {id:'penthouse',name:'Cobertura'};
 const n=isPlan?Number(/(\d+)\s*(?:dorm|quarto)/i.exec(text)?.[1]):Number(bedrooms);
 if(Number.isInteger(n) && n>0)return {id:`rooms-${Math.min(n,5)}`,name:n>=5?'5 ou mais dormitórios':`${n} ${n===1?'dormitório':'dormitórios'}`};
 if(isPlan && /implanta|pilotis|pavimento|lazer|mezanino|t[eé]rreo|condominial/i.test(text))return {id:'site',name:'Implantação'};
 return {id:'other',name:isPlan?'Outras plantas':'Outras configurações'};
}
function grouped(items,classify){const groups=new Map();items.forEach((item,index)=>{const c=classify(item);if(!groups.has(c.id))groups.set(c.id,{...c,items:[]});groups.get(c.id).items.push({item,index});});return [...groups.values()].sort((a,b)=>ordered.indexOf(a.id)-ordered.indexOf(b.id));}
export const groupFloorPlans=plans=>grouped(plans,p=>category(p.description,null,p.type,true));
export const groupConfigurations=units=>grouped(units,u=>unitNature(u)==='land'?{id:'land',name:'Terrenos e lotes'}:unitNature(u)==='studio'?{id:'studio',name:'Studios'}:category('',u.bedrooms,u.unitType));
