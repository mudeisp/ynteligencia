import {html as h,range,positive} from './model.js';
import {groupFloorPlans} from './composition.js';
import {editorialPlanImage} from './editorial-sources.js';

function metrics(p,g){
 const area=/([\d]+[,.][\d]+)\s*m/i.exec(p.description)?.[1],rooms=/(\d+)\s*(?:dorm|quarto)/i.exec(p.description)?.[1];
 const matches=area?g.units.filter(u=>Math.abs((u.area??-100)-Number(area.replace(',','.')))<.015):[];
 const suites=range(matches.map(u=>positive(u.suites))),parking=range(matches.map(u=>u.parking_spaces));
 return [area?`${area} m²`:'',rooms?`${rooms} ${rooms==='1'?'quarto':'quartos'}`:'',suites!=='Sob consulta'?`${suites} ${suites==='1'?'suíte':'suítes'}`:'',parking!=='Sob consulta'?`${parking} ${parking==='1'?'vaga':'vagas'}`:''].filter(Boolean).join(' · ');
}
const title=(p,i)=>p.description || p.type || `Planta ${i+1}`;
const zoom=(p,i)=>`<button class="art-plan-zoom" type="button" data-plan-image="${h(p.image)}" data-plan-title="${h(title(p,i))}" aria-label="Ampliar ${h(title(p,i))}"><img src="${h(p.image)}" alt="${h(title(p,i))}" width="1600" height="1200" loading="lazy" decoding="async"><span>Ampliar desenho ↗</span></button>`;
const option=(p,i,index,g)=>`<button type="button" data-art-plan="${i}" data-art-plan-image="${h(p.image)}" data-art-plan-title="${h(title(p,i))}" data-art-plan-metrics="${h(metrics(p,g))}" aria-pressed="${i===index}"><span>${String(i+1).padStart(2,'0')}</span><span>${h(title(p,i))}<small>${h(metrics(p,g))}</small></span><span>↗</span></button>`;
const dialog=()=>'<dialog id="plan-dialog" aria-labelledby="plan-dialog-title"><div class="gallery-toolbar"><h2 id="plan-dialog-title">Planta do empreendimento</h2><button type="button" data-plan-close aria-label="Fechar planta">×</button></div><img id="plan-dialog-image" alt="" width="1600" height="1200"></dialog>';
export function renderFloorPlans(g){
 const plans=g.details.plans.map(p=>editorialPlanImage(g.token,p)),available=plans.filter(p=>p.image);if(!plans.length)return '';
 const layout=!available.length?'descriptions':available.length<=3?'sequence':available.length<=10?'directory':'categories';
 const index=Math.max(0,available.findIndex(p=>/planta/i.test(p.description) && /(\d+)\s*(?:dorm|quarto)/i.test(p.description))),first=available[index],groups=groupFloorPlans(available);
 let content='';
 if(first && layout==='sequence')content=`<div class="art-plan-sequence art-plan-sequence--${available.length} wrap">${available.map((p,i)=>`<article class="art-plan-canvas">${zoom(p,i)}<div class="art-plan-caption"><span>${String(i+1).padStart(2,'0')} / ${available.length}</span><h3>${h(title(p,i))}</h3></div><p class="art-plan-metrics">${h(metrics(p,g))}</p></article>`).join('')}</div>`;
 else if(first){
  const categories=layout==='categories';
  const list=categories?groups.map(group=>`<details class="art-plan-category" data-art-plan-group="${group.id}"${group.items.some(p=>p.index===index)?' open':''}><summary>${h(group.name)} <span>${group.items.length}</span></summary>${group.items.map(({item,index:i})=>option(item,i,index,g)).join('')}</details>`).join(''):available.map((p,i)=>option(p,i,index,g)).join('');
  const select=categories?groups.map(group=>`<optgroup label="${h(group.name)}">${group.items.map(({item,index:i})=>`<option value="${i}"${i===index?' selected':''}>${h(title(item,i))}</option>`).join('')}</optgroup>`).join(''):available.map((p,i)=>`<option value="${i}"${i===index?' selected':''}>${h(title(p,i))}</option>`).join('');
  content=`<div class="art-plan-layout wrap"><aside class="art-plan-directory"><label for="art-plan-select">${categories?'Categorias e plantas':'Escolha uma planta'}</label><select id="art-plan-select">${select}</select><div class="art-plan-options" aria-label="Plantas disponíveis">${list}</div></aside><div class="art-plan-canvas">${zoom(first,index)}<div class="art-plan-caption"><span data-art-plan-counter>${String(index+1).padStart(2,'0')} / ${available.length}</span><h3 data-art-selected-plan-title>${h(title(first,index))}</h3></div><p class="art-plan-metrics" data-art-plan-metrics-text>${h(metrics(first,g))}</p><p class="art-drawing-note">Desenho ilustrativo. Características do catálogo para a metragem indicada; confirme a configuração com o atendimento.</p></div></div>`;
 }
 const without=plans.filter(p=>!p.image);
 return `<section class="art-plans art-plans--${layout}" id="plantas"><div class="wrap art-plans-heading"><p class="art-kicker">O DESENHO DE CADA DIA</p><h2>Espaço para<br>a sua vida.</h2><p>${plans.length} ${plans.length===1?'planta cadastrada':'plantas cadastradas'}${available.length?` · ${available.length} com imagem`:''}</p></div>${content}${available.length?`<noscript><div class="wrap art-text-plans"><h3>Explore os desenhos</h3>${available.map(p=>`<p><a href="${h(p.image)}" target="_blank" rel="noopener noreferrer">${h(p.description || p.type || 'Planta cadastrada')} ↗</a></p>`).join('')}</div></noscript>`:''}${available.length?dialog():''}${without.length?`<div class="art-text-plans wrap"><h3>Plantas descritas no catálogo</h3>${without.map(p=>`<p>${h(p.description || p.type)}</p>`).join('')}</div>`:''}</section>`;
}
