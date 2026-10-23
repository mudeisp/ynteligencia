
;
// SOURCE: assets/js/app.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; ordered compatibility boot; state/listeners remain interleaved intentionally.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

// Original main L6667
scheduleYnteligenciaSessionStart();

// Original main L6675
const YNT_ONESIGNAL_APP_ID=
  clean(
    document
      .querySelector(
        'meta[name="onesignal-app-id"]'
      )
      ?.content ||
    ""
  );

// Original main L6685
let YNT_ONESIGNAL_READY=false;

// Original main L6686
let YNT_ONESIGNAL_INSTANCE=null;

// Original main L7928
document
  .getElementById(
    "catalogPushBtn"
  )
  ?.addEventListener(
    "click",
    activateYnteligenciaPush
  );

// Original main L7937
initializeYnteligenciaPush();

// Original main L8029
let photoManifest={};

// Original main L8030
let photoManifestLoaded=false;

// Original main L8031
let photoManifestPromise=null;

// Original main L9019
document
  .querySelectorAll(
    ".option"
  )
  .forEach(
    btn=>
      btn.addEventListener(
        "click",
        ()=>{

          const key=
            btn.dataset.key;

          const value=
            btn.dataset.value;


          if(
            btn.classList.contains(
              "multi"
            )
          ){

            // Tipo do imóvel continua armazenado como array para manter
            // compatibilidade com o motor do MATCH, mas nesta etapa a
            // escolha é única e avança automaticamente.
            if(key==="types"){
              profile.types=[value];

              document
                .querySelectorAll('.option[data-key="types"]')
                .forEach(x=>x.classList.remove("selected"));

              btn.classList.add("selected");
              updateNext();
              window.setTimeout(()=>setStep(step+1),140);
              return;
            }

            const arr=
              profile[key];

            const i=
              arr.indexOf(value);


            if(i>=0){

              arr.splice(i,1);

            }else{

              arr.push(value);
            }


            btn.classList.toggle(
              "selected",
              arr.includes(value)
            );

          }else{

            if(key==="budget") {
              const budgetMin=Number(btn.dataset.budgetMin||0)||0;
              const budgetMax=Number(btn.dataset.budgetMax||0)||0;
              profile.budgetMin=budgetMin;
              profile.budgetMax=budgetMax;
              profile.budgetLabel=btn.dataset.budgetLabel||btn.textContent.trim();
              // Mantém profile.budget para compatibilidade com integrações existentes.
              profile.budget=budgetMax||budgetMin;
            }else{
              profile[key]=value;
            }


            document
              .querySelectorAll(
                `.option[data-key="${key}"]:not(.multi)`
              )
              .forEach(
                x=>
                  x.classList.remove(
                    "selected"
                  )
              );


            btn
              .classList
              .add(
                "selected"
              );

            // Perguntas de escolha única avançam automaticamente.
            if(["region","budget"].includes(key)){
              updateNext();
              window.setTimeout(()=>setStep(step+1),140);
              return;
            }

            // Dormitórios é a última pergunta obrigatória: dispara o motor do MATCH.
            if(key==="bedrooms"){
              updateNext();
              window.setTimeout(()=>{
                trackProfileCompleted();
                showMatchProcessing();
              },140);
              return;
            }
          }


          updateNext();
        }
      )
  );

// Original main L9212
$("skipStep")?.addEventListener("click",()=>{
  showToast("Cada resposta ajuda a encontrar seu imóvel.");
});

// Original main L9237
window.addEventListener("popstate",event=>{
  // Se existe detalhe aberto, Voltar fecha o detalhe e mantém o catálogo.
  if(document.getElementById("allGalleryShell")){
    document.getElementById("allGalleryShell")?.remove();
    return;
  }

  if(document.getElementById("photoModal")){
    closePropertyDetail({fromPopState:true});
    const savedScroll=Number(sessionStorage.getItem("ynt_catalog_scroll")||0);
    requestAnimationFrame(()=>window.scrollTo(0,savedScroll));
    return;
  }

  if(event.state?.ynteligenciaMatch){
    document.body.classList.add("match-mode");
    setStep(Number(event.state.step)||0,true);
  }else{
    leaveMatchMode();
    // Não derruba o catálogo para home quando a navegação atual é Explore/Ads.
    if(document.body.classList.contains("campaign-catalog-mode") ||
       $("catalog")?.classList.contains("visible")){
      document.body.classList.remove("home-mode");
    }else{
      document.body.classList.add("home-mode");
    }
  }
});

// Original main L9267
$("next")?.addEventListener(
    "click",
    ()=>{

      if(
        !currentValid()
      )return;


      if(step<3){

        setStep(
          step+1
        );

      }else{

        trackProfileCompleted();

        showMatchProcessing();
      }
    }
  );

// Original main L9292
$("back")?.addEventListener(
    "click",
    ()=>{

      if(step>0){
        setStep(step-1);
        history.replaceState({ynteligenciaMatch:true,step},"");
      }else{
        leaveMatchMode();
        document.body.classList.add("home-mode");
        document.getElementById("inicio")?.scrollIntoView({behavior:"smooth"});
      }
    }
  );

// Original main L9330
$("clearMatch")?.addEventListener("click",()=>{
  resetMatchProfile();
  showToast("Busca limpa. Comece novamente pelo tipo de imóvel.");
});

// Original main L9335
$("wizardMatchMode")?.addEventListener("click",()=>{
  document.getElementById("wizardMatchMode")?.classList.add("active");
  document.getElementById("wizardExploreMode")?.classList.remove("active");
  enterMatchMode();
});

// Original main L9341
$("wizardExploreMode")?.addEventListener("click",()=>{
  document.getElementById("wizardExploreMode")?.classList.add("active");
  document.getElementById("wizardMatchMode")?.classList.remove("active");
  openGeneralCatalog(true);
});

// Original main L9347
$("startHero")?.addEventListener(
    "click",
    ()=>{

      gtag(
        'event',
        'profile_started',
        {
          source:'hero'
        }
      );


      supabaseTrack(
        "profile_started",
        {
          source:"hero"
        }
      );

      enterMatchMode();
    }
  );

// Original main L9372
$("navMatch")?.addEventListener(
  "click",
  ()=>enterMatchMode()
);

// Original main L9378
$("exploreHero")?.addEventListener(
    "click",
    ()=>openGeneralCatalog(true)
  );

// Original main L9384
$("navExplore")?.addEventListener(
    "click",
    ()=>openGeneralCatalog(true)
  );

// Original main L9416
$("openFilters")?.addEventListener("click",()=>setFiltersOpen(true));

// Original main L9417
$("closeFilters")?.addEventListener("click",()=>setFiltersOpen(false));

// Original main L9418
$("filtersBackdrop")?.addEventListener("click",()=>setFiltersOpen(false));

// Original main L9419
$("showCatalog")?.addEventListener("click",()=>setFiltersOpen(false));

// Original main L9422
$("newSearch")
  .addEventListener(
    "click",
    ()=>{
      resetMatchProfile();
      enterMatchMode();
    }
  );

// Original main L10386
document.addEventListener("click",event=>{
  const button=event.target.closest?.("button[data-property-action]");
  if(!button)return;
  const id=button.dataset.propertyId;
  const property=propertyForInteraction(id);
  if(!property)return;
  if(button.dataset.propertyAction==="details"){
    aiRememberOpenedProperty(property);
    showPhotoModal(id);
  }
  else if(button.dataset.propertyAction==="interest")interest(id,property.name);
});

// Original main L15590
const YNT_PAID_UTM_MEDIA=new Set(["cpc","ppc","paid","paid_search","paid_social","paid_display","paid_video","cpm","cpv","cpa","cpl","sem","display","retargeting","remarketing"]);

// Original main L15617
syncPaidClickContextUi();

// Original main L16141
const fullNewPropertyCache=new Map();

// Original main L16231
const hydrateNewProperty=hydratePropertyDetails;

// Original main L16234
const developmentDataCache=new Map();

// Original main L17698
const catalogNeighborhoodIndexCache=new Map();

// Original main L17699
let catalogNeighborhoodIndexRequest=0;

// Original main L17807
let catalogRegion="";

// Original main L17916
document.querySelectorAll(".catalog-region-btn").forEach(btn=>{
  btn.addEventListener("click",()=>setCatalogRegion(btn.dataset.region || ""));
});

// Original main L17924
$("catalogRegionSelect")?.addEventListener("change",event=>{
  const region=
    String(
      event.target?.value || ""
    );

  setCatalogRegion(region);

  if(typeof updateCatalogUrl==="function"){
    updateCatalogUrl();
  }

  if(typeof maybeAutoExecuteCatalogSearch==="function"){
    maybeAutoExecuteCatalogSearch();
  }
});

// Original main L18317
$("showCatalog")
  .addEventListener(
    "click",
    ()=>{

      clearAdEntryIntent();

      $("catalog")
        .classList
        .add(
          "visible"
        );


      renderCatalog();
      updateCatalogUrl();


      $("catalog")
        .scrollIntoView({
          behavior:"smooth"
        });
    }
  );

// Original main L18350
const CATALOG_QUERY_KEYS=[
  "modo",
  "cidade",
  "city",
  "estado",
  "state",
  "regiao",
  "bairro",
  "busca",
  "tipo",
  "source",
  "ordem",
  "valor_min",
  "valor_max",
  "dormitorios",
  "area_min",
  "vagas",
  "condominio_max",
  "iptu_max"
];

// Original main L18827
$("catalogCity")?.addEventListener(
  "change",
  applyCatalogLocation
);

// Original main L18832
$("catalogState")?.addEventListener(
  "change",
  applyCatalogLocation
);

// Original main L19002
$("catalogSearchBtn")?.addEventListener("click",async event=>{
  event.preventDefault();
  event.stopPropagation();

  catalogAutoSearchStarted=true;

  if(catalogAutoSearchTimer){
    clearTimeout(catalogAutoSearchTimer);
    catalogAutoSearchTimer=null;
  }

  const button=
    $("catalogSearchBtn");

  const originalText=
    button?.textContent || "BUSCAR IMÓVEIS";

  if(button){
    button.disabled=true;
    button.textContent="BUSCANDO...";
  }

  try{
    await executeCatalogSearch();
  }catch(error){
    console.error(
      "CATALOG_SEARCH_CLICK_ERROR",
      error
    );

    if(typeof showToast==="function"){
      showToast(
        "Não foi possível buscar os imóveis agora."
      );
    }
  }finally{
    if(button){
      button.disabled=false;
      button.textContent=originalText;
    }
  }
});

// Original main L19045
$("catalogLoadMore")?.addEventListener("click",async()=>{
  const button=$("catalogLoadMore");
  if(button){button.disabled=true;button.textContent="CARREGANDO...";}
  try{
    const beforeCount=
      Array.isArray(newPropertiesCache)
        ? newPropertiesCache.length
        : 0;

    await fetchNewCatalogPage({reset:false});
    renderCatalog();

    const appended=
      Array.isArray(newPropertiesCache)
        ? newPropertiesCache.slice(
            beforeCount,
            beforeCount+CATALOG_PAGE_SIZE
          )
        : [];

    supabaseTrack(
      "catalog_load_more",
      {
        offset_before:
          beforeCount,

        delivered_count:
          appended.length,

        total_results:
          Number(newCatalogTotal)||0,

        delivered:
          appended.map(
            (item,index)=>({
              position:
                beforeCount+index+1,

              property_id:
                String(item.id||""),

              property_name:
                item.name||"",

              neighborhood:
                item.neighborhood||"",

              value:
                Number(item.value)||0,

              source:
                item.source||""
            })
          )
      }
    );

  }catch(error){
    console.error("Erro ao carregar mais imóveis:",error);
    showToast("Não foi possível carregar mais imóveis agora.");
  }finally{
    if(button)button.disabled=false;
    renderCatalog();
  }
});

// Original main L19111
$("catalogSearch").addEventListener("keydown", event=>{
  if(event.key === "Enter"){
    event.preventDefault();
    executeCatalogSearch();
  }
});

// Original main L19138
let catalogAutoSearchTimer=null;

// Original main L19139
let catalogAutoSearchStarted=false;

// Original main L19294
$("catalogSource")?.addEventListener("change",()=>{
  /*
    PERFORMANCE:
    troca de estoque atualiza o select imediatamente com o lote
    disponível. O índice completo fica lazy e só é buscado quando
    o usuário realmente abrir/usar Bairro ou selecionar uma Região.
  */
  Promise.resolve(
    fillCatalogNeighborhoodsForRegion(
      catalogRegion,
      {full:false}
    )
  ).catch(error=>{
    console.warn("Falha ao atualizar bairros:",error);
  });
});

// Original main L19317
let catalogNeighborhoodLazyLoading=false;

// Original main L19337
$("catalogNeighborhood")?.addEventListener(
  "focus",
  ()=>ensureFullNeighborhoodIndex().catch(()=>{})
);

// Original main L19342
$("catalogNeighborhood")?.addEventListener(
  "pointerdown",
  ()=>ensureFullNeighborhoodIndex().catch(()=>{}),
  {passive:true}
);

// Original main L19348
[
  "catalogNeighborhood",
  "catalogSource",
  "catalogType",
  "catalogBedrooms",
  "catalogParking"
]
.forEach(id=>{
  $(id)?.addEventListener("change",()=>{
    updateCatalogUrl();
    maybeAutoExecuteCatalogSearch();
  });
});

// Original main L19367
$("catalogSort")?.addEventListener("change",()=>{
  updateCatalogUrl();

  if($("catalog")?.classList.contains("visible")){
    renderCatalog();
  }
});

// Original main L19380
[
  "catalogSearch",
  "minPrice",
  "maxPrice",
  "minArea",
  "maxCondo",
  "maxIptu"
]
.forEach(id=>{
  $(id)?.addEventListener("input",()=>{
    updateCatalogUrl();
    maybeAutoExecuteCatalogSearch({
      debounce:true
    });
  });
});

// Original main L19434
const AD_INTENT_QUERY_KEYS=[
  "bairro","neighborhood","region","dormitorios","bedrooms","project","projeto",
  "valor_min","min_price","valor_max","max_price"
];

// Original main L19486
document.querySelector(".brand-lockup")?.addEventListener("click",event=>{
  event.preventDefault();
  goHome();
});

// Original main L19520
$("resetCatalogFilters")?.addEventListener("click",()=>{
  resetCatalogState(false);
  catalogAutoSearchStarted=false;

  if(catalogAutoSearchTimer){
    clearTimeout(catalogAutoSearchTimer);
    catalogAutoSearchTimer=null;
  }

  $("catalog")?.classList.remove("visible");
  updateCatalogUrl();
});

// Original main L19643
$("specialistFloat")?.addEventListener(
  "click",
  ()=>{

    console.log(
      "YNT_WHATSAPP_CTA_CLICK",
      {
        page:window.location.pathname,
        search:window.location.search,
        campaign_mode:document.body.classList.contains("campaign-catalog-mode")
      }
    );

    try{
      gtag(
        "event",
        "specialist_cta_click",
        {
          page_path:window.location.pathname,
          page_search:window.location.search,
          active_city:activeCity || "",
          active_state:activeState || ""
        }
      );
    }catch(error){
      console.warn("specialist_cta_click não registrado:",error);
    }

    const openDetail=document.getElementById("photoModal");
    if(openDetail){
      const detailId=openDetail.dataset?.propertyId;
      const detailProperty=detailId ? propertyForInteraction(detailId) : null;
      if(detailProperty){openPropertySpecialist(detailProperty);return;}
    }

    openLeadCapture({
      id:"specialist-general",
      name:"Atendimento personalizado Ynteligencia",
      neighborhood:$("catalogNeighborhood")?.value || adIntent?.neighborhood || "",
      value:0,
      source:"especialista_catalogo"
    });
  }
);

// Original main L20590
let paidExperience=null;

// Original main L20592
let yntDeferredSearch=null;

// Original main L20784
$("paidPushAccept")?.addEventListener("click", ()=>acceptPaidPush());

// Original main L20785
$("paidPushDismiss")?.addEventListener("click", dismissPaidPush);

// Original main L20786
$("paidPushClose")?.addEventListener("click", dismissPaidPush);

// Original main L20787
$("paidPushSheet")?.addEventListener("click", event=>{
  if(event.target===$("paidPushSheet")) dismissPaidPush();
});

// Original main L20791
const paidDetailObserver=new MutationObserver(()=>{
  if(paidExperience) renderPaidPush();
});

// Original main L20794
paidDetailObserver.observe(document.body,{childList:true});

// Original main L20900
document.querySelectorAll(".ad-budget-option").forEach(button=>{
  button.addEventListener("click",()=>{
    const min=Number(button.dataset.budgetMin||0)||0;
    const max=Number(button.dataset.budgetMax||0)||0;
    adIntent.minPrice=min;
    adIntent.maxPrice=max;
    syncPaidClickContextUi();
    updateAdIntentPriceInUrl();
    updateAdMatchUI();
    closeAdBudgetQuestion();

    try{
      gtag("event","ad_budget_selected",{
        region:adIntent.neighborhood||"",
        bedrooms:adIntent.bedrooms||0,
        min_price:min,
        max_price:max
      });
    }catch(e){}

    supabaseTrack("ad_budget_selected",{
      entry_mode:"ad_direct",
      neighborhood:adIntent.neighborhood||"",
      bedrooms:adIntent.bedrooms||0,
      min_price:min,
      max_price:max,
      pathname:window.location.pathname,
      search:window.location.search
    });

    showMatches();
  });
});

// Original main L20941
$("refineMatchFab")?.addEventListener("click",()=>{updateAdMatchUI();setRefineMatchOpen(true);});

// Original main L20942
$("refineMatchClose")?.addEventListener("click",()=>setRefineMatchOpen(false));

// Original main L20943
$("refineMatchShell")?.addEventListener("click",e=>{if(e.target===$("refineMatchShell"))setRefineMatchOpen(false);});

// Original main L20944
$("applyRefineMatch")?.addEventListener("click",()=>{
  const neighborhood=formatNeighborhoodName($("refineNeighborhood")?.value||"");
  const bedrooms=Number($("refineBedrooms")?.value||0) || 0;
  const budgetRange=$("refineBudgetRange")?.value||"";
  const [rangeMin,rangeMax]=budgetRange ? budgetRange.split("|") : ["0","0"];
  const min=Number(rangeMin||0)||0;
  const max=Number(rangeMax||0)||0;

  const regionKey=currentRefineRegionKey();
  if(neighborhood && regionKey){
    const validInRegion=properties.some(p=>
      norm(p.neighborhood)===norm(neighborhood) && propertyMatchesRegion(p,regionKey)
    );
    if(!validInRegion){
      showToast(`Escolha um bairro disponível em ${regionDisplayName(regionKey)}.`);
      return;
    }
  }

  adIntent.neighborhood=neighborhood;
  adIntent.bedrooms=bedrooms;
  adIntent.minPrice=min;
  adIntent.maxPrice=max;
  adIntent.active=Boolean(neighborhood || bedrooms || min || max || adIntent.type || adIntent.search || adIntent.development);
  syncPaidClickContextUi();
  notePaidSignal("refined");
  updateAdIntentPriceInUrl();
  updateAdMatchUI();
  setRefineMatchOpen(false);
  showMatches();
  try{gtag('event','match_refined',{region:regionKey||adIntent.neighborhood,neighborhood:adIntent.neighborhood,bedrooms:adIntent.bedrooms,min_price:min,max_price:max});}catch(e){}
});

// Original main L20976
$("clearRefineMatch")?.addEventListener("click",()=>{
  // Limpa apenas o refinamento do feed e preserva o MATCH original.
  adIntent.neighborhood="";
  adIntent.bedrooms=0;
  adIntent.minPrice=0;
  adIntent.maxPrice=0;
  adIntent.active=false;
  syncPaidClickContextUi();

  const url=new URL(window.location.href);
  ["bairro","neighborhood","region","dormitorios","bedrooms","valor_min","min_price","valor_max","max_price"].forEach(key=>url.searchParams.delete(key));
  history.replaceState(history.state||{},"",url.pathname+url.search+url.hash);

  updateAdMatchUI();
  setRefineMatchOpen(false);
  showMatches();
  showToast("Refinamento limpo. Voltamos à sua busca original.");
});

// Original main L21303
setStep(0);

// Original main L21305
if($("catalogCity")){
  $("catalogCity").value=activeCity;
}

// Original main L21308
if($("catalogState")){
  $("catalogState").value=activeState;
}

// Original main L21313
loadInventory()
.then(
  async ()=>{

    /*
      PERFORMANCE:
      o app fica utilizável assim que o inventário essencial termina.
      photos.json é carregado depois do primeiro paint e não bloqueia
      mais a abertura da interface.
    */
    const loadPhotosInBackground=()=>{
      loadPhotoManifest()
        .then(()=>{
          applyHeroInventoryPhoto();

          if($("results")?.classList.contains("visible")){
            showMatches();
          }

          if($("catalog")?.classList.contains("visible")){
            renderCatalog();
          }
        })
        .catch(()=>{});
    };

    if("requestIdleCallback" in window){
      window.requestIdleCallback(
        loadPhotosInBackground,
        {timeout:1800}
      );
    }else{
      setTimeout(loadPhotosInBackground,700);
    }

    /*
      Link compartilhado / Push:
      abre diretamente a ficha técnica do imóvel.

      Quando a URL vier com push=1, registramos push_click ANTES
      do property_view. Assim a jornada fica:

      push_sent -> push_click -> property_view -> IA -> lead

      O evento é deduplicado por aba/sessão para evitar duplicação
      causada por reload da mesma URL.
    */
    const launchParams=
      new URLSearchParams(
        window.location.search
      );

    const sharedPropertyId=
      launchParams.get("imovel") ||
      launchParams.get("property_id");

    const cameFromPush=
      launchParams.get("push")==="1";

    const pushVisitorId=
      launchParams.get("visitor") || "";

    if(sharedPropertyId){
      let sharedProperty=
        properties.find(
          item=>
            String(item.id)===
            String(sharedPropertyId)
        );

      /*
        O push pode apontar para um imóvel válido que ainda não está
        carregado no lote inicial do catálogo. Nesse caso, buscamos o
        registro diretamente no Supabase pelo external_id antes de
        declarar o imóvel indisponível.
      */
      if(!sharedProperty){
        try{
          const directUrl=
            new URL(
              "https://wzaegidwtdjuhqchpdpd.supabase.co/rest/v1/properties"
            );

          directUrl.searchParams.set(
            "external_id",
            `eq.${sharedPropertyId}`
          );

          directUrl.searchParams.set(
            "select",
            "*"
          );

          directUrl.searchParams.set(
            "limit",
            "1"
          );

          const directResponse=
            await fetch(
              directUrl.toString(),
              {
                cache:"no-store",
                headers:{
                  "apikey":
                    SUPABASE_PUBLISHABLE_KEY,

                  "Authorization":
                    `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
                }
              }
            );

          if(directResponse.ok){
            const directRows=
              await directResponse.json();

            const directRow=
              Array.isArray(directRows)
                ? directRows[0]
                : null;

            if(directRow){
              sharedProperty=
                mapOruloProperty(
                  directRow
                );

              if(sharedProperty?.id){
                sharedProperty={
                  ...sharedProperty,
                  detailHydrated:true
                };

                /*
                  Injeta o imóvel no estado atual para que toda a esteira
                  existente (detalhe, IA, tracking e navegação) continue
                  usando as mesmas funções do app.
                */
                if(
                  !properties.some(
                    item=>
                      String(item?.id||"")===
                      String(sharedProperty.id)
                  )
                ){
                  properties.unshift(
                    sharedProperty
                  );
                }

                if(
                  Array.isArray(
                    newPropertiesCache
                  ) &&
                  !newPropertiesCache.some(
                    item=>
                      String(item?.id||"")===
                      String(sharedProperty.id)
                  )
                ){
                  newPropertiesCache.unshift(
                    sharedProperty
                  );
                }

                console.log(
                  "YNT_PUSH_PROPERTY_LOADED_DIRECT",
                  {
                    property_id:
                      sharedProperty.id,

                    property_uuid:
                      sharedProperty.db_id||
                      ""
                  }
                );
              }
            }
          }else{
            console.warn(
              "YNT_PUSH_PROPERTY_DIRECT_FETCH_HTTP",
              directResponse.status
            );
          }
        }catch(error){
          console.warn(
            "YNT_PUSH_PROPERTY_DIRECT_FETCH_FAILED",
            error
          );
        }
      }

      if(sharedProperty){

        if(cameFromPush){
          try{
            const pushClickKey=
              "ynt_push_click_logged:"+
              String(sharedProperty.id||"");

            const alreadyLogged=
              sessionStorage.getItem(
                pushClickKey
              )==="1";

            if(!alreadyLogged){

              /*
                IMPORTANT:
                - property_id comercial continua no metadata.
                - property_uuid vai para a coluna UUID via supabaseTrack.
                - visitor da URL é apenas referência do push; não substitui
                  a identidade persistente do navegador.
              */
              supabaseTrack(
                "push_click",
                {
                  property_id:
                    String(
                      sharedProperty.id||
                      ""
                    ),

                  property_uuid:
                    String(
                      sharedProperty.db_id||
                      ""
                    ),

                  property_name:
                    sharedProperty.name||
                    "",

                  neighborhood:
                    sharedProperty.neighborhood||
                    "",

                  property_value:
                    Number(
                      sharedProperty.value
                    )||0,

                  inventory_source:
                    sharedProperty.source||
                    sourceMode||
                    "todos",

                  push_origin:
                    "daily_property",

                  push_visitor_id:
                    String(
                      pushVisitorId||
                      ""
                    ),

                  push:{
                    provider:
                      "onesignal",

                    type:
                      "daily_property",

                    clicked_at:
                      new Date()
                        .toISOString()
                  },

                  property:{
                    id:
                      String(
                        sharedProperty.id||
                        ""
                      ),

                    db_id:
                      String(
                        sharedProperty.db_id||
                        ""
                      ),

                    name:
                      sharedProperty.name||
                      "",

                    neighborhood:
                      sharedProperty.neighborhood||
                      "",

                    value:
                      Number(
                        sharedProperty.value
                      )||0
                  }
                }
              );

              sessionStorage.setItem(
                pushClickKey,
                "1"
              );

              console.log(
                "YNT_PUSH_CLICK_TRACKED",
                {
                  property_id:
                    sharedProperty.id,

                  property_uuid:
                    sharedProperty.db_id||
                    "",

                  visitor_id:
                    YNTELIGENCIA_VISITOR_ID,

                  push_visitor_id:
                    pushVisitorId
                }
              );
            }

          }catch(error){
            console.warn(
              "YNT_PUSH_CLICK_TRACK_FAILED",
              error
            );
          }
        }

        document.body.classList.remove(
          "home-mode"
        );

        showPhotoModal(
          String(
            sharedProperty.id
          )
        );

      }else{
        showToast(
          "Este imóvel não está disponível no estoque atual."
        );
      }
    }

    /*
      URL gerada pelo Explorar:
      abre o catálogo com a mesma busca salva na URL.
    */
    const openedCatalogFromUrl=
      !sharedPropertyId &&
      loadCatalogFromUrl();

    if(openedCatalogFromUrl){
      document.body.classList.add("campaign-catalog-mode");
    }

    // Persisted search is deferred; loading it does not activate the initial UI.
    yntDeferredSearch=paidMemory();

    startPaidClickExperience();
    if(openedCatalogFromUrl && yntHasPaidClickContext()){
      notePaidArrival();
    }

    /* Se o clique veio de um anúncio com intenção conhecida, entrega
       os imóveis imediatamente. A home e o wizard continuam intactos
       para acessos normais ao domínio.
       Esse fluxo só roda quando NÃO for uma URL modo=explorar. */
    if(
      !openedCatalogFromUrl &&
      adIntent.active &&
      !sharedPropertyId
    ){
      updateAdMatchUI();
      document.body.classList.remove("home-mode");
      showMatches();
      notePaidArrival();
    }

    /*
      HOME LIMPA:
      acesso normal permanece na home.
      Links de campanha continuam tratados acima por loadCatalogFromUrl/adIntent.
    */

    console.log(
      `Ynteligencia pronta: ${properties.length} imóveis · fotos em carregamento progressivo`
    );
  }
);
