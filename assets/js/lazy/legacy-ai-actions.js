async function aiSearchRegionFromSupabase(state){
  const regionKey=norm(state?.region||"");
  const regionNames=(REGION_MAP[regionKey]||[])
    .map(clean)
    .filter(Boolean);

  if(!regionNames.length){
    return {
      inventory_ready:true,
      inventory_count:0,
      recognized_filters:true,
      query:{
        text:"",
        exact_name:"",
        region:regionKey,
        neighborhood:"",
        bedrooms:Number(state?.bedrooms)||0,
        min_price:Number(state?.minPrice)||0,
        max_price:Number(state?.maxPrice)||0,
        source:"todos"
      },
      total:0,
      matches:[]
    };
  }

  const url=new URL(
    "https://wzaegidwtdjuhqchpdpd.supabase.co/rest/v1/properties"
  );

  url.searchParams.set("active","eq.true");
  url.searchParams.set(
    "select",
    "id,external_id,source,title,development_name,neighborhood,city,state,price,bedrooms,bathrooms,parking_spaces,area,image_url,property_url,active,updated_at,raw_data"
  );
  url.searchParams.set("city",`eq.${activeCity || "São Paulo"}`);
  url.searchParams.set("state",`eq.${activeState || "SP"}`);

  /*
    Região é traduzida para os bairros conhecidos do app.
    Não enviamos "Zona Oeste" como se fosse bairro.
  */
  const orParts=regionNames
    .map(name=>`neighborhood.ilike.*${name.replace(/[(),]/g," ")}*`)
    .join(",");

  if(orParts){
    url.searchParams.set("or",`(${orParts})`);
  }

  const bedrooms=Number(state?.bedrooms)||0;
  const minPrice=Number(state?.minPrice)||0;
  const maxPrice=Number(state?.maxPrice)||0;

  if(bedrooms){
    url.searchParams.set("bedrooms",`gte.${bedrooms}`);
  }

  if(minPrice && maxPrice){
    url.searchParams.set(
      "and",
      `(price.gte.${minPrice},price.lte.${maxPrice})`
    );
  }else if(minPrice){
    url.searchParams.set("price",`gte.${minPrice}`);
  }else if(maxPrice){
    url.searchParams.set("price",`lte.${maxPrice}`);
  }

  url.searchParams.set("order","price.asc.nullslast");
  url.searchParams.set("limit","100");

  const response=await fetch(url.toString(),{
    cache:"no-store",
    headers:{
      "apikey":SUPABASE_PUBLISHABLE_KEY,
      "Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Prefer":"count=exact"
    }
  });

  if(!response.ok){
    const errorText=await response.text().catch(()=>"");
    throw new Error(
      `Supabase IA região: ${response.status} ${errorText}`
    );
  }

  const rows=await response.json();
  const mapped=Array.isArray(rows)
    ? rows
        .map(mapOruloProperty)
        .filter(p=>p && p.id && p.value>0)
    : [];

  /*
    A consulta do PostgREST usa nomes da região. Revalidamos
    no frontend para impedir qualquer bairro indevido.
  */
  const filtered=mapped
    .filter(p=>propertyMatchesRegion(p,regionKey))
    .slice(0,12);

  const range=response.headers.get("content-range") || "";
  const totalMatch=range.match(/\/(\d+)$/);
  const total=totalMatch
    ? Number(totalMatch[1])||filtered.length
    : filtered.length;

  return {
    inventory_ready:true,
    inventory_count:total,
    recognized_filters:true,
    query:{
      text:"",
      exact_name:"",
      region:regionKey,
      neighborhood:"",
      bedrooms,
      min_price:minPrice,
      max_price:maxPrice,
      source:"todos"
    },
    total,
    matches:filtered.map(p=>({
      id:String(p.id||""),
      external_id:String(p.id||""),
      name:p.name||"Imóvel disponível",
      neighborhood:p.neighborhood||"",
      city:p.city||activeCity||"São Paulo",
      state:p.state||activeState||"SP",
      value:Number(p.value)||0,
      area:Number(p.area)||0,
      bedrooms:Number(p.bedrooms)||0,
      bathrooms:Number(p.bathrooms)||0,
      suites:Number(p.suites)||0,
      parking:Number(p.parking)||0,
      source:p.source||"usados",
      property_url:p.propertyUrl||"",
      image_url:Array.isArray(p.photos)&&p.photos.length ? p.photos[0] : "",
      raw_data:p.rawData||{}
    }))
  };
}

async function searchPropertiesForAi(message){
  const inventoryForParsing=
    Array.isArray(newPropertiesCache)
      ? newPropertiesCache
      : [];

  /*
    Escolha explícita feita nos botões de desambiguação.
    É consumida uma única vez e tem prioridade sobre o estado antigo.
  */
  const disambiguationChoice=
    aiPendingDisambiguationChoice &&
    typeof aiPendingDisambiguationChoice==="object"
      ? {...aiPendingDisambiguationChoice}
      : null;

  aiPendingDisambiguationChoice=null;

  /*
    Quando a mensagem veio de PROPERTY → SEARCH
    ("outras opções no Brooklin", por exemplo), usamos um
    payload estruturado de uma única execução.

    Isso evita enviar a frase inteira como query textual junto
    com o bairro e evita que o empreendimento atual volte.
  */
  const override=
    aiPendingSearchOverride &&
    typeof aiPendingSearchOverride==="object"
      ? {...aiPendingSearchOverride}
      : null;

  aiPendingSearchOverride=null;

  let state;

  if(disambiguationChoice){
    state={
      region:"",
      neighborhood:
        disambiguationChoice.type==="neighborhood"
          ? clean(disambiguationChoice.value)
          : "",
      exactName:
        disambiguationChoice.type==="project"
          ? clean(disambiguationChoice.value)
          : "",
      bedrooms:0,
      minPrice:0,
      maxPrice:0
    };

    if(typeof aiSearchState==="object" && aiSearchState){
      aiSearchState.region="";
      aiSearchState.neighborhood=state.neighborhood;
      aiSearchState.exactName=state.exactName;
      aiSearchState.bedrooms=0;
      aiSearchState.minPrice=0;
      aiSearchState.maxPrice=0;
    }

  }else if(override){
    state={
      region:override.region||"",
      neighborhood:override.neighborhood||"",
      exactName:"",
      bedrooms:Number(override.bedrooms)||0,
      minPrice:Number(override.min_price)||0,
      maxPrice:Number(override.max_price)||0
    };

    if(typeof aiSearchState==="object" && aiSearchState){
      aiSearchState.region=state.region;
      aiSearchState.neighborhood=state.neighborhood;
      aiSearchState.exactName="";
      aiSearchState.bedrooms=state.bedrooms;
      aiSearchState.minPrice=state.minPrice;
      aiSearchState.maxPrice=state.maxPrice;
    }
  }else{
    state=
      typeof aiUpdateSearchState==="function"
        ? aiUpdateSearchState(message,inventoryForParsing)
        : {
            region:"",
            neighborhood:"",
            exactName:"",
            bedrooms:0,
            minPrice:0,
            maxPrice:0
          };
  }

  /*
    Região explícita (ex.: "zona oeste") é uma busca estruturada.
    Isso limpa bairro/preço antigos e evita que o backend interprete
    "zona oeste" como texto/bairro anterior.
  */
  if(state.region){
    const regionContext=
      await aiSearchRegionFromSupabase(
        state
      );

    console.log(
      "MATCH_IA_REGION_SEARCH_RESPONSE",
      regionContext
    );

    aiStoreSearchContext(
      regionContext
    );

    return regionContext;
  }

  const neighborhoodScope=state.neighborhood
    ? AiSearchRouting.aiNeighborhoodScope(
        state.neighborhood,
        aiRoutingNeighborhoodCatalog(inventoryForParsing)
      )
    : null;

  const payload={
    /*
      Busca normal:
        query recebe a frase original.

      Busca de alternativas:
        query fica vazia e usamos bairro/preço/dormitórios
        como filtros estruturados.
    */
    query:disambiguationChoice
      ? (
          disambiguationChoice.type==="project"
            ? clean(disambiguationChoice.value)
            : ""
        )
      : override
      ? String(override.query||"").trim()
      : (aiLastRoutingTurn && aiLastRoutingTurn.keepQueryText===false)
      ? ""
      : String(message||"").trim(),

    neighborhood:(neighborhoodScope && neighborhoodScope.canonical_name) || state.neighborhood||"",
    project:state.exactName||"",
    bedrooms:Number(state.bedrooms)||0,
    min_price:Number(state.minPrice)||0,
    max_price:Number(state.maxPrice)||0,

    source:(
      state.inventorySource==="novos" ||
      state.inventorySource==="usados"
    )
      ? state.inventorySource
      : (
        aiSearchState?.inventorySource==="novos" ||
        aiSearchState?.inventorySource==="usados"
      )
        ? aiSearchState.inventorySource
        : "todos",
    limit:12,
    neighborhoodMode: neighborhoodScope ? neighborhoodScope.mode : "",
    neighborhoods: neighborhoodScope ? neighborhoodScope.names : [],
    city: neighborhoodScope ? neighborhoodScope.city : "",
    state: neighborhoodScope ? neighborhoodScope.state : ""
  };

  console.log(
    "MATCH_IA_SEARCH_API_REQUEST",
    {
      ...payload,
      exclude_id:override?.exclude_id||"",
      exclude_building_id:override?.exclude_building_id||"",
      exclude_name:override?.exclude_name||""
    }
  );

  const response=await fetch("/api/search-properties",{
    method:"POST",
    headers:{
      "Content-Type":"application/json"
    },
    body:JSON.stringify(payload)
  });

  const data=await response
    .json()
    .catch(()=>({}));

  if(!response.ok || data?.success!==true){
    throw new Error(
      aiApiErrorText(
        data?.error,
        "Não foi possível consultar o estoque agora."
      )
    );
  }

  const rawMatches=
    Array.isArray(data.matches)
      ? data.matches
      : [];

  const excludeId=
    String(override?.exclude_id||"");

  const excludeBuildingId=
    String(override?.exclude_building_id||"");

  const excludeName=
    norm(override?.exclude_name||"");

  const matches=
    rawMatches.filter(item=>{
      if(!item)return false;

      const itemId=String(item.id||"");
      const itemBuildingId=String(item.building_id||"");
      const itemName=norm(item.name||"");

      if(excludeId && itemId===excludeId){
        return false;
      }

      if(
        excludeBuildingId &&
        itemBuildingId &&
        itemBuildingId===excludeBuildingId
      ){
        return false;
      }

      /*
        Alguns registros/tipologias do mesmo empreendimento
        podem ter IDs diferentes. O nome impede que o próprio
        empreendimento volte como "outra opção".
      */
      if(
        excludeName &&
        itemName &&
        itemName===excludeName
      ){
        return false;
      }

      return true;
    });

  const removedCount=
    Math.max(
      0,
      rawMatches.length-matches.length
    );

  const backendTotal=
    Number(data.total)||0;

  const adjustedTotal=
    Math.max(
      0,
      backendTotal-removedCount
    );

  const inventoryContext={
    inventory_ready:true,
    inventory_count:Number(data.inventory_count)||0,

    recognized_filters:Boolean(
      payload.query ||
      state.region ||
      payload.neighborhood ||
      payload.project ||
      payload.bedrooms ||
      payload.min_price ||
      payload.max_price
    ),

    query:{
      text:payload.query,
      exact_name:payload.project,
      neighborhood:payload.neighborhood,
      bedrooms:payload.bedrooms,
      min_price:payload.min_price,
      max_price:payload.max_price,
      source:"novos"
    },

    total:adjustedTotal,
    matches:matches.slice(0,12)
  };

  console.log(
    "MATCH_IA_SEARCH_API_RESPONSE",
    inventoryContext
  );

  yntAdsTrack("ai_search", {
    intent:{
      neighborhood: payload.neighborhood || "",
      development: payload.project || "",
      bedrooms: Number(payload.bedrooms)||0,
      min_price: Number(payload.min_price)||0,
      max_price: Number(payload.max_price)||0,
      inventory_source: payload.source || "todos"
    }
  });

  aiStoreSearchContext(inventoryContext);

  return inventoryContext;
}

async function aiPropertyContextWithDevelopment(property){
  const base=
    aiPropertyContext(
      property
    );

  try{
    const developmentData=
      await loadDevelopmentData(
        property
      );

    const developmentContext=
      aiCompactDevelopmentContext(
        developmentData
      );

    if(developmentContext){
      base.development_context=
        developmentContext;
    }
  }catch(error){
    console.warn(
      "MATCH_IA_DEVELOPMENT_CONTEXT_ERROR",
      error
    );
  }

  return base;
}

async function sendAiAssistantMessage(text){
  text=clean(text);
  if(!text || aiAssistantSending || !aiAssistantProperty)return;

  aiAssistantSending=true;

  const shell=ensureAiAssistantShell();
  aiSyncInputPlaceholder();

  const send=shell.querySelector("#aiAssistantSend");

  if(send)send.disabled=true;

  appendAiMessage("user",text);

  aiAssistantHistory.push({
    role:"user",
    content:text
  });

  aiAssistantHistory=
    aiAssistantHistory.slice(-12);

  /*
    Se estamos dentro de um imóvel e o usuário pede alternativas,
    mudamos para SEARCH antes de processar a mensagem.
  */
  const wasPropertyMode=
    aiIsPropertyMode();

  await aiPrepareProjectNames(text);

  const routingTurn=
    aiClassifySearchTurn(
      text,
      aiCurrentRoutingContext(),
      aiRoutingNeighborhoodCatalog(),
      aiRoutingProjects()
    );

  aiLastRoutingTurn=routingTurn;
  if(routingTurn?.reason){
    aiLastSearchReason=routingTurn.reason;
  }

  /*
    Intenção comercial explícita vem antes de comparação,
    desambiguação, follow-up, estoque e OpenAI.
    Não abre lead e não consulta /api/search-properties.
  */
  const commercialTurn=
    aiResolveCommercialTurn(text);

  if(commercialTurn.handled){
    if(commercialTurn.intent){
      aiLastDetectedIntent=String(commercialTurn.intent);
    }
    const reply=
      aiSanitizeHandoffPromise(
        commercialTurn.reply
      );

    appendAiMessage("assistant", reply);

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    if(commercialTurn.showHandoff){
      aiSetHumanHandoffVisible(true);
    }

    aiAssistantSending=false;

    if(send){
      send.disabled=false;
    }

    return;
  }

  /*
    "comparar X com Y", "vs" e "versus" são comparação de termos,
    não desambiguação empreendimento/bairro e não comparação de imóveis.
    realComparison permanece false. Os dois lados ficam no turno.
  */
  if(routingTurn.kind==="comparison"){
    const left=routingTurn.compare_left?.name || "";
    const right=routingTurn.compare_right?.name || "";
    const reply=
      `Entendi que você quer comparar ${left} com ${right}. A comparação lado a lado ainda não está pronta.`;

    appendAiMessage("assistant", reply);

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    aiAssistantSending=false;

    if(send){
      send.disabled=false;
    }

    return;
  }

  /*
    "Outro imóvel", "mais opções", "me mostra outros" saem do detalhe
    e entram em SEARCH.

    "quero comparar com outro" usa esse mesmo fallback de alternativas.
    Não é comparação real: o imóvel atual permanece em
    aiLastPropertyBeforeHome e, com preserveSelectedProperty,
    também em aiLastSelectedProperty.
  */
  if(routingTurn.kind==="reset" && wasPropertyMode){
    aiSwitchToFreshSearchMode();

  }else if(
    routingTurn.kind==="alternatives" &&
    (
      wasPropertyMode ||
      aiLastPropertyBeforeHome
    )
  ){
    aiSwitchToSearchMode(text,{
      preserveSelectedProperty:
        routingTurn.preservePropertyForComparison===true
    });

  }else if(
    wasPropertyMode &&
    aiIsExplicitInventorySearch(text) &&
    routingTurn.preservePropertyForComparison!==true
  ){
    /*
      Ex.:
      "tem algum Maskan no estoque"
      "busca Well"
      "quero saber sobre Marka Perdizes"

      Nova busca a partir do imóvel, sem herdar o bairro dele.
    */
    aiSwitchToFreshSearchMode();
  }

  const detectedPhone=
    extractBrazilianPhone(text);

  if(detectedPhone){
    appendAiMessage(
      "assistant",
      "Perfeito. Vou abrir o atendimento para registrar seu WhatsApp corretamente. Seu número já vai preenchido — falta só confirmar seus dados."
    );

    aiAssistantSending=false;

    if(send)send.disabled=false;

    setTimeout(()=>{
      openAiLeadCaptureFromPhone(
        detectedPhone
      );
    },420);

    return;
  }

  /*
    Saudação isolada não é busca imobiliária.
    Evita "boa noite" virar "Alto da Boa Vista".
  */
  if(aiIsGreetingOnly(text)){
    const greeting=
      aiGreetingReply();

    appendAiMessage(
      "assistant",
      greeting
    );

    aiAssistantHistory.push({
      role:"assistant",
      content:greeting
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    aiAssistantSending=false;

    if(send)send.disabled=false;

    return;
  }

  /*
    "vocês tem" / "você tem" sem bairro, preço, dormitórios ou empreendimento
    não dispara busca vazia. A conversa fica aguardando um critério.
    Telefone e saudação continuam sendo resolvidos antes desta resposta.
  */
  if(routingTurn.kind==="vague"){
    const reply=
      "Me diga um bairro, uma faixa de preço, a quantidade de dormitórios ou o nome de um empreendimento para eu buscar.";

    appendAiMessage("assistant", reply);

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    aiAssistantSending=false;

    if(send){
      send.disabled=false;
    }

    return;
  }

  if(routingTurn.kind==="project_options"){
    appendAiProjectOptions(
      routingTurn.projectOptions
    );

    aiAssistantSending=false;

    if(send){
      send.disabled=false;
    }

    return;
  }


  /*
    DESAMBIGUAÇÃO DE INTENÇÃO
    Exemplo:
      "Quero saber sobre Well Perdizes"

    Pode significar:
      - empreendimento "Well"
      - bairro "Perdizes"

    Em vez de adivinhar, oferecemos as duas rotas.
  */
  if(
    Boolean(
      aiAssistantProperty
        ?.generic_search
    ) &&
    routingTurn.reason!=="known_project" &&
    !aiPendingDisambiguationChoice
  ){
    const ambiguity=
      aiDetectSearchAmbiguity(
        text
      );

    if(ambiguity){
      appendAiDisambiguationChoice(
        ambiguity
      );

      aiAssistantSending=false;

      if(send){
        send.disabled=false;
      }

      const input=
        shell.querySelector(
          "#aiAssistantInput"
        );

      if(input){
        input.placeholder=
          "Escolha uma das opções acima...";
      }

      return;
    }
  }

  /*
    Em contexto de imóvel, ações conhecidas são resolvidas
    pelo próprio app, sem chamar a IA genérica.
  */
  if(
    aiIsPropertyMode() &&
    aiIsFloorplanRequest(text)
  ){
    const property=
      aiAssistantProperty;

    const requestedArea=
      aiRequestedArea(text);

    /*
      Primeiro tenta o contexto rico do empreendimento.
      Não altera o fluxo atual; é uma camada adicional.
    */
    const developmentData=
      await loadDevelopmentData(
        property
      );

    const developmentPlans=
      findDevelopmentFloorplans(
        developmentData,
        requestedArea
      );

    let reply="";

    if(developmentPlans.length){
      if(requestedArea>0){
        reply=
          `Sim. Encontrei a planta de ${requestedArea.toLocaleString("pt-BR")} m² deste empreendimento.`;
      }else{
        const labels=
          developmentPlans
            .map(plan=>
              plan._area>0
                ? `${plan._area.toLocaleString("pt-BR")} m²`
                : plan._label
            )
            .filter(Boolean)
            .filter(
              (value,index,array)=>
                array.indexOf(value)===index
            );

        reply=
          labels.length
            ? `Encontrei ${developmentPlans.length} plantas cadastradas neste empreendimento: ${labels.join(", ")}. Escolha abaixo qual deseja abrir.`
            : `Encontrei ${developmentPlans.length} plantas cadastradas neste empreendimento. Escolha abaixo qual deseja abrir.`;
      }

      appendAiMessage(
        "assistant",
        reply
      );

      appendAiDevelopmentFloorplanButtons(
        property,
        developmentPlans
      );
    }else{
      /*
        Fallback antigo: mantém compatibilidade com usados
        e registros que ainda tenham planta só no raw_data.
      */
      const floorplanUrl=
        aiFindFloorplanForArea(
          property,
          requestedArea
        );

      if(floorplanUrl){
        reply=
          requestedArea>0
            ? `Encontrei uma planta cadastrada para ${requestedArea.toLocaleString("pt-BR")} m². Abra abaixo.`
            : "Encontrei uma planta cadastrada deste imóvel. Abra abaixo.";

        appendAiMessage(
          "assistant",
          reply
        );

        appendAiFloorplanButton(
          property,
          floorplanUrl,
          requestedArea>0
            ? `Ver planta ${requestedArea.toLocaleString("pt-BR")} m²`
            : "Ver planta"
        );
      }else{
        reply=
          requestedArea>0
            ? `Não encontrei uma planta de ${requestedArea.toLocaleString("pt-BR")} m² entre as plantas disponíveis deste empreendimento.`
            : "Não encontrei plantas disponíveis para este imóvel neste momento.";

        appendAiMessage(
          "assistant",
          reply
        );

        appendAiInternalDetailsButton(
          property
        );
      }
    }

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    const returningHome=
      aiScheduleHomeReturnForMissingInfo(
        reply
      );

    aiAssistantSending=false;

    if(send)send.disabled=false;

    if(returningHome){
      return;
    }

    return;
  }

  if(
    aiIsPropertyMode() &&
    aiIsPdfRequest(text)
  ){
    const property=
      aiAssistantProperty;

    const developmentData=
      await loadDevelopmentData(
        property
      );

    const pdfFiles=
      developmentPdfFiles(
        developmentData
      );

    const requestedArea=
      aiRequestedArea(text);

    const floorPlans=
      findDevelopmentFloorplans(
        developmentData,
        requestedArea
      );

    let reply="";

    if(pdfFiles.length){
      const first=
        pdfFiles[0];

      reply=
        pdfFiles.length===1
          ? `Encontrei o arquivo ${first._name}. Você pode abrir ou baixar abaixo.`
          : `Encontrei ${pdfFiles.length} arquivos disponíveis. Você pode abrir o primeiro abaixo.`;

      appendAiMessage(
        "assistant",
        reply
      );

      appendAiDownloadButton(
        `Baixar ${first._name}`,
        first._url
      );
    }else if(floorPlans.length){
      const plan=
        floorPlans[0];

      reply=
        "Não há um PDF cadastrado para esta planta no momento. Tenho a imagem oficial da planta e posso abrir ou baixar essa imagem.";

      appendAiMessage(
        "assistant",
        reply
      );

      appendAiDevelopmentFloorplanButtons(
        property,
        floorPlans
      );

      appendAiImageDownloadButton(
        plan._area>0
          ? `Baixar imagem ${plan._area.toLocaleString("pt-BR")} m²`
          : "Baixar imagem da planta",
        plan._url
      );
    }else{
      reply=
        "Não encontrei um PDF ou arquivo para download cadastrado para este imóvel neste momento.";

      appendAiMessage(
        "assistant",
        reply
      );
    }

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    const returningHome=
      aiScheduleHomeReturnForMissingInfo(
        reply
      );

    aiAssistantSending=false;

    if(send)send.disabled=false;

    if(returningHome){
      return;
    }

    return;
  }

  if(
    aiIsPropertyMode() &&
    aiIsInternalDetailsRequest(text)
  ){
    const property=
      aiAssistantProperty;

    const reply=
      `Claro. Abra os detalhes completos do ${property.name || "imóvel"} dentro da Ynteligencia.`;

    appendAiMessage(
      "assistant",
      reply
    );

    appendAiInternalDetailsButton(
      property
    );

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    aiAssistantSending=false;

    if(send)send.disabled=false;

    return;
  }

  /*
    Em contexto de imóvel, "tem mapa?", "como chegar?" etc.
    usa os dados já cadastrados e oferece Google Maps,
    sem expor coordenadas ou URL externa da Órulo.
  */
  if(
    aiIsPropertyMode() &&
    aiIsMapRequest(text)
  ){
    const property=
      aiAssistantProperty;

    const name=
      property.name ||
      "este imóvel";

    const reply=
      property.address
        ? `Claro. Posso abrir a localização do ${name} diretamente no Google Maps.`
        : `Claro. Posso abrir a localização disponível do ${name} diretamente no Google Maps.`;

    appendAiMessage(
      "assistant",
      reply
    );

    appendAiGoogleMapsButton(
      property
    );

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    aiAssistantSending=false;

    if(send)send.disabled=false;

    return;
  }

  const thinking=
    document.createElement("div");

  thinking.className=
    "ai-msg assistant";

  thinking.id=
    "aiThinking";

  thinking.textContent=
    "Só um instante...";

  shell
    .querySelector(
      "#aiAssistantMessages"
    )
    ?.appendChild(
      thinking
    );

  try{
    const genericMode=
      Boolean(
        aiAssistantProperty
          ?.generic_search
      );

    /*
      =======================================================
      FOLLOW-UP SOBRE ÚLTIMO RESULTADO
      =======================================================
    */
    if(
      genericMode &&
      aiIsFollowUpMessage(text) &&
      !aiMessageClearlyStartsNewSearch(text)
    ){
      const referenced=
        aiPickReferencedMatch(text);

      if(referenced){
        aiLastSelectedProperty=
          referenced;

        const direct=
          aiDirectFollowUpAnswer(
            text,
            referenced
          );

        if(direct){
          thinking.remove();

          appendAiMessage(
            "assistant",
            direct
          );

          /*
            Pedido de link/detalhes abre o detalhe INTERNO do app.
            Nunca expomos URL bruta do provedor.
          */
          if(
            typeof aiIsInternalDetailsRequest==="function" &&
            aiIsInternalDetailsRequest(text)
          ){
            appendAiInternalDetailsButton(
              referenced
            );
          }

          aiAssistantHistory.push({
            role:"assistant",
            content:direct
          });

          aiAssistantHistory=
            aiAssistantHistory.slice(-12);

          aiAssistantSending=false;

          if(send){
            send.disabled=false;
          }

          return;
        }

        /*
          Perguntas mais abertas:
          usa o próprio imóvel como contexto na /api/assistant.
          NÃO faz nova pesquisa.
        */
        thinking.textContent=
          "Consultando os dados desse imóvel...";

        const response=
          await fetch(
            "/api/assistant",
            {
              method:"POST",
              headers:{
                "Content-Type":
                  "application/json"
              },
              body:JSON.stringify({
                message:text,
                history:
                  aiAssistantHistory
                    .slice(0,-1),
                property:
                  {
                    ...aiFormatPropertyForAssistant(
                      referenced
                    ),
                    ...await aiPropertyContextWithDevelopment(
                      referenced
                    )
                  },
                mode:"property",
                page_url:
                  window.location.href
              })
            }
          );

        const data=
          await response
            .json()
            .catch(()=>({}));

        thinking.remove();

        if(
          !response.ok ||
          data.success !== true
        ){
          throw new Error(
            aiApiErrorText(
              data.error,
              "Não foi possível consultar este imóvel agora."
            )
          );
        }

        let reply=
          stripExternalProviderLinks(
            clean(data.reply||"") ||
            "Posso continuar te ajudando com esse imóvel."
          );

        reply=
          aiSanitizeHandoffPromise(
            reply
          );

        appendAiMessage(
          "assistant",
          reply
        );

        appendAiInternalDetailsButton(
          referenced
        );

        aiAssistantHistory.push({
          role:"assistant",
          content:reply
        });

        aiAssistantHistory=
          aiAssistantHistory.slice(-12);

        if(data.handoff===true){
          aiSetHumanHandoffVisible(true);
        }

        return;
      }
    }

    /*
      =======================================================
      NOVA PESQUISA
      =======================================================
    */
    let inventoryContext=null;

    if(genericMode){
      thinking.textContent=
        "Consultando imóveis...";

      inventoryContext=
        await searchPropertiesForAi(
          text
        );
    }

    const response=
      await fetch(
        "/api/assistant",
        {
          method:"POST",
          headers:{
            "Content-Type":
              "application/json"
          },
          body:JSON.stringify({
            message:text,

            history:
              aiAssistantHistory
                .slice(0,-1),

            property:
              genericMode
                ? {}
                : await aiPropertyContextWithDevelopment(
                    aiAssistantProperty
                  ),

            mode:
              genericMode
                ? "search"
                : "property",

            inventory:
              genericMode
                ? inventoryContext
                : null,

            page_url:
              window.location.href
          })
        }
      );

    const data=
      await response
        .json()
        .catch(()=>({}));

    thinking.remove();

    if(
      !response.ok ||
      data.success !== true
    ){
      throw new Error(
        aiApiErrorText(
          data.error,
          "Não foi possível falar com a assistente agora."
        )
      );
    }

    let reply=
      clean(data.reply||"") ||
      (
        genericMode
          ? "Posso continuar refinando sua busca. Qual bairro ou faixa de preço você prefere?"
          : "Posso continuar te ajudando com este imóvel."
      );

    /*
      URL da Órulo é infraestrutura, não interface do cliente.
    */
    reply=
      stripExternalProviderLinks(
        reply
      );

    reply=
      aiSanitizeHandoffPromise(
        reply
      );

    if(genericMode){
      reply=
        reply
          .replace(
            /^\s*INVENT[ÁA]RIO CONSULTADO\s*[—\-:]*\s*/i,
            ""
          )
          .replace(
            /\baceite\s+\d+\s*[–-]\s*\d+\s+dormit[oó]rios\??/gi,
            ""
          )
          .replace(
            /\s{2,}/g,
            " "
          )
          .trim();

      const ctx=
        inventoryContext || {
          recognized_filters:false,
          total:0,
          query:{},
          matches:[]
        };

      /*
        Quando encontramos exatamente 1 imóvel,
        guardamos automaticamente como referência
        para "esse", "o link", "qual o preço?" etc.
      */
      if(
        Array.isArray(ctx.matches) &&
        ctx.matches.length === 1
      ){
        const foundProperty = ctx.matches[0];

        aiLastSelectedProperty = foundProperty;

        /*
          TRANSIÇÃO AUTOMÁTICA:
          a partir daqui a conversa deixa de ser "busca geral"
          e passa a usar o MESMO contexto de imóvel do fluxo Ver detalhes.
        */
        const registeredFoundProperty =
          registerAiFoundProperty(foundProperty);

        aiLastPropertyBeforeHome=null;

        aiAssistantProperty = {
          ...registeredFoundProperty,

          /*
            Compatibilidade com o objeto já usado pelo app.
          */
          id: registeredFoundProperty.id || registeredFoundProperty.building_id || "",
          name: registeredFoundProperty.name || "",
          neighborhood: registeredFoundProperty.neighborhood || "",
          city: registeredFoundProperty.city || "",
          value: Number(registeredFoundProperty.value) || 0,
          area: Number(registeredFoundProperty.area) || 0,
          bedrooms: Number(registeredFoundProperty.bedrooms) || 0,
          bathrooms: Number(registeredFoundProperty.bathrooms) || 0,
          suites: Number(registeredFoundProperty.suites) || 0,
          parking: Number(registeredFoundProperty.parking) || 0,
          stock: Number(registeredFoundProperty.stock) || 0,
          source: registeredFoundProperty.source || "novos",
          status: registeredFoundProperty.status || "",
          developer: registeredFoundProperty.developer || "",
          property_url: registeredFoundProperty.property_url || "",
          image_url: registeredFoundProperty.image_url || "",
          address: registeredFoundProperty.address || null,

          /*
            Crucial: mensagens seguintes passam a ir em mode=property.
          */
          generic_search: false
        };

        console.log(
          "MATCH_IA_SWITCH_TO_PROPERTY",
          aiAssistantProperty
        );

        const aiInput =
          document
            .getElementById("aiAssistantInput");

        if(aiInput){
          aiInput.placeholder =
            `Pergunte sobre ${aiAssistantProperty.name || "este imóvel"}...`;
        }
      }

      if(
        ctx.recognized_filters &&
        ctx.total === 0
      ){
        const q=
          ctx.query || {};

        const parts=[];

        if(q.exact_name){
          parts.push(
            `o empreendimento ${q.exact_name}`
          );
        }else if(q.region){
          parts.push(
            `Zona ${String(q.region).charAt(0).toUpperCase()+String(q.region).slice(1)}`
          );
        }else if(q.neighborhood){
          parts.push(
            q.neighborhood
          );
        }

        if(q.max_price){
          parts.push(
            `até ${money(q.max_price)}`
          );
        }

        if(q.min_price){
          parts.push(
            `a partir de ${money(q.min_price)}`
          );
        }

        if(q.bedrooms){
          parts.push(
            `${q.bedrooms} dormitório${q.bedrooms>1?"s":""}`
          );
        }

        const criteria=
          parts
            .filter(Boolean)
            .join(", ");

        reply=
          `Não encontrei uma correspondência exata${criteria?` para ${criteria}`:""} na base consultada. Posso ampliar a busca por preço, bairro ou características se você quiser.`;
      }
    }

    const shouldReturnHome=
      !genericMode &&
      aiReplyIndicatesMissingInformation(
        reply
      );

    if(shouldReturnHome){
      reply=
        "Não encontrei essa informação no cadastro deste imóvel. Vou voltar para a busca geral para você continuar com outras perguntas.";
    }

    appendAiMessage(
      "assistant",
      reply
    );

    if(shouldReturnHome){
      aiAssistantHistory.push({
        role:"assistant",
        content:reply
      });

      aiAssistantHistory=
        aiAssistantHistory.slice(-12);

      window.setTimeout(
        ()=>{
          aiReturnToHomeConversation();
        },
        850
      );

      return;
    }

    let showedAiCards=false;

    if(
      genericMode &&
      inventoryContext &&
      Array.isArray(inventoryContext.matches) &&
      inventoryContext.matches.length
    ){
      const selection=aiSelectableSearchCards(
        data.properties,
        inventoryContext.matches
      );

      for(const skipped of selection.skipped){
        console.warn(
          "MATCH_IA_PROPERTY_NOT_FOUND",
          skipped
        );
      }

      if(selection.cards.length){
        appendAiPropertyCards(selection.cards);
        showedAiCards=true;
      }
    }

    if(
      !showedAiCards &&
      genericMode &&
      inventoryContext &&
      Array.isArray(inventoryContext.matches) &&
      inventoryContext.matches.length === 1 &&
      aiAssistantProperty &&
      aiAssistantProperty.generic_search === false
    ){
      appendAiInternalDetailsButton(aiAssistantProperty);
    }

    aiAssistantHistory.push({
      role:"assistant",
      content:reply
    });

    aiAssistantHistory=
      aiAssistantHistory.slice(-12);

    if(data.handoff===true){
      aiSetHumanHandoffVisible(true);
    }

    try{
      gtag(
        "event",
        "ai_assistant_message",
        {
          property_id:
            String(
              aiAssistantProperty.id ||
              ""
            )
        }
      );
    }catch(error){}

    supabaseTrack(
      "ai_assistant_message",
      {
        property_id:
          String(
            aiAssistantProperty.id ||
            ""
          ),

        message_length:
          text.length,

        handoff:
          Boolean(
            data.handoff
          )
      }
    );

  }catch(error){
    thinking.remove();

    appendAiMessage(
      "assistant",
      "Não consegui consultar os imóveis agora. Tente novamente em alguns instantes."
    );

    console.error(
      "MATCH_IA_ERROR",
      error
    );

  }finally{
    aiAssistantSending=false;

    if(send){
      send.disabled=false;
    }
  }
}
window.YntFeatureLoader.markLoaded("legacy-ai-actions");
