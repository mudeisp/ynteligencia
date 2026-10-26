
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
  if(!regionStep || regionStep.querySelector('[data-value="es"]')) return;

  const button=document.createElement('button');
  button.type='button';
  button.className='option';
  button.dataset.key='region';
  button.dataset.value='es';
  button.innerHTML='Espírito Santo<small>Vitória, Vila Velha, Serra, Guarapari e região</small>';
  regionStep.appendChild(button);

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

  button.addEventListener('click',async()=>{
    button.disabled=true;
    try{
      activeState='ES';
      activeCity='';
      profile.region='es';
      await fetchNewCatalogPage({reset:true});
      while(newCatalogHasMore){
        await fetchNewCatalogPage();
      }
      if(!properties.length){
        showToast('Não encontramos estoque ativo no Espírito Santo agora.');
      }
    }catch(error){
      console.error('YNT_MATCH_ES_LOAD_ERROR',error);
      showToast('Não foi possível carregar o estoque do Espírito Santo agora.');
    }finally{
      button.disabled=false;
    }
  });
})();
