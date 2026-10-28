import {productSemantics} from './semantics.js';
import {renderFloorPlans as architecturalPlans} from './floor-plans.js';
export {architecturalPlans};
import { getEditorialSource, editorialPlanImage } from './editorial-sources.js';
import { planComposition, groupFloorPlans, groupConfigurations } from './composition.js';
import {html as h,money,range,positive,slug,STATES} from './model.js';
import {unitLabel,typology} from './presentation.js';
import {editorialCard,technicalSheet} from './editorial.js';

// Editorial selections only. Inventory, prices and integrations stay in their existing source.
// These public media URLs are published by the developer on the project's official website.
const img=(url,alt,eager=false)=>url?`<img src="${h(url)}" alt="${h(alt)}" width="1600" height="1200" loading="${eager?'eager':'lazy'}" ${eager?'fetchpriority="high"':''} decoding="async">`:'';
function safeEmbed(value){
  try{
    const url=new URL(String(value||''));
    if(url.protocol!=='https:' || url.username || url.password)return null;
    const host=url.hostname.replace(/^www\./,'');
    if(host==='youtube.com' && url.pathname.startsWith('/embed/')){
      url.searchParams.set('autoplay','1');url.searchParams.set('mute','1');url.searchParams.set('playsinline','1');url.searchParams.set('rel','0');url.searchParams.set('enablejsapi','1');
      return {url:url.href,provider:'youtube'};
    }
    if(host==='player.vimeo.com' && url.pathname.startsWith('/video/')){
      url.searchParams.set('autoplay','1');url.searchParams.set('muted','1');url.searchParams.set('playsinline','1');
      return {url:url.href,provider:'vimeo'};
    }
  }catch{}
  return null;
}
function heroVideo(media=[]){
  for(const item of media){const embed=item?.embed?safeEmbed(item.embed):null;if(embed)return {...item,...embed};}
  return null;
}
function artPhoto(photo,g,className=''){
  return photo?.url?`<figure class="art-photo ${className}" data-photo-orientation="${photo.orientation || 'auto'}"><button type="button" data-art-image="${h(photo.url)}" data-art-caption="${h(photo.caption || g.name)}" aria-label="Ampliar ${h(photo.caption || g.name)}">${img(photo.url,`${g.name} · ${photo.caption || 'imagem do empreendimento'}`)}<span class="art-expand" aria-hidden="true">↗</span></button><figcaption>${h(photo.caption || 'Imagem do empreendimento')}</figcaption></figure>`:'';
}
function editorialMedia(g,p,composition,skipUrl=''){
  const media=composition.media.filter(item=>(item.embed || item.url)!==skipUrl);
  if(!media.length)return '';
  const first=media[0],poster=p.videoPoster || p.landscape?.url || g.photos[0];
  return `<section class="art-film" id="midia"><header class="art-section-head wrap"><p class="art-kicker">EM MOVIMENTO</p><h2>Uma nova<br>perspectiva.</h2><p>Conheça o projeto por outros ângulos.</p></header><div class="art-player wrap" data-art-player><button class="art-video-cover" type="button" data-art-video="${h(first.embed || first.url)}" data-art-video-title="${h(first.title)}" data-art-video-embed="${Boolean(first.embed)}">${img(poster,`${g.name} · apresentação do projeto`)}<span class="art-play"><span aria-hidden="true">▷</span><small>ASSISTIR AO FILME</small></span></button></div><div class="art-episodes wrap">${(media.length>1?media:[]).map((v,i)=>`<button type="button" data-art-video="${h(v.embed || v.url)}" data-art-video-title="${h(v.title)}" data-art-video-embed="${Boolean(v.embed)}"><span>${String(i+1).padStart(2,'0')}</span>${h(v.title)} <span>↗</span></button>`).join('')}${p.source?`<a href="${h(p.source)}" target="_blank" rel="noopener noreferrer">Material publicado no site oficial do empreendimento ↗</a>`:''}</div></section>`;
}
export function renderImageStory(g,p,composition){
 if(!composition.stories.length)return '';
 const stories=composition.stories.map(story=>{
  const [a,b]=story.assets;
  if(p.approved && story.type==='A')return `<div class="art-wide-image" data-image-composition="A">${artPhoto(a,g,'art-landscape')}</div>`;
  if(p.approved && story.type==='C')return `<div class="art-image-pair wrap" data-image-composition="C"><div>${artPhoto(a,g,'art-portrait')}<p class="art-image-thought">O espaço entre<br>um dia e outro.</p></div><div class="art-pair-offset"><p class="art-kicker">LUGARES PARA ESTAR</p>${artPhoto(b,g,'art-detail')}</div></div>`;
  const photo=(asset,style)=>artPhoto(asset,g,`art-story-image ${style}`);
  if(story.type==='A')return `<div class="art-story-A wrap" data-image-composition="A">${photo(a,'')}</div>`;
  if(story.type==='B')return `<div class="art-story-B wrap" data-image-composition="B">${photo(a,'')}<div><p class="art-kicker">ARQUITETURA &amp; LUGAR</p><p class="art-image-thought">Um olhar sobre<br>${h(g.neighborhood || g.city)}.</p></div></div>`;
  return `<div class="art-story-${story.type} wrap" data-image-composition="${story.type}">${photo(a,'art-story-large')}${photo(b,'art-story-detail')}</div>`;
 }).join('');
 return `<section class="art-architecture" id="arquitetura">${stories}</section>`;
}
function configurationGroups(g,unit){return groupConfigurations(g.units).map(group=>`<section class="art-unit-group"><h3>${h(group.name)}</h3><div>${group.items.map(({item})=>typology(item,g,unit)).join('')}</div></section>`).join('');}

export function architectureComposition(g,unit,related=[]){
  const semantics=productSemantics(g),d=g.details,p=getEditorialSource(g.token),composition=planComposition(g,p,related),name=g.name.split(/\s[-–]\s/),cityPath=`/${g.state.toLowerCase()}/${slug(g.city)}`,video=heroVideo(composition.media);
  p.cover=composition.cover;p.street=composition.amenityPhoto;
  if(!p.approved){p.landscape=composition.stories.flatMap(s=>s.assets)[0];}
  const headline=p.headline || (g.description.match(/^[^.!?]{12,110}[.!?]/)?.[0]) || `${g.neighborhood || g.city}. Um novo endereço.`;
  const copy=(g.description.match(/[^.!?]+[.!?]+/g)||[]).slice(p.headline || g.description.trim().startsWith(headline)?1:0,p.headline || g.description.trim().startsWith(headline)?2:1).join(' ').trim();
  const visual=video?`<figure class="art-cover-image art-cover-video" data-hero-video data-video-provider="${video.provider}"><iframe src="${h(video.url)}" title="${h(video.title || `${g.name} · apresentação do projeto`)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" style="position:absolute;inset:0;width:100%;height:100%;border:0;display:block"></iframe><button type="button" data-art-sound aria-pressed="false" style="position:absolute;left:18px;bottom:18px;z-index:3;padding:11px 15px;border:1px solid #fff9;background:#10252bb8;color:#fff;font:500 9px/1.2 var(--sans);letter-spacing:.12em;backdrop-filter:blur(5px)">ATIVAR SOM</button><figcaption>${h(video.title || 'Vídeo oficial do empreendimento')}</figcaption></figure>`:(p.cover?`<figure class="art-cover-image">${img(p.cover.url,`${g.name} em ${g.neighborhood}, ${g.city}/${g.state}`,true)}<figcaption>${h(p.cover.caption || 'Imagem do empreendimento')}</figcaption></figure>`:'');
  const hero=`<section class="art-cover art-cover--${video?'landscape':composition.modules.cover.layout}" data-cover-orientation="${video?'landscape':composition.cover?.orientation || 'none'}"${!video && composition.cover?.ratio?` style="--photo-ratio:${composition.cover.ratio}"`:''}><div class="art-cover-type"><p class="art-kicker">${h(g.neighborhood)} · ${h(g.city)}/${h(g.state)}</p><h1 aria-label="${h(g.name)}"><span>${h(name[0])}</span>${name.length>1?`<small>${h(name.slice(1).join(' — '))}</small>`:''}</h1><div class="art-cover-credit">${g.developer?`<span>${h(g.developer)}</span>`:''}${g.status || d.stage?`<span>${h(g.status || d.stage)}</span>`:''}</div><a href="#sobre" class="art-discover">Conheça este endereço <span>↓</span></a></div>${visual}<span class="art-edition">YINCORP · ARQUITETURA &amp; LUGAR</span></section>`;
  const introduction=`<section class="art-manifesto art-manifesto--${copy?'full':'compact'} wrap" id="sobre"><p class="art-kicker">01 / O PROJETO</p><h2>${h(headline)}</h2>${copy?`<p class="art-manifesto-copy">${h(copy)}</p>`:''}<span class="art-quiet-location">${h(g.neighborhood)} / ${h(g.city)}</span></section>`;
  const architecture=renderImageStory(g,p,composition);
  const essence=`<section class="art-essence art-essence--${composition.facts.length} wrap" id="essencia"><p class="art-kicker">02 / A ESSÊNCIA DO PROJETO</p><div>${composition.facts.map(([key,value])=>`<p><strong>${h(key==='area'?value.replace(' m²',''):value)}</strong><span>${{area:semantics.areaCaption,bedrooms:'dormitórios',parking:'vagas',delivery:'entrega informada',suites:'suítes',totalUnits:semantics.countLabel,product:'configuração',status:'estágio do projeto',towers:'torres'}[key]}</span></p>`).join('')}</div></section>`;
  const amenities=d.amenities.length || d.unitAmenities.length?`<section class="art-amenities art-amenities--${composition.modules.amenities.layout} wrap" id="diferenciais"><div class="art-amenities-title"><p class="art-kicker">04 / ALÉM DA PORTA DE ENTRADA</p><h2>${p.approved?'O privilégio<br>dos pequenos<br>momentos.':'Espaços para<br>o dia a dia.'}</h2>${p.street?artPhoto(p.street,g,'art-street'):''}</div><div class="art-amenities-list"><p>Destaques do empreendimento.</p><ul>${composition.highlights.map(n=>`<li>${h(n)}</li>`).join('')}</ul>${composition.allAmenities.length>composition.highlights.length?`<details class="art-all-amenities"><summary>Todos os diferenciais (${composition.allAmenities.length})</summary><ul>${composition.allAmenities.map(n=>`<li>${h(n)}</li>`).join('')}</ul></details>`:''}</div></section>`:'';
  const address=[d.street,d.zip?`CEP ${d.zip}`:''].filter(Boolean).join(' · ');
  const location=`<section class="art-location art-location--${composition.modules.location.layout}" id="localizacao"><div class="wrap art-location-layout"><div><p class="art-kicker">05 / O LUGAR FAZ PARTE</p><h2>${h(g.neighborhood || g.city)}<span>${h(g.city)}, ${h(STATES[g.state])}.</span></h2><p class="art-address">${h(address)}</p><a href="${cityPath}">Outros endereços em ${h(g.city)} ↗</a></div>${d.coordinates?`<div class="map-placeholder art-map"><span>${h(g.neighborhood || g.city)}</span><p>Uma perspectiva sobre os seus próximos caminhos.</p><button class="editorial-link" data-map="https://www.google.com/maps?q=${d.coordinates.lat},${d.coordinates.lng}&amp;output=embed" type="button">Explorar o mapa <span>↗</span></button><a href="https://www.google.com/maps/search/?api=1&amp;query=${d.coordinates.lat},${d.coordinates.lng}" target="_blank" rel="noopener noreferrer">Abrir no Google Maps</a></div>`:''}</div></section>`;
  const developer=g.developer?`<section class="art-developer wrap"><p class="art-kicker">UMA REALIZAÇÃO</p><h2>${h(g.developer)}</h2>${p.source?`<a href="${h(p.source)}" target="_blank" rel="noopener noreferrer">Conheça o site oficial do empreendimento ↗</a>`:''}</section>`:'';
  const availability=`<section class="art-availability wrap" id="disponibilidade" data-contact-start><p class="art-kicker">06 / SEU PRÓXIMO CAPÍTULO</p><div class="art-offer"><div><small>${unit?'Configuração selecionada':g.price?'A partir de':'Disponibilidade'}</small><strong>${h(money(unit?unit.price:g.price))}</strong><p>Consulte unidades e disponibilidade.</p></div><div><h2>Quer conhecer<br>${h(name[0])}?</h2><p>Uma conversa para conhecer os detalhes<br>e encontrar a configuração para você.</p><button class="button primary" data-contact="${unit?h(unit.id):''}">Consultar disponibilidade ↗</button><small>Nome e WhatsApp para começar. E-mail opcional.</small></div></div><details class="art-availability-details" id="tipologias"><summary>Compare as configurações <span>${g.units.length} no catálogo ↗</span></summary><div class="typology-list">${configurationGroups(g,unit)}</div></details></section>`;
  const specs=`<details class="art-specifications"><summary class="wrap">Ficha técnica e informações do empreendimento <span>+</span></summary>${composition.technicalFields?technicalSheet(g):''}<div class="wrap art-full-description">${g.description?`<p>${h(g.description)}</p>`:''}<p>Imagens e plantas ilustrativas do material de divulgação. Informações, valores e disponibilidade sujeitos à confirmação.</p></div></details>`;
  const relatedHTML=related.length?`<section class="art-related art-related--${related.length} wrap"><p class="art-kicker">CONTINUE DESCOBRINDO</p><h2>Outras formas<br>de viver ${h(g.city)}.</h2><div class="project-grid">${related.map(editorialCard).join('')}</div></section>`:'';
  const dialogs=`<dialog id="art-image-dialog" aria-labelledby="art-image-caption"><div class="gallery-toolbar"><h2 id="art-image-caption">${h(g.name)}</h2><button type="button" data-art-close aria-label="Fechar imagem">×</button></div><img id="art-image-full" alt="" width="1800" height="1200"></dialog><dialog id="gallery-dialog" aria-labelledby="gallery-title"><div class="gallery-toolbar"><h2 id="gallery-title">${h(g.name)}</h2><button type="button" data-gallery-close aria-label="Fechar galeria">×</button></div><img id="gallery-image" alt="" width="1600" height="1200"><div class="gallery-controls"><button type="button" data-gallery-prev>← Anterior</button><p id="gallery-counter" aria-live="polite"></p><button type="button" data-gallery-next>Próxima →</button></div></dialog>`;
  const modules={cover:()=>hero,manifesto:()=>introduction,imageStory:()=>architecture+fullGallery,film:()=>editorialMedia(g,p,composition,video?.embed || ''),essence:()=>essence,floorPlans:()=>architecturalPlans(g),amenities:()=>amenities,location:()=>location,developer:()=>developer,availability:()=>availability,technical:()=>specs,related:()=>relatedHTML};
  const fullGallery=composition.photos.length>1?`<div class="art-gallery-invitation wrap"><p>Há mais de um jeito<br>de olhar para este projeto.</p><button type="button" class="editorial-link" data-gallery="0">Ver todas as fotos (${g.photos.length}) <span>↗</span></button></div>`:'';
  return `<div class="architecture-story ${composition.approved?'composition-curated':'composition-adaptive'}" data-composition-modules="${composition.order.join(' ')}">${composition.order.map(id=>modules[id]()).join('')}${composition.modules.imageStory.enabled?'':fullGallery}${dialogs}</div>`;

}
