
;
// SOURCE: assets/js/domain/common.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function cleanAdParam(value){
  return String(value||"").replace(/[-_]+/g," ").trim();
}

function formatNeighborhoodName(value){
  const lowercaseWords=new Set(["da","das","de","do","dos","e"]);
  return cleanAdParam(value)
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((word,index)=>index>0 && lowercaseWords.has(word)
      ? word
      : word.charAt(0).toLocaleUpperCase("pt-BR")+word.slice(1))
    .join(" ");
}

function formatBRLCurrencyInput(value){
  const digits=String(value||"").replace(/\D/g,"");
  if(!digits) return "";
  return `R$ ${Number(digits).toLocaleString("pt-BR")}`;
}

function parseBRLCurrencyInput(value){
  return Number(String(value||"").replace(/\D/g,"")) || 0;
}

function clean(v){
  return String(v??"")
    .replace(/\s+/g," ")
    .trim()
}

function norm(v){
  return clean(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
}

function safeStorageGet(key){
  try{return localStorage.getItem(key);}catch{return null;}
}

function safeStorageSet(key,value){
  try{localStorage.setItem(key,value);return true;}catch{return false;}
}

function safeStorageGetJSON(key){
  try{
    const raw=localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }catch{
    return null;
  }
}

function safeStorageSetJSON(key,value){
  try{
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
    return true;
  }catch{
    return false;
  }
}

function esc(v){
  return String(v??"")
    .replace(
      /[&<>"]/g,
      c=>({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;"
      }[c])
    )
}

function numberBR(v){

  let s=
    String(v??"")
      .replace(/R\$/gi,"")
      .replace(/\s/g,"")
      .replace(/[^\d,.-]/g,"");

  if(!s)return 0;

  if(
    s.includes(",") &&
    s.includes(".")
  ){

    s=
      s.replace(/\./g,"")
       .replace(",",".");

  }else if(s.includes(",")){

    s=s.replace(",",".");

  }else if(
    (s.match(/\./g)||[]).length>1
  ){

    s=s.replace(/\./g,"");
  }

  return Number(s)||0;
}

function money(v){
  const amount=Number(v);

  /*
    0 e o marcador 0.1 dos lançamentos sem preço
    apareciam como "R$ 0". O valor no inventário não muda.
  */
  if(!Number.isFinite(amount) || amount<1){
    return "Valor sob consulta";
  }

  return new Intl.NumberFormat(
    "pt-BR",
    {
      style:"currency",
      currency:"BRL",
      maximumFractionDigits:0
    }
  ).format(amount);
}

function area(v){

  return new Intl.NumberFormat(
    "pt-BR",
    {
      maximumFractionDigits:2
    }
  ).format(v);
}


;
// SOURCE: assets/js/domain/search-intent.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function propertyMatchesAdNeighborhood(p){
  if(!adIntent.neighborhood) return true;
  const wanted=norm(adIntent.neighborhood);
  const haystack=norm(`${p.neighborhood||""} ${p.address||""}`);
  return haystack.includes(wanted);
}

function propertyMatchesAdRequirements(p){
  if(adIntent.bedrooms && Number(p.bedrooms)<Number(adIntent.bedrooms)) return false;
  if(adIntent.minPrice && (!p.value || Number(p.value)<adIntent.minPrice)) return false;
  if(adIntent.maxPrice && (!p.value || Number(p.value)>adIntent.maxPrice)) return false;
  if(adIntent.type && !norm(`${p.type||""} ${p.name||""}`).includes(norm(adIntent.type))) return false;
  const named=adIntent.development || adIntent.search;
  if(named && !norm(`${p.name||""} ${p.development||""}`).includes(norm(named))) return false;
  return true;
}

function yntHasPaidClickContext(){
  const touch=YNTELIGENCIA_TOUCHES?.current_touch || {};
  const paidMedium=String(touch.utm_medium || "").toLowerCase().replace(/[ -]+/g,"_");
  const paidAttribution=Boolean(
    touch.gclid || touch.gbraid || touch.wbraid || YNT_PAID_UTM_MEDIA.has(paidMedium)
  );
  return Boolean(yntCurrentUrlHasPaidAttribution() || paidAttribution || adIntent.active ||
    paidSearch.neighborhood || paidSearch.region || paidSearch.bedrooms ||
    paidSearch.minPrice || paidSearch.maxPrice || paidSearch.type ||
    paidSearch.search || paidSearch.development);
}

function syncPaidClickContextUi(){
  document.body.classList.toggle("paid-click-context", yntHasPaidClickContext());
}

function currentRefineRegionKey(){
  if(profile.region) return norm(profile.region);
  return adIntentRegionKey();
}

function regionDisplayName(regionKey){
  const names={
    oeste:"Zona Oeste",
    sul:"Zona Sul",
    norte:"Zona Norte",
    leste:"Zona Leste"
  };
  return names[norm(regionKey)] || "região escolhida";
}

function paidMemory(){
  return safeStorageGetJSON("ynt_paid_search_memory") || {};
}

function rememberPaidSearch(){
  if(!yntHasPaidClickContext()) return;
  safeStorageSetJSON("ynt_paid_search_memory", {
    neighborhood:adIntent.neighborhood || "",
    region:adIntent.region || "",
    bedrooms:adIntent.bedrooms || 0,
    minPrice:adIntent.minPrice || 0,
    maxPrice:adIntent.maxPrice || 0,
    type:adIntent.type || "",
    search:adIntent.search || "",
    development:adIntent.development || "",
    subscribed:safeStorageGet("ynt_push_last_opted_in")==="1",
    permissionDenied:safeStorageGet("ynt_paid_permission_denied")==="1",
    dismissedSessionId:safeStorageGet("ynt_paid_push_dismissed_session") || ""
  });
}

function startPaidClickExperience(){
  syncPaidClickContextUi();
  const memory=paidMemory();
  let denied=memory.permissionDenied===true;
  try{
    if(typeof Notification!=="undefined" && Notification.permission==="denied") denied=true;
  }catch(error){}
  paidExperience=PaidClickExperience.createExperience({
    intent:adIntent,
    remembered:memory,
    sessionId:typeof YNTELIGENCIA_SESSION_ID==="undefined" ? "" : YNTELIGENCIA_SESSION_ID,
    dismissedSessionId:memory.dismissedSessionId || "",
    subscriptionAuthority:paidOneSignalAuthority(),
    permissionDenied:denied
  });
  renderPaidPush();
}

function notePaidSignal(type, propertyId){
  if(!paidExperience || !yntHasPaidClickContext()) return;
  paidExperience=PaidClickExperience.reducePaidExperience(paidExperience, {type, propertyId});
  if(type==="dismiss"){
    safeStorageSet("ynt_paid_push_dismissed_session", YNTELIGENCIA_SESSION_ID);
    rememberPaidSearch();
  }
  if(type==="permission_denied"){
    safeStorageSet("ynt_paid_permission_denied", "1");
    rememberPaidSearch();
  }
  if(type==="subscribed"){
    safeStorageSet("ynt_push_last_opted_in", "1");
    safeStorageSet("ynt_paid_permission_denied", "");
    rememberPaidSearch();
  }
  if(type==="subscription_unresolved"){
    rememberPaidSearch();
  }
  renderPaidPush();
}

function notePaidArrival(){
  rememberPaidSearch();
  notePaidSignal("results_shown");
  if(adIntent.restored) return;
  supabaseTrack("paid_entry", PaidClickExperience.sanitizeEvent({
    neighborhood:adIntent.neighborhood || "",
    bedrooms:adIntent.bedrooms || 0,
    min_price:adIntent.minPrice || 0,
    max_price:adIntent.maxPrice || 0
  }));
}

function adIntentHasPrice(){
  return Boolean(adIntent.minPrice || adIntent.maxPrice);
}


;
// SOURCE: assets/js/domain/inventory.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function propertyForInteraction(id){
  const property=properties.find(p=>String(p.id)===String(id));
  const match=currentMatchById.get(String(id));
  return property && match ? {...property,match} : property;
}

function normalizePhotoURL(v){

  const s=clean(v);

  if(!s)return "";

  return validURL(s)
    ? s
    : "";
}

function photoList(p){

  const m=
    photoManifest[String(p.id)] ||
    photoManifest[p.id];


  if(Array.isArray(m)){

    return m
      .map(normalizePhotoURL)
      .filter(Boolean);
  }


  if(Array.isArray(p.photos)){

    return p.photos
      .map(normalizePhotoURL)
      .filter(Boolean);
  }


  const raw=clean(p.photos);


  if(raw.includes("|")){

    return raw
      .split("|")
      .map(normalizePhotoURL)
      .filter(Boolean);
  }


  const one=
    normalizePhotoURL(raw);


  return one
    ? [one]
    : [];
}

function validURL(v){

  try{

    let u=new URL(v);

    return(
      u.protocol==="http:" ||
      u.protocol==="https:"
    );

  }catch{

    return false;
  }
}

function parseCSV(text){

  const rows=[];

  let row=[];
  let field="";
  let quoted=false;

  text=
    String(text)
      .replace(/^\uFEFF/,"");


  for(
    let i=0;
    i<text.length;
    i++
  ){

    const c=text[i];
    const n=text[i+1];


    if(c==='"'){

      if(
        quoted &&
        n==='"'
      ){

        field+='"';
        i++;

      }else{

        quoted=!quoted;
      }

    }else if(
      c===';' &&
      !quoted
    ){

      row.push(field);
      field="";

    }else if(
      (c==="\n" || c==="\r") &&
      !quoted
    ){

      if(
        c==="\r" &&
        n==="\n"
      )i++;


      row.push(field);

      field="";


      if(
        row.some(
          v=>clean(v)!==""
        )
      ){

        rows.push(row);
      }


      row=[];

    }else{

      field+=c;
    }
  }


  row.push(field);


  if(
    row.some(
      v=>clean(v)!==""
    )
  ){

    rows.push(row);
  }


  if(rows.length<2){

    return [];
  }


  const headers=
    rows
      .shift()
      .map(norm);


  return rows.map(
    cols=>{

      const obj={};

      headers.forEach(
        (key,i)=>
          obj[key]=
            clean(cols[i])
      );

      return obj;
    }
  );
}

function field(
  row,
  names
){

  for(
    const name of names
  ){

    const value=
      row[norm(name)];

    if(
      clean(value)!==""
    ){

      return clean(value);
    }
  }

  return "";
}

function inferType(row){

  const t=
    norm(
      [
        field(
          row,
          ["EMPRENDIMENTO"]
        ),

        field(
          row,
          ["Observações"]
        ),

        field(
          row,
          ["Tipo"]
        ),

        field(
          row,
          ["Categoria"]
        )

      ].join(" ")
    );


  if(
    t.includes("cobertura")
  )return "cobertura";


  if(
    t.includes("sobrado")
  )return "sobrado";


  if(
    t.includes("casa")
  )return "casa";


  if(
    t.includes("studio") ||
    t.includes("studios") ||
    t.includes("kitnet") ||
    t.includes("loft")
  )return "studio";


  if(
    t.includes("comercial") ||
    t.includes("sala comercial") ||
    t.includes("conjunto comercial")
  )return "comercial";


  return "apartamento";
}

function mapProperty(
  row,
  index
){

  return{

    id:
      clean(
        field(
          row,
          ["ID"]
        )
      ) ||
      `IMOVEL-${index+1}`,


    name:
      clean(
        field(
          row,
          ["EMPRENDIMENTO"]
        )
      ) ||
      "Imóvel disponível",


    neighborhood:
      clean(
        field(
          row,
          ["Bairro"]
        )
      ) ||
      "Bairro não informado",

    city:
      clean(
        field(
          row,
          ["Cidade","city"]
        )
      ),

    state:
      clean(
        field(
          row,
          ["UF","Estado","state"]
        )
      ).toUpperCase(),


    address:
      clean(
        field(
          row,
          ["Endereço"]
        )
      ),


    unit:
      clean(
        field(
          row,
          ["Nº da unidade"]
        )
      ),


    area:
      numberBR(
        field(
          row,
          ["Área Privativa (m2)"]
        )
      ),


    bedrooms:
      numberBR(
        field(
          row,
          ["N˚ Dorms.","Nº Dorms."]
        )
      ),


    suites:
      numberBR(
        field(
          row,
          ["Nº Suítes"]
        )
      ),


    parking:
      numberBR(
        field(
          row,
          ["N˚ Vagas","Nº Vagas"]
        )
      ),


    year:
      numberBR(
        field(
          row,
          ["Ano Const."]
        )
      ),


    description:
      clean(
        field(
          row,
          ["Observações"]
        )
      ),


    condominium:
      numberBR(
        field(
          row,
          ["Valor Condomínio"]
        )
      ),


    iptu:
      numberBR(
        field(
          row,
          ["Valor IPTU"]
        )
      ),


    value:
      numberBR(
        field(
          row,
          ["Valor de venda (R$)"]
        )
      ),


    m2:
      numberBR(
        field(
          row,
          ["Valor M2 (R$ / m2)"]
        )
      ),


    photos:
      clean(
        field(
          row,
          ["Link das Fotos sem marca d´água"]
        )
      ),


    type:
      inferType(row),


    source:
      "usados"
  };
}

function normalizeOruloType(value){

  const t=norm(value || "");

  /*
    IMPORTANTE:
    O mapper da Órulo pode receber mais de uma pista ao mesmo tempo
    (ex.: normalized_type="apartment" e title contendo "Casa").
    Por isso CASAS ficam antes de APARTAMENTOS.
  */

  // CASAS / CASAS DE CONDOMÍNIO
  if(
    t.includes("condominium_house") ||
    t.includes("condominium house") ||
    t.includes("house") ||
    t.includes("casa")
  ){
    return "casa";
  }

  // SOBRADOS / TOWNHOUSES
  if(
    t.includes("townhouse") ||
    t.includes("sobrado")
  ){
    return "sobrado";
  }

  // COBERTURAS
  if(
    t.includes("penthouse") ||
    t.includes("cobertura")
  ){
    return "cobertura";
  }

  // STUDIOS / LOFTS / KITNETS
  if(
    t.includes("studio") ||
    t.includes("loft") ||
    t.includes("kitnet")
  ){
    return "studio";
  }

  // APARTAMENTOS
  if(
    t.includes("apartment") ||
    t.includes("apartamento") ||
    t.includes("flat")
  ){
    return "apartamento";
  }

  return "apartamento";
}

function extractOruloPhotos(row, raw){

  const found=[];
  const seen=new Set();

  function add(value){
    if(typeof value!=="string")return;
    const url=clean(value);
    if(!validURL(url) || seen.has(url))return;
    seen.add(url);
    found.push(url);
  }

  // A imagem principal salva no Supabase continua sendo a capa.
  add(row && row.image_url);

  // A Órulo pode devolver galerias em diferentes níveis do payload.
  // Percorremos apenas campos semanticamente ligados a fotos/imagens,
  // evitando capturar links comuns do empreendimento.
  function walk(value,key="",depth=0){
    if(depth>8 || value==null)return;

    const imageKey=/photo|foto|image|imagem|gallery|galeria|picture|banner|facade|fachada|plant|floor.?plan|perspective/i.test(String(key));

    if(typeof value==="string"){
      const looksLikeImage=/^https?:\/\//i.test(value) && (imageKey || /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(value) || /image|photo|foto|cdn.*orulo|orulo.*cdn/i.test(value));
      if(looksLikeImage)add(value);
      return;
    }

    if(Array.isArray(value)){
      value.forEach(item=>{
        if(typeof item==="string"){
          if(imageKey)add(item);
        }else{
          walk(item,key,depth+1);
        }
      });
      return;
    }

    if(typeof value==="object"){
      Object.entries(value).forEach(([k,v])=>{
        const nextKey=imageKey ? `${key}.${k}` : k;
        if(typeof v==="string"){
          if(imageKey || /photo|foto|image|imagem|url/i.test(k)){
            // Em objetos de galeria, "url" normalmente é a própria foto.
            if(imageKey || !/^url$/i.test(k)) add(v);
            else add(v);
          }
        }else{
          walk(v,nextKey,depth+1);
        }
      });
    }
  }

  walk(raw,"raw_data",0);

  return found;
}

function mapOruloProperty(row){

  const raw =
    row && typeof row.raw_data === "object"
      ? row.raw_data
      : {};

  const typology =
    raw.typology || {};

  const building =
    raw.building || {};

  /*
    NOVOS (Órulo): endereço costuma vir em raw.building.address.
    USADOS (Nonstop): endereço vem em raw.address.
  */
  const addressData =
    (
      raw.address &&
      typeof raw.address === "object"
    )
      ? raw.address
      : (building.address || {});

  const streetParts = [
    addressData.street_type,
    addressData.street,
    addressData.number
  ].filter(Boolean);

  const propertySource =
    clean(row.source || "novos").toLowerCase();

  return {

    /*
      id = identificador comercial/provedor usado pelo app
      db_id = UUID real da linha public.properties no Supabase
    */
    id:
      String(row.external_id || row.id || ""),

    db_id:
      String(row.id || ""),

    name:
      clean(
        row.development_name ||
        row.title ||
        "Imóvel disponível"
      ),

    neighborhood:
      clean(
        row.neighborhood ||
        addressData.area ||
        addressData.neighborhood ||
        ""
      ),

    city:
      clean(
        row.city ||
        addressData.city ||
        ""
      ),

    state:
      clean(
        row.state ||
        addressData.state ||
        addressData.uf ||
        ""
      ).toUpperCase(),

    address:
      clean(
        streetParts.join(" ")
      ),

    unit:
      clean(
        typology.reference ||
        typology.section_reference ||
        raw.reference ||
        ""
      ),

    area:
      Number(row.area) || 0,

    bedrooms:
      Number(row.bedrooms) || 0,

    suites:
      Number(
        typology.suites ??
        raw.suites ??
        0
      ) || 0,

    parking:
      Number(row.parking_spaces) || 0,

    year:
      Number(
        raw.year_of_construction ??
        raw.yearOfConstruction ??
        0
      ) || 0,

    description:
      clean(
        building.description ||
        raw.description ||
        row.title ||
        ""
      ),

    condominium:
      Number(
        raw?.fees?.condo ??
        raw?.values?.condoFee ??
        raw?.condoFee ??
        0
      ) || 0,

    iptu:
      Number(
        raw?.fees?.propertyTax ??
        raw?.values?.propertyTax ??
        raw?.propertyTax ??
        0
      ) || 0,

    value:
      Number(row.price) || 0,

    m2:
      Number(row.area) > 0 && Number(row.price) > 0
        ? Number(row.price) / Number(row.area)
        : 0,

    photos:
      extractOruloPhotos(row, raw),

    type:
      normalizeOruloType(
        [
          raw.normalized_type,
          typology.type,
          raw.type,
          raw.property_type,
          building.type,
          building.property_type,
          row.title,
          row.development_name
        ]
          .filter(Boolean)
          .join(" ") ||
        "apartamento"
      ),

    source:
      propertySource || "novos",

    propertyUrl:
      clean(row.property_url || ""),

    stock:
      Number(
        typology.stock ??
        raw.stock ??
        0
      ) || 0,

    rawData:
      raw
  };
}

function toCatalogLiteProperty(p){
  if(!p || typeof p!=="object")return p;

  return {
    ...p,
    rawData:{},
    detailHydrated:false
  };
}

function deduplicate(items){

  const map=new Map();

  items.forEach(
    p=>{

      const k=norm(p.id);

      if(
        k &&
        !map.has(k)
      ){

        map.set(k,p);
      }
    }
  );

  return[
    ...map.values()
  ];
}

function replacePropertyEverywhere(updated){
  if(!updated?.id)return updated;
  const id=String(updated.id);
  const mergeInto=(list)=>list.map(item=>{
    if(String(item?.id||"")!==id)return item;
    return {
      ...item,
      ...updated,
      match:item.match || updated.match
    };
  });

  newPropertiesCache=mergeInto(newPropertiesCache);
  properties=mergeInto(properties);

  const current=propertyForInteraction(id);
  return current || updated;
}


;
// SOURCE: assets/js/domain/visitor.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function yntUuid(){
  return (
    typeof crypto!=="undefined" &&
    crypto.randomUUID
  )
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
}

function yntValidVisitorId(value){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value||"").trim());
}

function yntReadCookie(name){
  try{
    const prefix=encodeURIComponent(name)+"=";
    const part=document.cookie
      .split("; ")
      .find(item=>item.startsWith(prefix));

    return part
      ? decodeURIComponent(part.slice(prefix.length))
      : "";
  }catch{
    return "";
  }
}

function yntWriteSharedVisitorCookie(id){
  if(!yntValidVisitorId(id))return;

  try{
    const host=String(location.hostname||"").toLowerCase();

    /*
      Compartilha a identidade entre:
      www.yincorp.com.br
      app.yincorp.com.br
    */
    if(
      host==="yincorp.com.br" ||
      host.endsWith(".yincorp.com.br")
    ){
      document.cookie=
        "ynt_visitor_id="+
        encodeURIComponent(id)+
        "; Max-Age=31536000; Path=/; Domain=.yincorp.com.br; SameSite=Lax; Secure";
    }
  }catch{}
}

function yntIncomingSharedVisitorId(){
  try{
    const params=
      new URLSearchParams(
        window.location.search
      );
    const vid=
      params.get("vid");

    return yntValidVisitorId(vid)
      ? String(vid).trim()
      : "";
  }catch{
    return "";
  }
}

function yntCleanSharedVisitorFromUrl(){
  try{
    const url=
      new URL(
        window.location.href
      );

    if(!url.searchParams.has("vid"))return;

    url.searchParams.delete("vid");

    history.replaceState(
      history.state||{},
      "",
      url.pathname+
      url.search+
      url.hash
    );
  }catch{}
}

function yntIncomingVisitorId(){
  try{
    const params=
      new URLSearchParams(
        window.location.search
      );

    const candidates=[
      params.get("visitor"),
      params.get("visitor_id")
    ];

    return candidates.find(
      yntValidVisitorId
    ) || "";
  }catch{
    return "";
  }
}

function yntCleanVisitorFromUrl(){
  try{
    const url=
      new URL(
        window.location.href
      );

    const had=
      url.searchParams.has("visitor") ||
      url.searchParams.has("visitor_id");

    if(!had)return;

    url.searchParams.delete("visitor");
    url.searchParams.delete("visitor_id");

    history.replaceState(
      history.state||{},
      "",
      url.pathname+
      url.search+
      url.hash
    );
  }catch{}
}

function getYnteligenciaVisitorId(){
  const visitorKey=
    "ynteligencia_visitor_id";

  /*
    IDENTIDADE CANÔNICA DO APP
    -------------------------
    O visitor_id usado pelo Supabase e o External ID usado pelo
    OneSignal nascem exatamente deste mesmo valor.

    ?vid= é o contrato entre YNTELIGENCIA e agente-yincorp.
    Só um UUID válido substitui a identidade local.
    Parâmetro visitor, visitor_id, cookie de LP e valor inválido
    continuam ignorados.
  */
  const sharedVisitorId=
    yntIncomingSharedVisitorId();

  if(sharedVisitorId){
    safeStorageSet(
      visitorKey,
      sharedVisitorId
    );
    yntCleanSharedVisitorFromUrl();
    return sharedVisitorId;
  }

  let id=
    safeStorageGet(
      visitorKey
    );

  if(
    !yntValidVisitorId(id)
  ){
    const legacy=
      safeStorageGet(
        "ynteligencia_session_id"
      );

    id=
      yntValidVisitorId(legacy)
        ? legacy
        : yntUuid();

    safeStorageSet(
      visitorKey,
      id
    );
  }

  return id;
}


;
// SOURCE: assets/js/domain/session.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function resolveYnteligenciaSession(){
  const key=
    "ynteligencia_session_state_v2";

  const now=
    Date.now();

  const previous=
    safeStorageGetJSON(key) ||
    {};

  const previousLastActivity=
    Number(
      previous.last_activity_at_ms
    ) || 0;

  const stillActive=
    previous.id &&
    previous.visitor_id ===
      YNTELIGENCIA_VISITOR_ID &&
    previousLastActivity > 0 &&
    (
      now -
      previousLastActivity
    ) < YNT_SESSION_TIMEOUT_MS;

  if(stillActive){
    const continued={
      ...previous,
      last_activity_at_ms:
        now
    };

    safeStorageSetJSON(
      key,
      continued
    );

    return continued;
  }

  const previousSessionId=
    clean(
      previous.id ||
      safeStorageGet(
        "ynteligencia_last_session_id"
      ) ||
      ""
    );

  const previousSessionStartedAt=
    clean(
      previous.started_at ||
      safeStorageGet(
        "ynteligencia_last_session_started_at"
      ) ||
      ""
    );

  const previousSessionLastActivity=
    Number(
      previous.last_activity_at_ms ||
      safeStorageGet(
        "ynteligencia_last_session_last_activity_ms"
      ) ||
      0
    ) || 0;

  const previousNumber=
    Number(
      previous.session_number ||
      safeStorageGet(
        "ynteligencia_session_number"
      ) ||
      0
    ) || 0;

  const sessionNumber=
    previousNumber + 1;

  const startedAt=
    new Date(now)
      .toISOString();

  const daysSinceLastVisit=
    previousSessionLastActivity > 0
      ? Math.max(
          0,
          (
            now -
            previousSessionLastActivity
          ) /
          86400000
        )
      : null;

  const current={
    id:
      yntUuid(),

    visitor_id:
      YNTELIGENCIA_VISITOR_ID,

    session_number:
      sessionNumber,

    is_returning:
      sessionNumber > 1,

    started_at:
      startedAt,

    started_at_ms:
      now,

    last_activity_at_ms:
      now,

    previous_session_id:
      previousSessionId,

    previous_session_started_at:
      previousSessionStartedAt,

    previous_session_last_activity_at_ms:
      previousSessionLastActivity || null,

    days_since_last_visit:
      daysSinceLastVisit
  };

  if(previousSessionId){
    safeStorageSet(
      "ynteligencia_last_session_id",
      previousSessionId
    );
  }

  if(previousSessionStartedAt){
    safeStorageSet(
      "ynteligencia_last_session_started_at",
      previousSessionStartedAt
    );
  }

  if(previousSessionLastActivity){
    safeStorageSet(
      "ynteligencia_last_session_last_activity_ms",
      String(
        previousSessionLastActivity
      )
    );
  }

  safeStorageSet(
    "ynteligencia_session_number",
    String(
      sessionNumber
    )
  );

  safeStorageSetJSON(
    key,
    current
  );

  return current;
}

function yntJourneyKey(suffix){
  return (
    `ynteligencia_journey_${YNTELIGENCIA_SESSION_ID}_${suffix}`
  );
}

function nextYnteligenciaEventSequence(){
  const key=
    yntJourneyKey("sequence");

  const current=
    Number(
      sessionStorage.getItem(key) ||
      0
    ) || 0;

  const next=
    current + 1;

  try{
    sessionStorage.setItem(
      key,
      String(next)
    );
  }catch{}

  return next;
}

function getYnteligenciaPreviousEvent(){
  try{
    const raw=
      sessionStorage.getItem(
        yntJourneyKey("previous_event")
      );

    return raw
      ? JSON.parse(raw)
      : null;
  }catch{
    return null;
  }
}

function setYnteligenciaPreviousEvent(event){
  try{
    sessionStorage.setItem(
      yntJourneyKey("previous_event"),
      JSON.stringify(event)
    );
  }catch{}
}

function touchYnteligenciaSession(){
  const key=
    "ynteligencia_session_state_v2";

  const now=
    Date.now();

  const state=
    safeStorageGetJSON(key);

  if(
    !state ||
    state.id !==
      YNTELIGENCIA_SESSION_ID
  ){
    return;
  }

  state.last_activity_at_ms=
    now;

  safeStorageSetJSON(
    key,
    state
  );
}


;
// SOURCE: assets/js/state/attribution-state.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function captureYnteligenciaAttribution(){

  const params=
    new URLSearchParams(
      window.location.search
    );

  const keys=[
    "gclid",
    "gbraid",
    "wbraid",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term"
  ];

  const attribution={};

  keys.forEach(key=>{

    const incoming=
      clean(
        params.get(key)
      );

    if(incoming){

      safeStorageSet(
        `ynteligencia_${key}`,
        incoming
      );

      attribution[key]=incoming;

    }else{

      attribution[key]=
        safeStorageGet(
          `ynteligencia_${key}`
        ) || "";
    }

  });

  return attribution;
}

function inferYnteligenciaCurrentTouch(){
  const params=
    new URLSearchParams(
      window.location.search
    );

  const current={
    gclid:
      clean(params.get("gclid")),

    gbraid:
      clean(params.get("gbraid")),

    wbraid:
      clean(params.get("wbraid")),

    utm_source:
      clean(params.get("utm_source")),

    utm_medium:
      clean(params.get("utm_medium")),

    utm_campaign:
      clean(params.get("utm_campaign")),

    utm_content:
      clean(params.get("utm_content")),

    utm_term:
      clean(params.get("utm_term")),

    referrer:
      document.referrer || "",

    landing_page:
      window.location.href,

    captured_at:
      new Date()
        .toISOString(),

    source:
      "",

    medium:
      "",

    campaign:
      ""
  };

  const hasPaidClick=
    Boolean(
      current.gclid ||
      current.gbraid ||
      current.wbraid
    );

  if(
    current.utm_source ||
    current.utm_medium ||
    current.utm_campaign
  ){
    current.source=
      current.utm_source ||
      (
        hasPaidClick
          ? "google"
          : "utm"
      );

    current.medium=
      current.utm_medium ||
      (
        hasPaidClick
          ? "cpc"
          : "unknown"
      );

    current.campaign=
      current.utm_campaign ||
      "";

    return current;
  }

  if(hasPaidClick){
    current.source=
      "google";

    current.medium=
      "cpc";

    return current;
  }

  let refHost="";

  try{
    refHost=
      document.referrer
        ? new URL(
            document.referrer
          ).hostname
            .toLowerCase()
        : "";
  }catch{
    refHost="";
  }

  const ownHost=
    window.location.hostname
      .toLowerCase();

  if(
    !refHost ||
    refHost === ownHost
  ){
    current.source=
      "direct";

    current.medium=
      "(none)";

    return current;
  }

  if(
    /(^|\.)google\./.test(refHost) ||
    refHost.includes("google.")
  ){
    current.source=
      "google";

    current.medium=
      "organic";

    return current;
  }

  if(
    refHost.includes("bing.") ||
    refHost.includes("yahoo.") ||
    refHost.includes("duckduckgo.")
  ){
    current.source=
      refHost.split(".")[0] ||
      refHost;

    current.medium=
      "organic";

    return current;
  }

  current.source=
    refHost;

  current.medium=
    "referral";

  return current;
}

function resolveYnteligenciaTouches(){
  const firstKey=
    "ynteligencia_first_touch_v2";

  const previousTouchKey=
    "ynteligencia_previous_session_touch_v2";

  const current=
    inferYnteligenciaCurrentTouch();

  let first=
    safeStorageGetJSON(
      firstKey
    );

  if(!first){
    /*
      Se já existia atribuição legada, aproveitamos como first touch.
      Isso preserva usuários que entraram antes desta atualização.
    */
    const legacy=
      YNTELIGENCIA_ATTRIBUTION ||
      {};

    const hasLegacy=
      Boolean(
        legacy.gclid ||
        legacy.gbraid ||
        legacy.wbraid ||
        legacy.utm_source ||
        legacy.utm_medium ||
        legacy.utm_campaign
      );

    first=
      hasLegacy
        ? {
            ...legacy,

            source:
              legacy.utm_source ||
              (
                legacy.gclid ||
                legacy.gbraid ||
                legacy.wbraid
                  ? "google"
                  : ""
              ),

            medium:
              legacy.utm_medium ||
              (
                legacy.gclid ||
                legacy.gbraid ||
                legacy.wbraid
                  ? "cpc"
                  : ""
              ),

            campaign:
              legacy.utm_campaign ||
              "",

            captured_at:
              safeStorageGet(
                "ynteligencia_first_seen_at"
              ) ||
              new Date()
                .toISOString(),

            migrated_from_legacy:
              true
          }
        : {
            ...current
          };

    safeStorageSetJSON(
      firstKey,
      first
    );
  }

  if(
    !safeStorageGet(
      "ynteligencia_first_seen_at"
    )
  ){
    safeStorageSet(
      "ynteligencia_first_seen_at",
      first.captured_at ||
      new Date()
        .toISOString()
    );
  }

  const previousSessionTouch=
    safeStorageGetJSON(
      previousTouchKey
    );

  /*
    Grava current touch somente uma vez por session_id.
    Reload da mesma sessão não deve sobrescrever a origem da visita.
  */
  const sessionTouchKey=
    `ynteligencia_session_touch_${YNTELIGENCIA_SESSION_ID}`;

  let sessionTouch=
    safeStorageGetJSON(
      sessionTouchKey
    );

  if(!sessionTouch){
    sessionTouch={
      ...current,

      session_id:
        YNTELIGENCIA_SESSION_ID,

      session_number:
        YNTELIGENCIA_SESSION
          .session_number
    };

    safeStorageSetJSON(
      sessionTouchKey,
      sessionTouch
    );

    if(
      previousSessionTouch &&
      previousSessionTouch.session_id !==
        YNTELIGENCIA_SESSION_ID
    ){
      safeStorageSetJSON(
        "ynteligencia_last_completed_touch_v2",
        previousSessionTouch
      );
    }

    safeStorageSetJSON(
      previousTouchKey,
      sessionTouch
    );
  }

  const previous=
    safeStorageGetJSON(
      "ynteligencia_last_completed_touch_v2"
    );

  const sameCampaignAsPrevious=
    Boolean(
      previous &&
      sessionTouch &&
      clean(previous.campaign) &&
      clean(sessionTouch.campaign) &&
      norm(previous.campaign) ===
        norm(sessionTouch.campaign)
    );

  const sameSourceAsPrevious=
    Boolean(
      previous &&
      sessionTouch &&
      clean(previous.source) &&
      clean(sessionTouch.source) &&
      norm(previous.source) ===
        norm(sessionTouch.source) &&
      norm(previous.medium) ===
        norm(sessionTouch.medium)
    );

  return {
    first_touch:
      first,

    current_touch:
      sessionTouch,

    previous_touch:
      previous,

    same_campaign_as_previous:
      sameCampaignAsPrevious,

    same_source_as_previous:
      sameSourceAsPrevious
  };
}

function yntCurrentUrlHasPaidAttribution(){
  const params=new URLSearchParams(window.location.search);
  const paidMedium=String(params.get("utm_medium") || "").toLowerCase().replace(/[ -]+/g,"_");
  return Boolean(
    params.get("gclid") || params.get("gbraid") || params.get("wbraid") ||
    YNT_PAID_UTM_MEDIA.has(paidMedium)
  );
}


;
// SOURCE: assets/js/integrations/supabase.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

async function supabaseTrack(
  eventType,
  metadata={}
){

  try{

    const response=await fetch(
      `${SUPABASE_URL}/rest/v1/events`,
      {
        method:"POST",

        headers:{
          "apikey":
            SUPABASE_PUBLISHABLE_KEY,

          "Content-Type":
            "application/json",

          "Prefer":
            "return=minimal"
        },

        body:JSON.stringify((()=>{

          /*
            EVENTOS DO APP · CONTEXTO PADRÃO
            --------------------------------
            A tabela events possui property_id no nível principal.
            Antes vários eventos guardavam o imóvel somente dentro
            de metadata, deixando a coluna property_id como NULL.
          */
          const propertyIdCandidate=
            clean(
              metadata?.property_uuid ||
              metadata?.property?.db_id ||
              metadata?.property_id ||
              metadata?.property?.id ||
              ""
            );

          /*
            public.events.property_id é UUID.
            IDs como "orulo:51327:78637" continuam no metadata,
            mas NUNCA são enviados para a coluna UUID.
          */
          const isUuid=
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
              .test(propertyIdCandidate);

          const resolvedPropertyId=
            isUuid
              ? propertyIdCandidate
              : "";

          const params=
            new URLSearchParams(
              window.location.search
            );

          const campaignIntent={
            mode:
              params.get("modo") || "",

            neighborhood:
              params.get("bairro") ||
              params.get("busca") ||
              (
                typeof adIntent!=="undefined"
                  ? adIntent?.neighborhood
                  : ""
              ) ||
              "",

            region:
              params.get("regiao") ||
              "",

            bedrooms:
              Number(
                params.get("dormitorios") ||
                (
                  typeof adIntent!=="undefined"
                    ? adIntent?.bedrooms
                    : 0
                ) ||
                0
              ) || 0,

            min_price:
              Number(
                params.get("valor_min") ||
                (
                  typeof adIntent!=="undefined"
                    ? adIntent?.minPrice
                    : 0
                ) ||
                0
              ) || 0,

            max_price:
              Number(
                params.get("valor_max") ||
                (
                  typeof adIntent!=="undefined"
                    ? adIntent?.maxPrice
                    : 0
                ) ||
                0
              ) || 0,

            type:
              params.get("tipo") || "",

            city:
              params.get("cidade") ||
              (
                typeof activeCity!=="undefined"
                  ? activeCity
                  : ""
              ) ||
              "",

            state:
              params.get("estado") ||
              (
                typeof activeState!=="undefined"
                  ? activeState
                  : ""
              ) ||
              ""
          };

          touchYnteligenciaSession();

          const eventSequence=
            nextYnteligenciaEventSequence();

          const previousEvent=
            getYnteligenciaPreviousEvent();

          const currentEventForJourney={
            sequence:
              eventSequence,

            event_type:
              eventType,

            property_id:
              resolvedPropertyId || "",

            created_at:
              new Date()
                .toISOString()
          };

          setYnteligenciaPreviousEvent(
            currentEventForJourney
          );

          return {

            session_id:
              YNTELIGENCIA_SESSION_ID,

            /*
              Só enviamos quando existe.
              Para eventos gerais, fica null.
            */
            property_id:
              resolvedPropertyId || null,

            event_type:
              eventType,

            metadata:{
              ...metadata,

              page:
                location.pathname,

              search:
                location.search,

              source_mode:
                sourceMode || "usados",

              visitor_id:
                YNTELIGENCIA_VISITOR_ID,

              event_sequence:
                eventSequence,

              journey:{
                sequence:
                  eventSequence,

                previous_event_type:
                  previousEvent?.event_type ||
                  "",

                previous_property_id:
                  previousEvent?.property_id ||
                  "",

                previous_sequence:
                  Number(
                    previousEvent?.sequence
                  ) || 0
              },

              session:{
                number:
                  Number(
                    YNTELIGENCIA_SESSION
                      .session_number
                  ) || 1,

                is_returning:
                  Boolean(
                    YNTELIGENCIA_SESSION
                      .is_returning
                  ),

                started_at:
                  YNTELIGENCIA_SESSION
                    .started_at ||
                  "",

                previous_session_id:
                  YNTELIGENCIA_SESSION
                    .previous_session_id ||
                  "",

                previous_session_started_at:
                  YNTELIGENCIA_SESSION
                    .previous_session_started_at ||
                  "",

                days_since_last_visit:
                  Number.isFinite(
                    Number(
                      YNTELIGENCIA_SESSION
                        .days_since_last_visit
                    )
                  )
                    ? Number(
                        YNTELIGENCIA_SESSION
                          .days_since_last_visit
                      )
                    : null
              },

              campaign_intent:
                campaignIntent,

              /*
                Compatibilidade:
                attribution continua sendo a atribuição legada/última
                conhecida usada pela esteira atual.
              */
              attribution:{
                ...YNTELIGENCIA_ATTRIBUTION
              },

              first_touch:{
                ...YNTELIGENCIA_TOUCHES
                  .first_touch
              },

              current_touch:{
                ...YNTELIGENCIA_TOUCHES
                  .current_touch
              },

              previous_touch:
                YNTELIGENCIA_TOUCHES
                  .previous_touch
                  ? {
                      ...YNTELIGENCIA_TOUCHES
                        .previous_touch
                    }
                  : null,

              attribution_compare:{
                same_campaign_as_previous:
                  Boolean(
                    YNTELIGENCIA_TOUCHES
                      .same_campaign_as_previous
                  ),

                same_source_as_previous:
                  Boolean(
                    YNTELIGENCIA_TOUCHES
                      .same_source_as_previous
                  )
              }
            }

          };

        })())

      }
    );


    if(!response.ok){

      const detail=
        await response.text();

      console.warn(
        `Supabase ${eventType} não gravou:`,
        response.status,
        detail
      );

      return false;
    }

    return true;

  }catch(error){

    console.warn(
      `Falha Supabase ${eventType}:`,
      error
    );

    return false;
  }
}


;
// SOURCE: assets/js/integrations/ads.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function yntAdsAttribution(){
  const source = YNTELIGENCIA_TOUCHES.current_touch || {};
  return {
    gclid: source.gclid || "",
    gbraid: source.gbraid || "",
    wbraid: source.wbraid || "",
    utm_source: source.utm_source || "",
    utm_medium: source.utm_medium || "",
    utm_campaign: source.utm_campaign || "",
    utm_term: source.utm_term || "",
    utm_content: source.utm_content || ""
  };
}

function yntAdsTrack(eventName, detail){
  try{
    const property = detail && detail.property ? detail.property : null;
    const intent = detail && detail.intent ? detail.intent : null;
    const amount = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
    const inventory = clean(intent && (intent.inventory_source || intent.source)).toLowerCase();
    const dedupeKey = eventName === "ai_search" ? JSON.stringify([
      YNTELIGENCIA_VISITOR_ID,
      YNTELIGENCIA_SESSION_ID,
      eventName,
      property && property.property_id || "",
      norm(intent && intent.neighborhood),
      norm(intent && (intent.development || intent.project || intent.exact_name)),
      Math.round(amount(intent && intent.bedrooms)),
      amount(intent && (intent.min_price ?? intent.minPrice)),
      amount(intent && (intent.max_price ?? intent.maxPrice)),
      ["novos", "usados", "todos"].includes(inventory) ? inventory : ""
    ]) : [
      eventName,
      YNTELIGENCIA_SESSION_ID,
      property && property.property_id || "",
      intent && intent.neighborhood || "",
      intent && intent.development || "",
      intent && intent.bedrooms || "",
      intent && intent.max_price || ""
    ].join("|");
    const now = Date.now();
    const recent = window.__yntAdsRecent || (window.__yntAdsRecent = {});
    if(eventName !== "lead_created" && recent[dedupeKey] && now - recent[dedupeKey] < 15000){
      return Promise.resolve(null);
    }
    if(eventName !== "lead_created") recent[dedupeKey] = now;
    const payload = {
      product:"ynteligencia",
      event_name:eventName,
      visitor_id:YNTELIGENCIA_VISITOR_ID,
      session_id:YNTELIGENCIA_SESSION_ID,
      ...yntAdsAttribution(),
      intent,
      property
    };
    if(detail && detail.event_id) payload.event_id = detail.event_id;
    return fetch("/api/ads?action=event", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      keepalive:true,
      body:JSON.stringify(payload)
    }).then(response => response.json().then(data => (
      response.ok && data && data.success && data.event_id ? data : null
    )).catch(() => null)).catch(() => null);
  }catch(error){
    return Promise.resolve(null);
  }
}

function yntAdsIntentFromState(){
  return {
    neighborhood:(aiSearchState && aiSearchState.neighborhood) || (typeof adIntent!=="undefined" && adIntent.neighborhood) || "",
    development:(aiSearchState && aiSearchState.exactName) || "",
    bedrooms:Number((aiSearchState && aiSearchState.bedrooms) || (typeof adIntent!=="undefined" && adIntent.bedrooms) || 0) || 0,
    min_price:Number((aiSearchState && aiSearchState.minPrice) || (typeof adIntent!=="undefined" && adIntent.minPrice) || 0) || 0,
    max_price:Number((aiSearchState && aiSearchState.maxPrice) || (typeof adIntent!=="undefined" && adIntent.maxPrice) || 0) || 0,
    inventory_source:(aiSearchState && aiSearchState.inventorySource) || "todos"
  };
}


;
// SOURCE: assets/js/services/agent.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function yntAgentHandoffUrl(value){
  try{
    const url=new URL(String(value||""));
    const handoff=url.searchParams.get("handoff")||"";
    const keys=Array.from(url.searchParams.keys());
    if(url.origin!=="https://agente.yincorp.com.br")return "";
    if(url.pathname!=="/")return "";
    if(!/^[A-Za-z0-9_-]{43}$/.test(handoff))return "";
    if(keys.length!==1||keys[0]!=="handoff")return "";
    return url.toString();
  }catch(error){
    return "";
  }
}

function yntOpenAgentOnce(url){
  const popup=window.open("about:blank","_blank");
  if(!popup){
    window.location.assign(url);
    return;
  }
  try{
    popup.opener=null;
    const doc=popup.document;
    const link=doc.createElement("a");
    link.href=url;
    link.rel="noopener noreferrer";
    link.target="_self";
    (doc.body||doc.documentElement).appendChild(link);
    link.click();
  }catch(error){
    try{ popup.close(); }catch(closeError){}
    throw error;
  }
}

async function openHomeAgentConversation(){
  const attemptAt=Date.now();
  if(yntAgentHandoffPending ||
    (yntAgentHandoffLastAttempt!==null && attemptAt-yntAgentHandoffLastAttempt<750))return;
  yntAgentHandoffPending=true;
  yntAgentHandoffLastAttempt=attemptAt;
  try{
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if(!uuid.test(YNTELIGENCIA_VISITOR_ID) || !uuid.test(YNTELIGENCIA_SESSION_ID))throw new Error("handoff_identity");
    const transitionId=window.crypto?.randomUUID?.();
    if(!uuid.test(transitionId||""))throw new Error("handoff_transition");
    const origins=new Set(["https://app.yincorp.com.br","https://www.yincorp.com.br","https://yincorp.com.br"]);
    const back=new URL("/",origins.has(location.origin)?location.origin:"https://app.yincorp.com.br");
    back.searchParams.set("vid",YNTELIGENCIA_VISITOR_ID);
    const returnUrl=window.YntPropertyHandoff?.safeReturnUrl(back.toString());
    if(!returnUrl)throw new Error("handoff_return");
    const envelope={version:1,kind:"general",entryPoint:"home.manual_ai",source_product:"ynteligencia",
      visitorId:YNTELIGENCIA_VISITOR_ID,sessionId:YNTELIGENCIA_SESSION_ID,
      transitionId,returnUrl,context:{}};
    if(yntHasPaidClickContext())envelope.paidContext={isPaid:true,intent:null};
    // Attribution and already declared intent stay on the existing tracking lane.
    const attribution=yntAdsAttribution();
    const response=await fetch("/api/ads?action=create-handoff",{
      method:"POST",headers:{"Content-Type":"application/json"},
      signal:typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?AbortSignal.timeout(8000):undefined,
      body:JSON.stringify({...envelope,tracking:{context:"home",declared_intent:yntAdsIntentFromState(),
        current_touch:attribution,attribution}})
    });
    const data=await response.json().catch(()=>null);
    const url=yntAgentHandoffUrl(data?.url);
    if(!response.ok || data?.success!==true || data?.error==="handoff_disabled" || !url)throw new Error("handoff");
    yntOpenAgentOnce(url);
  }catch(error){
    console.warn("YNT_HOME_AGENT_DIRECT_OPEN");
    try{
      yntOpenAgentOnce("https://agente.yincorp.com.br/");
    }catch(navigationError){
      window.location.assign("https://agente.yincorp.com.br/");
    }
  }finally{
    yntAgentHandoffPending=false;
  }
}

async function openAgentConversation(property){
  const attemptAt=Date.now();
  if(!property||yntAgentHandoffPending||
    (yntAgentHandoffLastAttempt!==null&&attemptAt-yntAgentHandoffLastAttempt<750))return;
  yntAgentHandoffPending=true;
  yntAgentHandoffLastAttempt=attemptAt;
  const status=document.querySelector("#photoModal .detail-agent-status");
  if(status){
    status.hidden=true;
    status.textContent="";
  }

  try{
    const envelope=window.YntPropertyHandoff?.buildEnvelope(property,{
      visitorId:YNTELIGENCIA_VISITOR_ID,sessionId:YNTELIGENCIA_SESSION_ID,
      crypto:window.crypto,origin:location.origin,isPaid:yntHasPaidClickContext()
    });
    if(!envelope)throw new Error("handoff_context");
    const attribution=yntAdsAttribution();
    const response=await fetch("/api/ads?action=create-handoff",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      signal:typeof AbortSignal!=="undefined"&&typeof AbortSignal.timeout==="function"?AbortSignal.timeout(8000):undefined,
      body:JSON.stringify({...envelope,tracking:{
        declared_intent:yntAdsIntentFromState(),current_touch:attribution,attribution,
        property:{development:window.YntPropertyHandoff.safeText(property.development||property.development_name)||""}
      }})
    });
    const data=await response.json().catch(()=>null);
    if(data&&data.error==="handoff_disabled"){
      openAiAssistant(property);
      return;
    }
    const url=yntAgentHandoffUrl(data&&data.url);
    if(!response.ok||data?.success!==true||!url)throw new Error("handoff");
    yntOpenAgentOnce(url);
  }catch(error){
    openAiAssistant(property);
  }finally{
    yntAgentHandoffPending=false;
  }
}


;
// SOURCE: assets/js/services/leads.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function yntLeadConversionId(propertyId){
  const key = "ynteligencia_lead_conversion_" + String(YNTELIGENCIA_VISITOR_ID || "") + "_" + String(propertyId || "");
  const maxAge = 15 * 60 * 1000;
  try{
    const stored = JSON.parse(sessionStorage.getItem(key) || "null");
    if(stored && stored.id && Date.now() - Number(stored.at) < maxAge) return String(stored.id);
  }catch(error){}
  const id = window.crypto && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "lead-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2);
  try{
    sessionStorage.setItem(key, JSON.stringify({ id: id, at: Date.now() }));
  }catch(error){}
  return id;
}

function openPropertySpecialist(p){
  if(!p)return;
  try{
    gtag("event","property_whatsapp_click",{
      property_id:String(p.id||""),
      property_name:p.name||"",
      neighborhood:p.neighborhood||"",
      property_value:Number(p.value)||0
    });
  }catch(error){}
  supabaseTrack("property_whatsapp_click",{
    property_id:String(p.id||""),
    property_name:p.name||"",
    neighborhood:p.neighborhood||"",
    property_value:Number(p.value)||0
  });
  openLeadCapture(p);
}

function interest(
  id,
  name
){

  const p=propertyForInteraction(id);


  try{

    gtag(
      'event',
      'property_interest',
      {

        property_id:
          String(id || ""),

        property_name:
          name || "",

        neighborhood:
          p?.neighborhood || "",

        property_value:
          Number(
            p?.value
          ) || 0,

        match_score:
          Number(
            p?.match?.score
          ) || 0,

        region:
          profile.region || "",

        budget:
          Number(
            profile.budget
          ) || 0,

        inventory_source:
          p?.source ||
          sourceMode ||
          "usados",

      }
    );

  }catch(error){

    console.warn(
      "Não foi possível registrar property_interest:",
      error
    );
  }


  supabaseTrack(
    "property_interest",
    {

      property:{

        id:
          String(id||""),

        name:
          name||"",

        neighborhood:
          p?.neighborhood||"",

        value:
          Number(
            p?.value
          )||0,

        match_score:
          Number(
            p?.match?.score
          )||0
      },

      profile:{
        ...profile
      }
    }
  );


  openLeadCapture(
    p || {
      id,
      name
    }
  );
}

function openLeadCapture(p,prefill={}){
  yntAdsTrack("specialist_cta_opened", {
    intent: yntAdsIntentFromState(),
    property:{
      property_id: String(p && (p.id || p.property_id) || ""),
      name: p && (p.name || p.property_name) || "",
      neighborhood: p && p.neighborhood || "",
      bedrooms: Number(p && p.bedrooms)||0,
      price: Number(p && (p.value || p.property_value))||0,
      inventory_source: p && (p.source || p.inventory_source) || ""
    }
  });

  const selectedProperty=aiSelectLeadProperty(p, aiOpenedProperties);
  if(selectedProperty.primary && aiSyntheticPropertyId(p?.id)){
    p=selectedProperty.primary;
  }

  const fromMatchIa=Boolean(
    String(prefill.source||"").startsWith("match_ia") ||
    aiLeadConversation.length
  );

  const old=
    document.getElementById(
      "leadModal"
    );


  if(old)old.remove();


  const modal=
    document.createElement(
      "div"
    );


  modal.id=
    "leadModal";


  modal.style.cssText=
    "position:fixed;inset:0;z-index:400;background:rgba(7,15,27,.82);display:flex;align-items:center;justify-content:center;padding:20px";


  modal.innerHTML=
    `
    <div style="width:min(520px,100%);background:#fff;border-radius:20px;padding:26px;position:relative;box-shadow:0 24px 70px rgba(0,0,0,.28)">

      <button
        type="button"
        aria-label="Fechar"
        onclick="document.getElementById('leadModal')?.remove()"
        style="position:absolute;top:14px;right:14px;width:38px;height:38px;border:0;border-radius:50%;background:#f0f3f6;color:#101a2b;font-size:22px;font-weight:900">
        ×
      </button>

      <div style="font-size:11px;font-weight:900;letter-spacing:1.3px;color:#D6B56F;margin-bottom:8px">
        ATENDIMENTO PERSONALIZADO
      </div>

      <h2 style="margin:0 42px 8px 0;font-size:28px;line-height:1.1;color:#182232">
        ${prefill.phone ? "Vamos concluir seu atendimento" : "Quer informações sobre este imóvel?"}
      </h2>

      <p style="margin:0 0 18px;color:#697487;line-height:1.5">
        ${prefill.phone
          ? `Seu WhatsApp já veio da conversa com a Match IA. Confirme nome e e-mail para registrar o atendimento sobre ${esc(p.name||"este imóvel")}.`
          : esc(p.name||"Imóvel selecionado")}
      </p>

      <form id="leadCaptureForm">

        <input
          id="leadName"
          class="field"
          required
          autocomplete="name"
          placeholder="Seu nome"
          style="margin-bottom:10px">

        <input
          id="leadPhone"
          class="field"
          required
          autocomplete="tel"
          inputmode="tel"
          placeholder="WhatsApp / telefone"
          style="margin-bottom:10px">

        <input
          id="leadEmail"
          class="field"
          type="email"
          required
          autocomplete="email"
          inputmode="email"
          placeholder="Seu e-mail"
          style="margin-bottom:14px">

        <button
          class="primary"
          type="submit"
          style="width:100%;border:0">
          ${prefill.phone ? "Confirmar e falar com Rafael" : "Continuar no WhatsApp"}
        </button>

        <p style="margin:10px 0 0;color:#8a94a3;font-size:11px;line-height:1.4;text-align:center">
          Seus dados são registrados para atendimento antes de abrir a conversa no WhatsApp.
        </p>

      </form>

    </div>
    `;


  modal.addEventListener(
    "click",
    e=>{

      if(e.target===modal){

        modal.remove();
      }
    }
  );


  document
    .body
    .appendChild(
      modal
    );

  if(fromMatchIa){
    modal.dataset.aiLead="1";
    aiTrackLeadEvent("ai_lead_form_opened",{
      property_id:String(p?.id||""),
      source:prefill.source||"match_ia"
    });
  }

  const savedLeadName=localStorage.getItem("yincorp_contact_name") || "";
  const savedLeadPhone=localStorage.getItem("yincorp_contact_phone") || "";
  const savedLeadEmail=localStorage.getItem("yincorp_contact_email") || "";

  const leadNameInput=document.getElementById("leadName");
  const leadPhoneInput=document.getElementById("leadPhone");
  const leadEmailInput=document.getElementById("leadEmail");

  if(leadNameInput && !leadNameInput.value) leadNameInput.value=clean(prefill.name||"") || savedLeadName;
  if(leadPhoneInput && !leadPhoneInput.value) leadPhoneInput.value=clean(prefill.phone||"") || savedLeadPhone;
  if(leadEmailInput && !leadEmailInput.value) leadEmailInput.value=clean(prefill.email||"") || savedLeadEmail;

  if(prefill.phone){
    setTimeout(()=>{
      if(!leadNameInput?.value) leadNameInput?.focus();
      else if(!leadEmailInput?.value) leadEmailInput?.focus();
    },80);
  }


  document
    .getElementById(
      "leadCaptureForm"
    )
    .addEventListener(
      "submit",
      async e=>{

        e.preventDefault();
        if(e.currentTarget.dataset.sending==="true")return;
        e.currentTarget.dataset.sending="true";


        const form=
          e.currentTarget;


        const submitButton=
          form.querySelector(
            'button[type="submit"]'
          );


        const lead={

          name:
            clean(
              document
                .getElementById(
                  "leadName"
                )
                .value
            ),

          phone:
            clean(
              document
                .getElementById(
                  "leadPhone"
                )
                .value
            ),

          email:
            clean(
              document
                .getElementById(
                  "leadEmail"
                )
                .value
            ),

          property_id:
            String(
              p.id||""
            ),

          property_name:
            p.name||"",

          neighborhood:
            p.neighborhood||"",

          property_value:
            Number(
              p.value
            )||0,

          bedrooms:
            Number(p.bedrooms)||Number(aiSearchState?.bedrooms)||0,

          inventory_source:
            p.source||"",

          match_score:
            Number(
              p.match?.score
            )||0,

          ai_context:
            aiLeadContext(p),

          profile:{
            ...profile
          },

          lead_summary:
            aiLeadSummary(),

          conversation:
            aiLeadConversation.slice(-8).map(item=>({
              role:item.role,
              content:item.content,
              at:item.at
            })),

          conversation_text:
            aiLeadConversation.slice(-8)
              .map(item=>`${item.role==="user" ? "Cliente" : "IA"}: ${item.content}`)
              .join("\n"),

          created_at:
            new Date()
              .toISOString()
        };


        submitButton.disabled=
          true;

        submitButton.dataset.leadLabel=
          submitButton.textContent;

        submitButton.textContent=
          "Enviando...";

        if(modal.dataset.aiLead==="1"){
          aiTrackLeadEvent("ai_lead_submitted",{
            property_id:lead.property_id
          });
        }


        try{

          /*
            O mesmo id segue para /api/lead, ads_events.lead_created
            e a telemetria sem PII. Não é a chave primária de public.leads.
          */
          const leadEventId=
            yntLeadConversionId(
              lead.property_id
            );

          /* =================================================
             PRAEDIUM
          ================================================= */

          const praediumResponse=
            await fetch(
              "/api/lead",
              {

                method:"POST",

                headers:{
                  "Content-Type":
                    "application/json"
                },

                body:JSON.stringify({

                  nome:
                    lead.name,

                  telefone:
                    lead.phone,

                  email:
                    lead.email,

                  origem:
                    prefill.source==="match_ia_phone" ? "ynteligencia_match_ia" : "ynteligencia",

                  pagina:
                    window.location.href,

                  gclid:
                    YNTELIGENCIA_ATTRIBUTION.gclid,

                  gbraid:
                    YNTELIGENCIA_ATTRIBUTION.gbraid,

                  wbraid:
                    YNTELIGENCIA_ATTRIBUTION.wbraid,

                  utm_source:
                    YNTELIGENCIA_ATTRIBUTION.utm_source,

                  utm_medium:
                    YNTELIGENCIA_ATTRIBUTION.utm_medium,

                  utm_campaign:
                    YNTELIGENCIA_ATTRIBUTION.utm_campaign,

                  utm_content:
                    YNTELIGENCIA_ATTRIBUTION.utm_content,

                  utm_term:
                    YNTELIGENCIA_ATTRIBUTION.utm_term,

                  empreendimento:
                    lead.property_name,

                  property_id:
                    lead.property_id,

                  neighborhood:
                    lead.neighborhood,

                  property_value:
                    lead.property_value,

                  bedrooms:
                    lead.bedrooms,

                  inventory_source:
                    lead.inventory_source,

                  match_score:
                    lead.match_score,

                  session_id:
                    YNTELIGENCIA_SESSION_ID,

                  visitor_id:
                    YNTELIGENCIA_VISITOR_ID,

                  lead_event_id:
                    leadEventId,

                  session:{
                    number:
                      Number(
                        YNTELIGENCIA_SESSION
                          .session_number
                      ) || 1,

                    is_returning:
                      Boolean(
                        YNTELIGENCIA_SESSION
                          .is_returning
                      ),

                    previous_session_id:
                      YNTELIGENCIA_SESSION
                        .previous_session_id ||
                      "",

                    days_since_last_visit:
                      Number.isFinite(
                        Number(
                          YNTELIGENCIA_SESSION
                            .days_since_last_visit
                        )
                      )
                        ? Number(
                            YNTELIGENCIA_SESSION
                              .days_since_last_visit
                          )
                        : null
                  },

                  declared_profile:{
                    purpose: profile.purpose || "",
                    region: profile.region || "",
                    budget: Number(profile.budget) || 0,
                    budget_min: Number(profile.budgetMin) || 0,
                    budget_max: Number(profile.budgetMax) || 0,
                    budget_label: profile.budgetLabel || "",
                    bedrooms: profile.bedrooms,
                    timing: profile.timing || "",
                    types: Array.isArray(profile.types) ? profile.types : [],
                    feature: Array.isArray(profile.feature) ? profile.feature : []
                  },

                  touches:{
                    first_touch:{
                      ...YNTELIGENCIA_TOUCHES.first_touch
                    },
                    current_touch:{
                      ...YNTELIGENCIA_TOUCHES.current_touch
                    },
                    previous_touch:
                      YNTELIGENCIA_TOUCHES.previous_touch
                        ? { ...YNTELIGENCIA_TOUCHES.previous_touch }
                        : null
                  },

                  lead_summary:
                    lead.lead_summary,

                  conversation:
                    lead.conversation,

                  conversation_text:
                    lead.conversation_text,

                  ai_context:
                    lead.ai_context,

                  mensagem:

                    `${prefill.source==="match_ia_phone" ? "NOVO LEAD MATCH IA" : "NOVO LEAD YNTELIGENCIA"} | ` +

                    `Código do imóvel: ${lead.property_id} | ` +

                    `Imóvel: ${lead.property_name} | ` +

                    `Bairro: ${lead.neighborhood} | ` +

                    `${money(lead.property_value)==="Valor sob consulta" ? "Valor sob consulta" : "Valor: "+money(lead.property_value)} | ` +

                    `MATCH: ${lead.match_score}% | ` +

                    `Região buscada: ${profile.region||""} | ` +

                    `Orçamento: ${Number(profile.budget)||0} | ` +

                    `Dormitórios: ${profile.bedrooms ?? ""} | ` +

                    `Momento de compra: ${profile.timing||""}`

                })

              }
            );


          const delivery=await praediumResponse.json().catch(()=>null);
          const leadPersisted=delivery?.supabase===true;
          const leadNotified=delivery?.email_sent===true;
          if(
            !praediumResponse.ok ||
            delivery?.success!==true ||
            (!leadPersisted && !leadNotified)
          ){

            throw new Error(
              delivery?.error ||
              "A API não confirmou o armazenamento do lead."
            );
          }

          if(!leadPersisted){
            throw new Error(
              "O aviso foi enviado, mas o registro do lead não foi confirmado."
            );
          }

          if(modal.dataset.aiLead==="1"){
            aiTrackLeadEvent("ai_lead_success",{
              property_id:lead.property_id
            });
          }

          const recordedLead = await yntAdsTrack("lead_created", {
            event_id: leadEventId,
            intent: yntAdsIntentFromState(),
            property:{
              property_id: lead.property_id || "",
              name: lead.property_name || "",
              neighborhood: lead.neighborhood || "",
              bedrooms: Number(lead.bedrooms)||0,
              price: Number(lead.property_value)||0,
              inventory_source: lead.inventory_source || ""
            }
          });
          const conversionId = recordedLead && recordedLead.event_id
            ? String(recordedLead.event_id)
            : "";


            /* =================================================
               GOOGLE ADS - CONVERSÃO LEAD YNTELIGENCIA
               O transaction_id é o event_id confirmado em ads_events.
               value 10 e BRL acompanham Lead Created no CSV.
            ================================================= */

            try{

              if(conversionId){
                gtag(
                  'event',
                  'conversion',
                  {
                    'send_to':
                      'AW-18371236623/1P2xCPmnzfccEI-mi7hE',
                    'transaction_id': conversionId,
                    'value': 10,
                    'currency': 'BRL'
                  }
                );
              }

            }catch(error){

              console.warn(
                "Não foi possível registrar a conversão no Google Ads:",
                error
              );
            }


          /* =================================================
             GA4
          ================================================= */

          try{

            gtag(
              'event',
              'lead_created',
              {

                property_id:
                  lead.property_id,

                property_name:
                  lead.property_name,

                neighborhood:
                  lead.neighborhood,

                property_value:
                  lead.property_value,

                match_score:
                  lead.match_score,

                region:
                  profile.region||"",

                budget:
                  Number(
                    profile.budget
                  )||0,

                inventory_source:
                  p.source ||
                  sourceMode ||
                  "usados",

                crm:
                  "praedium",

              }
            );

          }catch(error){

            console.warn(
              "Não foi possível registrar lead_created no GA4:",
              error
            );
          }


          /* =================================================
             SUPABASE EVENTS
          ================================================= */

          supabaseTrack(
            "lead_created",
            {
              property_id:
                String(lead.property_id || ""),

              property_name:
                lead.property_name || "",

              neighborhood:
                lead.neighborhood || "",

              property_value:
                Number(lead.property_value) || 0,

              match_score:
                Number(lead.match_score) || 0,

              inventory_source:
                lead.inventory_source || "",

              lead_event_id:
                leadEventId,

              source:
                prefill.source==="match_ia_phone"
                  ? "ynteligencia_match_ia"
                  : "ynteligencia",

              success: true
            }
          );


          /* =================================================
             META PIXEL
          ================================================= */

          try{

            if(
              typeof fbq==="function"
            ){

              fbq(
                'track',
                'Lead',
                {

                  content_name:
                    lead.property_name ||
                    "Ynteligencia",

                  content_category:
                    "Imóvel",

                  value:
                    lead.property_value ||
                    0,

                  currency:
                    "BRL"
                }
              );
            }

          }catch(error){

            console.warn(
              "Não foi possível registrar Lead no Meta Pixel:",
              error
            );
          }


          /* =================================================
             LOCAL STORAGE
          ================================================= */

          try{
            localStorage.setItem("yincorp_contact_name",lead.name || "");
            localStorage.setItem("yincorp_contact_phone",lead.phone || "");
            localStorage.setItem("yincorp_contact_email",lead.email || "");



            const leads=
              JSON.parse(
                localStorage.getItem(
                  "ynteligencia_leads"
                ) ||
                "[]"
              );


            leads.push({

              ...lead,

              crm:
                "praedium",

              crm_sent:
                true
            });


            localStorage.setItem(

              "ynteligencia_leads",

              JSON.stringify(
                leads.slice(-100)
              )
            );

          }catch{}


          document
            .getElementById(
              "leadModal"
            )
            ?.remove();


          showToast(
            "Pedido enviado ao Rafael."
          );


          const whatsappMessage=[
            `Olá, meu nome é ${lead.name}.`,
            `Vim pela Ynteligencia e quero conhecer este imóvel: ${lead.property_name || "imóvel selecionado"}.`,
            lead.neighborhood ? `Bairro: ${lead.neighborhood}.` : "",
            money(lead.property_value)==="Valor sob consulta"
              ? "Valor sob consulta."
              : `Valor: ${money(lead.property_value)}.`,
            lead.property_id ? `Código: ${lead.property_id}.` : "",
            lead.match_score ? `MATCH: ${lead.match_score}%.` : ""
          ]
          .filter(Boolean)
          .join("\n");

          const whatsappUrl=
            `https://wa.me/5511992976368?text=${encodeURIComponent(whatsappMessage)}`;

          console.log(
            "YNT_WHATSAPP_OPEN",
            {
              phone:"5511992976368",
              property_id:lead.property_id||"",
              property_name:lead.property_name||""
            }
          );

          window.location.href=
            whatsappUrl;


        }catch(error){


          console.error(
            "Erro ao enviar lead para o Praedium:",
            error
          );

          if(modal.dataset.aiLead==="1"){
            aiTrackLeadEvent("ai_lead_error",{
              property_id:lead.property_id,
              message:error?.message||""
            });
          }


          try{

            const leads=
              JSON.parse(
                localStorage.getItem(
                  "ynteligencia_leads"
                ) ||
                "[]"
              );


            leads.push({

              ...lead,

              crm:
                "praedium",

              crm_sent:
                false
            });


            localStorage.setItem(

              "ynteligencia_leads",

              JSON.stringify(
                leads.slice(-100)
              )
            );

          }catch{}


          showToast(
            "Não foi possível enviar agora. Tente novamente em instantes."
          );


          form.dataset.sending="false";
          submitButton.disabled=
            false;


          submitButton.textContent=
            submitButton.dataset.leadLabel ||
            "Continuar no WhatsApp";
        }
      }
    );
}


;
// SOURCE: assets/js/services/tracking.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function scheduleYnteligenciaSessionStart(){
  const sentKey=
    `ynteligencia_session_start_sent_${YNTELIGENCIA_SESSION_ID}`;

  if(
    safeStorageGet(sentKey)
  ){
    return;
  }

  safeStorageSet(
    sentKey,
    "1"
  );

  const send=()=>{
    supabaseTrack(
      "session_start",
      {
        visitor_id:
          YNTELIGENCIA_VISITOR_ID,

        session_number:
          Number(
            YNTELIGENCIA_SESSION
              .session_number
          ) || 1,

        journey_tracking_version:
          "v1",

        is_returning:
          Boolean(
            YNTELIGENCIA_SESSION
              .is_returning
          ),

        previous_session_id:
          YNTELIGENCIA_SESSION
            .previous_session_id ||
          "",

        days_since_last_visit:
          Number.isFinite(
            Number(
              YNTELIGENCIA_SESSION
                .days_since_last_visit
            )
          )
            ? Number(
                YNTELIGENCIA_SESSION
                  .days_since_last_visit
              )
            : null,

        first_seen_at:
          safeStorageGet(
            "ynteligencia_first_seen_at"
          ) || "",

        first_touch:{
          ...YNTELIGENCIA_TOUCHES
            .first_touch
        },

        current_touch:{
          ...YNTELIGENCIA_TOUCHES
            .current_touch
        },

        previous_touch:
          YNTELIGENCIA_TOUCHES
            .previous_touch
            ? {
                ...YNTELIGENCIA_TOUCHES
                  .previous_touch
              }
            : null,

        same_campaign_as_previous:
          Boolean(
            YNTELIGENCIA_TOUCHES
              .same_campaign_as_previous
          ),

        same_source_as_previous:
          Boolean(
            YNTELIGENCIA_TOUCHES
              .same_source_as_previous
          )
      }
    ).catch(()=>{});

    const adsEntry = yntAdsAttribution();
    if(
      adsEntry.gclid ||
      adsEntry.gbraid ||
      adsEntry.wbraid ||
      adsEntry.utm_source ||
      adsEntry.utm_campaign
    ){
      yntAdsTrack("ad_entry", {
        intent:{
          neighborhood: typeof adIntent!=="undefined" ? adIntent.neighborhood || "" : "",
          development:"",
          bedrooms:Number(typeof adIntent!=="undefined" ? adIntent.bedrooms : 0) || 0,
          min_price:Number(typeof adIntent!=="undefined" ? adIntent.minPrice : 0) || 0,
          max_price:Number(typeof adIntent!=="undefined" ? adIntent.maxPrice : 0) || 0,
          inventory_source:"todos"
        }
      });
    }
  };

  /*
    Espera o script terminar de inicializar sourceMode/adIntent.
  */
  if(document.readyState==="complete"){
    setTimeout(send,0);
  }else{
    window.addEventListener(
      "load",
      ()=>setTimeout(send,0),
      {once:true}
    );
  }
}

function trackProfileCompleted(){

  try{

    gtag(
      'event',
      'profile_completed',
      {

        purpose:
          profile.purpose || "",

        region:
          profile.region || "",

        budget:
          Number(
            profile.budget
          ) || 0,

        bedrooms:
          profile.bedrooms ?? "",

        timing:
          profile.timing || "",

        property_types:
          (
            profile.types || []
          ).join("|"),

        priorities:
          (
            profile.feature || []
          ).join("|"),

      }
    );

  }catch(error){

    console.warn(
      "Não foi possível registrar profile_completed:",
      error
    );
  }


  supabaseTrack(
    "profile_completed",
    {
      profile:{
        ...profile
      }
    }
  );
}


;
// SOURCE: assets/js/services/push.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

function yntPushConfigured(){
  return Boolean(
    YNT_ONESIGNAL_APP_ID &&
    YNT_ONESIGNAL_APP_ID !==
      "YOUR_ONESIGNAL_APP_ID"
  );
}

function yntCurrentPushProfile(intentOverride=null){
  const params=new URLSearchParams(window.location.search);
  const override=intentOverride && typeof intentOverride==="object" ? intentOverride : null;
  const has=(key)=>Boolean(override && Object.prototype.hasOwnProperty.call(override,key));
  const getValue=(id)=>clean(document.getElementById(id)?.value || "");
  const numberValue=(value)=>{ const n=Number(value); return Number.isFinite(n) ? n : 0; };
  const paramNumber=(...keys)=>{
    for(const key of keys){ const value=params.get(key); if(value!==null && value!=="") return numberValue(value); }
    return 0;
  };
  const minPrice=has("minPrice")
    ? numberValue(override.minPrice)
    : ((typeof parseBRLInput==="function" ? parseBRLInput(getValue("catalogMinPrice") || getValue("minPrice")) : 0) || paramNumber("valor_min","min_price"));
  const maxPrice=has("maxPrice")
    ? numberValue(override.maxPrice)
    : ((typeof parseBRLInput==="function" ? parseBRLInput(getValue("catalogMaxPrice") || getValue("maxPrice")) : 0) || paramNumber("valor_max","max_price"));
  return {
    city:clean(getValue("catalogCity") || params.get("cidade") || params.get("city") || (typeof activeCity!=="undefined" ? activeCity : "") || "São Paulo"),
    state:clean(getValue("catalogState") || params.get("estado") || params.get("state") || (typeof activeState!=="undefined" ? activeState : "") || "SP"),
    region:has("region") ? clean(override.region) : clean(getValue("catalogRegionSelect") || params.get("regiao") || params.get("region") || (typeof catalogRegion!=="undefined" ? catalogRegion : "") || ""),
    neighborhood:has("neighborhood") ? clean(override.neighborhood) : clean(getValue("catalogNeighborhood") || params.get("bairro") || params.get("neighborhood") || params.get("busca") || ""),
    type:has("type") ? clean(override.type) : clean(getValue("catalogType") || params.get("tipo") || params.get("type") || ""),
    search:has("search") ? clean(override.search) : clean(params.get("busca") || params.get("search") || ""),
    development:has("development") ? clean(override.development) : clean(params.get("empreendimento") || params.get("development") || ""),
    source:clean(getValue("catalogSource") || params.get("source") || "todos") || "todos",
    bedrooms:has("bedrooms") ? numberValue(override.bedrooms) : numberValue(getValue("catalogBedrooms") || getValue("bedrooms") || params.get("dormitorios") || params.get("bedrooms") || 0),
    min_price:Number(minPrice)||0,
    max_price:Number(maxPrice)||0,
    cadence:"daily",
    max_pushes:30
  };
}

function yntPushProfileHasIntent(
  profile
){
  return Boolean(
    profile?.neighborhood ||
    profile?.region ||
    profile?.type ||
    Number(profile?.bedrooms)>0 ||
    Number(profile?.min_price)>0 ||
    Number(profile?.max_price)>0
  );
}

function yntPushTagsFromProfile(
  profile
){
  return {
    ynt_visitor_id:
      String(
        YNTELIGENCIA_VISITOR_ID
      ),

    ynt_push_enabled:
      "1",

    ynt_push_cadence:
      "daily",

    ynt_neighborhood:
      String(
        profile.neighborhood ||
        ""
      ),

    ynt_region:
      String(
        profile.region ||
        ""
      ),

    ynt_type:
      String(
        profile.type ||
        ""
      ),

    ynt_source:
      String(
        profile.source ||
        "todos"
      ),

    ynt_search:
      String(profile.search || ""),

    ynt_development:
      String(profile.development || ""),

    ynt_bedrooms:
      String(
        Number(
          profile.bedrooms
        ) || 0
      ),

    ynt_min_price:
      String(
        Number(
          profile.min_price
        ) || 0
      ),

    ynt_max_price:
      String(
        Number(
          profile.max_price
        ) || 0
      ),

    ynt_city:
      String(
        profile.city ||
        ""
      ),

    ynt_state:
      String(
        profile.state ||
        ""
      )
  };
}

function refreshPushAlertCTA(){
  const wrap=
    document.getElementById(
      "catalogPushWrap"
    );

  const btn=
    document.getElementById(
      "catalogPushBtn"
    );

  const note=
    document.getElementById(
      "catalogPushNote"
    );

  if(
    !wrap ||
    !btn
  ){
    return;
  }

  const profile=
    yntCurrentPushProfile();

  const hasInventory=
    (
      Number(
        typeof newCatalogTotal!=="undefined"
          ? newCatalogTotal
          : 0
      ) > 0
    ) ||
    (
      Array.isArray(
        typeof newPropertiesCache!=="undefined"
          ? newPropertiesCache
          : []
      ) &&
      newPropertiesCache.length > 0
    );

  wrap.style.display=
    (
      hasInventory &&
      yntPushProfileHasIntent(
        profile
      )
    )
      ? "block"
      : "none";

  console.log(
    "YNT_PUSH_CTA_STATE",
    {
      hasInventory,
      profile,
      hasIntent:
        yntPushProfileHasIntent(
          profile
        ),
      configured:
        yntPushConfigured(),
      visible:
        wrap.style.display !==
        "none"
    }
  );

  if(!yntPushConfigured()){
    btn.disabled=false;

    btn.textContent=
      "🔔 Ativar alerta diário";

    if(note){
      note.textContent=
        "Configuração OneSignal ainda precisa do App ID.";
    }

    return;
  }

  if(
    YNT_ONESIGNAL_READY &&
    YNT_ONESIGNAL_INSTANCE
      ?.User
      ?.PushSubscription
      ?.optedIn
  ){
    btn.classList.add(
      "is-active"
    );

    btn.textContent=
      "✓ Alerta diário ativado";

    if(note){
      note.textContent=
        "Você receberá no máximo 1 imóvel por dia desta busca.";
    }

  }else{
    btn.classList.remove(
      "is-active"
    );

    btn.textContent=
      "🔔 Receber 1 imóvel por dia desta busca";

    if(note){
      note.textContent=
        "Só envia opções compatíveis que você ainda não recebeu.";
    }
  }
}

function yntPushProfileForProperty(p){
  /*
    Se o usuário chegou por uma busca/campanha, preservamos a faixa
    dessa busca. Caso tenha aberto o detalhe fora de uma busca,
    usamos bairro + dormitórios + origem do próprio imóvel.
  */
  const current=
    yntCurrentPushProfile();

  return {
    ...current,

    city:
      clean(
        p?.city ||
        current.city ||
        "São Paulo"
      ),

    state:
      clean(
        p?.state ||
        current.state ||
        "SP"
      ),

    neighborhood:
      clean(
        p?.neighborhood ||
        current.neighborhood ||
        ""
      ),

    type:
      clean(
        p?.type ||
        p?.property_type ||
        current.type ||
        ""
      ),

    source:
      clean(
        p?.source ||
        current.source ||
        "todos"
      ) || "todos",

    bedrooms:
      Number(
        p?.bedrooms ||
        current.bedrooms ||
        0
      ) || 0,

    /*
      Mantém preços explícitos da busca.
      Não inventamos uma faixa de preço a partir do imóvel.
    */
    min_price:
      Number(
        current.min_price
      ) || 0,

    max_price:
      Number(
        current.max_price
      ) || 0,

    cadence:
      "daily",

    max_pushes:
      30,

    seed_property_id:
      String(
        p?.id ||
        ""
      ),

    seed_property_name:
      clean(
        p?.name ||
        ""
      )
  };
}

async function activateYnteligenciaPushForProperty(
  p,
  btn
){
  if(!yntPushConfigured()){
    showToast(
      "O alerta ainda não está configurado."
    );
    return;
  }

  if(
    !YNT_ONESIGNAL_READY ||
    !YNT_ONESIGNAL_INSTANCE
  ){
    if(btn){
      btn.disabled=true;
      btn.querySelector(
        "span:last-child"
      ).textContent=
        "Carregando...";
    }

    const becameReady=
      await waitForYnteligenciaPushReady(
        8000
      );

    if(btn){
      btn.disabled=false;
    }

    if(!becameReady){
      console.error(
        "YNT_PUSH_NOT_READY",
        {
          configured:
            yntPushConfigured(),
          ready:
            YNT_ONESIGNAL_READY,
          hasInstance:
            Boolean(
              YNT_ONESIGNAL_INSTANCE
            ),
          lastError:
            window
              .YNT_ONESIGNAL_LAST_ERROR ||
            ""
        }
      );

      if(btn){
        btn.querySelector(
          "span:last-child"
        ).textContent=
          "LISTA V.I.P";
      }

      showToast(
        "Não foi possível iniciar os alertas. Recarregue a página e tente novamente."
      );
      return;
    }
  }

  const OneSignal=
    YNT_ONESIGNAL_INSTANCE;

  const profile=
    yntPushProfileForProperty(
      p
    );

  if(
    !yntPushProfileHasIntent(
      profile
    )
  ){
    showToast(
      "Não consegui identificar o perfil deste imóvel."
    );
    return;
  }

  try{
    if(btn){
      btn.disabled=true;
      btn.querySelector("span:last-child").textContent=
        "Ativando...";
    }

    const granted=
      OneSignal
        .Notifications
        .permission
        ? true
        : await OneSignal
            .Notifications
            .requestPermission();

    if(!granted){
      await supabaseTrack(
        "push_permission_denied",
        {
          property_id:
            String(p?.id||""),

          property_uuid:
            String(p?.db_id||""),

          push_profile:
            profile,

          push_origin:
            "property_detail"
        }
      );

      showToast(
        "As notificações não foram autorizadas."
      );
      return;
    }

    await yntSyncOneSignalIdentity(
      OneSignal,
      "before_optin"
    );

    await OneSignal
      .User
      .PushSubscription
      .optIn();

    const pushConfirmation=
      await yntWaitForConfirmedPushSubscription(
        OneSignal
      );

    if(
      !pushConfirmation.confirmed
    ){
      await supabaseTrack(
        "push_subscription_failed",
        {
          property_id:
            String(p?.id||""),

          property_uuid:
            String(p?.db_id||""),

          property_name:
            p?.name||"",

          push:{
            enabled:false,
            provider:"onesignal",
            permission:
              Boolean(
                OneSignal
                  ?.Notifications
                  ?.permission
              ),
            opted_in:
              pushConfirmation.optedIn,
            subscription_id:
              pushConfirmation.subscriptionId
          },

          visitor_id:
            YNTELIGENCIA_VISITOR_ID,

          push_profile:
            profile,

          push_origin:
            "property_detail"
        }
      );

      if(btn){
        btn.classList.remove(
          "is-active"
        );

        btn.querySelector("span:last-child").textContent=
          "Tentar novamente";
      }

      showToast(
        "A permissão foi aceita, mas o alerta ainda não foi confirmado."
      );

      return;
    }

    await OneSignal
      .User
      .addTags(
        yntPushTagsFromProfile(
          profile
        )
      );

    const subscriptionId=
      pushConfirmation
        .subscriptionId;

    await supabaseTrack(
      "push_subscribed",
      {
        property_id:
          String(p?.id||""),

        property_uuid:
          String(p?.db_id||""),

        property_name:
          p?.name||"",

        push:{
          enabled:true,
          provider:"onesignal",
          permission:true,
          opted_in:true,
          subscription_id:
            subscriptionId,
          cadence:"daily",
          max_pushes:30,
          subscribed_at:
            new Date().toISOString()
        },

        visitor_id:
          YNTELIGENCIA_VISITOR_ID,

        push_profile:
          profile,

        push_origin:
          "property_detail",

        attribution_at_subscription:{
          first_touch:{
            ...YNTELIGENCIA_TOUCHES
              .first_touch
          },

          current_touch:{
            ...YNTELIGENCIA_TOUCHES
              .current_touch
          }
        }
      }
    );

    if(btn){
      btn.classList.add(
        "is-active"
      );
      btn.querySelector("span:last-child").textContent=
        "Ativado";
    }

    showToast(
      "Oportunidades ativadas: até 1 imóvel por dia."
    );

  }catch(error){
    console.warn(
      "PUSH_PROPERTY_OPTIN_ERROR",
      error
    );

    await supabaseTrack(
      "push_subscription_error",
      {
        property_id:
          String(p?.id||""),

        push_origin:
          "property_detail",

        error:
          String(
            error?.message ||
            error ||
            ""
          ),

        push_profile:
          profile
      }
    );

    showToast(
      "Não foi possível ativar as oportunidades agora."
    );

  }finally{
    if(btn){
      btn.disabled=false;

      if(
        !btn.classList.contains(
          "is-active"
        )
      ){
        btn.querySelector("span:last-child").textContent=
          "LISTA V.I.P";
      }
    }
  }
}

async function activateYnteligenciaPush(intentOverride=null,{quiet=false}={}){
  const btn=document.getElementById("catalogPushBtn");
  const notify=(message)=>{ if(!quiet) showToast(message); };
  const fail=(reason,extra={})=>({success:false,permission:"unknown",optedIn:false,subscriptionId:"",alertConfigured:false,reason,...extra});

  if(!yntPushConfigured()){
    notify("Falta configurar o OneSignal App ID.");
    return fail("not_configured");
  }
  if(!YNT_ONESIGNAL_READY || !YNT_ONESIGNAL_INSTANCE){
    if(btn){btn.disabled=true;btn.textContent="CARREGANDO ALERTAS...";}
    const becameReady=await waitForYnteligenciaPushReady(8000);
    if(btn) btn.disabled=false;
    if(!becameReady){
      console.error("YNT_PUSH_NOT_READY",{configured:yntPushConfigured(),ready:YNT_ONESIGNAL_READY,hasInstance:Boolean(YNT_ONESIGNAL_INSTANCE),lastError:window.YNT_ONESIGNAL_LAST_ERROR||""});
      notify("Não foi possível iniciar os alertas. Recarregue a página e tente novamente.");
      refreshPushAlertCTA();
      return fail("sdk_not_ready");
    }
  }

  const OneSignal=YNT_ONESIGNAL_INSTANCE;
  const profile=yntCurrentPushProfile(intentOverride);
  if(!yntPushProfileHasIntent(profile)){
    notify("Faça uma busca antes de ativar o alerta.");
    return fail("missing_intent",{profile});
  }

  try{
    if(btn){btn.disabled=true;btn.textContent="ATIVANDO ALERTA...";}
    const granted=OneSignal.Notifications.permission ? true : await OneSignal.Notifications.requestPermission();
    if(!granted){
      try{await supabaseTrack("push_permission_denied",{push_profile:profile});}catch{}
      notify("As notificações não foram autorizadas neste navegador.");
      return fail("permission_denied",{permission:"denied",profile});
    }

    await yntSyncOneSignalIdentity(OneSignal,"before_optin");
    await OneSignal.User.PushSubscription.optIn();
    const pushConfirmation=await yntWaitForConfirmedPushSubscription(OneSignal);
    if(!pushConfirmation.confirmed){
      try{await supabaseTrack("push_subscription_failed",{push:{enabled:false,provider:"onesignal",permission:Boolean(OneSignal?.Notifications?.permission),opted_in:pushConfirmation.optedIn,subscription_id:pushConfirmation.subscriptionId},visitor_id:YNTELIGENCIA_VISITOR_ID,push_profile:profile,push_origin:"catalog"});}catch{}
      notify("A permissão foi aceita, mas o alerta ainda não foi confirmado.");
      return fail("subscription_unconfirmed",{permission:"granted",optedIn:pushConfirmation.optedIn,subscriptionId:pushConfirmation.subscriptionId,profile});
    }

    await OneSignal.User.addTags(yntPushTagsFromProfile(profile));
    const subscriptionId=clean(pushConfirmation.subscriptionId||"");
    const result={success:true,permission:"granted",optedIn:true,subscriptionId,alertConfigured:true,reason:"subscribed",profile};
    try{
      await supabaseTrack("push_subscribed",{push:{enabled:true,provider:"onesignal",permission:true,opted_in:true,subscription_id:subscriptionId,cadence:"daily",max_pushes:30,subscribed_at:new Date().toISOString()},visitor_id:YNTELIGENCIA_VISITOR_ID,push_profile:profile,attribution_at_subscription:{first_touch:{...YNTELIGENCIA_TOUCHES.first_touch},current_touch:{...YNTELIGENCIA_TOUCHES.current_touch}}});
    }catch(trackError){console.warn("PUSH_SUBSCRIBED_TRACK_ERROR",trackError);}
    notify("Alerta ativado: até 1 imóvel por dia.");
    return result;
  }catch(error){
    console.warn("PUSH_OPTIN_ERROR",error);
    try{await supabaseTrack("push_subscription_error",{error:String(error?.message||error||""),push_profile:profile});}catch{}
    notify("Não foi possível ativar o alerta agora.");
    return fail("subscription_error",{permission:OneSignal?.Notifications?.permission ? "granted" : "unknown",optedIn:Boolean(OneSignal?.User?.PushSubscription?.optedIn),subscriptionId:clean(OneSignal?.User?.PushSubscription?.id||""),profile});
  }finally{
    if(btn) btn.disabled=false;
    refreshPushAlertCTA();
  }
}

function reconcilePaidPushState(){
  if(!paidExperience || !yntHasPaidClickContext()) return;
  paidExperience=PaidClickExperience.reducePaidExperience(paidExperience,{
    type:"subscription_reconciled",
    authority:paidOneSignalAuthority()
  });
  renderPaidPush();
}

function renderPaidPush(){
  const sheet=$("paidPushSheet");
  const status=$("paidPushStatus");
  if(!paidExperience || !sheet || !status) return;
  const prompt=PaidClickExperience.promptCopy();
  const title=$("paidPushTitle");
  if(title) title.textContent=prompt.headline;
  const accept=$("paidPushAccept");
  const dismiss=$("paidPushDismiss");
  if(accept) accept.textContent=prompt.primary;
  if(dismiss) dismiss.textContent=prompt.secondary;
  const detail=document.getElementById("photoModal");
  const detailOpen=Boolean(detail && !detail.hidden &&
    detail.getAttribute("aria-hidden")!=="true" &&
    detail.getClientRects().length &&
    getComputedStyle(detail).visibility!=="hidden");
  const presentation=PaidClickExperience.evaluatePushPrompt(paidExperience,{detailOpen});
  const showPrompt=paidExperience.promptEligible && !detailOpen;
  if(showPrompt && !paidExperience.promptVisible){
    supabaseTrack("push_prompt_shown", PaidClickExperience.sanitizeEvent({
      neighborhood:adIntent.neighborhood || "",
      bedrooms:adIntent.bedrooms || 0
    }));
    notePaidSignal("prompt_shown");
    return;
  }
  sheet.hidden=!presentation.visible;
  document.body.classList.toggle("paid-push-prompt", presentation.visible);
  if(paidExperience.phase==="E" || paidExperience.phase==="H"){
    status.hidden=false;
    status.textContent=paidExperience.phase==="E"
      ? PaidClickExperience.acceptanceCopy()
      : PaidClickExperience.subscribedNote();
  }else if(paidExperience.phase==="G"){
    status.hidden=false;
    status.textContent=PaidClickExperience.deniedNote();
  }else if(paidExperience.phase==="J"){
    status.hidden=false;
    status.textContent=PaidClickExperience.unresolvedNote();
  }else{
    status.hidden=true;
    status.textContent="";
  }
  if(paidExperience.phase==="D") sheet.hidden=true;
}

async function acceptPaidPush(){
  if(!paidExperience) return;
  notePaidSignal("accept");
  supabaseTrack("push_prompt_accepted", PaidClickExperience.sanitizeEvent({
    neighborhood:adIntent.neighborhood || "",
    bedrooms:adIntent.bedrooms || 0
  }));

  const activation=await activateYnteligenciaPush(adIntent,{quiet:true});
  const decision=PaidClickExperience.paidPushDecision(activation);

  if(decision==="permission_denied"){
    notePaidSignal("permission_denied");
    return;
  }
  if(decision==="subscribed"){
    supabaseTrack("push_permission_granted", PaidClickExperience.sanitizeEvent({origin:"paid_click"}));
    notePaidSignal("subscribed");
    return;
  }
  notePaidSignal("subscription_unresolved");
}

function dismissPaidPush(){
  supabaseTrack("push_prompt_dismissed", PaidClickExperience.sanitizeEvent({
    neighborhood:adIntent.neighborhood || "",
    bedrooms:adIntent.bedrooms || 0
  }));
  notePaidSignal("dismiss");
}


;
// SOURCE: assets/js/integrations/onesignal.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; function declarations only.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.

async function yntSyncOneSignalIdentity(
  OneSignal,
  reason="init"
){
  const expectedId=
    String(
      YNTELIGENCIA_VISITOR_ID||
      ""
    ).trim();

  if(
    !yntValidVisitorId(
      expectedId
    )
  ){
    console.warn(
      "YNT_ONESIGNAL_IDENTITY_INVALID",
      expectedId
    );
    return false;
  }

  /*
    IDENTIDADE SEM LOGOUT
    ---------------------
    Não encerramos o usuário OneSignal durante a inicialização.
    Reforçamos apenas login(expectedId), preservando a assinatura atual.
  */
  const syncKey=
    "ynt_onesignal_identity_sync_v3";

  const needsIdentityRefresh=
    safeStorageGet(
      syncKey
    ) !== expectedId;

  try{
    await OneSignal.login(
      expectedId
    );

    try{
      await OneSignal
        .User
        .addTags({
          ynt_visitor_id:
            expectedId,

          ynt_identity_version:
            "v2"
        });
    }catch(tagError){
      console.warn(
        "YNT_ONESIGNAL_ID_TAG_FAILED",
        tagError
      );
    }

    const subscriptionId=
      clean(
        OneSignal
          ?.User
          ?.PushSubscription
          ?.id ||
        ""
      );

    const oneSignalId=
      clean(
        OneSignal
          ?.User
          ?.onesignalId ||
        ""
      );

    const reportedExternalId=
      clean(
        OneSignal
          ?.User
          ?.externalId ||
        ""
      );

    safeStorageSet(
      syncKey,
      expectedId
    );

    console.log(
      "YNT_ONESIGNAL_IDENTITY_SYNC_OK",
      {
        reason,
        visitor_id:
          expectedId,
        external_id_expected:
          expectedId,
        external_id_reported:
          reportedExternalId,
        onesignal_id:
          oneSignalId,
        subscription_id:
          subscriptionId,
        identity_refresh:
          needsIdentityRefresh
      }
    );

    try{
      await supabaseTrack(
        "onesignal_identity_sync",
        {
          external_id_expected:
            expectedId,

          external_id_reported:
            reportedExternalId,

          onesignal_id:
            oneSignalId,

          subscription_id:
            subscriptionId,

          identity_refresh:
            needsIdentityRefresh,

          reason
        }
      );
    }catch(trackError){
      console.warn(
        "YNT_ONESIGNAL_IDENTITY_TRACK_FAILED",
        trackError
      );
    }

    return true;

  }catch(error){
    console.warn(
      "YNT_ONESIGNAL_IDENTITY_SYNC_FAILED",
      error
    );

    try{
      await supabaseTrack(
        "onesignal_identity_sync_failed",
        {
          external_id_expected:
            expectedId,

          identity_refresh:
            needsIdentityRefresh,

          reason,

          error:
            clean(
              error?.message||
              String(error||"")
            )
        }
      );
    }catch{}

    return false;
  }
}

async function initializeYnteligenciaPush(){
  if(
    !yntPushConfigured()
  ){
    refreshPushAlertCTA();
    return false;
  }

  window.OneSignalDeferred=
    window.OneSignalDeferred ||
    [];

  window.OneSignalDeferred.push(
    async function(
      OneSignal
    ){
      try{
        await OneSignal.init({
          appId:
            YNT_ONESIGNAL_APP_ID,

          /*
            OneSignal Web SDK v16:
            como este site já possui /sw.js próprio, o worker do
            OneSignal precisa ficar isolado em /onesignal/.
          */
          serviceWorkerPath:
            "onesignal/OneSignalSDKWorker.js",

          serviceWorkerParam:{
            scope:
              "/onesignal/"
          },

          /*
            Força o SDK a respeitar o worker customizado mesmo quando
            o app OneSignal está configurado como "Typical Site".
            Sem isso ele tentou /OneSignalSDKWorker.js na raiz.
          */
          serviceWorkerOverrideForTypical:
            true,

          notifyButton:{
            enable:false
          }
        });

        /*
          FIX FASE 20:
          SDK inicializado = serviço pronto para pedir permissão.
          Antes, READY só virava true DEPOIS do OneSignal.login().
          Se o login falhasse antes do opt-in, o botão ficava preso
          para sempre em "serviço ainda está carregando".
        */
        YNT_ONESIGNAL_INSTANCE=
          OneSignal;

        YNT_ONESIGNAL_READY=
          true;

        queueMicrotask(()=>{
          try{reconcilePaidPushState();}catch{}
        });

        console.log(
          "YNT_ONESIGNAL_READY",
          {
            ready:true,
            appId:
              YNT_ONESIGNAL_APP_ID,
            permission:
              OneSignal
                ?.Notifications
                ?.permission
          }
        );

        refreshPushAlertCTA();

        await yntSyncOneSignalIdentity(
          OneSignal,
          "sdk_init"
        );

        try{
          OneSignal
            .User
            .PushSubscription
            .addEventListener(
              "change",
              async ()=>{
                refreshPushAlertCTA();

                const optedIn=
                  Boolean(
                    OneSignal
                      .User
                      .PushSubscription
                      .optedIn
                  );

                const subscriptionId=
                  clean(
                    OneSignal
                      .User
                      .PushSubscription
                      .id ||
                    ""
                  );

                const pushStateKey=
                  "ynt_push_last_opted_in";

                const previousOptedIn=
                  safeStorageGet(
                    pushStateKey
                  );

                if(optedIn){
                  await supabaseTrack(
                    "push_subscription_active",
                    {
                      push:{
                        enabled:true,
                        provider:"onesignal",
                        subscription_id:
                          subscriptionId
                      }
                    }
                  );

                  safeStorageSet(
                    pushStateKey,
                    "1"
                  );

                }else if(
                  previousOptedIn==="1"
                ){
                  await supabaseTrack(
                    "push_unsubscribed",
                    {
                      push:{
                        enabled:false,
                        provider:"onesignal",
                        subscription_id:
                          subscriptionId
                      }
                    }
                  );

                  safeStorageSet(
                    pushStateKey,
                    "0"
                  );
                }

                try{reconcilePaidPushState();}catch{}
              }
            );
        }catch(error){}

        try{
          OneSignal
            .Notifications
            .addEventListener(
              "click",
              async event=>{
                const notification=
                  event?.notification ||
                  {};

                const data=
                  notification
                    ?.additionalData ||
                  notification
                    ?.data ||
                  {};

                await supabaseTrack(
                  "push_notification_click",
                  {
                    property_id:
                      clean(
                        data
                          ?.property_id ||
                        ""
                      ),

                    push:{
                      provider:
                        "onesignal",

                      notification_id:
                        clean(
                          notification
                            ?.notificationId ||
                          notification
                            ?.id ||
                          ""
                        ),

                      data
                    }
                  }
                );
              }
            );
        }catch(error){}

        refreshPushAlertCTA();

      }catch(error){
        console.error(
          "ONESIGNAL_INIT_ERROR",
          error
        );

        YNT_ONESIGNAL_READY=
          false;

        YNT_ONESIGNAL_INSTANCE=
          null;

        window.YNT_ONESIGNAL_LAST_ERROR=
          String(
            error?.message ||
            error ||
            ""
          );

        refreshPushAlertCTA();
      }
    }
  );

  return true;
}

async function yntWaitForConfirmedPushSubscription(
  OneSignal,
  {
    timeoutMs=5000,
    intervalMs=250
  }={}
){
  const startedAt=
    Date.now();

  while(
    Date.now()-startedAt <
    timeoutMs
  ){
    const optedIn=
      Boolean(
        OneSignal
          ?.User
          ?.PushSubscription
          ?.optedIn
      );

    const subscriptionId=
      clean(
        OneSignal
          ?.User
          ?.PushSubscription
          ?.id ||
        ""
      );

    if(
      optedIn &&
      subscriptionId
    ){
      return {
        confirmed:true,
        optedIn:true,
        subscriptionId
      };
    }

    await new Promise(
      resolve=>
        setTimeout(
          resolve,
          intervalMs
        )
    );
  }

  return {
    confirmed:false,

    optedIn:
      Boolean(
        OneSignal
          ?.User
          ?.PushSubscription
          ?.optedIn
      ),

    subscriptionId:
      clean(
        OneSignal
          ?.User
          ?.PushSubscription
          ?.id ||
        ""
      )
  };
}

async function waitForYnteligenciaPushReady(
  timeoutMs=8000
){
  const started=
    Date.now();

  while(
    Date.now()-started <
    timeoutMs
  ){
    if(
      YNT_ONESIGNAL_READY &&
      YNT_ONESIGNAL_INSTANCE
    ){
      return true;
    }

    await new Promise(
      resolve=>
        setTimeout(
          resolve,
          200
        )
    );
  }

  return Boolean(
    YNT_ONESIGNAL_READY &&
    YNT_ONESIGNAL_INSTANCE
  );
}

function paidOneSignalAuthority(){
  return PaidClickExperience.subscriptionAuthority({
    sdkReady:Boolean(YNT_ONESIGNAL_READY && YNT_ONESIGNAL_INSTANCE),
    optedIn:Boolean(YNT_ONESIGNAL_INSTANCE?.User?.PushSubscription?.optedIn),
    subscriptionId:clean(YNT_ONESIGNAL_INSTANCE?.User?.PushSubscription?.id || "")
  });
}
