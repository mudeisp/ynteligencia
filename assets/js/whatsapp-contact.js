// Shared by the classic app and the ES/SP portal. Tracking stays with their existing adapters.
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  root.YntWhatsAppContact=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const PHONE='5511992976368';
  let pending=null;
  let lastNavigation=0;
  const text=value=>String(value??'').replace(/\s+/g,' ').trim();
  function propertyContext(p={}){
    return {
      property_id:text(p.id || p.property_id || p.external_id),
      external_id:text(p.external_id || p.id || p.property_id),
      db_id:text(p.db_id || p.property_uuid),
      name:text(p.name || p.property_name || p.development_name || p.development),
      development:text(p.development_name || p.development || p.name || p.property_name),
      city:text(p.city),
      neighborhood:text(p.neighborhood),
      bedrooms:Number(p.bedrooms)||0,
      price:Number(p.value ?? p.price ?? p.property_value)||0,
      inventory_source:text(p.source || p.inventory_source)
    };
  }
  function message(p){
    const property=propertyContext(p);
    const name=property.development || property.name;
    return name
      ? `Olá! Tenho interesse no ${name} que vi na Yincorp. Gostaria de mais informações.`
      : 'Olá! Vim pela Yincorp e gostaria de falar com um especialista.';
  }
  function url(message){return `https://wa.me/${PHONE}?text=${encodeURIComponent(message)}`;}
  function attempt(fn){try{return Promise.resolve(fn());}catch{return Promise.resolve(null);}}
  function open(p,options={}){
    // One navigation and one pair of events for rapid taps on any contact surface.
    if(pending)return pending;
    if(lastNavigation && Date.now()-lastNavigation<1500)return Promise.resolve();
    const property=propertyContext(p);
    const metadata={...options.metadata,property_id:property.property_id,property_uuid:property.db_id,
      external_id:property.external_id,development_name:property.development,property_name:property.name,
      city:property.city,neighborhood:property.neighborhood,price:property.price,
      inventory_source:property.inventory_source,page:location.pathname,url:location.href,
      timestamp:new Date().toISOString()};
    const reference = globalThis.crypto?.randomUUID?.();
    const destination = url(reference && options.adsTrack
      ? `${message(p)}\nRef. Yincorp: ${reference}`
      : message(p));
    const requests=[
      attempt(()=>options.adsTrack?.('whatsapp_cta_clicked',{event_id:reference,intent:options.intent,property,metadata})),
      attempt(()=>options.track?.('whatsapp_cta_clicked',metadata))
    ];
    let timer;
    pending=Promise.race([
      Promise.allSettled(requests),
      new Promise(resolve=>{timer=setTimeout(resolve,options.timeoutMs??700);})
    ]).then(()=>{
      lastNavigation=Date.now();
      (options.navigate || (href=>location.assign(href)))(destination);
    }).finally(()=>{clearTimeout(timer);pending=null;});
    return pending;
  }
  function mountFloating({resolveProperty,getOptions=()=>({})}={}){
    if(!document.body)return null;
    const existing=document.getElementById('ynt-whatsapp-float');
    if(existing){existing.yntContact={resolveProperty,getOptions};existing.yntRefresh?.();return existing;}
    const button=document.createElement('button');
    button.id='ynt-whatsapp-float';button.type='button';button.className='whatsapp-direct-float';
    button.setAttribute('aria-label','Falar pelo WhatsApp');
    button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true">\n        <path fill="currentColor" d="M16.02 3C8.84 3 3 8.72 3 15.76c0 2.25.6 4.45 1.75 6.38L3 29l7.04-1.81a13.18 13.18 0 0 0 5.97 1.45h.01C23.2 28.64 29 22.92 29 15.88 29 8.83 23.2 3 16.02 3Zm0 23.49h-.01a10.9 10.9 0 0 1-5.56-1.5l-.4-.24-4.18 1.08 1.12-4-.26-.41a10.46 10.46 0 0 1-1.67-5.66c0-5.86 4.92-10.63 10.97-10.63 2.93 0 5.68 1.12 7.75 3.15a10.43 10.43 0 0 1 3.21 7.59c-.01 5.86-4.93 10.62-10.97 10.62Zm6.02-7.95c-.33-.16-1.95-.94-2.25-1.05-.3-.11-.52-.16-.74.16-.22.32-.85 1.05-1.04 1.27-.19.21-.38.24-.71.08-.33-.16-1.39-.5-2.65-1.59a9.9 9.9 0 0 1-1.83-2.23c-.19-.32-.02-.5.14-.66.15-.14.33-.37.49-.56.16-.19.22-.32.33-.53.11-.21.05-.4-.03-.56-.08-.16-.74-1.75-1.01-2.4-.27-.64-.54-.55-.74-.56h-.63c-.22 0-.57.08-.87.4-.3.32-1.14 1.09-1.14 2.66 0 1.56 1.17 3.07 1.33 3.28.16.21 2.3 3.44 5.57 4.82.78.33 1.38.52 1.86.67.78.24 1.49.21 2.05.13.63-.09 1.95-.78 2.22-1.53.27-.75.27-1.4.19-1.53-.08-.13-.3-.21-.63-.37Z"/>\n      </svg>';
    button.yntContact={resolveProperty,getOptions};
    const property=()=>button.yntContact.resolveProperty?.();
    const refresh=()=>{button.hidden=!property() || Boolean(document.querySelector('dialog[open],#leadModal,#allGalleryShell,#floorplanLightbox'));};
    button.addEventListener('click',()=>{
      const selected=property();
      if(selected && !button.hidden)preRegister(selected,button.yntContact.getOptions());
    });
    button.yntRefresh=refresh;
    document.body.appendChild(button);
    if(typeof MutationObserver!=='undefined')new MutationObserver(refresh).observe(document.body,{
      childList:true,subtree:true,attributes:true,attributeFilter:['open','class','data-property-id']
    });
    refresh();
    return button;
  }
  function preRegister(p,options={}){
    if(document.getElementById('ynt-whatsapp-registration'))return;
    const dialog=document.createElement('dialog');
    dialog.id='ynt-whatsapp-registration';dialog.className='whatsapp-registration';
    dialog.setAttribute('aria-labelledby','ynt-whatsapp-registration-title');
    dialog.innerHTML=`<div class="wa-registration-header"><span class="wa-registration-avatar" aria-hidden="true">Y</span><div><strong id="ynt-whatsapp-registration-title">Yincorp</strong><small>Atendimento pelo WhatsApp</small></div><button type="button" class="wa-registration-close" aria-label="Fechar">×</button></div>
      <div class="wa-registration-chat"><p class="wa-registration-bubble">Olá! 👋 Qual é o seu WhatsApp com DDD?</p><p class="wa-registration-property"></p>
      <form><label for="ynt-whatsapp-phone">Seu número de WhatsApp</label><input id="ynt-whatsapp-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999" required maxlength="22">
      <p class="wa-registration-note">Ao continuar, você autoriza a Yincorp a entrar em contato sobre seu interesse. <a href="https://www.yincorp.com.br/politica-de-privacidade" target="_blank" rel="noopener">Privacidade</a></p>
      <p class="wa-registration-status" role="status" aria-live="polite"></p>
      <button type="submit" class="wa-registration-submit">Confirmar e continuar <span aria-hidden="true">➤</span></button></form></div>`;
    const form=dialog.querySelector('form'),input=dialog.querySelector('input'),submit=dialog.querySelector('[type="submit"]');
    const status=dialog.querySelector('[role="status"]'),close=dialog.querySelector('.wa-registration-close');
    const name=propertyContext(p).development||propertyContext(p).name;
    dialog.querySelector('.wa-registration-property').textContent=name?'Sobre: '+name:'Vamos ajudar você a encontrar seu imóvel.';
    let saving=false;
    close.addEventListener('click',()=>{if(!saving)dialog.close();});
    dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
    dialog.addEventListener('close',()=>{dialog.remove();document.getElementById('ynt-whatsapp-float')?.focus();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(saving)return;
      let phone=input.value.replace(/\D/g,'');
      if(phone.length===10||phone.length===11)phone='55'+phone;
      if(!/^55[1-9][0-9]{9,10}$/.test(phone)){status.textContent='Confira o número e inclua o DDD.';input.focus();return;}
      saving=true;submit.disabled=true;close.disabled=true;input.readOnly=true;
      status.textContent='Salvando seu contato…';
      try{
        const response=await fetch('https://app.yincorp.com.br/api/whatsapp-pre-registration',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({phone,property:propertyContext(p),page:location.href}),
          signal:AbortSignal.timeout(20000)
        });
        const receipt=await response.json();
        if(!response.ok||!receipt.success)throw new Error('registration_failed');
        dialog.close();
        await api.open(p,options);
      }catch{
        status.textContent='Não conseguimos salvar agora. Tente novamente.';
      }finally{
        saving=false;submit.disabled=false;close.disabled=false;input.readOnly=false;
      }
    });
    document.body.appendChild(dialog);dialog.showModal();input.focus();
  }
  const api={url,message,propertyContext,open,mountFloating};
  return api;
});
