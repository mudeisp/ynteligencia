import {cleanSimulation} from './finance-model.js';
// Shared rules. Matching does not use simulated financial returns.
export const ATTRIBUTION_KEYS=['gclid','gbraid','wbraid','utm_source','utm_medium','utm_campaign','utm_term','utm_content','visitor_id','session_id'];
const allowed={timing:['immediate','12months','1to3years','undefined'],stage:['ready','construction','launch','any'],objective:['income','appreciation','balanced']};
export function cleanProfile(input={}) {
  const n=Number(input.budget);
  return {budget:Number.isFinite(n)&&n>0&&n<=1e9?n:null,timing:allowed.timing.includes(input.timing)?input.timing:'undefined',stage:allowed.stage.includes(input.stage)?input.stage:'any',objective:allowed.objective.includes(input.objective)?input.objective:'balanced',region:String(input.region||'').slice(0,80)};
}
export function stageCode(stage='') {
  const s=String(stage).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/pronto|entregue|concluido/.test(s))return 'ready';
  if(/construcao|obras/.test(s))return 'construction';
  if(/lancamento/.test(s))return 'launch';
  return 'unknown';
}
export function rankProjects(projects,input,asOf) {
  const p=cleanProfile(input),now=Date.parse(asOf);
  const ranked=projects.flatMap(project=>{
    const units=project.units.filter(u=>u.stock!==0 && (!p.budget || (u.price>0 && u.price<=p.budget)));
    if(!units.length)return [];
    const ready=project.stageCode==='ready';
    const delivery=Date.parse(project.delivery),months=Number.isFinite(delivery)&&Number.isFinite(now)?(delivery-now)/(86400000*30.4375):null;
    // A stage alone cannot establish a delivery deadline. Do not infer readiness
    // from a past opening date while the supplier still reports construction.
    const fitsTime=p.timing==='undefined' || ready || (months!==null && months>=0 && (p.timing==='12months'?months<=12:p.timing==='1to3years'?months<=36:false));
    if(!fitsTime)return [];
    const priced=units.map(u=>u.price).filter(n=>n>0),price=priced.length?Math.min(...priced):null;
    const reasons=[p.budget?'Há tipologia elegível dentro do orçamento informado.':'Possui tipologia compacta no recorte da seleção.'];
    let score=0;
    if(p.stage!=='any' && project.stageCode===p.stage){score+=2;reasons.push('O estágio informado coincide com sua preferência.');}
    if(p.region && project.neighborhood===p.region){score+=3;reasons.push('Fica no bairro de sua preferência.');}
    if(p.timing!=='undefined')reasons.push(ready?'O fornecedor informa estágio pronto; confirme disponibilidade e início de operação.':'A entrega informada está no prazo escolhido; entrega não garante início de operação.');
    return [{...project,units,price,score,reasons}];
  });
  return ranked.sort((a,b)=>b.score-a.score || (a.price??Infinity)-(b.price??Infinity) || a.path.localeCompare(b.path)).slice(0,3);
}
export function attributedHref(path,search='',tracking=null) {
  const q=new URLSearchParams(search),target=new URL(path,'https://www.yincorp.com.br');
  for(const key of ATTRIBUTION_KEYS){
    const value=q.get(key) || (key==='visitor_id'?tracking?.visitorId:key==='session_id'?tracking?.sessionId:tracking?.touches?.current_touch?.[key]);
    if(value)target.searchParams.set(key,value);
  }
  return target.pathname+target.search+target.hash;
}
const token=v=>/^orulo-\d+$|^imovel-[a-f0-9]{16}$/.test(String(v))?String(v):'';
function studyComparison(projects) {
  const text=(v,n=160)=>String(v||'').slice(0,n),number=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
  return (Array.isArray(projects)?projects:[]).slice(0,6).filter(p=>token(p?.id)).map(p=>({id:token(p.id),name:text(p.name),neighborhood:text(p.neighborhood,80),price:number(p.price),stage:text(p.stage,80),documentary_status:'not_verified',units:(Array.isArray(p.units)?p.units:[]).slice(0,30).map(u=>({price:number(u.price),area:number(u.area),bedrooms:number(u.bedrooms),parking:number(u.parking),stock:number(u.stock),type:text(u.type,60)}))}));
}
export function cleanInvestmentContext(value) {
  if(!value || value.airbnb_interest!==true)return null;
  const selected=token(value.selected_project);
  const history=(Array.isArray(value.intent_history)?value.intent_history:[]).slice(-12).filter(e=>['residential','investment'].includes(e?.intent)).map(e=>({intent:e.intent,at:Number.isFinite(Date.parse(e.at))?new Date(e.at).toISOString():null}));
  return {version:1,declared_intent:'investment',airbnb_interest:true,initial_declared_intent:['residential','investment'].includes(value.initial_declared_intent)?value.initial_declared_intent:null,intent_history:history,profile:cleanProfile(value.profile),profile_completed:value.profile_completed===true,compared_projects:[...new Set((Array.isArray(value.compared_projects)?value.compared_projects:[]).map(token).filter(Boolean))].slice(0,6),selected_project:selected,top_projects:(Array.isArray(value.top_projects)?value.top_projects:[]).map(token).filter(Boolean).slice(0,3),...(cleanSimulation(value.simulation)?{simulation:cleanSimulation(value.simulation)}:{}),study:{version:1,source:'portal_inventory',documentary_status:'not_verified',comparison:studyComparison(value.study_projects || value.study?.comparison),assumptions:['Informações declaradas pelo visitante; confirmar preço, estoque, entrega e documentos.','Instantâneo do catálogo informado pelo cliente; exige readback antes de proposta comercial.'],risks:['Locação curta depende das regras condominiais e da legislação.','Sem projeção de receita ou retorno.'],next_steps:['Confirmar a unidade e os documentos com a Yincorp.']}};
}
export function evolveIntent(state={},intent,at=new Date().toISOString()) {
  if(!['residential','investment'].includes(intent))return state;
  return {...state,initial_declared_intent:state.initial_declared_intent||intent,declared_intent:intent,airbnb_interest:intent==='investment',intent_history:[...(state.intent_history||[]),{intent,at}].slice(-12)};
}
