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
    const destination=url(message(p));
    const requests=[
      attempt(()=>options.adsTrack?.('whatsapp_cta_clicked',{intent:options.intent,property,metadata})),
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
  return {url,message,propertyContext,open};
});
