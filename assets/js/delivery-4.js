
;
// SOURCE: assets/js/services/search.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

async function loadPhotoManifest(){

  if(photoManifestLoaded){
    return photoManifest;
  }

  if(photoManifestPromise){
    return photoManifestPromise;
  }

  photoManifestPromise=(async()=>{

    try{

      const r=
        await fetch(
          "photos.json",
          {
            cache:"default"
          }
        );


      if(!r.ok){
        return photoManifest;
      }


      const d=
        await r.json();


      if(
        d &&
        typeof d==="object"
      ){

        photoManifest=d;
      }

      photoManifestLoaded=true;
      return photoManifest;

    }catch{

      photoManifest={};
      return photoManifest;

    }finally{

      photoManifestPromise=null;
    }
  })();

  return photoManifestPromise;
}

async function hydratePropertyDetails(p){
  if(!p)return p;

  if(
    p.detailHydrated===true &&
    p.rawData &&
    typeof p.rawData==="object" &&
    Object.keys(p.rawData).length
  ){
    return p;
  }

  const id=String(p.id||"");
  if(!id)return p;

  if(fullNewPropertyCache.has(id)){
    return fullNewPropertyCache.get(id);
  }

  const promise=(async()=>{
    try{
      const url=new URL("https://wzaegidwtdjuhqchpdpd.supabase.co/rest/v1/properties");
      url.searchParams.set("external_id",`eq.${id}`);
      url.searchParams.set("select","*");
      url.searchParams.set("limit","1");

      const response=await fetch(url.toString(),{
        cache:"default",
        headers:{
          "apikey":SUPABASE_PUBLISHABLE_KEY,
          "Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`
        }
      });

      if(!response.ok){
        throw new Error(`Detalhe Supabase: ${response.status}`);
      }

      const rows=await response.json();
      const row=Array.isArray(rows)?rows[0]:null;
      if(!row)return p;

      const full=mapOruloProperty(row);
      const merged={
        ...p,
        ...full,
        source:full.source || p.source || "",
        match:p.match || full.match,
        detailHydrated:true
      };

      return replacePropertyEverywhere(merged);
    }catch(error){
      console.warn("Falha ao carregar detalhe completo:",error);
      return p;
    }
  })();

  fullNewPropertyCache.set(id,promise);
  const result=await promise;
  fullNewPropertyCache.set(id,result);
  return result;
}

async function loadDevelopmentData(p){
  const buildingId=
    developmentBuildingId(p);

  if(!buildingId){
    return null;
  }

  if(
    developmentDataCache.has(
      buildingId
    )
  ){
    return await developmentDataCache.get(
      buildingId
    );
  }

  const promise=(async()=>{
    try{
      const response=
        await fetch(
          `/api/development?id=${encodeURIComponent(buildingId)}`,
          {
            method:"GET",
            cache:"no-store",
            headers:{
              Accept:"application/json"
            }
          }
        );

      const data=
        await response.json()
          .catch(()=>null);

      if(
        !response.ok ||
        data?.success!==true
      ){
        throw new Error(
          data?.error ||
          `Development API ${response.status}`
        );
      }

      return data;
    }catch(error){
      console.warn(
        "YNT_DEVELOPMENT_LOAD_ERROR",
        {
          building_id:buildingId,
          error:error?.message || String(error)
        }
      );

      return null;
    }
  })();

  developmentDataCache.set(
    buildingId,
    promise
  );

  return await promise;
}

async function loadCatalogNeighborhoodIndex({force=false}={}){
  const key=catalogNeighborhoodIndexKey();

  if(!force && catalogNeighborhoodIndexCache.has(key)){
    return catalogNeighborhoodIndexCache.get(key);
  }

  const requestId=++catalogNeighborhoodIndexRequest;
  const source=$("catalogSource")?.value || "todos";
  const neighborhoods=[];
  const PAGE_SIZE=1000;
  let offset=0;

  /*
    Limite de segurança: 10 lotes = até 10.000 registros.
    Hoje o estoque Nonstop é muito menor que isso.
  */
  for(let page=0;page<10;page++){
    const url=new URL("https://wzaegidwtdjuhqchpdpd.supabase.co/rest/v1/properties");

    url.searchParams.set("select","neighborhood");
    url.searchParams.set("active","eq.true");
    url.searchParams.set("city",`eq.${activeCity}`);
    url.searchParams.set("state",`eq.${activeState}`);

    if(source==="novos"){
      url.searchParams.set("source","eq.novos");
    }else if(source==="usados"){
      url.searchParams.set("source","eq.usados");
    }

    url.searchParams.set("neighborhood","not.is.null");
    url.searchParams.set("limit",String(PAGE_SIZE));
    url.searchParams.set("offset",String(offset));

    const response=await fetch(url.toString(),{
      cache:"no-store",
      headers:{
        "apikey":SUPABASE_PUBLISHABLE_KEY,
        "Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      }
    });

    if(!response.ok){
      const message=await response.text().catch(()=>"");
      throw new Error(`Supabase bairros: ${response.status} ${message}`);
    }

    const rows=await response.json();

    if(requestId!==catalogNeighborhoodIndexRequest){
      return [];
    }

    if(!Array.isArray(rows) || !rows.length){
      break;
    }

    for(const row of rows){
      const neighborhood=clean(row?.neighborhood || "");
      if(neighborhood)neighborhoods.push(neighborhood);
    }

    offset+=rows.length;

    if(rows.length<PAGE_SIZE){
      break;
    }
  }

  const list=[...new Set(neighborhoods)]
    .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  catalogNeighborhoodIndexCache.set(key,list);

  return list;
}

function catalogServerQuery(offset=0){
  const url=new URL("https://wzaegidwtdjuhqchpdpd.supabase.co/rest/v1/properties");

  /*
    O catálogo agora lê NOVOS e USADOS diretamente do Supabase.
    O CSV permanece desativado.
  */
  const source=
    $("catalogSource")?.value || "todos";

  if(source==="novos"){
    url.searchParams.set("source","eq.novos");
  }else if(source==="usados"){
    url.searchParams.set("source","eq.usados");
  }

  url.searchParams.set("active","eq.true");
  url.searchParams.set(
    "select",
    "id,external_id,source,title,development_name,neighborhood,city,state,price,bedrooms,bathrooms,parking_spaces,area,image_url,property_url,active,updated_at,raw_data"
  );
  url.searchParams.set("city",`eq.${activeCity}`);
  url.searchParams.set("state",`eq.${activeState}`);

  const neighborhood=$("catalogNeighborhood")?.value || "";
  const search=clean($("catalogSearch")?.value || "");
  const catalogType=clean($("catalogType")?.value || "").toLowerCase();
  const minPrice=numberBR($("minPrice")?.value || "");
  const maxPrice=numberBR($("maxPrice")?.value || "");
  const bedrooms=$("catalogBedrooms")?.value || "";
  const minArea=numberBR($("minArea")?.value || "");
  const parking=$("catalogParking")?.value || "";
  const sort=$("catalogSort")?.value || "price_asc";

  /*
    TIPO ANTES DA PAGINAÇÃO
    -----------------------
    A tabela public.properties não possui coluna "type".
    Para casas da Órulo, os registros sincronizados trazem "Casa"
    no title (ex.: "... Casa ...").

    Antes, o Supabase retornava primeiro 30 imóveis de todos os tipos
    e só DEPOIS o navegador aplicava p.type==="casa". Se nenhuma casa
    estivesse entre os 30 primeiros, o app mostrava zero mesmo com
    casas existentes no banco.

    Agora restringimos CASAS no Supabase antes de limit/offset.
  */
  if(catalogType==="casa"){
    /*
      Evita falso positivo como "Metrocasa".
      Procuramos " Casa " como palavra isolada no título,
      padrão usado pelos registros de casas da Órulo
      (ex.: "JLEDM 121 Casa 601241007-41").
    */
    url.searchParams.set("title","ilike.* Casa *");
  }

  if(neighborhood){
    url.searchParams.set("neighborhood",`eq.${neighborhood}`);
  }else if(catalogRegion){
    /*
      PERFORMANCE:
      Região agora é filtrada no Supabase ANTES da paginação.
      Antes chegavam 30 imóveis aleatórios e a região era filtrada
      somente no navegador, podendo resultar em "0 exibidos" mesmo
      com milhares de imóveis no banco.
    */
    const regionNames=(REGION_MAP[norm(catalogRegion)] || [])
      .map(name=>clean(name))
      .filter(Boolean);

    if(regionNames.length){
      const regionOr=regionNames
        .map(name=>`neighborhood.ilike.*${name.replace(/[(),]/g," ")}*`)
        .join(",");

      url.searchParams.set("or",`(${regionOr})`);
    }
  }

  if(minPrice && maxPrice){
    url.searchParams.set("and",`(price.gte.${minPrice},price.lte.${maxPrice})`);
  }else if(minPrice){
    url.searchParams.set("price",`gte.${minPrice}`);
  }else if(maxPrice){
    url.searchParams.set("price",`lte.${maxPrice}`);
  }
  if(bedrooms) url.searchParams.set("bedrooms",`gte.${Number(bedrooms)}`);
  if(minArea) url.searchParams.set("area",`gte.${minArea}`);
  if(parking) url.searchParams.set("parking_spaces",parking==="0" ? "eq.0" : `gte.${Number(parking)}`);
  if(search){
    const safeSearch=search.replace(/[(),]/g," ").trim();
    if(safeSearch){
      url.searchParams.set("or",`(development_name.ilike.*${safeSearch}*,title.ilike.*${safeSearch}*,neighborhood.ilike.*${safeSearch}*,external_id.ilike.*${safeSearch}*)`);
    }
  }
  const orderMap={price_asc:"price.asc.nullslast",price_desc:"price.desc.nullslast",area_desc:"area.desc.nullslast",area_asc:"area.asc.nullslast"};
  url.searchParams.set("order",orderMap[sort] || orderMap.price_asc);
  url.searchParams.set("limit",String(CATALOG_PAGE_SIZE));
  url.searchParams.set("offset",String(offset));
  return url.toString();
}

async function fetchNewCatalogPage({reset=false}={}){
  if(newCatalogLoading) return;
  if(!reset && !newCatalogHasMore) return;
  if(reset){
    newCatalogOffset=0;
    newCatalogHasMore=true;
    newCatalogTotal=0;
    newPropertiesCache=[];
  }

  const requestId=++newCatalogRequestId;
  newCatalogLoading=true;

  try{
    const response=await fetch(catalogServerQuery(newCatalogOffset),{
      cache:"no-store",
      headers:{
        "apikey":SUPABASE_PUBLISHABLE_KEY,
        "Authorization":`Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Prefer":"count=exact"
      }
    });

    if(!response.ok){
      const t=await response.text().catch(()=>"");
      throw new Error(`Supabase catálogo: ${response.status} ${t}`);
    }

    const rows=await response.json();
    if(requestId!==newCatalogRequestId) return;

    const contentRange=response.headers.get("content-range") || "";
    const totalMatch=contentRange.match(/\/(\d+)$/);
    if(totalMatch){
      newCatalogTotal=Number(totalMatch[1])||0;
    }

    const mapped=
      Array.isArray(rows)
        ? rows
            /*
              raw_data ainda participa da NORMALIZAÇÃO desta resposta,
              garantindo que MATCH/filtros mantenham tipo, suítes,
              condomínio, IPTU e demais campos derivados.
              Logo depois descartamos o rawData bruto da listagem.
            */
            .map(mapOruloProperty)
            .map(toCatalogLiteProperty)
            /*
              Preço 0 é um registro válido no inventário.
            */
            .filter(p=>p && p.id)
        : [];

    newPropertiesCache=
      deduplicate([
        ...newPropertiesCache,
        ...mapped
      ]);

    console.info(
      "YNT_CATALOG_LITE_CACHE",
      {
        page_rows:Array.isArray(rows) ? rows.length : 0,
        cached:newPropertiesCache.length,
        raw_data_in_memory:newPropertiesCache.filter(
          p=>p?.rawData && Object.keys(p.rawData).length
        ).length
      }
    );

    newCatalogOffset +=
      Array.isArray(rows)
        ? rows.length
        : 0;

    newCatalogHasMore=
      Array.isArray(rows) &&
      rows.length===CATALOG_PAGE_SIZE &&
      (
        !newCatalogTotal ||
        newCatalogOffset<newCatalogTotal
      );

    /*
      O cache principal agora já contém o estoque filtrado
      solicitado ao Supabase: novos, usados ou todos.
    */
    properties=
      deduplicate([
        ...newPropertiesCache
      ]);

    /*
      Atualiza o campo Bairro com o que já veio nesta consulta,
      sem disparar uma varredura adicional no banco.
    */
    if($("catalogNeighborhood")){
      fillCatalogNeighborhoodsForRegion(
        catalogRegion,
        {full:false}
      ).catch(()=>{});
    }

  }finally{
    newCatalogLoading=false;
  }
}

async function loadUsedInventory(){
  if(!USE_CSV_INVENTORY){
    usedPropertiesCache=[];
    usedInventoryLoaded=true;
    usedInventoryLoading=false;
    properties=deduplicate([...newPropertiesCache]);
    return;
  }

  if(usedInventoryLoaded || usedInventoryLoading)return;
  usedInventoryLoading=true;

  try{
    const response=await fetch(CSV_FILE,{cache:"default"});
    if(!response.ok)throw new Error("CSV não encontrado");

    const text=await response.text();
    usedPropertiesCache=deduplicate(parseCSV(text).map(mapProperty));
    usedInventoryLoaded=true;
    properties=deduplicate([...usedPropertiesCache,...newPropertiesCache]);
    fillCatalogNeighborhoods();

    if($("catalog")?.classList.contains("visible"))renderCatalog();
    if($("results")?.classList.contains("visible"))showMatches();
  }catch(error){
    console.warn("Falha ao carregar usados em segundo plano:",error);
  }finally{
    usedInventoryLoading=false;
  }
}

async function loadInventory(){
  inventoryLoading=true;
  inventoryReady=false;
  inventoryLoadError=false;

  try{
    /*
      PERFORMANCE:
      carrega a primeira página do estoque solicitado diretamente
      do Supabase (novos, usados/Nonstop ou todos).
      O CSV permanece desativado.
    */
    await fetchNewCatalogPage({reset:true});

    properties=deduplicate([...newPropertiesCache]);
    inventoryLoading=false;
    inventoryReady=true;
    inventoryLoadError=false;

    fillCatalogNeighborhoods();
    if($("catalog")?.classList.contains("visible"))renderCatalog();

    if(USE_CSV_INVENTORY){
      const loadUsedLater=()=>loadUsedInventory().catch(()=>{});

      if("requestIdleCallback" in window){
        window.requestIdleCallback(loadUsedLater,{timeout:1400});
      }else{
        setTimeout(loadUsedLater,450);
      }
    }

  }catch(error){
    console.error("Falha ao carregar inventário:",error);
    inventoryLoading=false;
    inventoryReady=false;
    inventoryLoadError=true;
    if($("catalog")?.classList.contains("visible"))renderCatalog();
    showToast("Não foi possível atualizar o estoque agora. Tente novamente em instantes.");
  }
}


;
// SOURCE: assets/js/ui/match.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function setStep(n,fromHistory=false){

  const previousStep=step;

  step=
    Math.max(
      0,
      Math.min(
        3,
        n
      )
    );


  const wizard=document.querySelector(".wizard");
  if(wizard){
    wizard.dataset.direction=step>=previousStep ? "forward" : "back";
    wizard.dataset.currentStep=String(step);
  }

  steps.forEach((s,i)=>{
    s.hidden=i!==step;
    s.classList.toggle("active",i===step);
  });


  $("progress").style.width=
    `${((step+1)/5)*100}%`;

  const stepCount=$("stepCount");
  if(stepCount){
    stepCount.textContent=`${String(step+1).padStart(2,"0")} de 04`;
  }


  $("back").style.visibility=
    step===0
      ? "hidden"
      : "visible";


  $("next").textContent=
    step===3
      ? "Encontrar meus MATCHs"
      : "Continuar";


  updateNext();

  if(document.body.classList.contains("match-mode") && !fromHistory && step!==previousStep){
    history.pushState({ynteligenciaMatch:true,step},"");
  }


  if(document.body.classList.contains("match-mode")){
    document.getElementById("match").scrollTop=0;
  }
}

function currentValid(){

  if(step===0){

    return(
      profile.types.length>0
    );
  }


  if(step===2){

    return(
      Number(profile.budgetMin)>0 || Number(profile.budgetMax)>0
    );
  }


  const key=
    [
      "types",
      "region",
      "budget",
      "bedrooms",
      "feature"
    ][step];


  return(
    profile[key]!=="" &&
    profile[key]!==null &&
    profile[key]!==undefined
  );
}

function updateNext(){

  $("next").disabled=
    !currentValid();
}

function showMatchProcessing(){
  const layer=$("matchProcessing");
  const label=$("matchProcessingText");
  if(!layer){showMatches();return;}
  const messages=[
    "Analisando seu perfil...",
    "Comparando imóveis...",
    "Calculando compatibilidade...",
    "Seus MATCHES estão prontos."
  ];
  layer.classList.add("visible");
  messages.forEach((message,index)=>setTimeout(()=>{if(label)label.textContent=message;},index*420));
  setTimeout(()=>{showMatches();layer.classList.remove("visible");},1550);
}

function enterMatchMode(){
  // Evita que qualquer select do refinamento permaneça ativo sobre o Wizard.
  try{ document.activeElement?.blur?.(); }catch(e){}

  setRefineMatchOpen(false);
  setFiltersOpen(false);
  $("catalog")?.classList.remove("visible");
  $("results")?.classList.remove("visible");

  document.body.classList.remove("home-mode","match-results-mode","ad-match-mode");
  document.body.classList.add("match-mode");

  // Sempre entra no Wizard pela primeira etapa.
  setStep(0,true);
  history.pushState({ynteligenciaMatch:true,step:0},"");
}

function leaveMatchMode(){
  document.body.classList.remove("match-mode");
}

function resetMatchProfile(){
  profile={
    purpose:"",
    region:"",
    budget:0,
    budgetMin:0,
    budgetMax:0,
    bedrooms:null,
    feature:[],
    timing:"",
    types:[]
  };

  document.querySelectorAll(".option").forEach(x=>x.classList.remove("selected"));
  $("results")?.classList.remove("visible");
  document.body.classList.remove("match-results-mode");
  currentMatchById.clear();
  setStep(0,true);
  updateSummary();
  history.replaceState({ynteligenciaMatch:true,step:0},"");
}


;
// SOURCE: assets/js/ui/filters.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function setFiltersOpen(open){
  const sheet=$("catalogFilters");
  const backdrop=$("filtersBackdrop");
  if(!sheet || !backdrop)return;
  sheet.classList.toggle("open",open);
  backdrop.classList.toggle("open",open);
  backdrop.setAttribute("aria-hidden",String(!open));
  if(window.matchMedia("(max-width:700px)").matches){
    // Mobile filters are inline, not a fixed sheet: keep the document scrollable.
    document.body.style.overflow="";
    if(open){
      sheet.scrollTop=0;
      const panel=$("unifiedSearchPanel");
      if(panel)panel.scrollTop=0;
      if(panel?.contains(document.activeElement))document.activeElement.blur();
      requestAnimationFrame(()=>{
        if(!sheet.classList.contains("open") || !panel)return;
        sheet.scrollTop=0;
        panel.scrollTop=0;
        const headerHeight=document.querySelector("header")?.getBoundingClientRect().height || 0;
        window.scrollTo({top:Math.max(0,window.scrollY+panel.getBoundingClientRect().top-headerHeight-12),behavior:"instant"});
      });
    }
  }
}

function catalogNeighborhoodIndexKey(){
  const source=$("catalogSource")?.value || "todos";

  return [
    source,
    clean(activeCity || "São Paulo"),
    String(activeState || "SP").toUpperCase()
  ].join("|");
}

function neighborhoodMatchesRegionName(neighborhood,regionKey=""){
  if(!regionKey)return true;

  const neighborhoodNorm=norm(neighborhood);
  const regionNeighborhoods=(REGION_MAP[norm(regionKey)] || []).map(norm);

  return regionNeighborhoods.some(regionName=>
    neighborhoodNorm===regionName ||
    neighborhoodNorm.includes(regionName) ||
    regionName.includes(neighborhoodNorm)
  );
}

async function fillCatalogNeighborhoods(){
  return fillCatalogNeighborhoodsForRegion(catalogRegion);
}

async function fillCatalogNeighborhoodsForRegion(
  regionKey="",
  {
    full=false
  }={}
){
  const select=$("catalogNeighborhood");
  if(!select)return;

  const current=select.value;
  const key=catalogNeighborhoodIndexKey();

  /*
    PERFORMANCE:
    Não varremos milhares de registros do Supabase ao abrir o app.
    Primeiro mostramos instantaneamente os bairros do lote já carregado.
    O índice completo é buscado somente quando realmente necessário.
  */
  const loadedNeighborhoods=[...new Set(
    properties
      .map(p=>clean(p.neighborhood))
      .filter(Boolean)
  )]
  .sort((a,b)=>a.localeCompare(b,"pt-BR"));

  const cached=
    catalogNeighborhoodIndexCache.get(key);

  let allNeighborhoods=
    Array.isArray(cached) && cached.length
      ? cached
      : loadedNeighborhoods;

  if(full){
    select.disabled=true;

    if(!allNeighborhoods.length){
      select.innerHTML=
        '<option value="">Carregando bairros...</option>';
    }

    try{
      allNeighborhoods=
        await loadCatalogNeighborhoodIndex();
    }catch(error){
      console.warn(
        "Falha ao carregar índice completo de bairros:",
        error
      );
    }
  }

  const list=allNeighborhoods
    .filter(neighborhood=>
      neighborhoodMatchesRegionName(
        neighborhood,
        regionKey
      )
    );

  select.innerHTML=
    '<option value="">Todos os bairros</option>' +
    list
      .map(v=>`<option value="${esc(v)}">${esc(v)}</option>`)
      .join("");

  /*
    Preserva bairro vindo de URL/campanha mesmo se ele ainda não
    apareceu no primeiro lote.
  */
  const currentMatch=list.find(
    v=>norm(v)===norm(current)
  );

  if(currentMatch){
    select.value=currentMatch;
  }else if(current){
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${esc(current)}">${esc(current)}</option>`
    );
    select.value=current;
  }else{
    select.value="";
  }

  select.disabled=false;
}

async function setCatalogRegion(regionKey){
  catalogRegion=regionKey || "";

  document.querySelectorAll(".catalog-region-btn").forEach(btn=>{
    btn.classList.toggle("selected",(btn.dataset.region || "")===catalogRegion);
  });

  await fillCatalogNeighborhoodsForRegion(
    catalogRegion,
    {full:true}
  );

  /*
    A decisão de executar busca automática agora pertence a
    maybeAutoExecuteCatalogSearch(), que exige 4 critérios.
  */
}

function catalogFilledCriteriaCount(){
  const values=[
    /*
      Região
    */
    catalogRegion || "",

    /*
      Bairro
    */
    $("catalogNeighborhood")?.value || "",

    /*
      Nome do empreendimento / condomínio
    */
    clean($("catalogSearch")?.value || ""),

    /*
      Estoque só conta se o usuário restringiu o padrão "todos"
    */
    (
      ($("catalogSource")?.value || "todos")!=="todos"
        ? $("catalogSource")?.value
        : ""
    ),

    /*
      Tipo
    */
    $("catalogType")?.value || "",

    /*
      Dormitórios
    */
    $("catalogBedrooms")?.value || "",

    /*
      Faixa de preço: mínimo e máximo são critérios separados,
      porque são dois campos efetivamente preenchidos.
    */
    numberBR($("minPrice")?.value || "") > 0
      ? $("minPrice").value
      : "",

    numberBR($("maxPrice")?.value || "") > 0
      ? $("maxPrice").value
      : "",

    /*
      Área mínima
    */
    numberBR($("minArea")?.value || "") > 0
      ? $("minArea").value
      : "",

    /*
      Vagas: "0" é uma escolha válida e precisa contar.
    */
    $("catalogParking")?.value !== undefined &&
    $("catalogParking")?.value !== ""
      ? $("catalogParking").value
      : "",

    /*
      Condomínio e IPTU
    */
    numberBR($("maxCondo")?.value || "") > 0
      ? $("maxCondo").value
      : "",

    numberBR($("maxIptu")?.value || "") > 0
      ? $("maxIptu").value
      : ""
  ];

  return values.filter(value=>
    String(value ?? "").trim()!==""
  ).length;
}

function maybeAutoExecuteCatalogSearch({
  debounce=false
}={}){
  /*
    MOBILE:
    evita consultas automáticas enquanto o cliente está montando
    os filtros. A busca acontece ao tocar em BUSCAR IMÓVEIS.
    Isso deixa selects/inputs mais leves sem alterar o backend.
  */
  if(window.matchMedia && window.matchMedia("(max-width:768px)").matches){
    if(catalogAutoSearchTimer){
      clearTimeout(catalogAutoSearchTimer);
      catalogAutoSearchTimer=null;
    }
    return;
  }

  const count=
    catalogFilledCriteriaCount();

  /*
    Com menos de 4 filtros, não mostramos resultados
    automaticamente.
  */
  if(count<4){
    catalogAutoSearchStarted=false;

    if(catalogAutoSearchTimer){
      clearTimeout(catalogAutoSearchTimer);
      catalogAutoSearchTimer=null;
    }

    /*
      Se a busca anterior foi automática e o cliente removeu
      filtros até ficar abaixo de 4, ocultamos os resultados.
      O botão BUSCAR ainda pode reabri-los manualmente.
    */
    if($("catalog")?.classList.contains("visible")){
      $("catalog")?.classList.remove("visible");
    }

    return;
  }

  const run=()=>{
    catalogAutoSearchTimer=null;
    catalogAutoSearchStarted=true;
    executeCatalogSearch();
  };

  if(debounce){
    if(catalogAutoSearchTimer){
      clearTimeout(catalogAutoSearchTimer);
    }

    catalogAutoSearchTimer=
      setTimeout(run,450);
  }else{
    run();
  }
}

async function ensureFullNeighborhoodIndex(){
  if(catalogNeighborhoodLazyLoading)return;

  const key=catalogNeighborhoodIndexKey();
  if(catalogNeighborhoodIndexCache.has(key))return;

  catalogNeighborhoodLazyLoading=true;

  try{
    await fillCatalogNeighborhoodsForRegion(
      catalogRegion,
      {full:true}
    );
  }finally{
    catalogNeighborhoodLazyLoading=false;
  }
}

function updateAdIntentPriceInUrl(){
  const url=new URL(window.location.href);

  // Remove aliases antigos e grava uma URL canônica compartilhável.
  [
    "bairro","neighborhood","region",
    "dormitorios","bedrooms",
    "valor_min","min_price","valor_max","max_price"
  ].forEach(key=>url.searchParams.delete(key));

  if(adIntent.neighborhood) url.searchParams.set("bairro",adIntent.neighborhood);
  if(adIntent.bedrooms) url.searchParams.set("dormitorios",String(adIntent.bedrooms));
  if(adIntent.minPrice) url.searchParams.set("valor_min",String(adIntent.minPrice));
  if(adIntent.maxPrice) url.searchParams.set("valor_max",String(adIntent.maxPrice));

  // Mantém UTMs, GCLID/GBRAID/WBRAID e demais parâmetros da campanha.
  history.replaceState(history.state||{},"",url.pathname+url.search+url.hash);
}

function openAdBudgetQuestion(){
  const shell=$("adBudgetShell");
  if(!shell) return;
  const context=$("adBudgetContext");
  const known=[];
  if(adIntent.bedrooms) known.push(`${adIntent.bedrooms}+ dormitórios`);
  if(adIntent.neighborhood) known.push(adIntent.neighborhood);
  if(context){
    context.textContent=known.length
      ? `${known.join(" em ")}. Escolha seu teto de valor para mostrarmos imóveis que realmente fazem sentido para você.`
      : "Escolha seu teto de valor para mostrarmos imóveis que realmente fazem sentido para você.";
  }
  shell.classList.add("open");
  shell.setAttribute("aria-hidden","false");
}

function closeAdBudgetQuestion(){
  const shell=$("adBudgetShell");
  if(!shell) return;
  shell.classList.remove("open");
  shell.setAttribute("aria-hidden","true");
}

function setRefineMatchOpen(open){
  const shell=$("refineMatchShell");
  if(!shell) return;
  shell.classList.toggle("open",open);
  shell.setAttribute("aria-hidden",String(!open));
}


;
// SOURCE: assets/js/ui/catalog.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function coverHTML(p){

  /*
    PERFORMANCE:
    o card usa somente a capa. A galeria completa é carregada
    quando o usuário abre a ficha do imóvel.
  */
  const photos=
    photoList(p).slice(0,1);


  if(
    photos.length
  ){

    const slides=
      photos
        .map(
          (url,i)=>
            `
            <img
              class="photo-slide"
              src="${esc(url)}"
              alt="${esc(p.name||"Foto do imóvel")}"
              loading="lazy"
              decoding="async"
              onerror="this.style.display='none'">
            `
        )
        .join("");


    const dots=
      photos.length>1

        ? photos
            .map(
              (_,i)=>
                `
                <span
                  class="photo-dot ${i===0?"active":""}">
                </span>
                `
            )
            .join("")

        : "";


    const arrows=
      photos.length>1

        ? `
          <button
            class="photo-arrow prev"
            type="button"
            aria-label="Foto anterior"
            onclick="movePhoto(this,-1)">
            ‹
          </button>

          <button
            class="photo-arrow next"
            type="button"
            aria-label="Próxima foto"
            onclick="movePhoto(this,1)">
            ›
          </button>
          `

        : "";


    const counter=
      photos.length>1

        ? `
          <span class="photo-counter">
            1 / ${photos.length}
          </span>
          `

        : "";


    return`
      <div class="cover">

        <div
          class="photo-carousel"
          data-photo-index="0">

          <div
            class="photo-track"
            onscroll="syncPhotoUI(this)">

            ${slides}

          </div>

          ${arrows}

          <div class="photo-dots">
            ${dots}
          </div>

          ${counter}

        </div>

        <span class="match">
          ${
            p.match
              ? `${p.match.score}% MATCH`
              : "IMÓVEL DISPONÍVEL"
          }
        </span>

        <span class="cover-location">
          ${esc(p.neighborhood)}
        </span>

      </div>
      `;
  }


  return`
    <div class="cover">

      <div
        class="cover-art"
        aria-hidden="true">

        <span class="building one"></span>
        <span class="building two"></span>

      </div>

      <span class="match">
        ${
          p.match
            ? `${p.match.score}% MATCH`
            : "IMÓVEL DISPONÍVEL"
        }
      </span>

      <span class="cover-location">
        ${esc(p.neighborhood)}
      </span>

    </div>
    `;
}

function movePhoto(
  button,
  direction
){

  const carousel=
    button.closest(
      ".photo-carousel"
    );


  if(!carousel)return;


  const track=
    carousel.querySelector(
      ".photo-track"
    );


  const slides=
    track.querySelectorAll(
      ".photo-slide"
    );


  if(!slides.length)return;


  const current=
    Number(
      carousel.dataset.photoIndex || 0
    );


  const next=
    Math.max(
      0,
      Math.min(
        slides.length-1,
        current+direction
      )
    );


  track.scrollTo({

    left:
      track.clientWidth*
      next,

    behavior:
      "smooth"
  });


  carousel.dataset.photoIndex=
    String(next);


  updatePhotoUI(
    carousel,
    next
  );
}

function syncPhotoUI(track){

  const carousel=
    track.closest(
      ".photo-carousel"
    );


  if(
    !carousel ||
    !track.clientWidth
  )return;


  const index=
    Math.round(
      track.scrollLeft/
      track.clientWidth
    );


  carousel.dataset.photoIndex=
    String(index);


  updatePhotoUI(
    carousel,
    index
  );
}

function updatePhotoUI(
  carousel,
  index
){

  carousel
    .querySelectorAll(
      ".photo-dot"
    )
    .forEach(
      (dot,i)=>
        dot.classList.toggle(
          "active",
          i===index
        )
    );


  const counter=
    carousel.querySelector(
      ".photo-counter"
    );


  if(counter){

    counter.textContent=
      `${index+1} / ${carousel.querySelectorAll(".photo-dot").length}`;
  }
}

function card(
  p,
  isMatch=false
){

  const features=[];


  if(p.area){

    features.push(
      `${area(p.area)} m²`
    );
  }


  if(p.bedrooms){

    features.push(
      `${p.bedrooms} ${
        p.bedrooms===1
          ? "dorm."
          : "dorms."
      }`
    );
  }


  if(p.suites){

    features.push(
      `${p.suites} ${
        p.suites===1
          ? "suíte"
          : "suítes"
      }`
    );
  }


  if(p.parking){

    features.push(
      `${p.parking} ${
        p.parking===1
          ? "vaga"
          : "vagas"
      }`
    );
  }


  const addr=
    [
      p.address,

      p.unit
        ? `Unidade ${p.unit}`
        : ""

    ]
      .filter(Boolean)
      .join(" · ");


  const priceM2=
    p.m2 ||
    (
      p.value &&
      p.area

        ? p.value/
          p.area

        : 0
    );


  const reasons=
    isMatch &&
    p.match

      ? [
          ...(p.adAlternative ? [`Alternativa próxima em ${p.neighborhood || "bairro da mesma região"}`] : []),
          ...p.match.reasons
        ].slice(0,3)
      : [];


  const reasonHTML=
    isMatch

      ? `
        <div class="reasons">

          <strong>
            Por que apareceu para você?
          </strong>

          ${
            reasons.length

              ? reasons
                  .map(
                    r=>
                      `✓ ${esc(r)}`
                  )
                  .join(" · ")

              : "Combinação com seus critérios."
          }

        </div>
        `

      : "";


  const photos=
    photoList(p);


  const photoButton=
    photos.length

      ? `
        <button
          class="view"
          type="button"
          data-property-action="details" data-property-id="${esc(p.id)}">
          Ver detalhes
        </button>
        `

      : `
        <button
          class="view"
          type="button"
          onclick="showToast('As imagens deste imóvel ainda estão sendo atualizadas.')">
          Ver detalhes
        </button>
        `;


  return`
    <article class="card">

      ${coverHTML(p)}

      <div class="card-body">

        ${p.adAlternative ? `<div class="nearby-alternative">Alternativa próxima · ${esc(p.neighborhood || "mesma região")}</div>` : ""}

        <div class="card-tag">
          ${p.source==="novos" ? "NOVO" : "USADO"}
        </div>

        <div class="card-title-line">
          <h3>${esc(p.name)}</h3>
          ${p.neighborhood ? `<span class="card-neighborhood-inline">· ${esc(p.neighborhood)}</span>` : ""}
        </div>

        <p class="card-address">
          ${
            esc(
              addr ||
              p.neighborhood ||
              "São Paulo"
            )
          }
        </p>

        <div class="price">
          ${money(p.value)}
        </div>

        <div class="m2">

          ${
            priceM2

              ? `${money(priceM2)} por m²`

              : "Valor por m² não informado"
          }

        </div>

        <div class="features">

          ${
            features
              .map(
                x=>
                  `
                  <span class="feature">
                    ${esc(x)}
                  </span>
                  `
              )
              .join("")
          }

        </div>

        ${
          p.condominium

            ? `
              <div class="cost-line">

                Condomínio
                ${money(p.condominium)}

                ${
                  p.iptu
                    ? ` · IPTU ${money(p.iptu)}`
                    : ""
                }

              </div>
              `

            : ""
        }

        ${reasonHTML}

        <div class="card-actions">

          ${photoButton}

          <button
            class="interest"
            type="button"
            data-property-action="interest" data-property-id="${esc(p.id)}">
            Quero conhecer
          </button>

        </div>

      </div>

    </article>
    `;
}

function updateSpecialistContext(){
  const kicker=$("specialistFloatKicker");
  if(!kicker)return;
  const n=$("catalogNeighborhood")?.value || adIntent?.neighborhood || "";
  kicker.textContent=n ? `Dúvidas sobre ${n}?` : "Precisa de ajuda?";
}

function renderCatalog(){
  updateSpecialistContext();

  /*
    Não renderiza catálogo vazio durante a carga.
  */
  if(!inventoryReady){

    if($("catalogStatus")){
      $("catalogStatus").textContent=
        inventoryLoadError
          ? "Não foi possível atualizar o estoque agora."
          : "Carregando imóveis...";
    }

    if($("catalogGrid")){
      $("catalogGrid").innerHTML=`
        <div class="empty">
          <h3>${inventoryLoadError ? "Estoque temporariamente indisponível" : "Carregando estoque"}</h3>
          <p>${inventoryLoadError ? "Atualize a página em alguns instantes." : "Estamos carregando os imóveis disponíveis."}</p>
        </div>
      `;
    }

    return;
  }


  const catalogSource=
    $("catalogSource")?.value || "todos";

  if(catalogSource==="usados" && !usedInventoryLoaded){
    loadUsedInventory().catch(()=>{});

    if($("catalogStatus")){
      $("catalogStatus").textContent="Carregando imóveis usados...";
    }

    if($("catalogGrid")){
      $("catalogGrid").innerHTML=`
        <div class="empty">
          <h3>Carregando imóveis usados</h3>
          <p>O catálogo de usados está entrando em segundo plano.</p>
        </div>
      `;
    }

    return;
  }

  if($("catalogCity")){
    $("catalogCity").value=activeCity;
  }

  if($("catalogState")){
    $("catalogState").value=activeState;
  }

  const catalogSort=
    $("catalogSort")?.value || "price_asc";

  /*
    Mantém sourceMode coerente com a busca do catálogo
    para tracking e interações posteriores.
  */
  sourceMode=catalogSource;

  const q=
    norm(
      $("catalogSearch").value
    );


  const n=
    $("catalogNeighborhood").value;


  const type=
    $("catalogType").value;


  const minP=
    numberBR(
      $("minPrice").value
    );


  const maxP=
    numberBR(
      $("maxPrice").value
    );


  const beds=
    $("catalogBedrooms").value;


  const areaMin=
    numberBR(
      $("minArea").value
    );


  const parking=
    $("catalogParking").value;


  const condo=
    numberBR(
      $("maxCondo").value
    );


  const iptu=
    numberBR(
      $("maxIptu").value
    );


  const list=
    properties.filter(
      p=>{

        const searchable=
          norm(
            [
              p.id,
              p.name,
              p.neighborhood,
              p.address,
              p.unit,
              p.description
            ].join(" ")
          );


        const cityOk=
          !p.city ||
          norm(p.city)===norm(activeCity);

        const stateOk=
          !p.state ||
          String(p.state).toUpperCase()===activeState;

        return(

          cityOk

          &&

          stateOk

          &&

          (
            catalogSource==="todos" ||
            (
              catalogSource==="novos"
                ? p.source==="novos"
                : p.source!=="novos"
            )
          )

          &&

          (!q ||
            searchable.includes(q))

          &&

          (!n ||
            p.neighborhood===n)

          &&

          (!catalogRegion ||
            propertyMatchesRegion(p,catalogRegion))

          &&

          (!type ||
            p.type===type)

          &&

          (!minP ||
            p.value>=minP)

          &&

          (!maxP ||
            p.value<=maxP)

          &&

          (
            !beds ||
            p.bedrooms>=Number(beds)
          )

          &&

          (!areaMin ||
            p.area>=areaMin)

          &&

          (
            !parking ||

            (
              parking==="0"

                ? p.parking===0

                : p.parking>=
                  Number(parking)
            )
          )

          &&

          (
            !condo ||

            (
              p.condominium>0 &&
              p.condominium<=condo
            )
          )

          &&

          (
            !iptu ||

            (
              p.iptu>0 &&
              p.iptu<=iptu
            )
          )

        );
      }
    );


  /*
    ORDENAÇÃO DO CATÁLOGO
    Padrão: mais barato → mais caro.
    Imóveis sem preço vão para o final.
  */
  list.sort((a,b)=>{

    const valueA=
      Number(a.value || 0);

    const valueB=
      Number(b.value || 0);

    const areaA=
      Number(a.area || 0);

    const areaB=
      Number(b.area || 0);


    if(catalogSort==="price_desc"){

      if(!valueA && !valueB)return 0;
      if(!valueA)return 1;
      if(!valueB)return -1;

      return valueB - valueA;

    }


    if(catalogSort==="area_desc"){

      if(!areaA && !areaB)return 0;
      if(!areaA)return 1;
      if(!areaB)return -1;

      return areaB - areaA;

    }


    if(catalogSort==="area_asc"){

      if(!areaA && !areaB)return 0;
      if(!areaA)return 1;
      if(!areaB)return -1;

      return areaA - areaB;

    }


    /*
      price_asc — padrão
      Regra atual do catálogo:
      R$ 0,00 aparece primeiro e depois os demais preços em ordem crescente.
    */
    return valueA - valueB;

  });


  const usedFilteredCount=list.filter(p=>p.source!=="novos").length;
  const sourceForStatus=$("catalogSource")?.value || "todos";
  let totalAvailable=list.length;
  if(sourceForStatus==="novos" || sourceForStatus==="usados"){
    totalAvailable=newCatalogTotal || list.length;
  }else if(sourceForStatus==="todos"){
    totalAvailable=newCatalogTotal || list.length;
  }

  $("catalogStatus").textContent=`${list.length} exibidos${totalAvailable>list.length ? ` · ${totalAvailable} encontrados` : ""}`;

  const loadMoreButton=$("catalogLoadMore");
  if(loadMoreButton){
    const canLoadMore=newCatalogHasMore;
    loadMoreButton.style.display=canLoadMore ? "" : "none";
    loadMoreButton.disabled=newCatalogLoading;
    loadMoreButton.textContent=newCatalogLoading ? "CARREGANDO..." : "CARREGAR MAIS 30";
  }


  $("catalogGrid")
    .innerHTML=
      list.length

        ? list
            .map(
              p=>
                card(
                  p,
                  false
                )
            )
            .join("")

        : `
          <div class="empty">

            <h3>
              ${newCatalogTotal>0 ? "Carregando resultados compatíveis" : "Nenhum imóvel encontrado"}
            </h3>

            <p>
              ${newCatalogTotal>0
                ? "Existem imóveis nesta busca. Carregue mais resultados para continuar."
                : "Ajuste os filtros para ampliar a busca."}
            </p>

          </div>
          `;

  if(
    typeof refreshPushAlertCTA==="function"
  ){
    refreshPushAlertCTA();
  }
}

function updateCatalogUrl(){

  const url=
    new URL(window.location.href);

  /*
    Remove somente filtros do catálogo.
    UTMs, GCLID, GBRAID, WBRAID e outros parâmetros
    de atribuição permanecem intactos.
  */
  CATALOG_QUERY_KEYS.forEach(
    key=>url.searchParams.delete(key)
  );

  url.searchParams.set(
    "modo",
    "explorar"
  );

  url.searchParams.set(
    "cidade",
    activeCity
  );

  url.searchParams.set(
    "estado",
    activeState
  );

  const region=
    catalogRegion || "";

  const neighborhood=
    $("catalogNeighborhood")?.value || "";

  const search=
    clean(
      $("catalogSearch")?.value || ""
    );

  const source=
    $("catalogSource")?.value || "todos";

  const type=
    $("catalogType")?.value || "";

  const sort=
    $("catalogSort")?.value || "price_asc";

  const minPrice=
    numberBR(
      $("minPrice")?.value || ""
    );

  const maxPrice=
    numberBR(
      $("maxPrice")?.value || ""
    );

  const bedrooms=
    $("catalogBedrooms")?.value || "";

  const minArea=
    numberBR(
      $("minArea")?.value || ""
    );

  const parking=
    $("catalogParking")?.value || "";

  const maxCondo=
    numberBR(
      $("maxCondo")?.value || ""
    );

  const maxIptu=
    numberBR(
      $("maxIptu")?.value || ""
    );


  if(region){
    url.searchParams.set(
      "regiao",
      region
    );
  }

  if(neighborhood){
    url.searchParams.set(
      "bairro",
      neighborhood
    );
  }

  if(search){
    url.searchParams.set(
      "busca",
      search
    );
  }

  if(
    source &&
    source!=="todos"
  ){
    url.searchParams.set(
      "source",
      source
    );
  }

  if(type){
    url.searchParams.set(
      "tipo",
      type
    );
  }

  if(
    sort &&
    sort!=="price_asc"
  ){
    url.searchParams.set(
      "ordem",
      sort
    );
  }

  if(minPrice){
    url.searchParams.set(
      "valor_min",
      String(minPrice)
    );
  }

  if(maxPrice){
    url.searchParams.set(
      "valor_max",
      String(maxPrice)
    );
  }

  if(bedrooms){
    url.searchParams.set(
      "dormitorios",
      bedrooms
    );
  }

  if(minArea){
    url.searchParams.set(
      "area_min",
      String(minArea)
    );
  }

  if(parking){
    url.searchParams.set(
      "vagas",
      parking
    );
  }

  if(maxCondo){
    url.searchParams.set(
      "condominio_max",
      String(maxCondo)
    );
  }

  if(maxIptu){
    url.searchParams.set(
      "iptu_max",
      String(maxIptu)
    );
  }


  history.replaceState(
    {
      ...(history.state || {}),
      ynteligenciaView:"catalog"
    },
    "",
    url.pathname +
    url.search +
    url.hash
  );

  return url.toString();
}

function loadCatalogFromUrl(){

  const params=
    new URLSearchParams(
      window.location.search
    );

  if(
    (
      params.get("modo") ||
      ""
    ).toLowerCase()!=="explorar"
  ){
    return false;
  }


  /*
    0. Localização
  */
  activeCity=
    cleanAdParam(
      params.get("cidade") ||
      params.get("city") ||
      activeCity ||
      "São Paulo"
    ) || "São Paulo";

  activeState=
    String(
      params.get("estado") ||
      params.get("state") ||
      activeState ||
      "SP"
    )
    .trim()
    .toUpperCase() || "SP";

  if($("catalogCity")){
    $("catalogCity").value=activeCity;
  }

  if($("catalogState")){
    $("catalogState").value=activeState;
  }


  /*
    1. Região
  */
  catalogRegion=
    params.get("regiao") || "";

  document
    .querySelectorAll(
      ".catalog-region-btn"
    )
    .forEach(btn=>{

      btn.classList.toggle(
        "selected",
        (btn.dataset.region || "") ===
        catalogRegion
      );

    });


  /*
    2. Reconstrói a lista de bairros
    antes de selecionar o bairro salvo na URL.
  */
  fillCatalogNeighborhoodsForRegion(
    catalogRegion
  );


  const setValue=(id,value)=>{
    const el=$(id);
    if(!el)return;
    el.value=value ?? "";
  };


  const urlNeighborhood=params.get("bairro") || "";
  if(urlNeighborhood && $("catalogNeighborhood") && ![...$("catalogNeighborhood").options].some(option=>norm(option.value)===norm(urlNeighborhood))){
    $("catalogNeighborhood").insertAdjacentHTML("beforeend",`<option value="${esc(urlNeighborhood)}">${esc(urlNeighborhood)}</option>`);
  }
  setValue("catalogNeighborhood",urlNeighborhood);

  setValue(
    "catalogSearch",
    params.get("busca") || ""
  );

  setValue(
    "catalogType",
    params.get("tipo") || ""
  );

  const requestedSort=
    (
      params.get("ordem") ||
      "price_asc"
    ).toLowerCase();

  const safeSort=
    [
      "price_asc",
      "price_desc",
      "area_desc",
      "area_asc"
    ].includes(requestedSort)
      ? requestedSort
      : "price_asc";

  setValue(
    "catalogSort",
    safeSort
  );

  setValue(
    "minPrice",
    params.get("valor_min") || ""
  );

  setValue(
    "maxPrice",
    params.get("valor_max") || ""
  );

  setValue(
    "catalogBedrooms",
    params.get("dormitorios") || ""
  );

  setValue(
    "minArea",
    params.get("area_min") || ""
  );

  setValue(
    "catalogParking",
    params.get("vagas") || ""
  );

  setValue(
    "maxCondo",
    params.get("condominio_max") || ""
  );

  setValue(
    "maxIptu",
    params.get("iptu_max") || ""
  );


  const requestedSource=
    (
      params.get("source") ||
      "todos"
    ).toLowerCase();

  const safeSource=
    [
      "todos",
      "novos",
      "usados"
    ].includes(requestedSource)
      ? requestedSource
      : "todos";

  setValue(
    "catalogSource",
    safeSource
  );

  sourceMode=
    safeSource;


  /*
    3. Abre diretamente no Explorar.
  */
  document.body
    .classList
    .remove(
      "home-mode",
      "match-mode",
      "match-results-mode",
      "ad-match-mode"
    );

  $("results")
    ?.classList
    .remove("visible");

  $("catalog")
    ?.classList
    .add("visible");

  setRefineMatchOpen(false);
  setFiltersOpen(false);

  executeCatalogSearch();


  /*
    4. Mantém a URL normalizada com os filtros efetivamente aplicados.
  */
  updateCatalogUrl();


  setTimeout(
    ()=>{

      $("explore")
        ?.scrollIntoView({
          behavior:"instant",
          block:"start"
        });

    },
    60
  );


  return true;
}

function renderCatalogAndUpdateUrl(){

  renderCatalog();

  if(
    $("catalog")
      ?.classList
      .contains("visible")
  ){
    updateCatalogUrl();
  }
}

async function applyCatalogLocation(){
  activeCity=clean($("catalogCity")?.value || "São Paulo") || "São Paulo";
  activeState=String($("catalogState")?.value || "SP").trim().toUpperCase() || "SP";
  resetCatalogState(false);
  await fillCatalogNeighborhoodsForRegion(
    catalogRegion,
    {full:true}
  );
  await fetchNewCatalogPage({reset:true});
  inventoryReady=true;
  inventoryLoading=false;
  inventoryLoadError=false;
  $("catalog")?.classList.add("visible");
  renderCatalog();
  updateCatalogUrl();
}

async function executeCatalogSearch(){
  /*
    Fecha qualquer estado legado de filtros antes de mostrar resultados.
    No mobile isso evita resultado "abrir por trás" do formulário.
  */
  if(typeof setFiltersOpen==="function"){
    setFiltersOpen(false);
  }

  $("catalog")?.classList.add("visible");

  activeCity=
    clean(
      $("catalogCity")?.value ||
      activeCity
    ) || activeCity;

  activeState=
    String(
      $("catalogState")?.value ||
      activeState
    )
      .trim()
      .toUpperCase() ||
    activeState;

  if($("catalogStatus")){
    $("catalogStatus").textContent=
      "Carregando imóveis...";
  }

  if($("catalogLoadMore")){
    $("catalogLoadMore").style.display=
      "none";
  }

  await fetchNewCatalogPage({
    reset:true
  });

  inventoryReady=true;
  inventoryLoading=false;
  inventoryLoadError=false;

  renderCatalog();
  updateCatalogUrl();

  /*
    FUNIL DO APP:
    registra quais imóveis foram realmente entregues pela busca.
    Isso substitui a dependência de match_generated para acessos
    que entram diretamente no catálogo através de campanha.
  */
  try{
    const delivered=
      Array.isArray(newPropertiesCache)
        ? newPropertiesCache.slice(0,12)
        : [];

    supabaseTrack(
      "catalog_search_results",
      {
        filters:{
          city:
            activeCity||"",

          state:
            activeState||"",

          region:
            catalogRegion||"",

          neighborhood:
            clean(
              $("catalogNeighborhood")?.value ||
              ""
            ),

          search:
            clean(
              $("catalogSearch")?.value ||
              ""
            ),

          source:
            clean(
              $("catalogSource")?.value ||
              "todos"
            ),

          type:
            clean(
              $("catalogType")?.value ||
              ""
            ),

          bedrooms:
            Number(
              $("catalogBedrooms")?.value ||
              0
            ) || 0,

          min_price:
            parseBRLCurrencyInput(
              $("catalogMinPrice")?.value
            ) || 0,

          max_price:
            parseBRLCurrencyInput(
              $("catalogMaxPrice")?.value
            ) || 0
        },

        results_count:
          Number(newCatalogTotal) ||
          delivered.length,

        delivered_count:
          delivered.length,

        delivered:
          delivered.map(
            (item,index)=>({
              position:
                index+1,

              property_id:
                String(item.id||""),

              property_name:
                item.name||"",

              neighborhood:
                item.neighborhood||"",

              value:
                Number(item.value)||0,

              bedrooms:
                Number(item.bedrooms)||0,

              area:
                Number(item.area)||0,

              source:
                item.source||""
            })
          )
      }
    );

  }catch(error){
    console.warn(
      "CATALOG_SEARCH_TRACKING_ERROR",
      error
    );
  }

  $("catalog")?.scrollIntoView({
    behavior:"smooth",
    block:"start"
  });
}

function resetCatalogState(render=true){
  [
    "catalogSearch",
    "minPrice",
    "maxPrice",
    "minArea",
    "maxCondo",
    "maxIptu"
  ].forEach(id=>{ if($(id)) $(id).value=""; });

  [
    "catalogNeighborhood",
    "catalogType",
    "catalogBedrooms",
    "catalogParking"
  ].forEach(id=>{ if($(id)) $(id).value=""; });

  if($("catalogSource")) $("catalogSource").value="todos";
  if($("catalogSort")) $("catalogSort").value="price_asc";
  sourceMode="todos";

  catalogRegion="";
  document.querySelectorAll(".catalog-region-btn").forEach(btn=>{
    btn.classList.toggle("selected", !btn.dataset.region);
  });
  fillCatalogNeighborhoodsForRegion("");

  if(
    render &&
    $("catalog")?.classList.contains("visible")
  ){
    renderCatalog();
    updateCatalogUrl();
  }
}

function clearAdEntryIntent(){
  adIntent.neighborhood="";
  adIntent.bedrooms=0;
  adIntent.minPrice=0;
  adIntent.maxPrice=0;
  adIntent.active=false;
  syncPaidClickContextUi();

  document.body.classList.remove("ad-match-mode");
  $("results")?.classList.remove("visible");
  setRefineMatchOpen(false);

  const url=new URL(window.location.href);
  AD_INTENT_QUERY_KEYS.forEach(key=>url.searchParams.delete(key));
  history.replaceState(
    {...(history.state||{}),ynteligenciaView:"catalog"},
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

function updateAdMatchUI(){
  document.body.classList.toggle("ad-match-mode",Boolean(adIntent.active));

  const regionKey=currentRefineRegionKey();
  const regionName=regionDisplayName(regionKey);
  const known=$("refineMatchKnown");

  if(known){
    const parts=[];
    if(regionKey) parts.push(`<span>📍 ${esc(regionName)}</span>`);
    if(profile.types?.length) parts.push(`<span>⌂ ${esc(profile.types.join(", "))}</span>`);
    if(adIntent.neighborhood) parts.push(`<span>◎ ${esc(adIntent.neighborhood)}</span>`);
    known.innerHTML=parts.join("");
  }

  const neighborhoodSelect=$("refineNeighborhood");
  if(neighborhoodSelect){
    const availableProperties=regionKey
      ? properties.filter(p=>propertyMatchesRegion(p,regionKey))
      : properties;

    const neighborhoods=[...new Set(
      availableProperties
        .map(p=>clean(p.neighborhood))
        .filter(Boolean)
    )].sort((a,b)=>a.localeCompare(b,"pt-BR"));

    neighborhoodSelect.innerHTML=
      `<option value="">Todos os bairros de ${esc(regionName)}</option>` +
      neighborhoods
        .map(value=>`<option value="${esc(value)}">${esc(value)}</option>`)
        .join("");

    const current=adIntent.neighborhood||"";
    const currentOption=neighborhoods.find(value=>norm(value)===norm(current));
    neighborhoodSelect.value=currentOption || "";
  }

  const neighborhoodLabel=$("refineNeighborhoodLabel");
  if(neighborhoodLabel){
    const textNode=[...neighborhoodLabel.childNodes].find(node=>node.nodeType===Node.TEXT_NODE);
    if(textNode) textNode.nodeValue=`Bairro · ${regionName}\n        `;
  }

  const defaultBedrooms=adIntent.bedrooms || Number(profile.bedrooms||0) || 0;
  if($("refineBedrooms")) $("refineBedrooms").value=defaultBedrooms ? String(defaultBedrooms) : "";

  const min=adIntent.minPrice || Number(profile.budgetMin||0) || 0;
  const max=adIntent.maxPrice || Number(profile.budgetMax||0) || 0;
  const rangeSelect=$("refineBudgetRange");
  if(rangeSelect){
    const exact=`${min}|${max}`;
    const hasExact=[...rangeSelect.options].some(option=>option.value===exact);
    rangeSelect.value=hasExact ? exact : "";
  }
}

function applyHeroInventoryPhoto(){
  const featured=
    properties.find(property=>photoList(property).length);
  const photo=
    featured ? photoList(featured)[0] : "";
  if(photo){
    document.documentElement.style.setProperty(
      "--hero-photo",
      `url("${photo.replace(/"/g,"%22")}")`
    );
  }
}


;
// SOURCE: assets/js/ui/property-detail.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function detailValue(v){
  if(v===undefined || v===null || v==="")return "";
  if(typeof v==="object")return clean(v.name || v.title || v.label || v.description || "");
  return clean(v);
}

function detailDate(v){
  if(!v)return "";
  const raw=String(v).trim();
  const d=new Date(raw.length===10 ? raw+"T12:00:00" : raw);
  if(Number.isNaN(d.getTime()))return clean(raw);
  return new Intl.DateTimeFormat("pt-BR",{month:"short",year:"numeric"}).format(d).replace(" de ","/");
}

function detailFeatureNames(list){
  if(!Array.isArray(list))return [];
  const out=[];
  list.forEach(item=>{
    let label="";
    if(typeof item==="string")label=clean(item);
    else if(item && typeof item==="object")label=clean(item.name || item.title || item.label || item.description || item.feature || "");
    if(label && !out.includes(label))out.push(label);
  });
  return out.slice(0,18);
}

function detailRow(label,value){
  const v=detailValue(value);
  return v ? `<div class="detail-tech-row"><span>${esc(label)}</span><strong>${esc(v)}</strong></div>` : "";
}

function moveDetailPhoto(delta){
  const track=document.querySelector("#photoModal .detail-gallery-track");
  if(!track)return;
  const width=track.clientWidth || 1;
  const current=Math.round(track.scrollLeft/width);
  const total=track.querySelectorAll(".detail-gallery-slide").length;
  const next=Math.max(0,Math.min(total-1,current+delta));
  track.scrollTo({left:next*width,behavior:"smooth"});
}

function goDetailPhoto(index){
  const track=document.querySelector("#photoModal .detail-gallery-track");
  if(!track)return;
  track.scrollTo({left:index*track.clientWidth,behavior:"smooth"});
}

function updateDetailGallery(){
  const modal=document.getElementById("photoModal");
  const track=modal?.querySelector(".detail-gallery-track");
  if(!track)return;
  const slides=track.querySelectorAll(".detail-gallery-slide");
  const index=Math.max(0,Math.min(slides.length-1,Math.round(track.scrollLeft/(track.clientWidth||1))));
  const counter=modal.querySelector(".detail-gallery-counter");
  if(counter)counter.textContent=`${index+1} / ${slides.length}`;
  modal.querySelectorAll(".detail-gallery-dot").forEach((dot,i)=>dot.classList.toggle("active",i===index));
}

function detailUpdatedLabel(p,building,typology){
  const candidates=[building?.last_updated_pricetable_at,building?.updated_at,typology?.updated_at,p?.rawData?.updated_at].filter(Boolean);
  if(!candidates.length)return "Atualizado recentemente";
  const parsed=candidates.map(v=>new Date(v)).filter(d=>!Number.isNaN(d.getTime())).sort((a,b)=>b-a);
  if(!parsed.length)return "Atualizado recentemente";
  const latest=parsed[0],now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const date=new Date(latest.getFullYear(),latest.getMonth(),latest.getDate());
  const days=Math.max(0,Math.floor((today-date)/86400000));
  if(days===0)return "Atualizado hoje";
  if(days===1)return "Atualizado ontem";
  return `Atualizado há ${days} dias`;
}

function renderDetailSimilar(base,modal){
  const grid=modal?.querySelector("#detailSimilarGrid");
  const section=modal?.querySelector("#detailSimilarSection");
  if(!grid || !section || !base)return;

  const n=norm(base.neighborhood||"");
  const beds=Number(base.bedrooms)||0;
  const price=Number(base.value)||0;

  const ranked=(properties||[])
    .filter(x=>String(x.id)!==String(base.id))
    .map(x=>{
      let score=0;
      if(n && norm(x.neighborhood||"")===n)score+=6;
      if(beds && Number(x.bedrooms)===beds)score+=3;
      const xv=Number(x.value)||0;
      if(price && xv){
        const d=Math.abs(xv-price)/price;
        if(d<=.15)score+=3;
        else if(d<=.30)score+=1;
      }
      if(String(x.source||"")===String(base.source||""))score+=1;
      return {x,score};
    })
    .filter(v=>v.score>=5)
    .sort((a,b)=>b.score-a.score)
    .slice(0,4);

  if(!ranked.length){section.style.display="none";return}

  grid.innerHTML=ranked.map(({x})=>{
    const imgs=photoList(x);
    const img=imgs[0]||"";
    return `
      <button type="button" class="detail-similar-card" data-property-id="${esc(String(x.id||""))}">
        ${img?`<img src="${esc(img)}" alt="${esc(x.name||"Imóvel")}" loading="lazy">`:""}
        <span>
          <strong>${esc(x.name||"Imóvel")}</strong>
          <em>${esc(x.neighborhood||"")}${x.bedrooms?` · ${x.bedrooms} dorms.`:""}${x.area?` · ${area(x.area)} m²`:""}</em>
          <b>${Number(x.value)>0?money(x.value):"Consulte"}</b>
        </span>
      </button>`;
  }).join("");

  grid.querySelectorAll("[data-property-id]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const pid=btn.dataset.propertyId;
      try{gtag("event","similar_property_click",{from_property_id:String(base.id||""),property_id:String(pid||"")})}catch(error){}
      modal.remove();
      aiRememberOpenedProperty(propertyForInteraction(pid));
      showPhotoModal(pid);
    });
  });
}

function yntIsPaidDirectPropertyEntry(){
  // Compatibilidade legada; o scheduler de teste não abre IA automaticamente.
  return true;
}

function scheduleAiAssistantForProperty(p,modal){
  // Test edition: retain the hook, cancel stale timers, never auto-open a chat/tab.
  // Help is available through the existing manual CONVERSAR COM A IA action.
  clearTimeout(aiAssistantTriggerTimer);
  aiAssistantTriggerTimer=null;
}

function extractAllPropertyImages(p,raw){
  const result=[];
  const seen=new Set();

  function add(url,meta=""){
    if(typeof url!=="string")return;
    url=clean(url);
    if(!validURL(url) || seen.has(url))return;
    // Aceita também Google Drive/thumbnail. As fotos dos usados no photos.json
    // usam URLs como drive.google.com/thumbnail?... e não possuem extensão .jpg.
    if(!/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(url) &&
       !/image|photo|picture|media|cdn|thumbnail|drive\.google\.com|orulo|cloudinary|amazonaws/i.test(url))return;
    seen.add(url);
    result.push({url,meta:clean(meta)});
  }

  function walk(value,path="",depth=0,context=""){
    if(value==null || depth>11)return;

    if(typeof value==="string"){
      if(/^https?:\/\//i.test(value) &&
         /photo|image|picture|gallery|media|plant|planta|floor|layout|typolog|facade|fachada/i.test(path)){
        add(value,context || path);
      }
      return;
    }

    if(Array.isArray(value)){
      value.forEach((item,i)=>walk(item,`${path}[${i}]`,depth+1,context));
      return;
    }

    if(typeof value==="object"){
      const localMeta=[
        value.title,value.name,value.label,value.caption,value.description,
        value.category,value.type,value.kind,value.tag
      ].filter(v=>typeof v==="string").join(" · ");

      Object.entries(value).forEach(([key,val])=>{
        const next=path?`${path}.${key}`:key;
        if(typeof val==="string" && /^https?:\/\//i.test(val)){
          if(/url|src|image|photo|picture|original|large|medium|file/i.test(key) ||
             /photo|image|picture|gallery|media|plant|planta|floor|layout|typolog/i.test(next)){
            add(val,localMeta || context || next);
          }
        }else{
          walk(val,next,depth+1,localMeta || context);
        }
      });
    }
  }

  // Primeiro, TODAS as fotos que o app já conhece.
  // Nos usados, photoList() lê prioritariamente photos.json.
  try{
    const knownPhotos=photoList(p)||[];
    knownPhotos.forEach((url,i)=>add(url,`Foto ${i+1}`));
  }catch(error){
    console.warn("Falha ao carregar fotos conhecidas do imóvel:",error);
  }

  // Depois, todas as estruturas disponíveis.
  walk(p?.photos,"property.photos",0);
  walk(p?.images,"property.images",0);
  walk(p?.gallery,"property.gallery",0);
  walk(p?.floorplans,"property.floorplans",0);
  walk(p?.plans,"property.plans",0);
  walk(p?.typologies,"property.typologies",0);
  walk(raw,"raw_data",0);

  return result;
}

async function openAllPropertyGallery(...args){
  await window.YntFeatureLoader.load('property-detail');
  return openAllPropertyGallery.apply(this,args);
}

function extractFloorplans(raw,p=null){
  const found=[];
  const seen=new Set();

  function add(value){
    if(typeof value!=="string")return;
    const url=clean(value);
    if(!validURL(url) || seen.has(url))return;
    if(!/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(url) && !/image|photo|media|cdn|orulo/i.test(url))return;
    seen.add(url);
    found.push(url);
  }

  function objectText(obj){
    if(!obj || typeof obj!=="object")return "";
    return Object.entries(obj)
      .filter(([k,v])=>typeof v==="string" && !/^https?:\/\//i.test(v))
      .map(([k,v])=>`${k} ${v}`)
      .join(" ");
  }

  function collectUrls(obj){
    if(!obj || typeof obj!=="object")return;
    Object.entries(obj).forEach(([k,v])=>{
      if(typeof v==="string" && /^https?:\/\//i.test(v)){
        if(/url|image|photo|picture|file|src|original|large|medium/i.test(k))add(v);
      }else if(Array.isArray(v)){
        v.forEach(item=>{
          if(typeof item==="string" && /^https?:\/\//i.test(item))add(item);
          else if(item && typeof item==="object")collectUrls(item);
        });
      }else if(v && typeof v==="object"){
        collectUrls(v);
      }
    });
  }

  function walk(value,path="",depth=0){
    if(value==null || depth>10)return;

    if(Array.isArray(value)){
      value.forEach((item,index)=>walk(item,`${path}[${index}]`,depth+1));
      return;
    }

    if(typeof value!=="object")return;

    const context=`${path} ${objectText(value)}`;
    const isPlant=/\b(planta|plantas|floor\s*plan|floorplan|blueprint|layout|tipologia|typology)\b/i.test(context);

    if(isPlant)collectUrls(value);

    Object.entries(value).forEach(([key,val])=>{
      const next=path ? `${path}.${key}` : key;
      if(typeof val==="string"){
        if(/\b(planta|plantas|floor.?plan|blueprint|layout|tipologia|typology)\b/i.test(next) &&
           /^https?:\/\//i.test(val)) add(val);
      }else{
        walk(val,next,depth+1);
      }
    });
  }

  // Procura tanto no raw_data quanto em estruturas já normalizadas do imóvel.
  walk(raw,"raw_data",0);
  if(p){
    walk(p,"property",0);
    walk(p.photos,"property.photos",0);
    walk(p.images,"property.images",0);
    walk(p.floorplans,"property.floorplans",0);
    walk(p.plans,"property.plans",0);
    walk(p.typologies,"property.typologies",0);
  }

  return found.slice(0,12);
}

function propertyMapQuery(p,addressData){
  const lat=Number(
    addressData?.latitude ??
    addressData?.lat ??
    p?.rawData?.latitude ??
    p?.rawData?.lat
  );
  const lng=Number(
    addressData?.longitude ??
    addressData?.lng ??
    addressData?.lon ??
    p?.rawData?.longitude ??
    p?.rawData?.lng ??
    p?.rawData?.lon
  );

  if(Number.isFinite(lat) && Number.isFinite(lng) && lat!==0 && lng!==0){
    return `${lat},${lng}`;
  }

  return clean([
    p?.address,
    p?.neighborhood,
    addressData?.city || p?.city || "São Paulo",
    addressData?.state || addressData?.uf || p?.state || "SP"
  ].filter(Boolean).join(", "));
}

function openFloorplan(url,p){
  const old=document.getElementById("floorplanLightbox");
  if(old)old.remove();

  try{
    gtag("event","floorplan_view",{
      property_id:String(p?.id||""),
      property_name:p?.name||"",
      neighborhood:p?.neighborhood||""
    });
  }catch(error){}

  supabaseTrack("floorplan_view",{
    property_id:String(p?.id||""),
    property_name:p?.name||"",
    neighborhood:p?.neighborhood||""
  });

  const box=document.createElement("div");
  box.id="floorplanLightbox";
  box.className="floorplan-lightbox";
  box.innerHTML=`
    <button type="button" aria-label="Fechar">×</button>
    <img src="${esc(url)}" alt="Planta do imóvel">
  `;
  box.querySelector("button")?.addEventListener("click",()=>box.remove());
  box.addEventListener("click",e=>{if(e.target===box)box.remove()});
  document.body.appendChild(box);
}

function extractPropertyOptions(raw,p=null){
  const options=[];
  const seen=new Set();

  function add(label){
    label=clean(label);
    if(!label || label.length>120)return;
    const key=norm(label);
    if(!key || seen.has(key))return;
    seen.add(key);
    options.push(label);
  }

  const candidates=[
    raw?.typologies, raw?.typology, raw?.units, raw?.unit_types,
    raw?.building?.typologies, raw?.building?.units,
    p?.typologies, p?.rawData?.typologies
  ];

  candidates.forEach(list=>{
    if(!list)return;
    (Array.isArray(list)?list:[list]).forEach(item=>{
      if(typeof item==="string"){add(item);return}
      if(!item || typeof item!=="object")return;
      const areaValue=item.area || item.private_area || item.usable_area;
      const bedrooms=item.bedrooms ?? item.rooms;
      const suites=item.suites;
      const parking=item.parking_spaces ?? item.parking;
      const parts=[];
      if(item.name || item.title || item.label)parts.push(item.name || item.title || item.label);
      if(areaValue)parts.push(`${area(areaValue)} m²`);
      if(bedrooms)parts.push(`${bedrooms} dorm.`);
      if(suites)parts.push(`${suites} suíte${Number(suites)>1?"s":""}`);
      if(parking)parts.push(`${parking} vaga${Number(parking)>1?"s":""}`);
      if(parts.length)add(parts.join(" · "));
    });
  });

  return options.slice(0,10);
}

function closePropertyDetail({fromPopState=false}={}){
  clearTimeout(aiAssistantTriggerTimer);
  document.getElementById("aiAssistantTrigger")?.remove();
  document.getElementById("aiAssistantShell")?.classList.remove("open");

  const modal=
    document.getElementById(
      "photoModal"
    );

  const activeJourney=
    YNT_ACTIVE_PROPERTY_JOURNEY;

  /*
    Registra o fechamento UMA vez.
    Assim a jornada deixa de parecer que terminou no property_view.
  */
  if(
    modal &&
    activeJourney?.property_id
  ){
    const durationSeconds=
      activeJourney.opened_at_ms
        ? Math.max(
            0,
            Math.round(
              (
                Date.now() -
                activeJourney.opened_at_ms
              ) / 1000
            )
          )
        : 0;

    try{
      gtag(
        "event",
        "property_close",
        {
          property_id:
            activeJourney.property_id,

          property_name:
            activeJourney.property_name ||
            "",

          engagement_time_seconds:
            durationSeconds
        }
      );
    }catch(error){}

    supabaseTrack(
      "property_close",
      {
        property_id:
          activeJourney.property_id,

        property_uuid:
          activeJourney.property_uuid || "",

        property_name:
          activeJourney.property_name ||
          "",

        neighborhood:
          activeJourney.neighborhood ||
          "",

        property_value:
          Number(
            activeJourney.property_value
          ) || 0,

        inventory_source:
          activeJourney.inventory_source ||
          "",

        engagement_time_seconds:
          durationSeconds,

        close_method:
          fromPopState
            ? "browser_back"
            : "ui_close"
      }
    );

    /*
      O retorno ao catálogo também é um passo comercial importante:
      mostra que o comprador continuou comparando opções.
    */
    supabaseTrack(
      "catalog_return",
      {
        from_property_id:
          activeJourney.property_id,

        property_uuid:
          activeJourney.property_uuid || "",

        from_property_name:
          activeJourney.property_name ||
          "",

        engagement_time_seconds:
          durationSeconds
      }
    );
  }

  YNT_ACTIVE_PROPERTY_JOURNEY=null;

  if(modal){
    modal.remove();
  }

  if(aiResumeChatAfterDetail){
    aiResumeChatAfterDetail=false;
    const shell=document.getElementById("aiAssistantShell");
    if(shell){
      shell.classList.add("open");
      document.body.style.overflow="hidden";
    }
  }else{
    document.body.style.overflow="";
  }

  if(
    !fromPopState &&
    history.state
      ?.ynteligenciaPropertyDetail
  ){
    history.back();
  }

  notePaidSignal("returned_to_results");
}

function developmentBuildingId(p){
  const raw=
    p?.rawData && typeof p.rawData==="object"
      ? p.rawData
      : (
          p?.raw_data && typeof p.raw_data==="object"
            ? p.raw_data
            : {}
        );

  const building=
    raw?.building && typeof raw.building==="object"
      ? raw.building
      : {};

  return clean(
    raw?.building_id ||
    building?.id ||
    p?.building_id ||
    ""
  );
}

function developmentFileName(file){
  return clean(
    file?.name ||
    file?.title ||
    file?.filename ||
    file?.type ||
    ""
  );
}

function findDevelopmentBook(data){
  const files=
    Array.isArray(data?.media?.files)
      ? data.media.files
      : [];

  const book=
    files.find(file=>{
      const name=
        norm(
          developmentFileName(file)
        );

      const url=
        clean(file?.url);

      return Boolean(
        url &&
        (
          /\bbook\b/.test(name) ||
          /book\s*(digital|de\s*vendas|do\s*empreendimento)?/.test(name) ||
          /\bbook\b/.test(
            norm(url)
          )
        )
      );
    });

  return book || null;
}

function developmentFeatureName(item){
  if(
    typeof item==="string"
  ){
    return clean(item);
  }

  return clean(
    item?.name ||
    item?.title ||
    item?.label ||
    item?.description ||
    ""
  );
}

function developmentVideoEmbedUrl(url){
  const value=
    clean(url);

  if(!value){
    return "";
  }

  try{
    const parsed=
      new URL(value);

    const host=
      parsed.hostname
        .replace(/^www\./,"")
        .toLowerCase();

    if(
      host==="youtube.com" ||
      host==="m.youtube.com"
    ){
      const id=
        parsed.searchParams.get("v");

      if(id){
        return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
      }

      const match=
        parsed.pathname.match(
          /\/(?:embed|shorts)\/([^/?#]+)/
        );

      if(match?.[1]){
        return `https://www.youtube.com/embed/${encodeURIComponent(match[1])}`;
      }
    }

    if(
      host==="youtu.be"
    ){
      const id=
        parsed.pathname
          .split("/")
          .filter(Boolean)[0];

      if(id){
        return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
      }
    }

    if(
      host==="vimeo.com" ||
      host==="player.vimeo.com"
    ){
      const parts=
        parsed.pathname
          .split("/")
          .filter(Boolean);

      const id=
        parts.find(
          part=>/^\d+$/.test(part)
        );

      if(id){
        return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
      }
    }
  }catch(error){}

  return "";
}

function developmentSummaryItem(
  value,
  label
){
  if(
    value===null ||
    value===undefined ||
    value===""
  ){
    return "";
  }

  return `
    <div class="development-summary-card">
      <strong>${esc(value)}</strong>
      <span>${esc(label)}</span>
    </div>
  `;
}

function renderDevelopmentRichModal(
  modal,
  p,
  data
){
  if(
    !modal ||
    !data?.success
  ){
    return;
  }

  const target=
    modal.querySelector(
      "#developmentRichSection"
    );

  if(!target){
    return;
  }

  const development=
    data.development || {};

  const summary=
    data.summary || {};

  const typologies=
    Array.isArray(data.typologies)
      ? data.typologies
      : [];

  const buildingFeatures=
    Array.isArray(data?.features?.building)
      ? data.features.building
      : [];

  const unitFeatures=
    Array.isArray(data?.features?.units)
      ? data.features.units
      : [];

  const videos=
    Array.isArray(data?.media?.videos)
      ? data.media.videos
      : [];

  const floorPlans=
    Array.isArray(data?.media?.floor_plans)
      ? data.media.floor_plans
      : [];

  const book=
    findDevelopmentBook(data);

  const video=
    videos.find(
      item=>clean(item?.url)
    ) || null;

  const videoUrl=
    clean(video?.url);

  const embedUrl=
    developmentVideoEmbedUrl(
      videoUrl
    );

  const description=
    clean(
      development.description ||
      p.description ||
      ""
    );

  const address=
    development.address &&
    typeof development.address==="object"
      ? development.address
      : {};

  const fullAddress=
    clean(
      [
        address.street_type,
        address.street,
        address.number
      ]
        .filter(Boolean)
        .join(" ")
    );

  const locationLabel=
    clean(
      [
        fullAddress,
        development.neighborhood,
        development.city,
        development.state
      ]
        .filter(Boolean)
        .join(" • ")
    );

  const areaRange=
    Number(summary.min_area)>0 &&
    Number(summary.max_area)>0
      ? (
          Number(summary.min_area)===Number(summary.max_area)
            ? `${area(summary.min_area)} m²`
            : `${area(summary.min_area)} a ${area(summary.max_area)} m²`
        )
      : "";

  const bedroomValues=
    Array.isArray(summary.bedrooms)
      ? summary.bedrooms.filter(
          item=>Number.isFinite(Number(item))
        )
      : [];

  const bedroomLabel=
    bedroomValues.length
      ? (
          bedroomValues.length===1
            ? `${bedroomValues[0]} dorm.`
            : `${bedroomValues.join(" e ")} dorms.`
        )
      : "";

  const summaryCards=[
    developmentSummaryItem(
      summary.min_price
        ? `A partir de ${money(summary.min_price)}`
        : "",
      "PREÇO"
    ),
    developmentSummaryItem(
      areaRange,
      "METRAGENS"
    ),
    developmentSummaryItem(
      bedroomLabel,
      "DORMITÓRIOS"
    ),
    developmentSummaryItem(
      summary.total_stock!==null &&
      summary.total_stock!==undefined
        ? `${summary.total_stock}`
        : "",
      "UNIDADES DISPONÍVEIS"
    )
  ]
    .filter(Boolean)
    .join("");

  const typologyHtml=
    typologies.length
      ? `
        <div class="development-typologies">
          ${typologies.map(item=>{
            const bits=[
              Number(item.bedrooms)>0
                ? `${item.bedrooms} dorm${Number(item.bedrooms)===1?"":"s"}`
                : "",
              Number(item.bathrooms)>0
                ? `${item.bathrooms} banho${Number(item.bathrooms)===1?"":"s"}`
                : "",
              Number(item.suites)>0
                ? `${item.suites} suíte${Number(item.suites)===1?"":"s"}`
                : "",
              Number(item.parking)>0
                ? `${item.parking} vaga${Number(item.parking)===1?"":"s"}`
                : "",
              item.stock!==null &&
              item.stock!==undefined
                ? `${item.stock} disp.`
                : ""
            ].filter(Boolean);

            return `
              <article class="development-typology-card">
                <div class="development-typology-card-head">
                  <div class="development-typology-area">
                    ${Number(item.area)>0 ? `${area(item.area)} m²` : "Tipologia"}
                  </div>

                  <div class="development-typology-price">
                    ${Number(item.price)>0 ? money(item.price) : "Consulte"}
                  </div>
                </div>

                ${bits.length ? `
                  <div class="development-typology-meta">
                    ${bits.map(bit=>`<span>${esc(bit)}</span>`).join("")}
                  </div>
                ` : ""}
              </article>
            `;
          }).join("")}
        </div>
      `
      : "";

  const floorPlanCards=
    floorPlans
      .map((plan,index)=>{
        const url=
          developmentFloorplanUrl(plan);

        if(!url){
          return "";
        }

        const label=
          developmentFloorplanLabel(
            plan,
            index
          );

        const planArea=
          developmentFloorplanArea(
            plan
          );

        return `
          <article class="development-floorplan-card">
            <img
              class="development-floorplan-image"
              src="${esc(url)}"
              alt="${esc(label)}"
              loading="lazy"
              data-development-floorplan="${esc(url)}"
            >

            <div class="development-floorplan-body">
              <strong>${esc(label)}</strong>

              <button
                type="button"
                data-development-floorplan="${esc(url)}">
                ${planArea>0
                  ? `VER PLANTA ${esc(planArea.toLocaleString("pt-BR"))} m²`
                  : "VER PLANTA"}
              </button>
            </div>
          </article>
        `;
      })
      .filter(Boolean)
      .join("");

  const buildingFeatureNames=
    buildingFeatures
      .map(developmentFeatureName)
      .filter(Boolean)
      .filter(
        (value,index,array)=>
          array.indexOf(value)===index
      )
      .slice(0,28);

  const unitFeatureNames=
    unitFeatures
      .map(developmentFeatureName)
      .filter(Boolean)
      .filter(
        (value,index,array)=>
          array.indexOf(value)===index
      )
      .slice(0,20);

  const featureHtml=
    buildingFeatureNames.length
      ? `
        <div class="development-feature-list">
          ${buildingFeatureNames.map(name=>`<span>${esc(name)}</span>`).join("")}
        </div>
      `
      : "";

  const unitFeatureHtml=
    unitFeatureNames.length
      ? `
        <div class="development-feature-list">
          ${unitFeatureNames.map(name=>`<span>${esc(name)}</span>`).join("")}
        </div>
      `
      : "";

  const videoHtml=
    embedUrl
      ? `
        <div class="development-video-wrap">
          <iframe
            src="${esc(embedUrl)}"
            title="${esc(video?.title || `Vídeo de ${development.name || p.name || "empreendimento"}`)}"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen>
          </iframe>
        </div>
      `
      : (
          videoUrl
            ? `
              <div class="development-media-actions">
                <a
                  class="development-action-link"
                  href="${esc(videoUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-development-video-link="true">
                  ▶ ASSISTIR VÍDEO
                </a>
              </div>
            `
            : ""
        );

  const bookMaterialHtml=
    book?.url
      ? `
        <div class="development-material-card">
          <small>Book do empreendimento</small>
          <strong>${esc(developmentFileName(book) || "Book digital")}</strong>
          <p>Material completo disponibilizado para consulta.</p>

          <a
            class="development-action-link primary"
            href="${esc(book.url)}"
            target="_blank"
            rel="noopener noreferrer"
            download
            data-development-book="true">
            ↓ BAIXAR BOOK
          </a>
        </div>
      `
      : `
        <div class="development-material-card">
          <small>Book do empreendimento</small>
          <strong>Solicitar material completo</strong>
          <p>Peça o Book atualizado e o Rafael envia pelo atendimento.</p>

          <button
            class="development-lp-cta"
            type="button"
            data-development-request="book">
            SOLICITAR BOOK
          </button>
        </div>
      `;

  const tableMaterialHtml=`
    <div class="development-material-card">
      <small>Tabela comercial</small>
      <strong>Solicitar tabela atualizada</strong>
      <p>Valores e disponibilidade podem mudar. Solicite a tabela comercial mais recente.</p>

      <button
        class="development-lp-cta"
        type="button"
        data-development-request="table">
        SOLICITAR TABELA
      </button>
    </div>
  `;

  target.innerHTML=`
    <div class="development-lp-intro">
      <div class="development-lp-intro-copy">
        <div class="detail-section-title">Empreendimento completo</div>
        <h3>${esc(development.name || p.name || "Conheça o empreendimento")}</h3>
        ${locationLabel ? `<p>${esc(locationLabel)}</p>` : ""}
      </div>
    </div>

    ${summaryCards ? `
      <div class="development-summary-grid">
        ${summaryCards}
      </div>
    ` : ""}

    <div class="development-lp-cta-row">
      <button
        class="development-lp-cta primary"
        type="button"
        data-development-ai="true">
        ✦ CONVERSAR COM A IA
      </button>

      <button
        class="development-lp-cta whatsapp"
        type="button"
        data-development-human="true">
        FALAR COM ESPECIALISTA
      </button>
    </div>

    ${typologyHtml ? `
      <div class="development-section-block">
        <div class="detail-section-title">Tipologias disponíveis</div>
        <h3>Compare as opções deste projeto</h3>
        ${typologyHtml}
        <div class="development-availability-note">
          Valores e disponibilidade são dinâmicos e podem mudar sem aviso prévio.
        </div>
      </div>
    ` : ""}

    ${floorPlanCards ? `
      <div class="development-section-block">
        <div class="detail-section-title">Plantas</div>
        <h3>Conheça as opções do empreendimento</h3>

        <div class="development-floorplans">
          ${floorPlanCards}
        </div>
      </div>
    ` : ""}

    ${videoHtml ? `
      <div class="development-section-block">
        <div class="detail-section-title">Vídeo</div>
        <h3>Conheça o projeto</h3>
        ${videoHtml}
      </div>
    ` : ""}

    ${description ? `
      <div class="development-section-block">
        <div class="detail-section-title">Sobre o projeto</div>
        <h3>${esc(development.name || p.name || "Empreendimento")}</h3>
        <p>${esc(description)}</p>
      </div>
    ` : ""}

    ${featureHtml ? `
      <div class="development-section-block">
        <div class="detail-section-title">Lazer e comodidades</div>
        <h3>Estrutura do condomínio</h3>
        ${featureHtml}
      </div>
    ` : ""}

    ${unitFeatureHtml ? `
      <div class="development-section-block">
        <div class="detail-section-title">Características das unidades</div>
        <h3>Detalhes dos apartamentos</h3>
        ${unitFeatureHtml}
      </div>
    ` : ""}

    <div class="development-section-block">
      <div class="detail-section-title">Materiais comerciais</div>
      <h3>Book e tabela atualizada</h3>

      <div class="development-materials-grid">
        ${bookMaterialHtml}
        ${tableMaterialHtml}
      </div>
    </div>
  `;

  target
    .querySelectorAll(
      "[data-development-floorplan]"
    )
    .forEach(element=>{
      element.addEventListener(
        "click",
        ()=>{
          const url=
            clean(
              element.dataset.developmentFloorplan
            );

          if(!url){
            return;
          }

          openFloorplan(
            url,
            p
          );

          try{
            gtag(
              "event",
              "development_floorplan_click",
              {
                property_id:String(p.id||""),
                building_id:String(development.id||""),
                property_name:p.name||""
              }
            );
          }catch(error){}

          supabaseTrack(
            "development_floorplan_click",
            {
              property_id:String(p.id||""),
              building_id:String(development.id||""),
              property_name:p.name||""
            }
          );
        }
      );
    });

  // One visible AI action per detail: rich development CTA replaces its duplicate.
  const detailAi=modal.querySelector(".detail-specialist-btn");
  if(detailAi && target.querySelector("[data-development-ai]"))detailAi.hidden=true;
  const detailHuman=modal.querySelector(".detail-specialist-human-btn");
  if(detailHuman && target.querySelector("[data-development-human]"))detailHuman.hidden=true;

  target
    .querySelector(
      "[data-development-ai]"
    )
    ?.addEventListener(
      "click",
      ()=>{
        openAgentConversation(p);
      }
    );

  target
    .querySelector(
      "[data-development-human]"
    )
    ?.addEventListener(
      "click",
      ()=>{
        openPropertySpecialist(p);
      }
    );

  target
    .querySelectorAll(
      "[data-development-request]"
    )
    .forEach(button=>{
      button.addEventListener(
        "click",
        ()=>{
          const kind=
            button.dataset.developmentRequest;

          const label=
            kind==="table"
              ? "Solicitação de tabela atualizada"
              : "Solicitação de Book";

          const requestProperty={
            ...p,
            id:String(p.id||development.id||""),
            name:`${development.name || p.name || "Empreendimento"} — ${label}`
          };

          try{
            gtag(
              "event",
              kind==="table"
                ? "development_table_request"
                : "development_book_request",
              {
                property_id:String(p.id||""),
                building_id:String(development.id||""),
                property_name:p.name||""
              }
            );
          }catch(error){}

          supabaseTrack(
            kind==="table"
              ? "development_table_request"
              : "development_book_request",
            {
              property_id:String(p.id||""),
              building_id:String(development.id||""),
              property_name:p.name||""
            }
          );

          openLeadCapture(
            requestProperty
          );
        }
      );
    });

  target
    .querySelector(
      "[data-development-book]"
    )
    ?.addEventListener(
      "click",
      ()=>{
        try{
          gtag(
            "event",
            "development_book_click",
            {
              property_id:String(p.id||""),
              building_id:String(development.id||""),
              property_name:p.name||"",
              file_name:developmentFileName(book)
            }
          );
        }catch(error){}

        supabaseTrack(
          "development_book_click",
          {
            property_id:String(p.id||""),
            building_id:String(development.id||""),
            property_name:p.name||"",
            file_name:developmentFileName(book)
          }
        );
      }
    );

  target
    .querySelector(
      "[data-development-video-link]"
    )
    ?.addEventListener(
      "click",
      ()=>{
        try{
          gtag(
            "event",
            "development_video_click",
            {
              property_id:String(p.id||""),
              building_id:String(development.id||""),
              property_name:p.name||""
            }
          );
        }catch(error){}

        supabaseTrack(
          "development_video_click",
          {
            property_id:String(p.id||""),
            building_id:String(development.id||""),
            property_name:p.name||""
          }
        );
      }
    );

  console.info(
    "YNT_DEVELOPMENT_RENDERED",
    {
      building_id:String(development.id||""),
      typologies:typologies.length,
      images:Array.isArray(data?.media?.images)
        ? data.media.images.length
        : 0,
      floor_plans:floorPlans.length,
      videos:videos.length,
      book:Boolean(book?.url),
      lp_complete:true
    }
  );
}

async function hydrateDevelopmentRichModal(
  modal,
  p
){
  const target=
    modal?.querySelector(
      "#developmentRichSection"
    );

  if(
    !target ||
    String(p?.source||"").toLowerCase()!=="novos"
  ){
    return;
  }

  const buildingId=
    developmentBuildingId(p);

  if(!buildingId){
    target.remove();
    return;
  }

  const data=
    await loadDevelopmentData(p);

  if(
    !data ||
    !document.body.contains(modal)
  ){
    target.remove();
    return;
  }

  renderDevelopmentRichModal(
    modal,
    p,
    data
  );
}

async function showPhotoModal(...args){
  await window.YntFeatureLoader.load('property-detail');
  return showPhotoModal.apply(this,args);
}


;
// SOURCE: assets/js/legacy/compatibility.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

async function yntCountOtherLaunchesInNeighborhood(
  p
){
  const neighborhood=
    clean(
      p?.neighborhood ||
      p?.rawData
        ?.building
        ?.address
        ?.neighborhood ||
      ""
    );

  if(!neighborhood){
    return {
      count:0,
      neighborhood:""
    };
  }

  try{
    const url=
      new URL(
        `${SUPABASE_URL}/rest/v1/properties`
      );

    url.searchParams.set(
      "source",
      "eq.novos"
    );

    url.searchParams.set(
      "active",
      "eq.true"
    );

    url.searchParams.set(
      "neighborhood",
      `ilike.${neighborhood}`
    );

    url.searchParams.set(
      "select",
      "id,external_id,title,development_name,neighborhood"
    );

    url.searchParams.set(
      "limit",
      "200"
    );

    const response=
      await fetch(
        url.toString(),
        {
          cache:"no-store",
          headers:{
            apikey:
              SUPABASE_PUBLISHABLE_KEY,

            Authorization:
              `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
          }
        }
      );

    if(!response.ok){
      throw new Error(
        `Supabase ${response.status}`
      );
    }

    const rows=
      await response.json();

    const currentExternalId=
      String(
        p?.id ||
        ""
      );

    const currentUuid=
      String(
        p?.db_id ||
        ""
      );

    /*
      Um lançamento pode ter várias plantas/unidades.
      Contamos empreendimentos únicos, não linhas da tabela.
    */
    const unique=
      new Set();

    (
      Array.isArray(rows)
        ? rows
        : []
    ).forEach(
      row=>{
        const rowExternal=
          String(
            row?.external_id ||
            ""
          );

        const rowUuid=
          String(
            row?.id ||
            ""
          );

        if(
          rowExternal===currentExternalId ||
          rowUuid===currentUuid
        ){
          return;
        }

        const key=
          norm(
            row?.development_name ||
            row?.title ||
            rowExternal ||
            rowUuid
          );

        if(key){
          unique.add(key);
        }
      }
    );

    return {
      count:
        unique.size,

      neighborhood
    };

  }catch(error){
    console.warn(
      "YNT_PROACTIVE_AI_COUNT_FAILED",
      error
    );

    return {
      count:0,
      neighborhood
    };
  }
}


;
// SOURCE: assets/js/ui/home-navigation.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function goHome(){
  clearAdEntryIntent();
  resetMatchProfile();
  resetCatalogState(false);
  sourceMode="todos";
  document.querySelectorAll(".source-btn").forEach(button=>{
    button.classList.toggle("selected",button.dataset.source==="todos");
  });
  setFiltersOpen(false);
  closeAdBudgetQuestion();
  setRefineMatchOpen(false);
  $("catalog")?.classList.remove("visible");
  $("photoModal")?.remove();
  $("leadModal")?.remove();
  document.body.classList.remove("match-mode","match-results-mode","ad-match-mode");
  document.body.classList.add("home-mode");
  document.body.style.overflow="";
  $("wizardMatchMode")?.classList.add("active");
  $("wizardExploreMode")?.classList.remove("active");
  const url=new URL(window.location.href);
  url.searchParams.delete("imovel");
  url.hash="";
  history.replaceState({ynteligenciaView:"home",step:0},"",url.pathname+url.search);
  window.scrollTo({top:0,behavior:"instant"});
}

function openGeneralCatalog(openFilters=true){
  clearAdEntryIntent();
  document.body.classList.remove("match-results-mode");
  resetCatalogState(false);
  currentMatchById.clear();
  document.body.classList.remove("home-mode");
  leaveMatchMode();

  /*
    EXPLORAR:
    não exibe o inventário inteiro imediatamente.
    Resultados só aparecem quando:
      1) o cliente preencher 4 critérios; ou
      2) clicar em BUSCAR IMÓVEIS.
  */
  $("catalog")?.classList.remove("visible");

  /*
    O mobile agora usa o formulário inline completo.
    Mantemos o estado legado fechado para não bloquear Região/Bairro.
  */
  setFiltersOpen(Boolean(openFilters && window.matchMedia("(max-width:700px)").matches));

  $("explore")?.scrollIntoView({
    behavior:"smooth",
    block:"start"
  });
}

function yntRestoreSavedResults(){
  const memory=yntDeferredSearch || paidMemory();
  if(!memory.neighborhood && !memory.region && !memory.bedrooms && !memory.minPrice &&
    !memory.maxPrice && !memory.type && !memory.search && !memory.development)return false;
  adIntent.neighborhood=memory.neighborhood || "";
  adIntent.region=memory.region || "";
  adIntent.bedrooms=Number(memory.bedrooms)||0;
  adIntent.minPrice=Number(memory.minPrice)||0;
  adIntent.maxPrice=Number(memory.maxPrice)||0;
  adIntent.type=memory.type || "";
  adIntent.search=memory.search || "";
  adIntent.development=memory.development || "";
  adIntent.active=true;
  adIntent.restored=true;
  syncPaidClickContextUi();
  startPaidClickExperience();
  updateAdMatchUI();
  document.body.classList.remove("home-mode");
  showMatches();
  return true;
}


;
// SOURCE: assets/js/ui/modals.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function showToast(message){

  const t=
    $("toast");


  t.textContent=
    message;


  t.classList
    .add(
      "show"
    );


  clearTimeout(
    window.__toast
  );


  window.__toast=
    setTimeout(
      ()=>
        t.classList.remove(
          "show"
        ),
      3500
    );
}
