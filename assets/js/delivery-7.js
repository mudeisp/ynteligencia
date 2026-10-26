
;
// SOURCE: assets/js/ui/menu.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; original post-main boot block.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.


(function(){
  const menu=document.getElementById('appMenu');
  const backdrop=document.getElementById('menuBackdrop');
  const openTop=document.getElementById('openAppMenu');
  const openDock=document.getElementById('openAppMenuDock');
  const closeBtn=document.getElementById('closeAppMenu');
  const installCard=document.getElementById('installAppButton');
  const installModal=document.getElementById('installModal');
  const installNow=document.getElementById('installNowButton');
  const installClose=document.getElementById('closeInstallModal');
  const fallback=document.getElementById('installFallback');
  let deferredInstallPrompt=null;

  function openMenu(){
    menu.classList.add('open');
    backdrop.classList.add('open');
    menu.setAttribute('aria-hidden','false');
    openTop?.setAttribute('aria-expanded','true');
    document.body.style.overflow='hidden';
  }
  function closeMenu(){
    menu.classList.remove('open');
    backdrop.classList.remove('open');
    menu.setAttribute('aria-hidden','true');
    openTop?.setAttribute('aria-expanded','false');
    document.body.style.overflow='';
  }
  function openInstall(){
    closeMenu();
    installModal.classList.add('open');
    installModal.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    if(!deferredInstallPrompt) fallback.hidden=false;
  }
  function closeInstall(){
    installModal.classList.remove('open');
    installModal.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }

  openTop?.addEventListener('click',openMenu);
  openDock?.addEventListener('click',openMenu);
  closeBtn?.addEventListener('click',closeMenu);
  backdrop?.addEventListener('click',closeMenu);
  installCard?.addEventListener('click',openInstall);
  document.getElementById('menuSpecialistButton')?.addEventListener('click',event=>{
    event.preventDefault();
    closeMenu();
    // Reuse the existing human flow and its tracking; never route to MATCH/AI.
    document.getElementById('specialistFloat')?.click();
  });
  installClose?.addEventListener('click',closeInstall);
  installModal?.addEventListener('click',e=>{if(e.target===installModal) closeInstall();});

  document.querySelectorAll('[data-scroll-target]').forEach(el=>{
    el.addEventListener('click',()=>{
      const id=el.getAttribute('data-scroll-target');
      closeMenu();
      setTimeout(()=>{
        if(id==='match') enterMatchMode();
        else if(id==='explore') openGeneralCatalog();
        else if(id==='results'){
          if(!document.querySelector('#matchGrid .card') && yntRestoreSavedResults())return;
          const results=document.getElementById('results');
          if(!document.querySelector('#matchGrid .card')){
            showToast('Você ainda não tem resultados nesta sessão. Explore imóveis para começar.');
            return;
          }
          document.body.classList.remove('home-mode','match-mode');
          results?.classList.add('visible');
          results?.scrollIntoView({behavior:'smooth'});
        }
        else{
          if(id==='inicio'){goHome();return;}
          document.body.classList.toggle('home-mode',id==='inicio');
          document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
        }
      },80);
    });
  });

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    fallback.hidden=true;
  });

  installNow?.addEventListener('click',async()=>{
    if(!deferredInstallPrompt){
      fallback.hidden=false;
      return;
    }
    deferredInstallPrompt.prompt();
    try{await deferredInstallPrompt.userChoice;}catch(e){}
    deferredInstallPrompt=null;
    closeInstall();
  });

  window.addEventListener('appinstalled',()=>{
    deferredInstallPrompt=null;
    if(installCard) installCard.style.display='none';
    closeInstall();
  });

  if(window.matchMedia('(display-mode: standalone)').matches){
    if(installCard) installCard.style.display='none';
  }
})();



;
// SOURCE: assets/js/integrations/pwa.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; original post-main boot block.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.


/* PWA: registra o Service Worker sem alterar interface, MATCH ou tracking. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => {
      console.warn("Service Worker não registrado:", error);
    });
  });
}



;
// SOURCE: assets/js/ui/filters-boot.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; original post-main boot block.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.


/* Região agora é um select dentro da janela única de busca. */
(() => {
  const regionSelect=document.getElementById("catalogRegionSelect");
  if(regionSelect){
    if(!regionSelect.querySelector('option[value="es"]')){
      const option=document.createElement('option');
      option.value='es';
      option.textContent='Espírito Santo';
      regionSelect.appendChild(option);
    }

    // Troca a geografia antes do listener principal do catálogo executar.
    regionSelect.addEventListener('change',event=>{
      if(event.target?.value==='es'){
        activeState='ES';
        activeCity='';
      }else{
        activeState='SP';
        activeCity='São Paulo';
      }
      if(document.getElementById('catalogState')) document.getElementById('catalogState').value=activeState;
      if(document.getElementById('catalogCity')) document.getElementById('catalogCity').value=activeCity;
    },true);

    /* Sincroniza também quando a busca veio de URL/campanha. */
    const syncRegion=()=>{
      try{
        regionSelect.value=(typeof catalogRegion!=="undefined" ? catalogRegion : "") || "";
      }catch(error){}
    };
    syncRegion();
    setTimeout(syncRegion,250);
    setTimeout(syncRegion,1200);
  }

  document.getElementById("resetCatalogFilters")?.addEventListener("click",()=>{
    if(regionSelect) regionSelect.value="";
  });
})();



;
// SOURCE: assets/js/ui/mobile-viewport.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; original post-main boot block.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.


(function(){
  function updateAiMobileViewport(){
    const vv=window.visualViewport;
    const height=vv && vv.height ? Math.round(vv.height) : window.innerHeight;
    document.documentElement.style.setProperty('--ai-mobile-vh', height + 'px');

    const keyboardOpen = vv
      ? (window.innerHeight - vv.height > 120)
      : false;
    document.body.classList.toggle('ai-keyboard-open', keyboardOpen);

    const box=document.getElementById('aiAssistantMessages');
    if(box && document.getElementById('aiAssistantShell')?.classList.contains('open')){
      requestAnimationFrame(()=>{ box.scrollTop=box.scrollHeight; });
    }
  }

  updateAiMobileViewport();
  window.addEventListener('resize', updateAiMobileViewport, {passive:true});
  window.addEventListener('orientationchange', updateAiMobileViewport, {passive:true});

  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', updateAiMobileViewport, {passive:true});
    window.visualViewport.addEventListener('scroll', updateAiMobileViewport, {passive:true});
  }

  document.addEventListener('focusin', function(event){
    if(event.target && event.target.id==='aiAssistantInput'){
      updateAiMobileViewport();
      setTimeout(updateAiMobileViewport, 120);
      setTimeout(()=>{
        const box=document.getElementById('aiAssistantMessages');
        if(box) box.scrollTop=box.scrollHeight;
      },180);
    }
  });

  document.addEventListener('focusout', function(event){
    if(event.target && event.target.id==='aiAssistantInput'){
      setTimeout(updateAiMobileViewport,120);
    }
  });
})();



;
// SOURCE: assets/js/ui/home.js
// Extracted unchanged from outputs/index-home-agent-fix-test.html; original post-main boot block.
// Classic script: intentional shared global scope; see docs/global-compatibility.md.


(function(){
  const explore=document.getElementById("homeExploreBtn");
  const ai=document.getElementById("homeAiButton");

  explore?.addEventListener("click",function(event){
    event.preventDefault();

    if(typeof openGeneralCatalog==="function"){
      openGeneralCatalog(true);
    }

    try{
      if(typeof setFiltersOpen==="function"){
        setFiltersOpen(true);
      }
    }catch(error){}

    const filters=document.getElementById("catalogFilters");
    if(filters){
      filters.classList.add("open");
    }
  });

  ai?.addEventListener("click",function(event){
    event.preventDefault();
    if(typeof openHomeAgentConversation==="function"){
      openHomeAgentConversation();
    }
  });
})();


;
// MATCH: opção geográfica ES sem alterar pesos/pontuação.
(function(){
  const regionStep=document.querySelector('.step[data-step="1"] .options');
  if(!regionStep) return;

  let button=regionStep.querySelector('[data-key="region"][data-value="es"]');
  if(!button){
    button=document.createElement('button');
    button.type='button';
    button.className='option';
    button.dataset.key='region';
    button.dataset.value='es';
    button.innerHTML='Espírito Santo<small>Vitória, Vila Velha, Serra, Guarapari e região</small>';
    regionStep.appendChild(button);
  }

  const originalPropertyMatchesRegion=propertyMatchesRegion;
  propertyMatchesRegion=function(property,regionKey){
    if(norm(regionKey)==='es') return norm(property?.state)==='es';
    return originalPropertyMatchesRegion(property,regionKey);
  };

  const originalCatalogServerQuery=catalogServerQuery;
  catalogServerQuery=function(offset=0){
    const url=new URL(originalCatalogServerQuery(offset));
    if(norm(activeState)==='es' && !clean(activeCity)){
      url.searchParams.delete('city');
    }
    return url.toString();
  };

  const originalLoadCatalogNeighborhoodIndex=loadCatalogNeighborhoodIndex;
  loadCatalogNeighborhoodIndex=async function(options={}){
    if(norm(activeState)!=='es' || clean(activeCity)){
      return originalLoadCatalogNeighborhoodIndex(options);
    }

    const source=document.getElementById('catalogSource')?.value || 'todos';
    const neighborhoods=[];
    const PAGE_SIZE=1000;
    let offset=0;
    for(let page=0;page<10;page++){
      const url=new URL('https://wzaegidwtdjuhqchpdpd.supabase.co/rest/v1/properties');
      url.searchParams.set('select','neighborhood');
      url.searchParams.set('active','eq.true');
      url.searchParams.set('state','eq.ES');
      if(source==='novos') url.searchParams.set('source','eq.novos');
      else if(source==='usados') url.searchParams.set('source','eq.usados');
      url.searchParams.set('neighborhood','not.is.null');
      url.searchParams.set('limit',String(PAGE_SIZE));
      url.searchParams.set('offset',String(offset));
      const response=await fetch(url.toString(),{
        cache:'no-store',
        headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}`}
      });
      if(!response.ok) throw new Error(`Supabase bairros ES: ${response.status}`);
      const rows=await response.json();
      if(!Array.isArray(rows) || !rows.length) break;
      rows.forEach(row=>{const n=clean(row?.neighborhood||'');if(n)neighborhoods.push(n);});
      offset+=rows.length;
      if(rows.length<PAGE_SIZE) break;
    }
    const list=[...new Set(neighborhoods)].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    catalogNeighborhoodIndexCache.set(catalogNeighborhoodIndexKey(),list);
    return list;
  };

  button.addEventListener('click',async()=>{
    button.disabled=true;
    try{
      activeState='ES';
      activeCity='';
      profile.region='es';

      document.querySelectorAll('.option[data-key="region"]:not(.multi)')
        .forEach(x=>x.classList.remove('selected'));
      button.classList.add('selected');
      updateNext();

      await fetchNewCatalogPage({reset:true});
      while(newCatalogHasMore){
        await fetchNewCatalogPage();
      }
      if(!properties.length){
        showToast('Não encontramos estoque ativo no Espírito Santo agora.');
      }

      window.setTimeout(()=>setStep(step+1),140);
    }catch(error){
      console.error('YNT_MATCH_ES_LOAD_ERROR',error);
      showToast('Não foi possível carregar o estoque do Espírito Santo agora.');
    }finally{
      button.disabled=false;
    }
  });
})();
