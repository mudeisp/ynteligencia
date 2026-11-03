import {submitInterest} from './portal-contact.js';
import './whatsapp-contact.js';

const config=JSON.parse(document.getElementById('portal-data')?.textContent||'{}');
const preview=config.preview===true,property=config.property;
let tracking=null;
if(!preview){
  try{tracking=await import('./portal-session.js');}catch{console.warn('RENTAL_TELEMETRY_UNAVAILABLE');}
  // Preserve the rental GA destination. No sale conversions or new analytics backend.
  window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
  window.gtag('js',new Date());window.gtag('config','G-Y2W11SX5VV');
  const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id=G-Y2W11SX5VV';document.head.append(script);
}
const intent=()=>({purpose:'LOCACAO',operation:'LOCACAO',inventory_source:'nonstop',neighborhood:property?.neighborhood||'',development:property?.name||''});
const trackedProperty=()=>property?{...property,property_id:property.external_id||property.id,property_uuid:property.id}:null;
function track(event,details={}){
  if(preview)return Promise.resolve(null);
  const metadata={...details,purpose:'LOCACAO',operation:'LOCACAO',inventory_source:'nonstop',property_id:property?.external_id||property?.id||'',property_uuid:property?.id||'',portal:true};
  window.gtag?.('event',event,metadata);
  try{return Promise.resolve(tracking?.track(event,metadata)).catch(()=>null);}catch{return Promise.resolve(null);}
}
function adsEvent(event,metadata={}){
  if(preview)return Promise.resolve(null);
  try{return Promise.resolve(tracking?.adsTrack(event,{intent:intent(),property:trackedProperty(),metadata:{...metadata,purpose:'LOCACAO',operation:'LOCACAO'}})).catch(()=>null);}catch{return Promise.resolve(null);}
}
void track('rental_page_view',{page_path:location.pathname});
if(property){void track('property_view');void adsEvent('property_view');}
document.querySelectorAll('.card a').forEach(a=>a.addEventListener('click',()=>{void track('rental_property_click',{property_path:a.getAttribute('href')});}));
let lastTouch=0;
document.addEventListener('pointerdown',()=>{if(!preview&&Date.now()-lastTouch>30000){tracking?.touch();lastTouch=Date.now();}},{passive:true});

const gallery=document.querySelector('[data-rental-gallery]'),dialog=document.querySelector('.photo-dialog');
if(gallery&&dialog){
  const rail=gallery.querySelector('.gallery-track'),items=[...rail.querySelectorAll('[data-photo]')];
  const urls=items.map(a=>a.getAttribute('href')),viewer=dialog.querySelector('figure img'),caption=dialog.querySelector('figcaption'),counter=gallery.querySelector('.gallery-count');
  let selected=0,railIndex=0,opener=null,swipeStart=null,frame=0;
  const hydrate=i=>{const img=items[i]?.querySelector('img');if(img?.dataset.src){img.src=img.dataset.src;delete img.dataset.src;}};
  const show=(index,interaction)=>{
    selected=(index+urls.length)%urls.length;viewer.classList.remove('image-failed');viewer.src=urls[selected];viewer.alt=`${property?.name||'Imóvel'} — foto ${selected+1} de ${urls.length}`;caption.textContent=`${selected+1} / ${urls.length}`;
    if(interaction)void track('rental_gallery_interaction',{action:interaction,photo_index:selected+1,photo_count:urls.length});
  };
  const open=(index,target)=>{opener=target;show(index,'open');dialog.showModal();};
  items.forEach((a,i)=>a.addEventListener('click',event=>{event.preventDefault();open(i,a);}));
  gallery.querySelector('[data-gallery-open]').addEventListener('click',event=>open(railIndex,event.currentTarget));
  dialog.querySelector('[data-gallery-close]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('[data-gallery-prev]').addEventListener('click',()=>show(selected-1,'previous'));
  dialog.querySelector('[data-gallery-next]').addEventListener('click',()=>show(selected+1,'next'));
  dialog.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();show(selected+(event.key==='ArrowRight'?1:-1),'keyboard');}});
  dialog.addEventListener('close',()=>{opener?.focus();void track('rental_gallery_interaction',{action:'close',photo_count:urls.length});});
  viewer.addEventListener('error',()=>{viewer.classList.add('image-failed');caption.textContent=`${selected+1} / ${urls.length} · Foto indisponível. Você pode continuar navegando.`;});
  items.forEach(a=>a.querySelector('img').addEventListener('error',()=>a.classList.add('image-failed')));
  dialog.querySelector('.viewer-stage').addEventListener('pointerdown',event=>{swipeStart={x:event.clientX,y:event.clientY};},{passive:true});
  dialog.querySelector('.viewer-stage').addEventListener('pointerup',event=>{if(swipeStart){const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy))show(selected+(dx<0?1:-1),'swipe');swipeStart=null;}},{passive:true});
  rail.addEventListener('scroll',()=>{if(frame)return;frame=requestAnimationFrame(()=>{
    frame=0;if(rail.scrollWidth<=rail.clientWidth)return;
    const index=Math.max(0,Math.min(items.length-1,Math.round(rail.scrollLeft/rail.clientWidth)));
    for(let n=Math.max(0,index-1);n<=Math.min(items.length-1,index+1);n++)hydrate(n);
    counter.textContent=`${index+1} / ${urls.length}`;
    if(index!==railIndex){railIndex=index;void track('rental_gallery_interaction',{action:'swipe',photo_index:index+1,photo_count:urls.length});}
  });},{passive:true});
}

const form=document.getElementById('rental-lead'),feedback=document.getElementById('rental-feedback');
document.querySelectorAll('[data-rental-contact]').forEach(a=>a.addEventListener('click',()=>{void track('rental_contact_click',{surface:a.closest('.mobile-contact')?'mobile_bar':'page'});void adsEvent('specialist_cta_opened');}));
const mobileBar=document.querySelector('.mobile-contact');
if(mobileBar&&typeof IntersectionObserver!=='undefined'){
  const visible=new Map();new IntersectionObserver(entries=>{for(const e of entries)visible.set(e.target,e.isIntersecting);mobileBar.classList.toggle('is-hidden',[...visible.values()].some(Boolean));},{threshold:0}).observe(document.getElementById('contato'));
  const summary=document.querySelector('.rental-summary');
  if(summary)new IntersectionObserver(entries=>{for(const e of entries)visible.set(e.target,e.isIntersecting);mobileBar.classList.toggle('is-hidden',[...visible.values()].some(Boolean));},{threshold:.25}).observe(summary);
}
form?.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('[type=submit]');
  if(preview){feedback.textContent='Prévia: envio desativado. Nenhum contato foi registrado.';return;}
  if(button.disabled)return;
  if(!tracking){feedback.textContent='Não foi possível preparar seu atendimento. Atualize a página e tente novamente.';return;}
  const phone=form.elements.telefone.value.replace(/\D/g,'');if(phone.length<10||phone.length>15){feedback.textContent='Informe um WhatsApp válido com DDD.';return;}
  button.disabled=true;feedback.textContent='Registrando seu interesse…';
  const propertyId=property?.external_id||form.dataset.id||'rental_catalog';
  const id=tracking.leadId(propertyId);
  const canonical=property?.id?`https://www.yincorp.com.br/alugar/imovel/${property.id}`:'https://www.yincorp.com.br/alugar';
  const message=property?`Olá, tenho interesse neste imóvel para alugar em ${property.neighborhood||property.city}. ${property.name} | Código ${propertyId} | ${canonical}`:'Olá, tenho interesse em encontrar um imóvel para alugar pela Yincorp. https://www.yincorp.com.br/alugar';
  const payload={nome:form.elements.nome.value.trim(),telefone:phone,email:form.elements.email.value.trim(),origem:'portal_locacao',perfil:'Locação',purpose:'LOCACAO',operation:'LOCACAO',pagina:location.href,empreendimento:form.dataset.name,property_id:propertyId,property_uuid:property?.id||'',property_value:Number(form.dataset.price),neighborhood:form.dataset.neighborhood,inventory_source:'nonstop',mensagem:message,visitor_id:tracking.visitorId,session_id:tracking.sessionId,lead_event_id:id,...tracking.attribution(),touches:tracking.touches,session:{number:tracking.session.session_number,is_returning:tracking.session.is_returning,previous_session_id:tracking.session.previous_session_id,days_since_last_visit:tracking.session.days_since_last_visit}};
  try{
    await submitInterest(payload);
    await track('rental_lead_created',{lead_event_id:id,success:true});
    feedback.textContent='Interesse registrado. ';const link=document.createElement('a');link.textContent='Continuar no WhatsApp ↗';
    link.href=window.YntWhatsAppContact.url(`Olá, meu nome é ${payload.nome}. ${message}`);link.rel='noopener noreferrer';
    let pending=false;
    link.addEventListener('click',async event=>{
      event.preventDefault();if(pending)return;pending=true;
      // Canonical intention is attempted before navigating; a slow tracker cannot trap contact.
      let timer;await Promise.race([Promise.allSettled([track('rental_whatsapp_click'),track('whatsapp_cta_clicked'),adsEvent('whatsapp_cta_clicked',{lead_event_id:id})]),new Promise(resolve=>{timer=setTimeout(resolve,900);})]);clearTimeout(timer);location.assign(link.href);
    });
    feedback.append(link);button.textContent='Interesse registrado';
  }catch{feedback.textContent='Não foi possível registrar. Tente novamente; seus dados continuam no formulário.';button.disabled=false;}
});
