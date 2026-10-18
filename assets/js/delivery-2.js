
;
// SOURCE: assets/js/domain/match.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; whole original block.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function updateSummary(){

  const el=
    $("summary");


  if(!el)return;


  const p=
    profile;


  const region=
    p.region==="outra"
      ? "outra região"
      : p.region;


  const budget=
    p.budgetLabel
      ? p.budgetLabel
      : (p.budget ? money(p.budget) : "qualquer faixa");


  const beds=
    p.bedrooms===4
      ? "4+"
      : p.bedrooms ??
        "qualquer número";


  const types=
    p.types.join(", ");


  el.textContent=
    `Você busca ${types||"um imóvel"} para ${p.purpose||"comprar"}, em ${region||"São Paulo"}, na faixa ${budget}, com ${beds} dormitório(s). ${p.feature.length?"Prioridades: "+p.feature.join(", ")+".":""}`;
}


/* =========================================================
   MATCH
========================================================= */

function textHas(
  p,
  terms
){

  const t=
    norm(
      [
        p.description,
        p.name,
        p.address
      ].join(" ")
    );


  return terms.some(
    x=>
      t.includes(
        norm(x)
      )
  );
}



const REGION_MAP={
  oeste:[
    "perdizes","pompeia","pompéia","pinheiros","vila madalena","lapa",
    "alto da lapa","barra funda","butanta","butantã","jaguare","jaguaré",
    "sumare","sumaré","vila leopoldina","alto de pinheiros","rio pequeno",
    "vila sonia","vila sônia","morumbi"
  ],
  sul:[
    "moema","vila mariana","chacara klabin","chácara klabin","brooklin",
    "campo belo","saude","saúde","ipiranga","paraiso","paraíso",
    "aclimação","aclimacao","jardins","jardim paulista","itaim bibi",
    "vila nova conceicao","vila nova conceição","santo amaro","campo grande",
    "vila clementino","planalto paulista","mirandopolis","mirandópolis"
  ],
  norte:[
    "santana","tucuruvi","casa verde","mandaqui","vila guilherme",
    "vila maria","parada inglesa","jardim sao paulo","jardim são paulo",
    "lauzane paulista","limão","limao","freguesia do o","freguesia do ó",
    "tremembe","tremembé","jaçanã","jacana"
  ],
  leste:[
    "tatuape","tatuapé","mooca","analia franco","anália franco",
    "vila prudente","penha","carrão","carrao","belem","belém",
    "brás","bras","água rasa","agua rasa","vila formosa","vila matilde",
    "itaquera","aricanduva","sapopemba","são mateus","sao mateus"
  ]
};

function adIntentRegionKey(){
  const wanted=norm(adIntent.neighborhood);
  if(!wanted) return "";
  return Object.keys(REGION_MAP).find(key=>
    REGION_MAP[key].some(item=>{
      const neighborhood=norm(item);
      return neighborhood===wanted || neighborhood.includes(wanted) || wanted.includes(neighborhood);
    })
  ) || "";
}

function propertyMatchesRegion(p,regionKey){
  const key=norm(regionKey);
  const neighborhood=norm(p.neighborhood);
  const address=norm(p.address);
  const haystack=`${neighborhood} ${address}`;
  const bairros=(REGION_MAP[key]||[]).map(norm);
  return bairros.some(b=>haystack.includes(b));
}

function scoreProperty(p){

  let score=0;

  let reasons=[];


  const region=
    norm(
      profile.region
    );


  if(region){

    if(propertyMatchesRegion(p,region)){

      score+=25;

      reasons.push(
        "Região desejada"
      );
    }

  }else{

    score+=25;
  }


  if(profile.budgetMin || profile.budgetMax || profile.budget){

    const minBudget=Number(profile.budgetMin||0)||0;
    const maxBudget=Number(profile.budgetMax||0)||0;
    const value=Number(p.value||0)||0;

    const insideBudget=
      value>0 &&
      (!minBudget || value>=minBudget) &&
      (!maxBudget || value<=maxBudget);

    if(insideBudget){

      score+=25;

      reasons.push(
        "Dentro da faixa de valor"
      );

    }else if(value>0){

      const lowerTolerance=minBudget ? minBudget*0.9 : 0;
      const upperTolerance=maxBudget ? maxBudget*1.1 : 0;
      const nearBudget=
        (minBudget && value>=lowerTolerance && value<minBudget) ||
        (maxBudget && value>maxBudget && value<=upperTolerance);

      if(nearBudget){
        score+=17;
        reasons.push("Próximo da faixa de valor");
      }
    }

  }else{

    score+=25;
  }


  if(
    profile.bedrooms!==null
  ){

    const minimumBedrooms=Number(profile.bedrooms);

    if(p.bedrooms<minimumBedrooms){
      return {score:0,reasons:[]};
    }

    score+=15;

    reasons.push(
      minimumBedrooms===4
        ? "4+ dormitórios"
        : `${minimumBedrooms}+ dormitórios`
    );

  }else{

    score+=15;
  }


  if(
    profile.types.length
  ){

    const allowedTypes=profile.types.map(norm);
    const propertyType=norm(p.type);

    // Tipo escolhido no MATCH é requisito obrigatório.
    // Ex.: apartamento não pode retornar casa ou sobrado.
    if(!allowedTypes.includes(propertyType)){
      return {score:0,reasons:[]};
    }

    score+=8;

    reasons.push(
      `Tipo: ${p.type}`
    );

  }else{

    score+=8;
  }


  if(
    profile.feature.includes(
      "area50"
    )
  ){

    if(
      p.area>=50
    ){

      score+=4;

      reasons.push(
        "Área compatível"
      );
    }
  }


  if(
    profile.feature.includes(
      "suite"
    )
  ){

    if(
      p.suites>0
    ){

      score+=4;

      reasons.push(
        "Suíte"
      );
    }
  }


  if(
    profile.feature.includes(
      "parking"
    )
  ){

    if(
      p.parking>0
    ){

      score+=4;

      reasons.push(
        "Vaga"
      );
    }
  }


  if(
    profile.feature.includes(
      "balcony"
    )
  ){

    if(
      textHas(
        p,
        [
          "varanda",
          "sacada",
          "terraço",
          "terraco"
        ]
      )
    ){

      score+=3;

      reasons.push(
        "Varanda"
      );
    }
  }


  if(
    profile.feature.includes(
      "pool"
    )
  ){

    if(
      textHas(
        p,
        ["piscina"]
      )
    ){

      score+=3;

      reasons.push(
        "Piscina"
      );
    }
  }


  if(
    profile.feature.includes(
      "metro"
    )
  ){

    if(
      textHas(
        p,
        [
          "metrô",
          "metro",
          "estação",
          "estacao"
        ]
      )
    ){

      score+=3;

      reasons.push(
        "Metrô próximo"
      );
    }
  }


  if(
    profile.feature.includes(
      "lowcondo"
    )
  ){

    if(
      p.condominium>0 &&
      p.condominium<=900
    ){

      score+=4;

      reasons.push(
        "Condomínio controlado"
      );
    }
  }


  return{

    score:
      Math.max(
        0,
        Math.min(
          100,
          Math.round(score)
        )
      ),

    reasons:
      [
        ...new Set(reasons)
      ].slice(0,5)
  };
}


function showMatches(){

  leaveMatchMode();
  document.body.classList.add("match-results-mode");
  history.replaceState({ynteligenciaView:"feed"},"");

  const rankList=list=>
    list
      .map(p=>({...p,match:scoreProperty(p)}))
      .filter(x=>x.match.score>=45)
      .sort((a,b)=>b.match.score-a.match.score || a.value-b.value);

  let rankedProperties;

  if(adIntent.active){
    /* Jornada de mídia: respeita integralmente a intenção declarada.
       Bairro + dormitórios + faixa de preço são filtros duros.
       Se não houver imóveis suficientes no bairro pedido, NÃO completa
       o feed silenciosamente com outros bairros/cidades. Isso evita que
       uma busca por Perdizes retorne Morumbi, Butantã ou homônimos de
       outras cidades. O feed mostra apenas os imóveis realmente elegíveis. */
    const eligible=properties.filter(propertyMatchesAdRequirements);
    const exact=rankList(eligible.filter(propertyMatchesAdNeighborhood));
    rankedProperties=exact.slice(0,12);
  }else{
    rankedProperties=rankList(properties);
  }


  /*
    MATCH unificado: preserva a pontuação original, mas evita que
    o estoque muito maior de usados esconda os lançamentos.
    Até 6 Novos + 6 Usados; se um grupo não tiver 6 elegíveis,
    as vagas restantes são preenchidas pelos melhores imóveis gerais.
  */
  let scored;

  if(adIntent.active){
    /* Não reordena alternativas acima dos imóveis do bairro solicitado. */
    scored=rankedProperties.slice(0,12);
  }else{
    const novos=rankedProperties.filter(p=>p.source==="novos").slice(0,6);
    const usados=rankedProperties.filter(p=>p.source!=="novos").slice(0,6);
    const selectedIds=new Set([...novos,...usados].map(p=>`${p.source}:${p.id}`));
    scored=[...novos,...usados];

    for(const p of rankedProperties){
      if(scored.length>=12) break;
      const key=`${p.source}:${p.id}`;
      if(!selectedIds.has(key)){
        scored.push(p);
        selectedIds.add(key);
      }
    }

    scored.sort((a,b)=>b.match.score-a.match.score || a.value-b.value);
  }


  currentMatchById.clear();
  scored.forEach(p=>currentMatchById.set(String(p.id),p.match));

  console.log(
    "Ynteligencia MATCH:",
    {
      novos:scored.filter(p=>p.source==="novos").length,
      usados:scored.filter(p=>p.source!=="novos").length,
      total:scored.length
    }
  );


  try{

    gtag(
      'event',
      'match_generated',
      {

        results_count:
          scored.length,

        top_match_score:
          scored.length
            ? scored[0].match.score
            : 0,

        region:
          profile.region || "",

        budget:
          Number(profile.budget) || 0,

        budget_min:
          Number(profile.budgetMin) || 0,

        budget_max:
          Number(profile.budgetMax) || 0,

        inventory_source:
          sourceMode || "usados",

      }
    );

  }catch(error){

    console.warn(
      "Não foi possível registrar match_generated:",
      error
    );
  }


  supabaseTrack(
    "match_generated",
    {

      entry_mode:
        adIntent.active
          ? "ad_direct"
          : "wizard",

      pathname:
        window.location.pathname,

      search:
        window.location.search,

      referrer:
        document.referrer || "",

      ad_intent:{
        active:
          adIntent.active,

        neighborhood:
          adIntent.neighborhood || "",

        bedrooms:
          adIntent.bedrooms || 0,

        min_price:
          adIntent.minPrice || 0,

        max_price:
          adIntent.maxPrice || 0
      },

      profile:{
        ...profile
      },

      results_count:
        scored.length,

      top_match_score:
        scored.length
          ? scored[0].match.score
          : 0,

      matches:
        scored
          .slice(0,12)
          .map(
            item=>({

              property_id:
                String(
                  item.id || ""
                ),

              property_name:
                item.name || "",

              neighborhood:
                item.neighborhood || "",

              value:
                Number(
                  item.value
                ) || 0,

              score:
                Number(
                  item.match?.score
                ) || 0

            })
          )
    }
  );


  $("results")
    .classList
    .add(
      "visible"
    );

  /* Primeiro mostra o motor/resultados. No desktop o refinamento fica minimizado. */
  updateAdMatchUI();
  setRefineMatchOpen(false);


  if(adIntent.active){
    const copy=PaidClickExperience.contextCopy(adIntent);
    const heading=document.querySelector("#results .result-top h2");
    if(heading) heading.textContent=copy.title;
    const memory=typeof paidExperience==="undefined" ? "" : PaidClickExperience.memoryLine(paidExperience);
    $("resultSummary").textContent=[copy.subtitle, memory].filter(Boolean).join(" · ")
      || (scored.length ? `${scored.length} imóveis` : "Não encontramos imóveis nessa combinação.");
  }else{
    $("resultSummary").textContent=scored.length
      ? `Encontramos ${scored.length} imóveis com maior compatibilidade com o seu perfil.`
      : "Não encontramos uma combinação forte. Vamos ampliar sua busca.";
  }


  $("matchGrid")
    .innerHTML=
      scored.length

        ? scored
            .map(
              p=>
                card(
                  p,
                  true
                )
            )
            .join("")

        : `
          <div class="empty">

            <h3>
              Vamos ampliar o MATCH
            </h3>

            <p>
              Tente uma região ou faixa de preço
              um pouco mais ampla.
            </p>

          </div>
          `;


  $("results")
    .scrollIntoView({
      behavior:"smooth"
    });
}


;
// SOURCE: assets/js/legacy/match-ai.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; whole original block.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

let aiAssistantProperty=null;
let aiPendingDisambiguationChoice=null;

let aiAssistantHistory=[];

/* Histórico comercial completo para anexar ao lead. */
let aiLeadConversation=[];

function resetAiLeadConversation(){
  aiLeadConversation=[];
  aiLastDetectedIntent="";
  aiLastSearchReason="";
}

function registerAiLeadConversation(role,content){
  const text=clean(content||"");
  if(!text)return;

  aiLeadConversation.push({
    role: role==="user" ? "user" : "assistant",
    content:text,
    at:new Date().toISOString()
  });

  if(aiLeadConversation.length>200){
    aiLeadConversation=aiLeadConversation.slice(-200);
  }
}

function aiLeadConversationText(){
  return aiLeadConversation
    .map(item=>`${item.role==="user" ? "Cliente" : "IA"}: ${item.content}`)
    .join("\n");
}

let aiOpenedProperties=[];
let aiLastDetectedIntent="";
let aiLastSearchReason="";

function aiSyntheticPropertyId(id){
  const value=String(id||"");
  return !value ||
    value==="match-ia-orulo" ||
    value==="specialist-general" ||
    value.startsWith("__");
}

function aiRememberOpenedProperty(property){
  const id=String(property?.id||"");
  if(aiSyntheticPropertyId(id))return;

  aiOpenedProperties=aiOpenedProperties.filter(
    item=>String(item?.id||"")!==id
  );
  aiOpenedProperties.push({
    id,
    name:property?.name||"",
    neighborhood:property?.neighborhood||"",
    value:Number(property?.value)||0,
    bedrooms:Number(property?.bedrooms)||0,
    source:property?.source||""
  });

  if(aiOpenedProperties.length>8){
    aiOpenedProperties=aiOpenedProperties.slice(-8);
  }
}

function aiSelectLeadProperty(fallback, opened){
  const realOpened=(Array.isArray(opened)?opened:[])
    .filter(item=>item && !aiSyntheticPropertyId(item.id));

  if(fallback && !aiSyntheticPropertyId(fallback.id)){
    return {
      primary:fallback,
      others:realOpened.filter(
        item=>String(item.id)!==String(fallback.id)
      )
    };
  }

  const primary=realOpened.length
    ? realOpened[realOpened.length-1]
    : null;

  return {
    primary,
    others:realOpened.slice(0,-1)
  };
}

function aiBuildLeadNarrative(facts){
  const parts=[];
  const development=String(facts?.development||"").trim();
  const neighborhood=String(facts?.neighborhood||"").trim();
  const place=development
    ? `o empreendimento ${development}`
    : neighborhood
      ? `imóvel em ${neighborhood}`
      : "";

  if(place){
    const qualifiers=[];
    if(facts?.maxPriceLabel)qualifiers.push(`até ${facts.maxPriceLabel}`);
    if(facts?.minPriceLabel)qualifiers.push(`a partir de ${facts.minPriceLabel}`);
    const bedrooms=Number(facts?.bedrooms)||0;
    if(bedrooms>0){
      qualifiers.push(`${bedrooms} dormitório${bedrooms>1?"s":""}`);
    }
    parts.push(
      `Cliente busca ${place}${qualifiers.length?`, ${qualifiers.join(", ")}`:""}.`
    );
  }

  const opened=Array.isArray(facts?.opened)?facts.opened:[];
  const openedNames=[...new Set(
    opened.map(item=>String(item?.name||"").trim()).filter(Boolean)
  )];

  if(opened.length===1 && openedNames[0]){
    parts.push(`Demonstrou interesse no ${openedNames[0]} e abriu essa unidade no modal.`);
  }else if(opened.length>1){
    const interest=openedNames.length===1
      ? openedNames[0]
      : openedNames.join(", ");
    parts.push(
      `Demonstrou interesse no ${interest} e abriu ${opened.length} unidades no modal.`
    );
  }

  if(facts?.askedContact){
    parts.push("Pediu contato com especialista.");
  }

  return parts.join(" ").replace(/\s+/g," ").trim();
}

function aiPriceLabel(value){
  const amount=Number(value);
  if(!Number.isFinite(amount) || amount<1)return "";
  return money(amount);
}

function aiCurrentLeadFacts(){
  const recommended=(Array.isArray(aiLastSearchContext?.matches)
    ? aiLastSearchContext.matches
    : []
  ).slice(0,5).map(item=>({
    id:String(item?.id||""),
    name:item?.name||"",
    neighborhood:item?.neighborhood||"",
    value:Number(item?.value)||0,
    bedrooms:Number(item?.bedrooms)||0,
    source:item?.source||""
  }));

  return {
    neighborhood:aiSearchState?.neighborhood||"",
    development:aiSearchState?.exactName||"",
    minPrice:Number(aiSearchState?.minPrice)||0,
    maxPrice:Number(aiSearchState?.maxPrice)||0,
    minPriceLabel:aiPriceLabel(aiSearchState?.minPrice),
    maxPriceLabel:aiPriceLabel(aiSearchState?.maxPrice),
    bedrooms:Number(aiSearchState?.bedrooms)||0,
    recommended,
    opened:aiOpenedProperties.map(item=>({...item})),
    messageCount:aiLeadConversation.length,
    lastIntent:aiLastDetectedIntent||aiLastSearchReason||"",
    lastSearchReason:aiLastSearchReason||""
  };
}

function aiLeadSummary(){
  const facts=aiCurrentLeadFacts();
  const hasContext=Boolean(
    facts.messageCount ||
    facts.neighborhood ||
    facts.development ||
    facts.recommended.length ||
    facts.opened.length
  );
  if(!hasContext)return "";
  return aiBuildLeadNarrative({
    ...facts,
    askedContact:true
  });
}

function aiLeadContext(primary){
  const facts=aiCurrentLeadFacts();
  return {
    search:{
      neighborhood:facts.neighborhood,
      development:facts.development,
      min_price:facts.minPrice,
      max_price:facts.maxPrice,
      bedrooms:facts.bedrooms,
      inventory:aiSearchState?.inventorySource||"",
      reason:facts.lastSearchReason
    },
    recommended:facts.recommended,
    opened:facts.opened,
    other_property_ids:aiSelectLeadProperty(
      primary,
      facts.opened
    ).others.map(item=>String(item.id||"")).filter(Boolean),
    message_count:facts.messageCount,
    last_intent:facts.lastIntent
  };
}

function aiTrackLeadEvent(name,detail){
  const payload=detail||{};
  try{
    gtag("event",name,payload);
  }catch(error){}
  try{
    supabaseTrack(name,payload);
  }catch(error){}
}

function aiSanitizeHandoffPromise(value){
  return AiCommercialIntent.aiSanitizeHandoffPromise(value);
}

function aiSetHumanHandoffVisible(show){
  const button=document.getElementById("aiHumanHandoff");
  if(!button)return;

  const on=Boolean(show);
  if(on && button.dataset.ctaTracked!=="1"){
    button.dataset.ctaTracked="1";
    aiTrackLeadEvent("ai_lead_cta_shown",{
      property_id:String(aiAssistantProperty?.id||"")
    });
  }
  button.classList.toggle("is-visible", on);
  button.classList.toggle("visible", on);
  button.hidden=!on;
  button.setAttribute("aria-hidden", on ? "false" : "true");
}

function aiCommercialDecisionContext(){
  const matches=
    Array.isArray(aiLastSearchContext?.matches)
      ? aiLastSearchContext.matches
      : [];
  const propertyMode=
    typeof aiIsPropertyMode==="function" &&
    aiIsPropertyMode();
  const namedProperty=
    propertyMode
      ? aiAssistantProperty
      : (
          matches.length===1
            ? (aiLastSelectedProperty || matches[0])
            : null
        );

  return {
    hasProperty:Boolean(propertyMode || matches.length===1),
    resultCount:propertyMode ? 1 : matches.length,
    propertyName:namedProperty?.name || ""
  };
}

function aiResolveCommercialTurn(message){
  return AiCommercialIntent.aiResolveCommercialTurn(
    message,
    aiCommercialDecisionContext()
  );
}

let aiAssistantSending=false;
let aiAssistantTriggerTimer=null;

function aiPropertyContext(p){
  if(!p)return {};

  return {
    id:String(p.id||""),
    building_id:String(p.building_id||""),
    name:p.name||"",
    neighborhood:p.neighborhood||"",
    city:p.city||"",
    value:Number(p.value)||0,
    area:Number(p.area)||0,
    bedrooms:Number(p.bedrooms)||0,
    bathrooms:Number(p.bathrooms)||0,
    suites:Number(p.suites)||0,
    parking:Number(p.parking)||0,
    stock:Number(p.stock)||0,
    source:p.source||"",
    status:p.status||"",
    developer:p.developer||"",
    property_url:p.property_url||"",
    image_url:p.image_url||"",
    address:p.address||null,

    /*
      Mantém compatibilidade com propriedades oriundas do catálogo.
    */
    type:p.type||"",
    description:p.description||"",
    property_type:p.property_type||"",
    rawData:
      p.rawData && typeof p.rawData==="object"
        ? p.rawData
        : (
            p.raw_data && typeof p.raw_data==="object"
              ? p.raw_data
              : null
          )
  };
}

function ensureAiAssistantShell(){
  let shell=document.getElementById("aiAssistantShell");
  if(shell)return shell;

  shell=document.createElement("div");
  shell.id="aiAssistantShell";
  shell.className="ai-assistant-shell";
  shell.innerHTML=`
    <div class="ai-assistant-card" role="dialog" aria-modal="true" aria-label="Assistente de compra">
      <div class="ai-assistant-head">
        <div class="ai-assistant-brand">
          <span class="ai-orb">✦</span>
          <span><strong>Match IA</strong><small>Assistente de compra Ynteligencia</small></span>
        </div>
        <button class="ai-assistant-close" type="button" aria-label="Fechar">×</button>
      </div>
      <div>
        <div class="ai-assistant-messages" id="aiAssistantMessages"></div>
        <button class="ai-human-handoff" id="aiHumanHandoff" type="button" hidden aria-hidden="true">Falar com Rafael no WhatsApp</button>
      </div>
      <form class="ai-assistant-input" id="aiAssistantForm">
        <textarea id="aiAssistantInput" rows="1" placeholder="Digite sua dúvida sobre este imóvel..."></textarea>
        <button class="ai-assistant-send" id="aiAssistantSend" type="submit" aria-label="Enviar">➜</button>
      </form>
    </div>`;

  shell.querySelector(".ai-assistant-close")?.addEventListener(
    "click",
    ()=>{
      if(
        shell.dataset.forceChoice==="1"
      ){
        return;
      }

      closeAiAssistant();
    }
  );

  shell.addEventListener(
    "click",
    e=>{
      if(
        e.target===shell &&
        shell.dataset.forceChoice!=="1"
      ){
        closeAiAssistant();
      }
    }
  );
  shell.querySelector("#aiAssistantForm")?.addEventListener("submit",e=>{
    e.preventDefault();
    const input=shell.querySelector("#aiAssistantInput");
    const text=clean(input?.value||"");
    if(!text)return;
    input.value="";
    sendAiAssistantMessage(text);
  });
  shell.querySelector("#aiHumanHandoff")?.addEventListener("click",()=>{
    if(!aiAssistantProperty)return;

    const property=aiAssistantProperty;
    const aiShell=document.getElementById("aiAssistantShell");

    aiShell?.classList.remove("open");
    aiShell?.remove();
    document.body.style.overflow="hidden";

    setTimeout(()=>{
      const selected=aiSelectLeadProperty(
        property?.generic_search ? null : property,
        aiOpenedProperties
      );
      const target=selected.primary || {
        id:"",
        name:aiSearchState?.exactName || "Busca assistida pela Match IA",
        neighborhood:aiSearchState?.neighborhood || "",
        value:0,
        bedrooms:Number(aiSearchState?.bedrooms)||0,
        source:""
      };

      if(!property?.generic_search && target?.id){
        openPropertySpecialist(target);
        return;
      }

      openLeadCapture(target,{source:"match_ia"});
    },120);
  });

  document.body.appendChild(shell);
  return shell;
}


function registerAiFoundProperty(p){
  if(!p || !p.id)return p;

  const normalized={
    ...p,
    id:String(p.id||p.building_id||""),
    building_id:String(p.building_id||""),
    name:p.name||"",
    neighborhood:p.neighborhood||"",
    city:p.city||"",
    value:Number(p.value)||0,
    area:Number(p.area)||0,
    bedrooms:Number(p.bedrooms)||0,
    bathrooms:Number(p.bathrooms)||0,
    suites:Number(p.suites)||0,
    parking:Number(p.parking)||0,
    stock:Number(p.stock)||0,
    source:p.source||"novos",
    status:p.status||"",
    developer:p.developer||"",
    property_url:p.property_url||"",
    image_url:p.image_url||"",
    address:p.address||null,
    rawData:
      p.rawData && typeof p.rawData==="object"
        ? p.rawData
        : (
            p.raw_data && typeof p.raw_data==="object"
              ? p.raw_data
              : {}
          )
  };

  const upsertInto=list=>{
    if(!Array.isArray(list))return [normalized];
    const existingIndex=list.findIndex(
      item=>String(item?.id||"")===String(normalized.id)
    );
    if(existingIndex>=0){
      const copy=[...list];
      copy[existingIndex]={
        ...copy[existingIndex],
        ...normalized
      };
      return copy;
    }
    return [normalized,...list];
  };

  properties=upsertInto(properties);

  if(String(normalized.source||"").toLowerCase()==="novos"){
    newPropertiesCache=upsertInto(newPropertiesCache);
  }

  return normalized;
}


function aiIsGreetingOnly(message){
  const t=norm(message||"")
    .replace(/[!?.,;:]+/g," ")
    .replace(/\s+/g," ")
    .trim();

  return Boolean(
    /^(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|e aí|opa|hello|hey|tudo bem|oi tudo bem|ola tudo bem|olá tudo bem|bom dia tudo bem|boa tarde tudo bem|boa noite tudo bem)$/.test(t)
  );
}

function aiGreetingReply(){
  const generic=
    Boolean(
      aiAssistantProperty?.generic_search
    );

  if(generic){
    return "Olá! 👋 Como posso ajudar? Você pode me dizer um bairro, faixa de preço, dormitórios ou o nome de um empreendimento.";
  }

  const name=
    aiAssistantProperty?.name ||
    "este imóvel";

  return `Olá! 👋 Pode perguntar o que quiser sobre ${name} — e, se preferir, também posso buscar outras opções para comparar.`;
}


function aiIsInternalDetailsRequest(message){
  const t=norm(message||"");

  return Boolean(
    /\b(link|url|detalhes|ver detalhes|pagina|página|anuncio|anúncio)\b/.test(t)
  );
}

function aiIsFloorplanRequest(message){
  const t=norm(message||"");

  return Boolean(
    /\b(planta|plantas|floor plan|floorplan|layout|tipologia)\b/.test(t)
  );
}

function aiRequestedArea(message){
  const t=norm(message||"");

  const m=t.match(
    /\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:m2|m²|metros?|metros quadrados?)\b/
  );

  if(!m)return 0;

  const n=Number(
    String(m[1])
      .replace(",",".")
  );

  return Number.isFinite(n)
    ? n
    : 0;
}

function aiFindFloorplanForArea(property,requestedArea=0){
  if(!property)return "";

  const raw=
    property?.rawData &&
    typeof property.rawData==="object"
      ? property.rawData
      : (
          property?.raw_data &&
          typeof property.raw_data==="object"
            ? property.raw_data
            : {}
        );

  const seen=new Set();
  const exact=[];
  const generic=[];

  const validImage=url=>{
    const s=clean(url);
    if(!validURL(s))return false;

    return Boolean(
      /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(s) ||
      /image|photo|media|cdn|orulo/i.test(s)
    );
  };

  const collectUrls=(obj,target)=>{
    if(!obj || typeof obj!=="object")return;

    Object.entries(obj).forEach(([key,val])=>{
      if(
        typeof val==="string" &&
        /^https?:\/\//i.test(val) &&
        validImage(val) &&
        /url|image|photo|picture|file|src|plant|planta|floor|layout/i.test(key)
      ){
        const u=clean(val);

        if(!seen.has(u)){
          seen.add(u);
          target.push(u);
        }
      }
    });
  };

  const walk=(value,path="",depth=0)=>{
    if(value==null || depth>11)return;

    if(Array.isArray(value)){
      value.forEach(
        (item,index)=>
          walk(
            item,
            `${path}[${index}]`,
            depth+1
          )
      );
      return;
    }

    if(typeof value!=="object")return;

    const areaCandidates=[
      value.area,
      value.private_area,
      value.usable_area,
      value.total_area,
      value.area_private,
      value.area_privativa
    ]
      .map(Number)
      .filter(Number.isFinite);

    const isRequestedArea=
      requestedArea>0 &&
      areaCandidates.some(
        a=>Math.abs(a-requestedArea)<=1.2
      );

    const context=
      norm(
        [
          path,
          value.name,
          value.title,
          value.label,
          value.type,
          value.description
        ]
          .filter(Boolean)
          .join(" ")
      );

    const looksLikePlan=
      /\b(planta|plantas|floorplan|floor plan|layout|tipologia|typology)\b/.test(context);

    if(isRequestedArea){
      collectUrls(
        value,
        exact
      );
    }

    if(looksLikePlan){
      collectUrls(
        value,
        generic
      );
    }

    Object.entries(value).forEach(
      ([key,val])=>{
        const next=
          path
            ? `${path}.${key}`
            : key;

        if(
          typeof val==="string" &&
          /^https?:\/\//i.test(val) &&
          validImage(val) &&
          /planta|plant|floor|layout|typolog/i.test(next)
        ){
          const u=clean(val);

          if(!seen.has(u)){
            seen.add(u);

            if(isRequestedArea){
              exact.push(u);
            }else{
              generic.push(u);
            }
          }

          return;
        }

        if(
          val &&
          typeof val==="object"
        ){
          walk(
            val,
            next,
            depth+1
          );
        }
      }
    );
  };

  walk(
    raw,
    "raw_data",
    0
  );

  walk(
    property,
    "property",
    0
  );

  /*
    Fallback no extrator já usado pela ficha do imóvel.
  */
  if(
    !exact.length &&
    !generic.length &&
    typeof extractFloorplans==="function"
  ){
    const fallback=
      extractFloorplans(
        raw,
        property
      );

    if(
      Array.isArray(fallback) &&
      fallback.length
    ){
      return fallback[0];
    }
  }

  return (
    exact[0] ||
    generic[0] ||
    ""
  );
}

function appendAiFloorplanButton(property,url,label="Ver planta"){
  if(!property || !url)return;

  const shell=
    ensureAiAssistantShell();

  const box=
    shell.querySelector(
      "#aiAssistantMessages"
    );

  if(!box)return;

  const wrap=
    document.createElement("div");

  wrap.className=
    "ai-quick-actions";

  const button=
    document.createElement("button");

  button.type="button";
  button.textContent=label;

  button.addEventListener(
    "click",
    ()=>{
      closeAiAssistant();

      window.setTimeout(
        ()=>{
          if(
            typeof openFloorplan==="function"
          ){
            openFloorplan(
              url,
              property
            );
          }else{
            window.open(
              url,
              "_blank",
              "noopener,noreferrer"
            );
          }
        },
        60
      );
    }
  );

  wrap.appendChild(button);
  box.appendChild(wrap);
  box.scrollTop=box.scrollHeight;
}


function developmentFloorplanLabel(plan,index=0){
  return clean(
    plan?.name ||
    plan?.description ||
    `Planta ${index+1}`
  );
}

function developmentFloorplanArea(plan){
  const direct=Number(
    plan?.area ||
    plan?.private_area ||
    0
  );

  if(Number.isFinite(direct) && direct>0){
    return direct;
  }

  const text=norm(
    [
      plan?.name,
      plan?.description,
      plan?.raw?.description
    ]
      .filter(Boolean)
      .join(" ")
  );

  const match=text.match(
    /(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:m2|m²|metros?)/i
  );

  if(!match){
    return 0;
  }

  const value=Number(
    String(match[1]).replace(",",".")
  );

  return Number.isFinite(value)
    ? value
    : 0;
}

function developmentFloorplanUrl(plan){
  return clean(
    plan?.url ||
    plan?.["1024x1024"] ||
    plan?.["2280x1800"] ||
    plan?.raw?.["1024x1024"] ||
    plan?.raw?.["2280x1800"] ||
    ""
  );
}

function findDevelopmentFloorplans(
  data,
  requestedArea=0
){
  const plans=
    Array.isArray(data?.media?.floor_plans)
      ? data.media.floor_plans
      : [];

  const available=
    plans
      .map((plan,index)=>({
        ...plan,
        _label:developmentFloorplanLabel(plan,index),
        _area:developmentFloorplanArea(plan),
        _url:developmentFloorplanUrl(plan)
      }))
      .filter(plan=>plan._url);

  if(!(requestedArea>0)){
    return available;
  }

  return available.filter(
    plan=>
      plan._area>0 &&
      Math.abs(plan._area-requestedArea)<=1.2
  );
}

function appendAiDevelopmentFloorplanButtons(
  property,
  plans
){
  if(
    !property ||
    !Array.isArray(plans) ||
    !plans.length
  ){
    return;
  }

  const shell=
    ensureAiAssistantShell();

  const box=
    shell.querySelector(
      "#aiAssistantMessages"
    );

  if(!box){
    return;
  }

  const wrap=
    document.createElement("div");

  wrap.className=
    "ai-quick-actions";

  plans
    .slice(0,8)
    .forEach(plan=>{
      const button=
        document.createElement("button");

      button.type="button";

      button.textContent=
        plan._area>0
          ? `Ver planta ${plan._area.toLocaleString("pt-BR")} m²`
          : `Ver ${plan._label}`;

      button.addEventListener(
        "click",
        ()=>{
          closeAiAssistant();

          window.setTimeout(
            ()=>{
              openFloorplan(
                plan._url,
                property
              );
            },
            60
          );
        }
      );

      wrap.appendChild(
        button
      );
    });

  box.appendChild(
    wrap
  );

  box.scrollTop=
    box.scrollHeight;
}


function aiIsPdfRequest(message){
  const t=norm(message||"");

  return Boolean(
    /\b(pdf|baixar|download|arquivo|book|tabela|memorial)\b/.test(t)
  );
}

function developmentPdfFiles(data){
  const files=
    Array.isArray(data?.media?.files)
      ? data.media.files
      : [];

  return files
    .map((file,index)=>({
      ...file,
      _name:clean(
        file?.name ||
        file?.title ||
        file?.filename ||
        `Arquivo ${index+1}`
      ),
      _url:clean(
        file?.url ||
        file?.file_url ||
        file?.download_url ||
        ""
      )
    }))
    .filter(file=>{
      if(!file._url){
        return false;
      }

      return Boolean(
        /\.pdf(?:\?|$)/i.test(file._url) ||
        /\b(pdf|book|tabela|memorial)\b/i.test(file._name)
      );
    });
}

function appendAiDownloadButton(
  label,
  url
){
  if(!url){
    return;
  }

  const shell=
    ensureAiAssistantShell();

  const box=
    shell.querySelector(
      "#aiAssistantMessages"
    );

  if(!box){
    return;
  }

  const wrap=
    document.createElement("div");

  wrap.className=
    "ai-quick-actions";

  const link=
    document.createElement("a");

  link.href=url;
  link.target="_blank";
  link.rel="noopener noreferrer";
  link.download="";
  link.textContent=label || "Baixar PDF";

  link.style.cssText=
    "display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid #c6a76b;background:#fcfaf6;color:#4a443c;font-weight:900;text-decoration:none;";

  wrap.appendChild(link);
  box.appendChild(wrap);
  box.scrollTop=box.scrollHeight;
}

function appendAiImageDownloadButton(
  label,
  url
){
  if(!url){
    return;
  }

  const shell=
    ensureAiAssistantShell();

  const box=
    shell.querySelector(
      "#aiAssistantMessages"
    );

  if(!box){
    return;
  }

  const wrap=
    document.createElement("div");

  wrap.className=
    "ai-quick-actions";

  const link=
    document.createElement("a");

  link.href=url;
  link.target="_blank";
  link.rel="noopener noreferrer";
  link.download="";
  link.textContent=label || "Baixar imagem da planta";

  link.style.cssText=
    "display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid #c6a76b;background:#fcfaf6;color:#4a443c;font-weight:900;text-decoration:none;";

  wrap.appendChild(link);
  box.appendChild(wrap);
  box.scrollTop=box.scrollHeight;
}

function aiIsMapRequest(message){
  const t=norm(message||"");

  return Boolean(
    /\b(mapa|google maps|maps|localizacao no mapa|localização no mapa|como chegar|rota|abrir mapa)\b/.test(t)
  );
}

function aiPropertyMapsUrl(property){
  if(!property)return "";

  const raw=
    property?.rawData &&
    typeof property.rawData==="object"
      ? property.rawData
      : (
          property?.raw_data &&
          typeof property.raw_data==="object"
            ? property.raw_data
            : {}
        );

  const building=
    raw?.building &&
    typeof raw.building==="object"
      ? raw.building
      : {};

  const addressData=
    building?.address &&
    typeof building.address==="object"
      ? building.address
      : (
          property?.address &&
          typeof property.address==="object"
            ? property.address
            : {}
        );

  let query="";

  try{
    query=
      typeof propertyMapQuery==="function"
        ? propertyMapQuery(
            property,
            addressData
          )
        : "";
  }catch(error){}

  if(!query){
    query=[
      typeof property.address==="string"
        ? property.address
        : "",
      property.neighborhood||"",
      property.city||"São Paulo"
    ]
      .filter(Boolean)
      .join(", ");
  }

  if(!query)return "";

  return (
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(query)
  );
}

function appendAiGoogleMapsButton(property){
  const url=
    aiPropertyMapsUrl(property);

  if(!url)return;

  const shell=
    ensureAiAssistantShell();

  const box=
    shell.querySelector(
      "#aiAssistantMessages"
    );

  if(!box)return;

  const wrap=
    document.createElement("div");

  wrap.className=
    "ai-quick-actions";

  const button=
    document.createElement("button");

  button.type="button";
  button.textContent=
    "Abrir no Google Maps";

  button.addEventListener(
    "click",
    ()=>{
      window.open(
        url,
        "_blank",
        "noopener,noreferrer"
      );
    }
  );

  wrap.appendChild(button);
  box.appendChild(wrap);
  box.scrollTop=box.scrollHeight;
}

function aiDisplayPrice(value){
  if(value===null || value===undefined){
    return "Preço sob consulta";
  }

  const text=String(value).trim();
  if(!text || text==="0"){
    return "Preço sob consulta";
  }

  const amount=Number(text);
  if(!Number.isFinite(amount) || amount<1){
    return "Preço sob consulta";
  }

  return money(amount);
}

function aiSelectableSearchCards(assistantProperties, searchMatches){
  const inventory=Array.isArray(searchMatches) ? searchMatches : [];
  const allowed=new Map();

  for(const item of inventory){
    const id=String(item?.id||"");
    if(id)allowed.set(id, item);
  }

  const source=
    Array.isArray(assistantProperties) && assistantProperties.length
      ? assistantProperties
      : inventory;

  const cards=[];
  const skipped=[];

  for(const item of source){
    const id=String(item?.id||item?.property_id||"");
    const known=id ? allowed.get(id) : null;

    if(!known){
      skipped.push({
        property_id:id,
        nome:item?.name||"",
        origem:item?.source||""
      });
      continue;
    }

    cards.push(known);
    if(cards.length===5)break;
  }

  return {cards, skipped};
}

function appendAiPropertyCards(cards){
  const shell=ensureAiAssistantShell();
  const box=shell.querySelector("#aiAssistantMessages");
  if(!box || !cards.length)return;

  const list=document.createElement("div");
  list.className="ai-result-list";

  for(const property of cards){
    const card=document.createElement("article");
    card.className="ai-result-card";

    const name=document.createElement("div");
    name.className="ai-result-name";
    name.textContent=property.name||"Imóvel disponível";

    const source=String(property.source||"").toLowerCase();
    if(source==="novos" || source==="usados"){
      const tag=document.createElement("span");
      tag.className="ai-result-source";
      tag.textContent=source==="novos" ? "NOVO" : "USADO";
      name.appendChild(tag);
    }

    const meta=document.createElement("div");
    meta.className="ai-result-meta";
    meta.textContent=property.neighborhood||"";

    const price=document.createElement("div");
    price.className="ai-result-price";
    price.textContent=aiDisplayPrice(property.value);

    const facts=document.createElement("div");
    facts.className="ai-result-facts";
    const bits=[];
    if(Number(property.bedrooms)>0){
      bits.push(`${Number(property.bedrooms)} dorm${Number(property.bedrooms)>1?"s.":"."}`);
    }
    if(Number(property.area)>0){
      bits.push(`${area(property.area)} m²`);
    }
    facts.textContent=bits.join(" · ");

    const button=document.createElement("button");
    button.type="button";
    button.className="view";
    button.textContent="Ver detalhes";
    button.addEventListener("click",()=>{
      openAiInventoryDetails(property);
    });

    card.append(name);
    if(meta.textContent)card.append(meta);
    card.append(price);
    if(facts.textContent)card.append(facts);
    card.append(button);
    list.append(card);
  }

  box.appendChild(list);
  box.scrollTop=box.scrollHeight;
}

let aiResumeChatAfterDetail=false;

function openAiInventoryDetails(property){
  const selection=aiSelectableSearchCards(
    [property],
    aiLastSearchContext?.matches||[]
  );

  for(const skipped of selection.skipped){
    console.warn("MATCH_IA_PROPERTY_NOT_FOUND", skipped);
  }

  const known=selection.cards[0];
  if(!known?.id)return;

  const registered=registerAiFoundProperty(known);
  aiRememberOpenedProperty(registered);
  if(!registered?.id){
    console.warn("MATCH_IA_PROPERTY_NOT_FOUND",{
      property_id:String(property?.id||property?.property_id||""),
      nome:property?.name||"",
      origem:property?.source||""
    });
    return;
  }

  aiResumeChatAfterDetail=true;
  closeAiAssistant();

  window.setTimeout(()=>{
    showPhotoModal(String(registered.id));
  },60);
}

function appendAiInternalDetailsButton(property){
  if(!property?.id)return;

  const shell=ensureAiAssistantShell();
  const box=shell.querySelector("#aiAssistantMessages");
  if(!box)return;

  const wrap=document.createElement("div");
  wrap.className="ai-quick-actions";

  const button=document.createElement("button");
  button.type="button";
  button.textContent="Ver detalhes";
  button.dataset.aiInternalDetails=String(property.id);

  button.addEventListener("click",()=>{
    const p=registerAiFoundProperty(property);
    aiRememberOpenedProperty(p);

    /*
      A Match IA usa z-index maior que o modal de detalhes.
      Fechamos a conversa antes de abrir o detalhe para evitar
      que o modal fique renderizado por baixo da IA.
    */
    aiResumeChatAfterDetail=true;
    closeAiAssistant();

    window.setTimeout(()=>{
      showPhotoModal(String(p.id));
    },60);
  });

  wrap.appendChild(button);
  box.appendChild(wrap);
  box.scrollTop=box.scrollHeight;
}

function stripExternalProviderLinks(text){
  return String(text||"")
    .replace(
      /\s*(?:Ver detalhes|Detalhes|Link do anúncio|Link):?\s*https?:\/\/(?:www\.)?orulo\.com\.br\/\S*/gi,
      ""
    )
    .replace(
      /https?:\/\/(?:www\.)?orulo\.com\.br\/\S*/gi,
      ""
    )
    .replace(
      /(?:Tem|Existe|Há|Possui|Consta)?\s*(?:o\s+)?link\s+(?:do\s+)?empreendimento\s+(?:no|na)\s+Ó?rulo[^.!?]*[.!?]?/gi,
      ""
    )
    .replace(
      /\bÓ?rulo\b/gi,
      "catálogo"
    )
    .replace(/\s{2,}/g," ")
    .trim();
}

function appendAiMessage(role,text){
  const shell=ensureAiAssistantShell();
  const box=shell.querySelector("#aiAssistantMessages");
  if(!box)return;

  const finalText=
    role==="assistant"
      ? aiSanitizeHandoffPromise(text)
      : clean(text||"");

  const div=document.createElement("div");
  div.className=`ai-msg ${role}`;
  div.textContent=finalText;
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;

  registerAiLeadConversation(role,finalText);
}


function aiTitleCase(value){
  return clean(value)
    .toLowerCase()
    .replace(
      /(^|\s|-)([a-záàâãéèêíïóôõöúçñ])/g,
      (_,sep,ch)=>sep+ch.toUpperCase()
    );
}

function aiKnownNeighborhoodNames(){
  const fromRegions=
    typeof REGION_MAP==="object" && REGION_MAP
      ? Object.values(REGION_MAP).flat()
      : [];

  const fromInventory=
    Array.isArray(newPropertiesCache)
      ? newPropertiesCache
          .map(p=>clean(p?.neighborhood))
          .filter(Boolean)
      : [];

  return [...new Set([
    ...fromRegions,
    ...fromInventory
  ])]
    .filter(Boolean)
    .sort((a,b)=>b.length-a.length);
}

function aiDetectSearchAmbiguity(message){
  const found=
    AiSearchRouting.aiDetectProjectNeighborhoodAmbiguity(
      message,
      aiRoutingNeighborhoodCatalog(),
      aiKnownProjectNames()
    );

  if(!found)return null;

  return {
    ambiguous:true,
    project:found.project,
    neighborhood:found.neighborhood
  };
}

function appendAiDisambiguationChoice({
  project,
  neighborhood
}){
  const shell=ensureAiAssistantShell();
  const box=shell.querySelector("#aiAssistantMessages");

  if(!box)return;

  const question=
    `Entendi duas possibilidades: você quer procurar o empreendimento “${project}” ou imóveis no bairro ${neighborhood}?`;

  appendAiMessage(
    "assistant",
    question
  );

  aiAssistantHistory.push({
    role:"assistant",
    content:question
  });

  aiAssistantHistory=
    aiAssistantHistory.slice(-12);

  const wrap=
    document.createElement("div");

  wrap.className=
    "ai-disambiguation";

  const projectButton=
    document.createElement("button");

  projectButton.type="button";
  projectButton.className=
    "ai-disambiguation-btn";

  projectButton.innerHTML=
    `<strong>Empreendimento ${esc(project)}</strong>` +
    `<small>Buscar pelo nome do empreendimento/condomínio</small>`;

  const neighborhoodButton=
    document.createElement("button");

  neighborhoodButton.type="button";
  neighborhoodButton.className=
    "ai-disambiguation-btn";

  neighborhoodButton.innerHTML=
    `<strong>Imóveis em ${esc(neighborhood)}</strong>` +
    `<small>Buscar todo o estoque disponível no bairro</small>`;

  function lockButtons(){
    projectButton.disabled=true;
    neighborhoodButton.disabled=true;
  }

  projectButton.addEventListener(
    "click",
    ()=>{
      lockButtons();

      aiPendingDisambiguationChoice={
        type:"project",
        value:project
      };

      /*
        Nova intenção explícita:
        não herda bairro/região/preço/dormitórios antigos.
      */
      resetAiSearchState();

      sendAiAssistantMessage(
        `Buscar empreendimento ${project}`
      );
    }
  );

  neighborhoodButton.addEventListener(
    "click",
    ()=>{
      lockButtons();

      aiPendingDisambiguationChoice={
        type:"neighborhood",
        value:neighborhood
      };

      resetAiSearchState();

      sendAiAssistantMessage(
        `Buscar imóveis em ${neighborhood}`
      );
    }
  );

  wrap.appendChild(
    projectButton
  );

  wrap.appendChild(
    neighborhoodButton
  );

  box.appendChild(wrap);
  box.scrollTop=box.scrollHeight;
}

function appendAiProjectOptions(candidates){
  const shell=ensureAiAssistantShell();
  const box=shell.querySelector("#aiAssistantMessages");
  const labels=[...new Set(
    (Array.isArray(candidates)?candidates:[])
      .map(name=>clean(name))
      .filter(Boolean)
  )].slice(0,8);

  if(!box || labels.length<2)return;

  const question=labels.length===2
    ? `Encontrei mais de um empreendimento com esse nome. Você procura ${labels[0]} ou ${labels[1]}?`
    : `Encontrei mais de um empreendimento com esse nome. Você procura ${labels.slice(0,-1).join(", ")} ou ${labels[labels.length-1]}?`;

  appendAiMessage("assistant", question);
  aiAssistantHistory.push({
    role:"assistant",
    content:question
  });
  aiAssistantHistory=aiAssistantHistory.slice(-12);

  const wrap=document.createElement("div");
  wrap.className="ai-disambiguation";
  const buttons=[];

  for(const label of labels){
    const button=document.createElement("button");
    button.type="button";
    button.className="ai-disambiguation-btn";
    button.textContent=label;
    button.addEventListener("click",()=>{
      for(const item of buttons)item.disabled=true;
      sendAiAssistantMessage(label);
    });
    buttons.push(button);
    wrap.appendChild(button);
  }

  box.appendChild(wrap);
  box.scrollTop=box.scrollHeight;
}

function extractBrazilianPhone(text){
  const candidates=String(text||"").match(/(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9?\d{4})[\s.-]*\d{4}/g) || [];

  for(const candidate of candidates){
    let digits=String(candidate).replace(/\D/g,"");

    if((digits.length===12 || digits.length===13) && digits.startsWith("55")){
      digits=digits.slice(2);
    }

    if(digits.length===10 || digits.length===11){
      return digits;
    }
  }

  return "";
}

function formatBrazilianPhone(phone){
  const digits=String(phone||"").replace(/\D/g,"");
  if(digits.length===11){
    return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  }
  if(digits.length===10){
    return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  }
  return phone||"";
}

function openAiLeadCaptureFromPhone(phone){
  if(!aiAssistantProperty || !phone)return;

  const property=aiAssistantProperty;
  const formattedPhone=formatBrazilianPhone(phone);
  const aiShell=document.getElementById("aiAssistantShell");

  try{
    gtag("event","ai_phone_detected",{
      property_id:String(property.id||""),
      property_name:property.name||""
    });
  }catch(error){}

  supabaseTrack("ai_phone_detected",{
    property_id:String(property.id||""),
    property_name:property.name||""
  });

  aiShell?.classList.remove("open");
  aiShell?.remove();
  document.body.style.overflow="hidden";

  setTimeout(()=>{
    openLeadCapture(property,{
      phone:formattedPhone,
      source:"match_ia_phone"
    });
  },160);
}


/* =========================================================
   HOME IA · BUSCA NA BASE DE NOVOS / ÓRULO
========================================================= */

let aiOruloInventoryPromise=null;

async function ensureAiOruloInventory(){
  if(aiOruloInventoryPromise)return aiOruloInventoryPromise;

  aiOruloInventoryPromise=(async()=>{
    try{
      if((!Array.isArray(newPropertiesCache) || newPropertiesCache.length===0) &&
         typeof fetchNewCatalogPage==="function"){
        await fetchNewCatalogPage({reset:true});
      }

      let guard=0;
      while(
        typeof newCatalogHasMore!=="undefined" &&
        newCatalogHasMore &&
        guard<80
      ){
        guard++;
        await fetchNewCatalogPage({reset:false});
      }

      return Array.isArray(newPropertiesCache)
        ? [...newPropertiesCache]
        : [];
    }catch(error){
      console.error("AI_ORULO_LOAD_ERROR",error);
      return Array.isArray(newPropertiesCache)
        ? [...newPropertiesCache]
        : [];
    }
  })();

  return aiOruloInventoryPromise;
}

function aiNormalizeMoneyNumber(raw){
  return AiSearchRouting.aiNormalizeMoneyNumber(raw);
}

function aiApplyMoneyUnit(value,unit=""){
  return AiSearchRouting.aiApplyMoneyUnit(value,unit);
}

function aiOruloParseMoney(text){
  return AiSearchRouting.aiOruloParseMoney(text);
}

function aiGetRawProperty(p){
  return p?.rawData && typeof p.rawData==="object"
    ? p.rawData
    : {};
}

function aiGetPropertySearchText(p){
  const raw=aiGetRawProperty(p);
  const building=raw?.building && typeof raw.building==="object"
    ? raw.building
    : {};

  const address=building?.address && typeof building.address==="object"
    ? building.address
    : {};

  return norm([
    p?.name,
    p?.neighborhood,
    p?.address,
    p?.description,

    raw?.name,
    raw?.title,
    raw?.project_name,
    raw?.development_name,
    raw?.building_name,

    building?.name,
    building?.title,
    building?.commercial_name,
    building?.development_name,
    building?.description,

    address?.neighborhood,
    address?.street,
    address?.city
  ].filter(Boolean).join(" "));
}

function aiGetPropertyDisplayName(p){
  const raw=aiGetRawProperty(p);
  const building=raw?.building && typeof raw.building==="object"
    ? raw.building
    : {};

  return clean(
    p?.name ||
    building?.name ||
    building?.commercial_name ||
    raw?.name ||
    raw?.title ||
    "Empreendimento"
  );
}


/* =========================================================
   MATCH IA · ESTADO ESTRUTURADO DA BUSCA
========================================================= */

let aiSearchState={
  region:"",
  neighborhood:"",
  exactName:"",
  bedrooms:0,
  minPrice:0,
  maxPrice:0,
  inventorySource:""
};

let aiLastRoutingTurn=null;

function resetAiSearchState(){
  aiSearchState={
    region:"",
    neighborhood:"",
    exactName:"",
    bedrooms:0,
    minPrice:0,
    maxPrice:0,
    inventorySource:""
  };
}

function aiNeighborhoodsFromInventory(inventory){
  const list=Array.isArray(inventory)
    ? inventory
    : (Array.isArray(newPropertiesCache) ? newPropertiesCache : []);

  return list.flatMap(p=>{
    const raw=aiGetRawProperty(p);
    const building=raw?.building && typeof raw.building==="object" ? raw.building : {};
    return [
      p?.neighborhood,
      building?.address?.neighborhood,
      raw?.neighborhood
    ];
  });
}

function aiRoutingNeighborhoodCatalog(inventory){
  return [
    ...aiKnownNeighborhoodNames(),
    ...aiNeighborhoodsFromInventory(inventory)
  ];
}

function aiKnownProjectNames(inventory){
  const list=Array.isArray(inventory)
    ? inventory
    : (Array.isArray(newPropertiesCache) ? newPropertiesCache : []);

  return list.flatMap(p=>{
    const raw=aiGetRawProperty(p);
    const building=raw?.building && typeof raw.building==="object" ? raw.building : {};
    return [
      p?.name,
      raw?.name,
      raw?.title,
      raw?.project_name,
      raw?.development_name,
      raw?.building_name,
      building?.name,
      building?.title,
      building?.commercial_name,
      building?.development_name
    ];
  });
}

function aiCurrentRoutingContext(){
  const propertyNeighborhood=
    typeof aiIsPropertyMode==="function" && aiIsPropertyMode()
      ? (aiAssistantProperty?.neighborhood || "")
      : "";

  return {
    region:aiSearchState?.region || "",
    neighborhood:aiSearchState?.neighborhood || propertyNeighborhood,
    exactName:aiSearchState?.exactName || "",
    bedrooms:Number(aiSearchState?.bedrooms)||0,
    minPrice:Number(aiSearchState?.minPrice)||0,
    maxPrice:Number(aiSearchState?.maxPrice)||0,
    hasProperty:typeof aiIsPropertyMode==="function" ? aiIsPropertyMode() : false
  };
}

function aiCanonicalNeighborhood(message,knownNeighborhoods){
  return AiSearchRouting.aiCanonicalNeighborhood(
    message,
    knownNeighborhoods || aiRoutingNeighborhoodCatalog()
  );
}

function aiClassifySearchTurn(message,context,knownNeighborhoods,knownProjects){
  return AiSearchRouting.aiClassifySearchTurn(
    message,
    context || aiCurrentRoutingContext(),
    knownNeighborhoods || aiRoutingNeighborhoodCatalog(),
    knownProjects || aiKnownProjectNames()
  );
}

function aiExtractExplicitRegion(message){
  return AiSearchRouting.aiExtractExplicitRegion(message);
}

function aiMessageStartsNewSearch(text){
  return aiClassifySearchTurn(
    text,
    aiCurrentRoutingContext(),
    aiRoutingNeighborhoodCatalog()
  ).kind==="reset";
}

function aiMessageClearlyStartsNewSearch(message){
  const kind=aiClassifySearchTurn(
    message,
    aiCurrentRoutingContext(),
    aiRoutingNeighborhoodCatalog()
  ).kind;

  return kind==="reset" || kind==="alternatives";
}

function aiExtractExplicitNeighborhood(message,inventory){
  return aiCanonicalNeighborhood(
    message,
    aiRoutingNeighborhoodCatalog(inventory)
  );
}

function aiExtractExplicitProject(message,inventory){
  const project=AiSearchRouting.aiMatchKnownProject(
    message,
    aiKnownProjectNames(inventory)
  ) || "";
  const neighborhood=aiCanonicalNeighborhood(
    message,
    aiRoutingNeighborhoodCatalog(inventory)
  );

  if(
    project &&
    neighborhood &&
    norm(project)===norm(neighborhood)
  ){
    return "";
  }

  return project;
}

let aiTurnProjectNames=null;

function aiRoutingProjects(){
  return Array.isArray(aiTurnProjectNames)
    ? aiTurnProjectNames
    : aiKnownProjectNames();
}

async function aiLookupDevelopmentNames(token){
  const safe=String(token||"")
    .replace(/[*,()]/g,"")
    .trim();

  if(safe.length<4 || typeof SUPABASE_URL!=="string")return [];

  try{
    const url=new URL(`${SUPABASE_URL}/rest/v1/properties`);
    url.searchParams.set("select","development_name");
    url.searchParams.set("active","eq.true");
    url.searchParams.set("development_name",`ilike.*${safe}*`);
    url.searchParams.set("limit","300");

    const response=await fetch(url.toString(),{
      headers:{
        apikey:SUPABASE_PUBLISHABLE_KEY,
        Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      }
    });

    if(!response.ok)return [];

    const rows=await response.json();
    return [...new Set(
      (Array.isArray(rows)?rows:[])
        .map(row=>clean(row?.development_name))
        .filter(Boolean)
    )];
  }catch(error){
    console.warn("MATCH_IA_PROJECT_LOOKUP",error);
    return [];
  }
}

async function aiPrepareProjectNames(message){
  const token=AiSearchRouting.aiProjectLookupToken(
    message,
    aiRoutingNeighborhoodCatalog()
  );
  const local=aiKnownProjectNames();

  if(!token){
    aiTurnProjectNames=local;
    return;
  }

  const remote=await aiLookupDevelopmentNames(token);
  aiTurnProjectNames=[...new Set([...local,...remote])];
}

function aiUpdateSearchState(message,inventory){
  const applied=AiSearchRouting.aiNextSearchState(
    aiSearchState,
    message,
    aiRoutingNeighborhoodCatalog(inventory),
    aiRoutingProjects()
  );

  const turn=applied.turn;
  const state={...applied.state};
  const keepResolvedProject=
    turn.reason==="known_project" &&
    Boolean(state.exactName);

  if(!keepResolvedProject){
    const explicitProject=
      turn.kind==="vague" ||
      turn.kind==="follow_up" ||
      turn.kind==="project_options"
        ? state.exactName
        : aiExtractExplicitProject(message,inventory);

    if(
      turn.kind!=="vague" &&
      turn.kind!=="follow_up" &&
      turn.kind!=="project_options"
    ){
      if(explicitProject){
        state.exactName=explicitProject;
      }else if(turn.kind==="reset" || turn.kind==="alternatives"){
        state.exactName="";
      }
    }
  }

  aiSearchState=state;
  aiLastRoutingTurn=turn;

  /*
    Complementos curtos continuam em refine:
    "2 dorms" mantém bairro.
    "até 900 mil" mantém bairro e dormitórios.
    Local novo ou frase de recomeço zera o que a frase não repetiu.
  */

  console.log("MATCH_IA_SEARCH_STATE",{
    isNew:turn.kind==="reset",
    kind:turn.kind,
    reason:turn.reason,
    message,
    state:{...aiSearchState}
  });

  return {...aiSearchState};
}

function aiOruloContext(message){
  const inventory=Array.isArray(newPropertiesCache)?newPropertiesCache:[];
  const state=aiUpdateSearchState(message,inventory);

  const exactName=state.exactName||"";
  const neighborhood=state.neighborhood||"";
  const bedrooms=Number(state.bedrooms)||0;
  const minPrice=Number(state.minPrice)||0;
  const maxPrice=Number(state.maxPrice)||0;

  const filtered=inventory.filter(p=>{
    if(!p)return false;

    const searchText=aiGetPropertySearchText(p);

    if(exactName){
      const exactTokens=norm(exactName).split(/\s+/).filter(Boolean);
      if(!exactTokens.every(t=>searchText.includes(t)))return false;
    }

    if(neighborhood){
      const tokens=norm(neighborhood).split(/\s+/).filter(Boolean);
      if(!tokens.every(t=>searchText.includes(t)))return false;
    }

    if(bedrooms){
      const pBedrooms=Number(
        p.bedrooms ||
        p?.rawData?.typology?.bedrooms ||
        0
      );
      if(pBedrooms!==bedrooms)return false;
    }

    if(minPrice && Number(p.value||0)<minPrice)return false;
    if(maxPrice && Number(p.value||0)>maxPrice)return false;

    return true;
  });

  const recognized=Boolean(
    exactName ||
    neighborhood ||
    bedrooms ||
    minPrice ||
    maxPrice
  );

  let alternatives=[];

  if(recognized && filtered.length===0){
    alternatives=inventory
      .filter(p=>{
        const text=aiGetPropertySearchText(p);

        if(neighborhood){
          const tokens=norm(neighborhood).split(/\s+/).filter(Boolean);
          if(!tokens.every(t=>text.includes(t)))return false;
        }

        if(exactName){
          const nameTokens=norm(exactName).split(/\s+/).filter(Boolean);
          if(!nameTokens.some(t=>text.includes(t)))return false;
        }

        return true;
      })
      .slice(0,6);
  }

  return {
    inventory_ready:inventory.length>0,
    inventory_count:inventory.length,
    recognized_filters:recognized,
    query:{
      exact_name:exactName,
      neighborhood,
      bedrooms,
      min_price:minPrice,
      max_price:maxPrice,
      source:"todos"
    },
    total:filtered.length,
    matches:filtered.slice(0,12).map(p=>({
      id:String(p.id||""),
      name:aiGetPropertyDisplayName(p),
      neighborhood:p.neighborhood||p?.rawData?.building?.address?.neighborhood||"",
      city:p.city||p?.rawData?.building?.address?.city||activeCity||"São Paulo",
      value:Number(p.value)||0,
      area:Number(p.area)||0,
      bedrooms:Number(p.bedrooms||p?.rawData?.typology?.bedrooms||0),
      suites:Number(p.suites||p?.rawData?.typology?.suites||0),
      parking:Number(p.parking||p?.rawData?.typology?.parking||0),
      source:"novos",
      status:p.status||p?.rawData?.building?.stage||""
    })),
    alternatives:alternatives.map(p=>({
      id:String(p.id||""),
      name:aiGetPropertyDisplayName(p),
      neighborhood:p.neighborhood||p?.rawData?.building?.address?.neighborhood||"",
      value:Number(p.value)||0,
      bedrooms:Number(p.bedrooms||p?.rawData?.typology?.bedrooms||0),
      area:Number(p.area)||0
    }))
  };
}

function openHomeAiSearch(){
  resetAiSearchState();
  aiResetConversationSearchMemory();
  resetAiLeadConversation();

  aiAssistantProperty={
    id:"__orulo_search__",
    name:"Busca de lançamentos",
    neighborhood:"",
    source:"todos",
    generic_search:true
  };

  aiAssistantHistory=[];

  const shell=ensureAiAssistantShell();
  const box=shell.querySelector("#aiAssistantMessages");
  const input=shell.querySelector("#aiAssistantInput");
  const handoff=shell.querySelector("#aiHumanHandoff");

  if(box)box.innerHTML="";
  if(input)input.placeholder="Digite bairro, preço, dormitórios ou empreendimento...";
  if(handoff)aiSetHumanHandoffVisible(false);

  shell.classList.add("open");
  document.body.style.overflow="hidden";

  appendAiMessage(
    "assistant",
    "Oi! 👋 Eu sou a Match IA. Posso pesquisar imóveis novos e usados disponíveis na nossa base. Me diga um bairro, faixa de preço, dormitórios ou o nome de um empreendimento."
  );

  /* Busca real acontece sob demanda via /api/search-properties */

  try{
    gtag("event","ai_assistant_open",{mode:"search_orulo"});
  }catch(error){}

  supabaseTrack("ai_assistant_open",{mode:"search_orulo"});
}

function openAiAssistant(p){
  if(!p)return;
  aiAssistantProperty=p;
  aiAssistantHistory=[];
  resetAiLeadConversation();
  const shell=ensureAiAssistantShell();
  const box=shell.querySelector("#aiAssistantMessages");
  if(box)box.innerHTML="";
  aiSetHumanHandoffVisible(false);
  
  shell.classList.add("open");
  document.body.style.overflow="hidden";

  const sourceLabel=String(p.source||"").toLowerCase()==="novos" ? "lançamento" : "imóvel";
  appendAiMessage("assistant",`Oi! Vi que você está olhando ${p.name||"este imóvel"}${p.neighborhood?` em ${p.neighborhood}`:""}. Pode me perguntar o que quiser sobre este imóvel — e também posso buscar outras unidades e opções do nosso estoque para comparar com você.`);

  try{
    gtag("event","ai_assistant_open",{
      property_id:String(p.id||""),property_name:p.name||"",neighborhood:p.neighborhood||""
    });
  }catch(error){}
  supabaseTrack("ai_assistant_open",{property_id:String(p.id||""),property_name:p.name||"",neighborhood:p.neighborhood||""});
}

function closeAiAssistant(){
  const shell=document.getElementById("aiAssistantShell");
  shell?.classList.remove("open");
  if(document.getElementById("photoModal"))document.body.style.overflow="hidden";
  else document.body.style.overflow="";
}


/* =========================================================
   MATCH IA · BUSCA REAL VIA /api/search-properties
========================================================= */


/* =========================================================
   MATCH IA · MEMÓRIA DE RESULTADOS / FOLLOW-UP
========================================================= */

let aiLastSearchContext = null;
let aiLastSelectedProperty = null;

function aiResetConversationSearchMemory(){
  aiLastSearchContext = null;
  aiLastSelectedProperty = null;
}

function aiStoreSearchContext(ctx){
  aiLastSearchContext = ctx || null;

  if(
    ctx &&
    Array.isArray(ctx.matches) &&
    ctx.matches.length === 1
  ){
    aiLastSelectedProperty = ctx.matches[0];
  }
}

function aiIsFollowUpMessage(message){
  const t = norm(message || "");

  return Boolean(
    /\b(link|url|endereco|endereço|metragem|area|área|preco|preço|valor|dormitorios|dormitórios|quartos|vagas|suite|suíte|varanda|detalhes|mais sobre|fale mais|esse|essa|desse|dessa|primeiro|segundo|terceiro|unidade|unidades|estoque|quantas|quantos|disponibilidade|disponiveis|disponíveis)\b/.test(t)
  );
}

function aiPickReferencedMatch(message){
  const ctx = aiLastSearchContext;

  if(
    !ctx ||
    !Array.isArray(ctx.matches) ||
    !ctx.matches.length
  ){
    return null;
  }

  const t = norm(message || "");

  if(/\b(segundo|2o|2º)\b/.test(t)){
    return ctx.matches[1] || ctx.matches[0];
  }

  if(/\b(terceiro|3o|3º)\b/.test(t)){
    return ctx.matches[2] || ctx.matches[0];
  }

  if(/\b(primeiro|1o|1º)\b/.test(t)){
    return ctx.matches[0];
  }

  /*
    Se o usuário repete o nome do empreendimento,
    encontra o match correspondente.
  */
  for(const item of ctx.matches){
    const name = norm(item?.name || "");
    if(name && t.includes(name)){
      return item;
    }

    const nameTokens = name
      .split(/\s+/)
      .filter(x => x.length >= 4);

    if(
      nameTokens.length &&
      nameTokens.every(token => t.includes(token))
    ){
      return item;
    }
  }

  /*
    Se só houve um resultado, "esse / desse / o link"
    refere-se naturalmente a ele.
  */
  if(ctx.matches.length === 1){
    return ctx.matches[0];
  }

  /*
    Várias tipologias podem ser do MESMO empreendimento.
    Nesse caso, "tem link?" refere-se naturalmente ao empreendimento,
    então usamos a primeira tipologia como porta de entrada do detalhe.
  */
  const visible=
    ctx.matches.slice(0,3);

  const normalizedNames=
    [...new Set(
      visible
        .map(item=>norm(item?.name||""))
        .filter(Boolean)
    )];

  const buildingIds=
    [...new Set(
      visible
        .map(item=>String(item?.building_id||"").trim())
        .filter(Boolean)
    )];

  if(
    visible.length > 1 &&
    (
      normalizedNames.length === 1 ||
      buildingIds.length === 1
    )
  ){
    return visible[0];
  }

  return aiLastSelectedProperty || null;
}

function aiFormatPropertyForAssistant(p){
  if(!p) return {};

  return {
    id: p.id || "",
    building_id: p.building_id || "",
    name: p.name || "",
    neighborhood: p.neighborhood || "",
    city: p.city || "",
    value: Number(p.value) || 0,
    area: Number(p.area) || 0,
    bedrooms: Number(p.bedrooms) || 0,
    bathrooms: Number(p.bathrooms) || 0,
    suites: Number(p.suites) || 0,
    parking: Number(p.parking) || 0,
    stock: Number(p.stock) || 0,
    status: p.status || "",
    developer: p.developer || "",
    property_url: p.property_url || "",
    image_url: p.image_url || "",
    address: p.address || null,
    source: p.source || "novos"
  };
}

function aiDirectFollowUpAnswer(message, property){
  if(!property) return "";

  const t = norm(message || "");
  const name = property.name || "Este imóvel";

  if(/\b(link|url|detalhes|ver detalhes)\b/.test(t)){
    return `Claro. Abra os detalhes completos do ${name} no botão abaixo.`;
  }

  if(/\b(endereco|endereço)\b/.test(t)){
    const a = property.address;
    if(a && typeof a === "object"){
      const parts = [
        a.street,
        a.number,
        a.neighborhood,
        a.city,
        a.state
      ].filter(Boolean);

      if(parts.length){
        return `${name}: ${parts.join(", ")}.`;
      }
    }

    if(typeof a === "string" && a.trim()){
      return `${name}: ${a.trim()}.`;
    }
  }

  if(/\b(metragem|area|área)\b/.test(t) && Number(property.area) > 0){
    return `${name}: ${Number(property.area).toLocaleString("pt-BR")} m².`;
  }

  if(/\b(preco|preço|valor)\b/.test(t) && Number(property.value) > 0){
    return `${name}: ${money(Number(property.value))}.`;
  }

  if(/\b(dormitorios|dormitórios|quartos)\b/.test(t) && Number(property.bedrooms) > 0){
    return `${name}: ${Number(property.bedrooms)} dormitório${Number(property.bedrooms) > 1 ? "s" : ""}.`;
  }

  if(/\b(unidade|unidades|estoque|quantas|quantos|disponibilidade|disponiveis|disponíveis)\b/.test(t)){
    const stock = Number(property.stock);

    if(Number.isFinite(stock) && stock > 0){
      return `${name}: o cadastro atual informa ${stock} unidade${stock > 1 ? "s" : ""} em estoque. Como o estoque pode mudar, a disponibilidade comercial deve ser confirmada no atendimento.`;
    }

    return `O ${name} está cadastrado na base, mas o número de unidades disponíveis não veio informado neste resultado. Posso te passar os detalhes do imóvel ou encaminhar para confirmação com o Rafael.`;
  }

  return "";
}

async function aiSearchRegionFromSupabase(...args){
  await window.YntFeatureLoader.load('legacy-ai-actions');
  return aiSearchRegionFromSupabase.apply(this,args);
}

function aiApiErrorText(error, fallback){
  if(typeof error==="string" && error.trim()){
    return error.trim();
  }

  if(
    error &&
    typeof error==="object" &&
    typeof error.message==="string" &&
    error.message.trim()
  ){
    return error.message.trim();
  }

  return fallback;
}

async function searchPropertiesForAi(...args){
  await window.YntFeatureLoader.load('legacy-ai-actions');
  return searchPropertiesForAi.apply(this,args);
}

/* =========================================================
   MATCH IA · ROTEADOR SEARCH ↔ PROPERTY
========================================================= */

let aiPendingSearchOverride = null;

/*
  Último imóvel deixado para trás quando a conversa volta
  à busca geral. Serve para entender "outro imóvel" logo
  depois de sair de um detalhe.
*/
let aiLastPropertyBeforeHome = null;

function aiIsPropertyMode(){
  return Boolean(
    aiAssistantProperty &&
    aiAssistantProperty.generic_search !== true &&
    aiAssistantProperty.id !== "__general_search__"
  );
}



function aiIsExplicitInventorySearch(message){
  const t=norm(message||"");

  if(!t)return false;

  return Boolean(
    /\b(tem|existe|ha|há)\b.*\b(estoque|imovel|imóvel|empreendimento|condominio|condomínio)\b/.test(t) ||
    /\b(busca|buscar|busque|procura|procurar|procure|pesquisa|pesquisar|ache|encontre|quero ver|quero saber sobre|comparar|compare|comparacao|comparação)\b/.test(t) ||
    /\b(tem algum|tem alguma|tem o|tem a|existe algum|existe alguma)\b/.test(t)
  );
}

function aiSyncInputPlaceholder(){
  const input=
    document.getElementById(
      "aiAssistantInput"
    );

  if(!input)return;

  input.placeholder=
    Boolean(
      aiAssistantProperty?.generic_search
    )
      ? "Digite bairro, preço, dormitórios ou empreendimento..."
      : "Digite sua dúvida sobre este imóvel...";
}

function aiSwitchToFreshSearchMode(){
  /*
    Nova intenção explícita de busca:
    não herda bairro, região, preço ou dormitórios do imóvel anterior.
  */
  aiPendingSearchOverride=null;
  aiPendingDisambiguationChoice=null;

  if(typeof resetAiSearchState==="function"){
    resetAiSearchState();
  }

  aiAssistantProperty={
    generic_search:true
  };

  aiLastSelectedProperty=null;
  aiLastPropertyBeforeHome=null;

  aiSyncInputPlaceholder();
}

function aiIsRequestForAlternatives(message){
  return AiSearchRouting.aiIsRequestForAlternatives(message);
}

function aiExtractSearchHintFromMessage(message){
  const money=aiOruloParseMoney(message);
  const neighborhood=aiCanonicalNeighborhood(message);

  return {
    query:String(message||"").trim(),
    region:neighborhood ? "" : aiExtractExplicitRegion(message),
    neighborhood,
    bedrooms:AiSearchRouting.aiExtractBedrooms(message),
    min_price:Number(money?.min)||0,
    max_price:Number(money?.max)||0
  };
}

function aiSwitchToSearchMode(message,options){
  const preserveSelectedProperty=Boolean(
    options && options.preserveSelectedProperty
  );
  const hint=
    aiExtractSearchHintFromMessage(
      message
    );

  /*
    Guardamos o imóvel atual ANTES de sair de PROPERTY.
    Ele será excluído da nova busca de alternativas.
  */
  const previousProperty=
    aiIsPropertyMode()
      ? {...aiAssistantProperty}
      : (
          aiLastPropertyBeforeHome
            ? {...aiLastPropertyBeforeHome}
            : null
        );

  /*
    Se o usuário disser apenas:
      "tem outra opção?"
      "me mostra outro"

    usamos o bairro do imóvel atual como contexto.

    Se ele disser:
      "mais opções no Brooklin"

    o bairro explícito da nova frase vence.
  */
  const targetNeighborhood=
    hint.region
      ? ""
      : (
          hint.neighborhood ||
          previousProperty?.neighborhood ||
          ""
        );

  if(typeof resetAiSearchState==="function"){
    resetAiSearchState();
  }

  if(typeof aiSearchState==="object" && aiSearchState){
    aiSearchState.region=
      hint.region||"";

    aiSearchState.neighborhood=
      targetNeighborhood;

    aiSearchState.bedrooms=
      hint.bedrooms||0;

    aiSearchState.minPrice=
      hint.min_price||0;

    aiSearchState.maxPrice=
      hint.max_price||0;

    aiSearchState.exactName="";
  }

  /*
    Override de uma única busca.

    query fica vazia de propósito:
      NÃO enviamos "tem outras opções no Brooklin"
      como termo textual para /api/search-properties.

    Em vez disso:
      neighborhood = Brooklin
      bedrooms/preço = somente se explicitados
      empreendimento atual = excluído no frontend
  */
  aiPendingSearchOverride={
    query:"",
    region:hint.region||"",
    neighborhood:targetNeighborhood,
    bedrooms:hint.bedrooms||0,
    min_price:hint.min_price||0,
    max_price:hint.max_price||0,

    exclude_id:
      previousProperty?.id||"",

    exclude_building_id:
      previousProperty?.building_id||"",

    exclude_name:
      previousProperty?.name||""
  };

  if(previousProperty){
    aiLastPropertyBeforeHome={
      ...previousProperty
    };
  }

  aiAssistantProperty={
    id:"__general_search__",
    name:"Busca geral",
    neighborhood:"",
    source:"todos",
    generic_search:true
  };

  /*
    Comparar com outro ainda não é comparação real.
    preserveSelectedProperty guarda o imóvel atual para uma comparação futura.
    O fluxo abaixo continua sendo o de alternativas.
  */
  if(preserveSelectedProperty && previousProperty){
    aiLastSelectedProperty={...previousProperty};
  }else if(!preserveSelectedProperty){
    aiLastSelectedProperty=null;
  }

  console.log(
    "MATCH_IA_SWITCH_TO_SEARCH",
    {
      message,
      previous_property:{
        id:previousProperty?.id||"",
        building_id:previousProperty?.building_id||"",
        name:previousProperty?.name||"",
        neighborhood:previousProperty?.neighborhood||""
      },
      search_override:{
        ...aiPendingSearchOverride
      }
    }
  );

  const aiInput=
    document
      .getElementById(
        "aiAssistantInput"
      );

  if(aiInput){
    aiInput.placeholder=
      targetNeighborhood
        ? `Buscando outras opções em ${targetNeighborhood}...`
        : "Digite bairro, preço, dormitórios ou empreendimento...";
  }
}


/* =========================================================
   MATCH IA · CONTEXTO RICO DE UNIDADE + SAÍDA DO LIMBO
========================================================= */

function aiCompactDevelopmentContext(data){
  if(!data || data?.success!==true){
    return null;
  }

  const typologies=
    Array.isArray(data?.typologies)
      ? data.typologies
      : [];

  const floorPlans=
    Array.isArray(data?.media?.floor_plans)
      ? data.media.floor_plans
      : [];

  const compactTypologies=
    typologies
      .slice(0,120)
      .map(item=>({
        id:item?.id ?? null,
        type:item?.type ?? item?.raw?.type ?? "",
        name:item?.name ?? item?.title ?? item?.raw?.name ?? "",
        area:Number(
          item?.area ??
          item?.private_area ??
          item?.raw?.private_area ??
          0
        ) || 0,
        bedrooms:Number(
          item?.bedrooms ??
          item?.raw?.bedrooms ??
          0
        ) || 0,
        bathrooms:Number(
          item?.bathrooms ??
          item?.raw?.bathrooms ??
          0
        ) || 0,
        suites:Number(
          item?.suites ??
          item?.raw?.suites ??
          0
        ) || 0,
        parking:Number(
          item?.parking ??
          item?.parking_spaces ??
          item?.raw?.parking ??
          0
        ) || 0,
        stock:Number(
          item?.stock ??
          item?.total_units ??
          item?.raw?.stock ??
          0
        ) || 0,
        price:Number(
          item?.price ??
          item?.discount_price ??
          item?.original_price ??
          item?.raw?.discount_price ??
          item?.raw?.original_price ??
          0
        ) || 0,
        reference:
          clean(
            item?.reference ??
            item?.raw?.reference ??
            ""
          ),
        floor_reference:
          clean(
            item?.floor_reference ??
            item?.raw?.floor_reference ??
            ""
          ),
        section_reference:
          clean(
            item?.section_reference ??
            item?.raw?.section_reference ??
            ""
          )
      }));

  const compactPlans=
    floorPlans
      .slice(0,80)
      .map((plan,index)=>({
        id:plan?.id ?? null,
        name:developmentFloorplanLabel(plan,index),
        area:developmentFloorplanArea(plan),
        description:clean(
          plan?.description ||
          plan?.raw?.description ||
          ""
        )
      }));

  return {
    development:
      data?.development && typeof data.development==="object"
        ? {
            id:data.development?.id ?? null,
            name:data.development?.name ?? "",
            total_units:Number(data.development?.total_units)||0,
            number_of_towers:Number(data.development?.number_of_towers)||0,
            number_of_floors:Number(data.development?.number_of_floors)||0,
            units_per_floor:Number(data.development?.units_per_floor)||0,
            stage:data.development?.stage ?? "",
            status:data.development?.status ?? ""
          }
        : null,
    summary:
      data?.summary && typeof data.summary==="object"
        ? data.summary
        : null,
    typologies:compactTypologies,
    floor_plans:compactPlans
  };
}

async function aiPropertyContextWithDevelopment(...args){
  await window.YntFeatureLoader.load('legacy-ai-actions');
  return aiPropertyContextWithDevelopment.apply(this,args);
}

function aiReplyIndicatesMissingInformation(reply){
  const t=
    norm(reply||"")
      .replace(/\s+/g," ")
      .trim();

  if(!t){
    return true;
  }

  return Boolean(
    /\b(nao vejo cadastrado|não vejo cadastrado|nao encontrei|não encontrei|nao consta|não consta|nao tenho essa informacao|não tenho essa informação|nao aparece cadastrado|não aparece cadastrado|nao esta cadastrado|não está cadastrado|nao foi informado|não foi informado|nao consigo confirmar|não consigo confirmar|nao ha informacao|não há informação|nao ha um pdf|não há um pdf|nao ha pdf|não há pdf|nao encontrei plantas|não encontrei plantas|nao encontrei um pdf|não encontrei um pdf)\b/.test(t)
  );
}

function aiReturnToHomeConversation(){
  /*
    Sai do contexto do imóvel sem deixar o cliente preso.
    Volta à home do app e reabre a IA em busca geral.
  */

  if(aiIsPropertyMode()){
    aiLastPropertyBeforeHome={
      ...aiAssistantProperty
    };
  }

  try{
    closeAiAssistant();
  }catch{}

  if(typeof goHome==="function"){
    goHome();
  }

  if(typeof resetAiSearchState==="function"){
    resetAiSearchState();
  }

  if(typeof aiResetConversationSearchMemory==="function"){
    aiResetConversationSearchMemory();
  }

  aiAssistantProperty={
    id:"__general_search__",
    name:"Busca geral",
    neighborhood:"",
    source:"todos",
    generic_search:true
  };

  aiLastSelectedProperty=null;
  aiAssistantHistory=[];

  const shell=
    ensureAiAssistantShell();

  const box=
    shell.querySelector(
      "#aiAssistantMessages"
    );

  const input=
    shell.querySelector(
      "#aiAssistantInput"
    );

  if(box){
    box.innerHTML="";
  }

  if(input){
    input.placeholder=
      "Pergunte sobre bairro, preço, dormitórios ou outro imóvel...";
  }

  shell.classList.add("open");
  document.body.style.overflow="hidden";

  const message=
    "Não encontrei essa informação no cadastro deste imóvel. Para não te deixar preso aqui, voltei para a busca geral. Pode fazer outra pergunta ou me pedir outro imóvel por bairro, preço, dormitórios ou empreendimento.";

  appendAiMessage(
    "assistant",
    message
  );

  aiAssistantHistory.push({
    role:"assistant",
    content:message
  });
}

function aiScheduleHomeReturnForMissingInfo(reply){
  if(
    !aiIsPropertyMode() ||
    !aiReplyIndicatesMissingInformation(reply)
  ){
    return false;
  }

  window.setTimeout(
    ()=>{
      aiReturnToHomeConversation();
    },
    850
  );

  return true;
}


async function sendAiAssistantMessage(...args){
  await window.YntFeatureLoader.load('legacy-ai-actions');
  return sendAiAssistantMessage.apply(this,args);
}
