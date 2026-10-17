(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.YntPropertyHandoff=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const ENTRY_POINT="property.detail.manual_ai";
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ID=/^[A-Za-z0-9:_./-]{1,80}$/;
  const RETURN_ID=/^[A-Za-z0-9:_-]{1,80}$/;
  const ORIGINS=new Set(["https://app.yincorp.com.br","https://www.yincorp.com.br","https://yincorp.com.br"]);
  const record=value=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const choice=(value,allowed)=>allowed.includes(value)?value:null;
  function safeText(value,max=160){
    if(typeof value!=="string")return null;
    const text=value.trim();
    if(!text||text.length>max||/[\x00-\x1f\x7f@]|https?:|www\.|mailto:|tel:/i.test(text)||/(?:\+?\d[\d\s().-]*){10,}/.test(text)||/\b(?:gclid|gbraid|wbraid|first_touch|current_touch)\s*[:=]/i.test(text))return null;
    return text;
  }
  function safeId(value){
    if(typeof value!=="string"&&typeof value!=="number")return null;
    const id=String(value).trim();
    return ID.test(id)&&!UUID.test(id)&&!/https?:|www\./i.test(id)?id:null;
  }
  function number(value,max,integer=false){
    if(value==null||value===""||typeof value==="boolean")return null;
    const n=Number(value);
    return Number.isFinite(n)&&n>=0&&n<=max&&(!integer||Number.isInteger(n))?n:null;
  }
  function propertyReference(value){
    const p=record(value);
    const external=[p.external_id,p.id,p.property_id].map(safeId).find(Boolean)||null;
    const db=[p.db_id,p.id,p.property_id].find(id=>typeof id==="string"&&UUID.test(id))||null;
    if(!external&&!db)return null;
    return {external_id:external,db_id:db,
      inventory_source:choice(p.inventory_source,["novos","usados","todos"])||choice(p.source,["novos","usados"]),
      source:choice(p.source,["orulo","nonstop","novos","usados"]),
      name:safeText(p.name??p.property_name),neighborhood:safeText(p.neighborhood,80),city:safeText(p.city,80),
      bedrooms:number(p.bedrooms,30,true),price:number(p.value??p.price??p.property_value,1e12)};
  }
  function safeReturnUrl(value){
    if(typeof value!=="string"||value.length>500||/[\x00-\x20\x7f\\]/.test(value))return null;
    try{
      const url=new URL(value);
      if(!ORIGINS.has(url.origin)||url.username||url.password||url.port||url.pathname!=="/"||url.hash)return null;
      for(const [key,val]of url.searchParams){
        if(url.searchParams.getAll(key).length!==1)return null;
        if(key==="imovel"){if(!RETURN_ID.test(val))return null;}
        else if(key==="vid"){if(!UUID.test(val))return null;}
        else return null;
      }
      return url.toString();
    }catch{return null;}
  }
  function propertyReturnUrl(property,visitorId,origin){
    const url=new URL("/",ORIGINS.has(origin)?origin:"https://app.yincorp.com.br");
    const id=property.external_id??property.db_id;
    if(id&&RETURN_ID.test(id))url.searchParams.set("imovel",id);
    url.searchParams.set("vid",visitorId);
    return safeReturnUrl(url.toString());
  }
  // Paid intent is a signal only. No inferred buyer preferences or attribution IDs.
  function paidContext(value){return record(value).isPaid===true?{isPaid:true,intent:null}:undefined;}
  function parseEnvelope(value){
    const r=record(value),context=record(r.context);
    if(r.version!==1||r.kind!=="property"||r.entryPoint!==ENTRY_POINT||
      ![r.visitorId,r.sessionId,r.transitionId].every(id=>typeof id==="string"&&UUID.test(id)))return null;
    const received=record(context.currentProperty);
    if((received.external_id!=null&&safeId(received.external_id)!==received.external_id)||
      (received.db_id!=null&&(typeof received.db_id!=="string"||!UUID.test(received.db_id))))return null;
    const p=propertyReference({external_id:received.external_id,db_id:received.db_id,inventory_source:received.inventory_source,
      source:received.source,name:received.name,neighborhood:received.neighborhood,city:received.city,
      bedrooms:received.bedrooms,price:received.price});
    const returnUrl=safeReturnUrl(r.returnUrl);
    if(!p||!returnUrl)return null;
    const envelope={version:1,kind:"property",entryPoint:ENTRY_POINT,visitorId:r.visitorId,sessionId:r.sessionId,
      transitionId:r.transitionId,returnUrl,context:{currentProperty:p}};
    const paid=paidContext(r.paidContext);
    if(paid)envelope.paidContext=paid;
    return envelope;
  }
  function transitionId(crypto){
    if(crypto&&typeof crypto.randomUUID==="function")return crypto.randomUUID();
    if(!crypto||typeof crypto.getRandomValues!=="function")return null;
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
    return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  }
  function buildEnvelope(property,input){
    const p=propertyReference(property),options=record(input);
    if(!p)return null;
    return parseEnvelope({version:1,kind:"property",entryPoint:ENTRY_POINT,visitorId:options.visitorId,
      sessionId:options.sessionId,transitionId:transitionId(options.crypto),
      returnUrl:propertyReturnUrl(p,options.visitorId,options.origin),context:{currentProperty:p},
      paidContext:options.isPaid?{isPaid:true}:undefined});
  }
  return {ENTRY_POINT,safeText,propertyReference,safeReturnUrl,parseEnvelope,buildEnvelope};
});
