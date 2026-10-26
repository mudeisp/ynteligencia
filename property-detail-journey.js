(function(root,factory){
  if(typeof module==="object" && module.exports)module.exports=factory();
  else root.YntPropertyJourney=factory();
})(typeof window!=="undefined"?window:this,function(){
  "use strict";
  const AGENT="https://agente.yincorp.com.br/";
  const KEYS=["gclid","gbraid","wbraid","utm_source","utm_medium","utm_campaign","utm_term","utm_content","bairro","cidade","dormitorios","valor_min","valor_max","vagas","metragem_min","tipo","source_product"];
  function context(search){
    const params=new URLSearchParams(search);
    return {fromAgent:params.get("agent_return")==="1"};
  }
  function returnPlan({search,referrer,historyLength,detailState}){
    const params=new URLSearchParams(search);
    const url=new URL(AGENT);
    for(const key of KEYS){
      const value=params.get(key);
      if(value)url.searchParams.set(key,value);
    }
    let previousAgent=false;
    try{previousAgent=new URL(referrer).origin===new URL(AGENT).origin;}catch(error){}
    // The modal adds one local history entry. Never land on the APP entry again.
    const delta=context(search).fromAgent && previousAgent && historyLength>(detailState?2:1)
      ? (detailState?-2:-1) : 0;
    // Fallback reuses the same tab's original AGENTE storage; no handoff or new ID.
    return {delta,href:url.toString()};
  }
  return {context,returnPlan};
});

/*
 * ES campaign URL guard.
 * The legacy catalog parser treats cidade= as falsy and falls back to São Paulo.
 * Install after the delivery scripts are parsed but before inventory startup calls
 * loadCatalogFromUrl(). During the legacy parser call, suppress its premature
 * search/URL rewrite; then normalize ES + blank city and run exactly one search.
 */
(function(){
  let installed=false;

  function installEsCampaignGuard(){
    if(installed || typeof window.loadCatalogFromUrl!=="function") return false;
    installed=true;

    const innerLoadCatalogFromUrl=window.loadCatalogFromUrl;
    window.loadCatalogFromUrl=function(...args){
      const params=new URLSearchParams(window.location.search);
      const requestedState=String(params.get("estado") ?? params.get("state") ?? "").trim().toUpperCase();
      const requestedCity=String(params.get("cidade") ?? params.get("city") ?? "").trim();
      const isEsStatewide=requestedState==="ES" && !requestedCity;

      if(!isEsStatewide){
        return innerLoadCatalogFromUrl.apply(this,args);
      }

      const realExecuteCatalogSearch=window.executeCatalogSearch;
      const realUpdateCatalogUrl=window.updateCatalogUrl;

      // Prevent the legacy loader from firing São Paulo+ES and from rewriting
      // the campaign URL before the correct geography is installed.
      window.executeCatalogSearch=async function(){ return undefined; };
      window.updateCatalogUrl=function(){ return window.location.href; };

      let result;
      try{
        result=innerLoadCatalogFromUrl.apply(this,args);
      }finally{
        window.executeCatalogSearch=realExecuteCatalogSearch;
        window.updateCatalogUrl=realUpdateCatalogUrl;
      }

      window.activeState="ES";
      window.activeCity="";
      window.catalogRegion=params.get("regiao") || "es";

      const state=document.getElementById("catalogState");
      const city=document.getElementById("catalogCity");
      const region=document.getElementById("catalogRegionSelect");
      if(state) state.value="ES";
      if(city) city.value="";
      if(region) region.value=window.catalogRegion;

      Promise.resolve(realExecuteCatalogSearch?.()).catch(error=>{
        console.error("YNT_ES_CAMPAIGN_SEARCH_ERROR",error);
      });

      return result;
    };

    return true;
  }

  // setTimeout runs after the parser's current script task; DOMContentLoaded is
  // the fallback. A short bounded retry covers slower external script loading.
  setTimeout(()=>{
    if(installEsCampaignGuard()) return;
    let attempts=0;
    const timer=setInterval(()=>{
      attempts+=1;
      if(installEsCampaignGuard() || attempts>=100) clearInterval(timer);
    },10);
  },0);
  document.addEventListener("DOMContentLoaded",installEsCampaignGuard,{once:true});
})();
