import './portal-gallery.js';
import { submitInterest } from './portal-contact.js';
const config=JSON.parse(document.getElementById('portal-data')?.textContent || '{}');
const preview=config.preview===true;
let tracking=null;
if(!preview) {
  try {tracking=await import('./portal-session.js');}catch {console.warn('PORTAL_TELEMETRY_UNAVAILABLE');}
}
const project=config.project,dialog=document.getElementById('contact-dialog'),form=document.getElementById('portal-lead');
const citySelect=document.getElementById('portal-city'),neighborhoodSelect=document.getElementById('portal-neighborhood');
const intent=()=>({neighborhood:project?.neighborhood || '',development:project?.name || '',bedrooms:config.filters?.bedrooms || 0,max_price:config.filters?.max || 0,inventory_source:'todos'});
const property=u=>u?{property_id:u.id,name:u.name,neighborhood:u.neighborhood,bedrooms:u.bedrooms,price:u.value,inventory_source:u.source}:null;
const acquisition=()=>{
  const q=new URLSearchParams(location.search),clean=v=>String(v||'').trim().toLowerCase();
  const gclid=clean(q.get('gclid')),gbraid=clean(q.get('gbraid')),wbraid=clean(q.get('wbraid'));
  const utmSource=clean(q.get('utm_source')),utmMedium=clean(q.get('utm_medium')),utmCampaign=String(q.get('utm_campaign')||'').trim();
  const shareMarker=clean(q.get('share') || q.get('shared') || q.get('yc_source'));
  let referrerHost='';
  try{referrerHost=document.referrer?new URL(document.referrer).hostname.toLowerCase().replace(/^www\./,''):'';}catch{}
  const hasPaidClick=Boolean(gclid || gbraid || wbraid);
  const paidMedium=/(^|[-_])(cpc|ppc|paid|paidsearch|paid_search)([-_]|$)/.test(utmMedium);
  const googleSource=/^(google|googleads|google_ads)$/.test(utmSource);
  const whatsappSource=/^(whatsapp|wa|whatsapp_share)$/.test(utmSource) || shareMarker==='whatsapp' || /(^|\.)whatsapp\.com$/.test(referrerHost) || referrerHost==='wa.me';
  const chatgptSource=/^(chatgpt|openai)$/.test(utmSource) || shareMarker==='chatgpt' || /(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(referrerHost);
  const explicitShared=shareMarker==='shared_link' || shareMarker==='share' || utmMedium==='share' || utmMedium==='shared';
  let channel='direct',source='direct',medium='(none)',detection='inferred';
  if(hasPaidClick || (googleSource && paidMedium)){
    channel='google_ads';source='google';medium=utmMedium || 'cpc';detection='explicit';
  }else if(whatsappSource){
    channel='whatsapp';source='whatsapp';medium=utmMedium || 'share';detection=(utmSource || shareMarker)?'explicit':'referrer';
  }else if(chatgptSource){
    channel='chatgpt';source='chatgpt';medium=utmMedium || 'referral';detection=(utmSource || shareMarker)?'explicit':'referrer';
  }else if(explicitShared){
    channel='shared_link';source=utmSource || 'shared_link';medium=utmMedium || 'share';detection='explicit';
  }else if(utmSource){
    channel=paidMedium?'paid_other':'campaign';source=utmSource;medium=utmMedium || 'unknown';detection='explicit';
  }else if(/(^|\.)google\./.test(referrerHost) || referrerHost.includes('google.')){
    channel='google_organic';source='google';medium='organic';detection='referrer';
  }else if(referrerHost.includes('bing.') || referrerHost.includes('yahoo.') || referrerHost.includes('duckduckgo.')){
    channel='organic_search';source=referrerHost.split('.')[0] || referrerHost;medium='organic';detection='referrer';
  }else if(referrerHost && referrerHost!==location.hostname.toLowerCase().replace(/^www\./,'')){
    channel='referral';source=referrerHost;medium='referral';detection='referrer';
  }
  return {channel,source,medium,campaign:utmCampaign,referrer_host:referrerHost,referrer_url:document.referrer || '',landing_url:location.href,detection,gclid:Boolean(gclid),gbraid:Boolean(gbraid),wbraid:Boolean(wbraid)};
};
const acquisitionContext=acquisition();
const tracked=metadata=>({...metadata,acquisition:acquisitionContext});
if(tracking) {
  const key=`ynteligencia_session_start_sent_${tracking.sessionId}`;
  try {if(!localStorage.getItem(key)){
    localStorage.setItem(key,'1');
    void tracking.track('session_start',tracked({portal:true}));
    window.gtag?.('event','portal_session_start',{acquisition_channel:acquisitionContext.channel,acquisition_source:acquisitionContext.source,acquisition_medium:acquisitionContext.medium,acquisition_detection:acquisitionContext.detection});
  }}catch{}
  if(project) {
    // An aggregate development view does not fabricate a selected unit view.
    void tracking.track('development_view',tracked({portal:true,development_id:project.token,development_name:project.name}));
    if(config.selectedUnit){const u=project.units.find(u=>u.db_id===config.selectedUnit);if(u){void tracking.adsTrack('property_view',{intent:intent(),property:property(u)});void tracking.track('property_view',tracked({property_id:u.id,property_uuid:u.db_id,portal:true}));}}
  }else if(config.kind)void tracking.track('catalog_search_results',tracked({portal:true,grouped_by:'development',results_count:config.total,filters:config.filters}));
  const q=new URLSearchParams(location.search),paidEntry=Boolean(q.get('gclid') || q.get('gbraid') || q.get('wbraid') || (['google','googleads','google_ads'].includes(String(q.get('utm_source')||'').toLowerCase()) && /cpc|ppc|paid/.test(String(q.get('utm_medium')||'').toLowerCase())));
  if(paidEntry) {
    const key=`portal_ad_entry_${tracking.sessionId}`;
    try{if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'1');void tracking.adsTrack('ad_entry',{intent:intent()});}}catch{}
  }
  let lastTouch=0;
  document.addEventListener('pointerdown',()=>{if(Date.now()-lastTouch>30000){tracking.touch();lastTouch=Date.now();}},{passive:true});
}
citySelect?.addEventListener('change',()=>{
  neighborhoodSelect.replaceChildren(new Option('Todos os bairros',''));
  const city=config.cities?.find(c=>c.slug===citySelect.value);
  for(const n of city?.neighborhoods || [])neighborhoodSelect.add(new Option(n.name,n.slug));
});
document.querySelectorAll('[data-contact]').forEach(button=>button.addEventListener('click',()=>{
  const unit=project?.units.find(u=>u.db_id===button.dataset.contact);
  form.elements.unit.value=unit?.db_id || config.selectedUnit || '';
  document.getElementById('contact-feedback').replaceChildren();
  form.querySelector('[type=submit]').hidden=false;
  dialog.showModal();
  void tracking?.adsTrack('specialist_cta_opened',{intent:intent(),property:property(unit)});
  if(unit)void tracking?.track('property_interest',tracked({property_id:unit.id,property_uuid:unit.db_id,portal:true}));
}));
document.querySelector('.dialog-close')?.addEventListener('click',()=>dialog.close());
dialog?.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)dialog.close();}});
form?.addEventListener('submit',async event=>{
  event.preventDefault();
  const feedback=document.getElementById('contact-feedback');
  if(preview){feedback.textContent='Prévia: envio desativado. Nenhum contato foi registrado.';return;}
  const u=project?.units.find(u=>u.db_id===form.elements.unit.value);
  if(!u)return;
  const phone=String(form.elements.telefone.value).replace(/\D/g,'');
  if(phone.length<10 || phone.length>15){feedback.textContent='Informe um WhatsApp válido com DDD.';form.elements.telefone.focus();return;}
  if(!tracking){feedback.textContent='Não foi possível iniciar seu atendimento. Recarregue a página e tente novamente.';return;}
  const button=form.querySelector('[type=submit]');
  if(button.disabled)return;
  button.disabled=true;button.textContent='Registrando seu interesse…';feedback.textContent='';feedback.className='';
  const id=tracking.leadId(u.id);
  const payload={nome:form.elements.nome.value.trim(),telefone:phone,email:form.elements.email.value.trim(),origem:'ynteligencia',pagina:location.href,empreendimento:project.name,property_id:u.id,neighborhood:u.neighborhood,property_value:u.value,bedrooms:u.bedrooms,inventory_source:u.source,visitor_id:tracking.visitorId,session_id:tracking.sessionId,lead_event_id:id,...tracking.attribution(),acquisition:acquisitionContext,touches:tracking.touches,session:{number:tracking.session.session_number,is_returning:tracking.session.is_returning,previous_session_id:tracking.session.previous_session_id,days_since_last_visit:tracking.session.days_since_last_visit},mensagem:`Interesse pelo portal Yincorp | ${project.name} | ${u.city}/${u.state} | Código ${u.id}`};
  try {
    await submitInterest(payload);
    const recorded=await tracking.adsTrack('lead_created',{event_id:id,intent:intent(),property:property(u)});
    void tracking.track('lead_created',tracked({property_id:u.id,property_uuid:u.db_id,lead_event_id:id,success:true,portal:true}));
    const conversionId=recorded?.event_id,sentKey=`portal_conversion_${id}`;
    let alreadySent=false;try{alreadySent=sessionStorage.getItem(sentKey)==='1';}catch{}
    if(conversionId && !alreadySent) {
      window.gtag?.('event','conversion',{send_to:'AW-18371236623/1P2xCPmnzfccEI-mi7hE',transaction_id:conversionId,value:10,currency:'BRL'});
      window.fbq?.('track','Lead',{content_name:project.name},{eventID:conversionId});
      try{sessionStorage.setItem(sentKey,'1');}catch{}
    }
    window.gtag?.('event','lead_created',{property_id:u.id,acquisition_channel:acquisitionContext.channel,acquisition_source:acquisitionContext.source,acquisition_medium:acquisitionContext.medium});
    feedback.textContent='Interesse registrado. Continue com o atendimento pelo WhatsApp.';
    const link=document.createElement('a');link.className='button primary';link.textContent='Continuar no WhatsApp ↗';
    link.href=`https://wa.me/5511992976368?text=${encodeURIComponent(`Olá, meu nome é ${payload.nome}. Tenho interesse em ${project.name}, ${u.city}/${u.state}. Código: ${u.id}. ${location.origin+project.path}`)}`;
    link.target='_blank';link.rel='noopener noreferrer';
    link.addEventListener('click',()=>{void tracking.track('property_whatsapp_click',tracked({property_id:u.id,property_uuid:u.db_id,portal:true}));window.gtag?.('event','property_whatsapp_click',{property_id:u.id,acquisition_channel:acquisitionContext.channel});});
    feedback.append(link);button.hidden=true;
  }catch(error) {
    feedback.textContent=error.message;feedback.className='form-error';
    void tracking.track('portal_lead_error',tracked({property_id:u.id,property_uuid:u.db_id}));
  }finally {button.disabled=false;button.textContent='Enviar interesse e continuar';}
});
