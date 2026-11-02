import {attributedHref,cleanProfile,cleanInvestmentContext,evolveIntent,rankProjects} from './investment-model.js';
import {cleanSimulation} from './finance-model.js';

// Session-scoped anonymous preferences. Never mutate acquisition storage.
export function createJourney({storage,key,preview=false,emit=()=>{},initial={}}) {
  let state=initial;
  if(!preview)try{state=JSON.parse(storage.getItem(key)||'null')||initial;}catch{}
  const save=()=>{if(!preview)try{storage.setItem(key,JSON.stringify(state));}catch{}};
  const context=()=>cleanInvestmentContext({...state,simulation:Date.now()<(state.simulation_expires_at||0)?state.simulation:null});
  const telemetryContext=()=>{const value=context();if(value)delete value.simulation;return value;};
  const event=(name,extra={})=>{if(!preview)emit(name,{...extra,investment_context:telemetryContext(),declared_intent:state.declared_intent,initial_declared_intent:state.initial_declared_intent});};
  return {get state(){return state;},select(intent){state=evolveIntent(state,intent);save();event(intent==='investment'?'investment_intent_selected':'residential_intent_selected');},profile(profile,projects,asOf){state={...state,profile:cleanProfile(profile),profile_completed:true,compared_projects:projects.map(p=>p.id),study_projects:projects};const ranked=rankProjects(projects,state.profile,asOf);state.top_projects=ranked.map(p=>p.id);save();event('investment_profile_completed');return ranked;},comparison(projects){state={...state,compared_projects:projects.map(p=>p.id),study_projects:projects};save();event('investment_comparison_viewed');},project(id){if(state.simulation?.projectId!==id)state={...state,simulation:null,simulation_expires_at:0};state={...state,selected_project:id};save();event('investment_project_selected',{development_id:id});},setSimulation(value){state={...state,simulation:cleanSimulation(value),simulation_expires_at:Date.now()+30*60*1000};save();},telemetryContext,context};
}
export function initInvestmentJourney({config,tracking,document,location,storage,emit}) {
  const journey=createJourney({storage,key:`ynt_investment_v1_${tracking?.sessionId||'preview'}`,preview:config.preview===true,emit});
  const href=path=>attributedHref(path,location.search,tracking);
  for(const a of document.querySelectorAll('[data-investment-entry]')){
    a.href=href(a.getAttribute('href'));
    a.addEventListener('click',()=>journey.select('investment'));
  }
  for(const button of document.querySelectorAll('[data-residential-intent]'))button.addEventListener('click',()=>{journey.select('residential');document.getElementById('intent-feedback').textContent='Preferência registrada. Continue explorando os imóveis nesta página.';});
  const projects=config.investmentProjects || [];
  if(config.kind==='investment'){
    // Entering this dedicated journey records interest without changing acquisition.
    if(journey.state.declared_intent!=='investment')journey.select('investment');
    const compare=document.getElementById('comparador');
    if(compare){
      if(typeof IntersectionObserver==='function'){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){journey.comparison(projects);observer.disconnect();}},{threshold:0.1});observer.observe(compare);}
      else journey.comparison(projects);
    }
    const form=document.getElementById('investment-profile'),results=document.getElementById('investment-results');
    if(form && results){
      const previous=cleanProfile(journey.state.profile);
      for(const key of ['budget','timing','stage','objective','region'])if(previous[key]!=null && form.elements[key])form.elements[key].value=previous[key];
      form.addEventListener('submit',event=>{
        event.preventDefault();
        const profile=Object.fromEntries(new FormData(form)),ranked=journey.profile(profile,projects,config.investmentAsOf);
        results.replaceChildren();
        const heading=document.createElement('h3');heading.textContent=ranked.length?'Até três opções para aprofundar':'Nenhum projeto atende ao orçamento e prazo informados';results.append(heading);
        if(!ranked.length){const p=document.createElement('p');p.textContent='Não ampliamos seu orçamento nem presumimos entrega. Revise os critérios ou consulte o catálogo completo. A ausência de resultado não significa ausência de imóveis no mercado.';results.append(p);}
        for(const project of ranked){
          const article=document.createElement('article'),title=document.createElement('h4'),why=document.createElement('p'),facts=document.createElement('p'),link=document.createElement('a');
          article.className='investment-match';title.textContent=project.name;why.textContent='Por que este projeto apareceu para você: '+project.reasons.join(' ');
          facts.textContent=`${project.neighborhood} · ${project.price?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format(project.price):'Preço a confirmar'} · ${project.stage}. Documentação da locação curta: não verificada.`;
          link.className='button primary';link.textContent='Quero analisar esta opção para locação curta';link.href=href(project.path);link.dataset.investmentProject=project.id;link.addEventListener('click',()=>journey.project(project.id));article.append(title,facts,why,link);results.append(article);
        }
        results.focus();
      });
    }
  }
  for(const a of document.querySelectorAll('a[href^="/es/vitoria/empreendimento/"]')){
    if(config.kind==='investment' || journey.context()){
      a.href=href(a.getAttribute('href'));
      const id=a.dataset.investmentProject || a.pathname?.match(/--(orulo-\d+|imovel-[a-f0-9]{16})/)?.[1];
      if(id)a.addEventListener('click',()=>journey.project(id));
    }
  }
  if(config.project?.city==='Vitória' && journey.context()){
    for(const button of document.querySelectorAll('[data-contact]'))button.textContent='Quero receber o estudo deste imóvel';
    const title=document.getElementById('contact-title');if(title)title.textContent='Vamos analisar esta opção para locação curta?';
    if(config.project.token)journey.project(config.project.token);
  }
  const simulator=document.getElementById('investment-simulator');
  let simulatorLoaded=false;
  simulator?.addEventListener('toggle',async()=>{if(!simulator.open||simulatorLoaded)return;simulatorLoaded=true;try{const {initSimulator}=await import('./investment-simulator.js');initSimulator({config,journey,tracking,emit,document,location});}catch{simulatorLoaded=false;console.warn('INVESTMENT_SIMULATOR_UNAVAILABLE');}});
  return journey;
}
