function openAllPropertyGallery(items,p,startIndex=0){
  if(!items?.length)return;

  const old=document.getElementById("allGalleryShell");
  if(old)old.remove();

  let index=Math.max(0,Math.min(Number(startIndex)||0,items.length-1));
  const shell=document.createElement("div");
  shell.id="allGalleryShell";
  shell.className="all-gallery-shell";
  shell.innerHTML=`
    <div class="all-gallery-head">
      <strong>${esc(p?.name||"Galeria do imóvel")} · ${items.length} ${items.length===1?"imagem":"imagens"}</strong>
      <button type="button" class="all-gallery-close" aria-label="Fechar">×</button>
    </div>
    <div class="all-gallery-stage">
      <button type="button" class="all-gallery-nav all-gallery-prev" aria-label="Anterior">‹</button>
      <img class="all-gallery-main" alt="${esc(p?.name||"Imóvel")}">
      <button type="button" class="all-gallery-nav all-gallery-next" aria-label="Próxima">›</button>
      <div class="all-gallery-caption"></div>
    </div>
    <div class="all-gallery-thumbs">
      ${items.map((item,i)=>`
        <button type="button" class="all-gallery-thumb" data-gallery-index="${i}">
          <img src="${esc(item.url)}" alt="Imagem ${i+1}" loading="lazy">
        </button>
      `).join("")}
    </div>
  `;

  function render(){
    const item=items[index];
    const main=shell.querySelector(".all-gallery-main");
    const caption=shell.querySelector(".all-gallery-caption");
    if(main)main.src=item.url;
    if(caption)caption.textContent=`${index+1} / ${items.length}${item.meta?` · ${item.meta}`:""}`;
    shell.querySelectorAll(".all-gallery-thumb").forEach((btn,i)=>{
      btn.classList.toggle("active",i===index);
      if(i===index)btn.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
    });
  }

  function move(delta){
    index=(index+delta+items.length)%items.length;
    render();
  }

  shell.querySelector(".all-gallery-close")?.addEventListener("click",()=>{
    if(history.state?.ynteligenciaAllGallery)history.back();
    else shell.remove();
  });
  shell.querySelector(".all-gallery-prev")?.addEventListener("click",()=>move(-1));
  shell.querySelector(".all-gallery-next")?.addEventListener("click",()=>move(1));

  const stage=shell.querySelector(".all-gallery-stage");
  let touchStartX=null;
  stage?.addEventListener("touchstart",e=>{
    touchStartX=e.touches?.[0]?.clientX ?? null;
  },{passive:true});
  stage?.addEventListener("touchend",e=>{
    if(touchStartX==null)return;
    const endX=e.changedTouches?.[0]?.clientX ?? touchStartX;
    const delta=endX-touchStartX;
    touchStartX=null;
    if(Math.abs(delta)<45)return;
    move(delta<0 ? 1 : -1);
  },{passive:true});
  shell.querySelectorAll("[data-gallery-index]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      index=Number(btn.dataset.galleryIndex)||0;
      render();
    });
  });

  shell.addEventListener("click",e=>{
    if(e.target!==shell)return;
    if(history.state?.ynteligenciaAllGallery)history.back();
    else shell.remove();
  });
  document.addEventListener("keydown",function galleryKeys(e){
    if(!document.getElementById("allGalleryShell")){
      document.removeEventListener("keydown",galleryKeys);
      return;
    }
    if(e.key==="Escape"){
      if(history.state?.ynteligenciaAllGallery)history.back();
      else shell.remove();
    }
    if(e.key==="ArrowLeft")move(-1);
    if(e.key==="ArrowRight")move(1);
  });

  try{
    gtag("event","property_gallery_view",{
      property_id:String(p?.id||""),
      property_name:p?.name||"",
      images_count:items.length
    });
  }catch(error){}

  supabaseTrack("property_gallery_view",{
    property_id:String(p?.id||""),
    property_name:p?.name||"",
    images_count:items.length
  });

  document.body.appendChild(shell);

  if(!history.state?.ynteligenciaAllGallery){
    history.pushState(
      {
        ...(history.state || {}),
        ynteligenciaPropertyDetail:true,
        ynteligenciaAllGallery:true,
        propertyId:String(p?.id||"")
      },
      "",
      window.location.href
    );
  }

  render();
}

async function showPhotoModal(id){
  let p=propertyForInteraction(id);
  if(!p)return;

  /*
    PERFORMANCE:
    A listagem mantém somente dados normalizados.
    O raw_data completo é carregado aqui, sob demanda,
    para NOVOS e USADOS.
  */
  p=await hydratePropertyDetails(p);

  /*
    O photos.json dos usados é grande. Ele não bloqueia mais a abertura
    do app; é garantido sob demanda quando o usuário abre um usado.
  */
  if(
    String(p.source||"").toLowerCase()==="usados" &&
    !photoManifestLoaded
  ){
    await loadPhotoManifest();
  }

  try{
    sessionStorage.setItem("ynt_catalog_scroll",String(window.scrollY||0));
    sessionStorage.setItem("ynt_catalog_url",window.location.href);
  }catch(error){}

  /*
    Marca o imóvel atualmente aberto para conseguirmos registrar
    corretamente o fechamento e o tempo de permanência.
  */
  YNT_ACTIVE_PROPERTY_JOURNEY={
    property_id:
      String(p.id||""),

    property_uuid:
      String(p.db_id||""),

    property_name:
      p.name||"",

    neighborhood:
      p.neighborhood||"",

    property_value:
      Number(p.value)||0,

    inventory_source:
      p.source||sourceMode||"todos",

    opened_at_ms:
      Date.now()
  };

  try{
    gtag("event","property_view",{
      property_id:String(p.id||""),
      property_name:p.name||"",
      neighborhood:p.neighborhood||"",
      property_value:Number(p.value)||0,
      source_mode:p.source||sourceMode||"todos"
    });
  }catch(error){}

  yntAdsTrack("property_view", {
    intent: yntAdsIntentFromState(),
    property:{
      property_id: String(p.id||""),
      name: p.name||"",
      neighborhood: p.neighborhood||"",
      development: p.development || "",
      bedrooms: Number(p.bedrooms)||0,
      price: Number(p.value)||0,
      inventory_source: p.source || ""
    }
  });

  supabaseTrack("property_view",{
    property_id:
      String(p.id||""),

    property_uuid:
      String(p.db_id||""),

    property_name:
      p.name||"",

    neighborhood:
      p.neighborhood||"",

    property_value:
      Number(p.value)||0,

    property_area:
      Number(p.area)||0,

    bedrooms:
      Number(p.bedrooms)||0,

    inventory_source:
      p.source||sourceMode||"todos",

    match_score:
      Number(p.match?.score)||0,

    property:{
      id:String(p.id||""),
      db_id:String(p.db_id||""),
      name:p.name||"",
      neighborhood:p.neighborhood||"",
      value:Number(p.value)||0,
      area:Number(p.area)||0,
      bedrooms:Number(p.bedrooms)||0,
      match_score:Number(p.match?.score)||0
    },

    profile:{...profile}
  });

  const photos=photoList(p);

  const old=document.getElementById("photoModal");

  /*
    Se algum fluxo abrir outro imóvel sem passar pelo botão voltar,
    encerramos a jornada anterior antes de substituir o modal.
  */
  if(
    old &&
    YNT_ACTIVE_PROPERTY_JOURNEY?.property_id &&
    String(
      YNT_ACTIVE_PROPERTY_JOURNEY
        .property_id
    ) !== String(p.id||"")
  ){
    const previous=
      YNT_ACTIVE_PROPERTY_JOURNEY;

    const durationSeconds=
      previous.opened_at_ms
        ? Math.max(
            0,
            Math.round(
              (
                Date.now() -
                previous.opened_at_ms
              ) / 1000
            )
          )
        : 0;

    supabaseTrack(
      "property_close",
      {
        property_id:
          previous.property_id,

        property_uuid:
          previous.property_uuid || "",

        property_name:
          previous.property_name ||
          "",

        neighborhood:
          previous.neighborhood ||
          "",

        engagement_time_seconds:
          durationSeconds,

        close_method:
          "property_replaced"
      }
    );

    YNT_ACTIVE_PROPERTY_JOURNEY=null;
  }

  if(old)old.remove();

  // Cria uma etapa de navegação interna para o botão/gesto Voltar do celular.
  if(!history.state?.ynteligenciaPropertyDetail){
    history.pushState(
      {
        ...(history.state || {}),
        ynteligenciaPropertyDetail:true,
        propertyId:String(p.id||"")
      },
      "",
      window.location.href
    );
  }

  const raw=p.rawData && typeof p.rawData==="object" ? p.rawData : {};
  const building=raw.building && typeof raw.building==="object" ? raw.building : {};
  const typology=raw.typology && typeof raw.typology==="object" ? raw.typology : {};
  const addressData=building.address && typeof building.address==="object" ? building.address : {};
  const allPropertyImages=extractAllPropertyImages(p,raw);
  const detailPhotos=allPropertyImages.length
    ? allPropertyImages.map(item=>item.url)
    : photos;

  console.info("YNT_DETAIL_PHOTOS",{
    property_id:String(p.id||""),
    source:p.source||"",
    photos_json_or_property:photos.length,
    gallery_total:detailPhotos.length,
    manifest_has_key:Boolean(
      photoManifest[String(p.id)] ||
      photoManifest[p.id]
    )
  });

  if(!detailPhotos.length){
    showToast("As imagens deste imóvel ainda estão sendo atualizadas.");
    return;
  }

  const floorplans=extractFloorplans(raw,p);
  const propertyOptions=extractPropertyOptions(raw,p);
  const mapQuery=propertyMapQuery(p,addressData);
  const mapEmbedUrl=mapQuery
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`
    : "";
  const isNew=String(p.source||"").toLowerCase()==="novos";
  const updatedLabel=isNew ? detailUpdatedLabel(p,building,typology) : "";
  const detailReasons=(p.match?.reasons || []).slice(0,4);

  const status=detailValue(building.stage || building.status);
  const developer=detailValue(building.developer || building.developer_data || building.publisher);
  const delivery=detailDate(building.opening_date);
  const launch=detailDate(building.launch_date);
  const m2Value=Number(p.m2)||((Number(p.area)>0 && Number(p.value)>0)?Number(p.value)/Number(p.area):0);

  const techRows=[
    p.area ? detailRow("Área privativa",`${area(p.area)} m²`) : "",
    p.bedrooms ? detailRow("Dormitórios",p.bedrooms) : "",
    p.suites ? detailRow("Suítes",p.suites) : "",
    p.parking ? detailRow("Vagas",p.parking) : "",
    Number(p.stock)>0 ? detailRow("Unidades disponíveis",p.stock) : "",
    p.unit ? detailRow("Referência",p.unit) : ""
  ].filter(Boolean).join("");

  const buildingRows=[
    developer ? detailRow("Incorporadora",developer) : "",
    status ? detailRow("Status",status) : "",
    delivery ? detailRow("Entrega prevista",delivery) : "",
    launch ? detailRow("Lançamento",launch) : "",
    building.number_of_towers ? detailRow("Torres",building.number_of_towers) : "",
    building.number_of_floors ? detailRow("Andares",building.number_of_floors) : "",
    building.total_units ? detailRow("Total de unidades",building.total_units) : "",
    building.apts_per_floor ? detailRow("Unidades por andar",building.apts_per_floor) : ""
  ].filter(Boolean).join("");

  const amenities=detailFeatureNames(
    (Array.isArray(building.building_features)?building.building_features:[])
      .concat(Array.isArray(typology.features)?typology.features:[])
  );

  const description=clean(building.description || p.description || "");
  const fullAddress=clean([
    p.address,
    p.neighborhood,
    addressData.city || "São Paulo"
  ].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(" • "));

  const modal=document.createElement("div");
  modal.id="photoModal";
  modal.className="photo-detail-shell";
  modal.dataset.propertyId=String(p.id||"");

  modal.innerHTML=`
    <div class="detail-gallery">
      <div class="detail-gallery-track">
        ${detailPhotos.map((url,i)=>`<img class="detail-gallery-slide" src="${esc(url)}" alt="${esc(p.name)} — foto ${i+1}" loading="${i===0?"eager":"lazy"}">`).join("")}
      ${allPropertyImages.length ? `
          <span class="detail-gallery-count">${allPropertyImages.length} ${allPropertyImages.length===1?"foto":"fotos"}</span>
          ${allPropertyImages.length>1 ? `<button type="button" class="detail-gallery-all-btn">Ver todas as fotos</button>` : ""}
        ` : ""}</div>
      <button class="detail-gallery-close" type="button" aria-label="Voltar" onclick="closePropertyDetail()">‹</button>
      <div class="detail-gallery-counter">1 / ${detailPhotos.length}</div>
      ${detailPhotos.length>1 ? `
        <button class="detail-gallery-arrow prev" type="button" aria-label="Foto anterior" onclick="moveDetailPhoto(-1)">‹</button>
        <button class="detail-gallery-arrow next" type="button" aria-label="Próxima foto" onclick="moveDetailPhoto(1)">›</button>
        <div class="detail-gallery-dots">
          ${detailPhotos.length<=20 ? detailPhotos.map((_,i)=>`<button class="detail-gallery-dot ${i===0?"active":""}" type="button" aria-label="Ir para foto ${i+1}" onclick="goDetailPhoto(${i})"></button>`).join("") : ""}
        </div>` : ""}
    </div>

    <main class="detail-property">
      <div class="detail-top-labels">
        ${p.match ? `<span class="detail-match">${Number(p.match.score)||0}% MATCH</span>` : ""}
        ${isNew ? `<span class="detail-builder-stamp">Unidade da construtora</span>` : ""}
        <span class="detail-source">${isNew?"Novo":"Usado"}</span>
        ${status ? `<span class="detail-status">${esc(status)}</span>` : ""}
        ${isNew ? `<span class="detail-updated">${esc(updatedLabel)}</span>` : ""}
      </div>

      <h1>${esc(p.name)}</h1>
      <div class="detail-location">${esc(p.neighborhood || "São Paulo")}${isNew && addressData.city ? ` • ${esc(addressData.city)}` : ""}</div>
      <div class="detail-price">${money(p.value)}</div>
      ${m2Value>0 ? `<div class="detail-price-m2">${money(m2Value)} / m²</div>` : ""}

      <div class="detail-main-specs">
        ${p.area ? `<div class="detail-spec"><strong>${area(p.area)} m²</strong><span>ÁREA</span></div>` : ""}
        ${p.bedrooms ? `<div class="detail-spec"><strong>${p.bedrooms}</strong><span>DORMITÓRIOS</span></div>` : ""}
        ${p.suites ? `<div class="detail-spec"><strong>${p.suites}</strong><span>SUÍTE${p.suites===1?"":"S"}</span></div>` : ""}
        ${p.parking ? `<div class="detail-spec"><strong>${p.parking}</strong><span>VAGA${p.parking===1?"":"S"}</span></div>` : ""}
      </div>

      ${detailReasons.length ? `
        <section class="detail-section">
          <div class="detail-section-title">Seu MATCH</div>
          <h3>Por que combina com você</h3>
          <div class="detail-match-reasons">
            ${detailReasons.map(reason=>`<div class="detail-match-reason"><b>✓</b><span>${esc(reason)}</span></div>`).join("")}
          </div>
        </section>` : ""}

      ${techRows ? `
        <section class="detail-section">
          <div class="detail-section-title">Ficha do imóvel</div>
          <div class="detail-tech-grid">${techRows}</div>
        </section>` : ""}

      ${isNew ? `
        <section class="detail-section development-rich-section" id="developmentRichSection">
          <div class="detail-section-title">Empreendimento completo</div>
          <h3>Carregando informações do projeto...</h3>
          <div class="development-rich-loading">
            Consultando tipologias, plantas, vídeo e conteúdo do empreendimento.
          </div>
        </section>
      ` : ""}

      ${isNew && buildingRows ? `
        <section class="detail-section">
          <div class="detail-section-title">Empreendimento</div>
          <h3>Ficha técnica</h3>
          <div class="detail-tech-grid">${buildingRows}</div>
        </section>` : ""}

      ${!isNew && amenities.length ? `
        <section class="detail-section">
          <div class="detail-section-title">Estrutura</div>
          <h3>Lazer e comodidades</h3>
          <div class="detail-amenities">${amenities.map(x=>`<span class="detail-amenity">${esc(x)}</span>`).join("")}</div>
        </section>` : ""}

      ${description && !isNew ? `
        <section class="detail-section">
          <div class="detail-section-title">Sobre</div>
          <h3>Sobre o imóvel</h3>
          <p>${esc(description)}</p>
        </section>` : ""}

      ${propertyOptions.length ? `
        <section class="detail-section">
          <div class="detail-section-title">Opções</div>
          <h3>Opções disponíveis neste condomínio</h3>
          <div class="detail-chips">
            ${propertyOptions.map(option=>`<span>${esc(option)}</span>`).join("")}
          </div>
        </section>` : ""}

      ${!isNew ? `
      <section class="detail-section detail-floorplans">
        <div class="detail-section-title">Plantas</div>
        <h3>Plantas do condomínio</h3>
        ${floorplans.length ? `
          <div class="detail-floorplan-grid">
            ${floorplans.map((url,index)=>`
              <button type="button" class="detail-floorplan-card" data-floorplan="${esc(url)}">
                <img src="${esc(url)}" alt="Planta ${index+1} — ${esc(p.name)}" loading="lazy">
                <span>Ver planta ${index+1}</span>
              </button>
            `).join("")}
          </div>` :
          `<p class="detail-map-address">Planta não disponível nos dados deste imóvel.</p>`
        }
      </section>
      ` : ""}

      ${mapEmbedUrl ? `
        <section class="detail-section detail-location-section">
          <div class="detail-section-title">Localização</div>
          <h3>${esc(p.neighborhood || "São Paulo")}</h3>
          <div class="detail-map-wrap">
            <iframe
              class="detail-map-frame"
              title="Mapa de localização de ${esc(p.name)}"
              src="${esc(mapEmbedUrl)}"
              loading="lazy"
              referrerpolicy="no-referrer-when-downgrade"
              allowfullscreen>
            </iframe>
          </div>
          ${fullAddress ? `<p class="detail-map-address">${esc(fullAddress)}</p>` : ""}
        </section>` : (fullAddress ? `
        <section class="detail-section">
          <div class="detail-section-title">Localização</div>
          <h3>${esc(p.neighborhood || "São Paulo")}</h3>
          <p>${esc(fullAddress)}</p>
        </section>` : "")}

      <section class="detail-specialist">
        <img src="/PERFIL.jfif" alt="Especialista Ynteligencia">
        <div class="detail-specialist-copy">
          <small>Atendimento personalizado</small>
          <strong>Quer entender melhor este imóvel?</strong>
          <p>Escolha conversar com a IA sobre este imóvel ou falar com um especialista.</p>
        </div>
        <div class="detail-specialist-actions">
          <button class="detail-specialist-btn" type="button">CONVERSAR COM A IA</button>
          <button class="detail-specialist-human-btn" type="button">FALAR COM ESPECIALISTA</button>
          <p class="detail-agent-status" hidden></p>
        </div>
      </section>

      <section class="detail-similar" id="detailSimilarSection">
        <h3>Imóveis semelhantes</h3>
        <p>Outras opções próximas da sua busca.</p>
        <div class="detail-similar-grid" id="detailSimilarGrid"></div>
      </section>
    </main>
`;

  const track=modal.querySelector(".detail-gallery-track");
  track?.addEventListener("scroll",()=>window.requestAnimationFrame(updateDetailGallery),{passive:true});

  modal.querySelector(".detail-specialist-btn")?.addEventListener("click",()=>openAgentConversation(p));
  modal.querySelector(".detail-specialist-human-btn")?.addEventListener("click",()=>openPropertySpecialist(p));
  document.body.appendChild(modal);
  notePaidSignal("detail_opened", p.id);

  /*
    Camada adicional de empreendimento.
    Não bloqueia a abertura do modal e não altera o fluxo atual.
  */
  if(isNew){
    hydrateDevelopmentRichModal(
      modal,
      p
    );
  }

  scheduleAiAssistantForProperty(p,modal);

  modal.querySelector(".detail-gallery-all-btn")?.addEventListener("click",()=>{
    const track=modal.querySelector(".detail-gallery-track");
    const current=track && track.clientWidth
      ? Math.round(track.scrollLeft/track.clientWidth)
      : 0;
    openAllPropertyGallery(allPropertyImages,p,current);
  });

  modal.querySelectorAll("[data-floorplan]").forEach(btn=>{
    btn.addEventListener("click",()=>openFloorplan(btn.dataset.floorplan,p));
  });

  const mapFrame=modal.querySelector(".detail-map-frame");
  if(mapFrame){
    let mapTracked=false;
    const mapObserver=new IntersectionObserver(entries=>{
      if(!mapTracked && entries.some(entry=>entry.isIntersecting)){
        mapTracked=true;
        try{
          gtag("event","map_view",{
            property_id:String(p.id||""),
            property_name:p.name||"",
            neighborhood:p.neighborhood||""
          });
        }catch(error){}
        supabaseTrack("map_view",{
          property_id:String(p.id||""),
          property_name:p.name||"",
          neighborhood:p.neighborhood||""
        });
        mapObserver.disconnect();
      }
    },{threshold:.35});
    mapObserver.observe(mapFrame);
  }

  renderDetailSimilar(p,modal);
  updateDetailGallery();
}
window.YntFeatureLoader.markLoaded("property-detail");
