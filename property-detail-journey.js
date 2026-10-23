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
