import {FINANCIAL_FIELDS,SCENARIOS,SCENARIO_LABELS,normalizeAssumptions,createScenarios,calculate,validBenchmarks,addComparison,compareSimulations,cleanSimulation} from './finance-model.js';
import {attributedHref} from './investment-model.js';
const brl=v=>v===null?'Indisponível':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(v);
const percent=v=>v===null?'Indisponível':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(v)+'%';
const decimal=v=>v===null?'Indisponível':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(v);
const labels={grossMonthly:'Receita bruta mensal',grossAnnual:'Receita bruta anual — mês repetido',platformCost:'Plataforma mensal',cleaningCost:'Limpeza mensal',managementCost:'Gestão mensal',condo:'Condomínio mensal',iptuMonthly:'IPTU mensal',internet:'Internet mensal',energy:'Energia mensal',insurance:'Seguro mensal',maintenance:'Manutenção mensal',taxes:'Impostos mensais',operatingTotal:'Custo operacional mensal total',netMonthly:'Receita operacional líquida mensal — antes da dívida',netAnnual:'Receita operacional líquida anual — antes da dívida',implementationCost:'Implantação e reserva inicial',acquisitionCosts:'Custos adicionais de aquisição',totalCapital:'Capital total do projeto',equityCapital:'Capital próprio investido',debtMonthly:'Parcela financeira mensal',debtAnnual:'Parcelas nos primeiros doze meses',cashMonthly:'Fluxo mensal após dívida',cashAnnual:'Fluxo nos primeiros doze meses após dívida',grossYield:'Gross yield — receita bruta / aquisição',netYield:'Net yield — receita líquida / capital total',capRate:'Cap rate simplificado — receita líquida / aquisição',cashOnCash:'Cash-on-cash — após dívida / capital próprio',paybackYears:'Payback simples do projeto — antes da dívida (anos)',breakEvenOperating:'Ocupação de equilíbrio antes da dívida',breakEvenAfterDebt:'Ocupação de equilíbrio após dívida'};
const percentageKeys=['grossYield','netYield','capRate','cashOnCash','breakEvenOperating','breakEvenAfterDebt'];
const format=(key,value)=>percentageKeys.includes(key)?percent(value):key==='paybackYears'?decimal(value):brl(value);
export function simulatorEvent(name,detail={}){
  // Strict dimensions only: no amounts, rates, profile, financing or identifiers.
  const allowed=['project_id','scenario','field','comparison_count'];
  return {name,detail:Object.fromEntries(allowed.filter(k=>detail[k]!==undefined).map(k=>[k,detail[k]]))};
}
export function initSimulator({config,journey,tracking,emit,document,location}) {
  const root=document.getElementById('investment-simulator');if(!root)return;
  const projects=config.investmentProjects||[],benchmarks=validBenchmarks(config.investmentBenchmarks);
  const projectSelect=document.getElementById('sim-project'),unitSelect=document.getElementById('sim-unit'),scenarioSelect=document.getElementById('sim-scenario'),form=document.getElementById('sim-assumptions'),results=document.getElementById('sim-results'),comparison=document.getElementById('sim-comparison');
  let selected=null,unit=null,currentScenario='base',draft=null,comparisons=[],calculated=null;
  const drafts=new Map();
  const signal=(name,detail={})=>{if(config.preview!==true){const e=simulatorEvent(name,{project_id:selected?.id,scenario:currentScenario,...detail});emit(e.name,e.detail);}};
  signal('investment_simulator_opened');
  root.addEventListener('toggle',()=>{if(root.open)signal('investment_simulator_opened');});
  projectSelect.disabled=false;
  const loading=document.getElementById('sim-loading');if(loading)loading.hidden=true;
  const element=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
  const refs=()=>benchmarks.filter(b=>!b.neighborhood||b.neighborhood===selected?.neighborhood);
  function showBenchmarks(){
    const container=document.getElementById('sim-benchmarks');container.replaceChildren();
    const list=refs();if(!list.length){container.append(element('p','Nenhum benchmark externo validado está cadastrado para este recorte. Informe diária e ocupação; referências não são aplicadas automaticamente.'));return;}
    const metric={nightly_rate:'Diária',occupancy:'Ocupação',annual_revenue:'Receita anual estimada',seasonality:'Sazonalidade'},method={mean:'Média',median:'Mediana',estimate:'Estimativa'};
    for(const b of list){const p=element('p',`${metric[b.metric]}: ${b.value} ${b.unit} · ${method[b.method]} · ${b.neighborhood||b.city} · período ${b.periodStart} a ${b.periodEnd} · atualizado em ${b.updatedAt.slice(0,10)}. `),a=element('a',b.source);a.href=b.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';p.append(a);container.append(p);}
    container.append(element('p','Esses benchmarks são referências de mercado e não resultados previstos para o empreendimento. Nenhum valor preenche as hipóteses automaticamente.'));
  }
  function saveForm(){
    if(!draft)return;
    const values=Object.fromEntries(new FormData(form));values.financing=values.financing==='true';values.outsourced=values.outsourced==='true';draft.scenarios[currentScenario]=normalizeAssumptions(values);
  }
  function fillForm(){
    const a=draft.scenarios[currentScenario];
    for(const k of Object.keys(FINANCIAL_FIELDS))form.elements[k].value=a[k]??'';
    for(const k of ['financing','outsourced','furnished'])form.elements[k].value=String(a[k]);
    document.getElementById('sim-copy-base').disabled=currentScenario==='base';results.replaceChildren();calculated=null;
  }
  function chooseUnit(){
    saveForm();const index=Number(unitSelect.value);unit=unitSelect.value===''?null:selected.units[index];
    document.getElementById('sim-editor').hidden=!unit;results.replaceChildren();
    const inventory=document.getElementById('sim-inventory');inventory.replaceChildren();if(!unit)return;
    const key=selected.id+':'+(unit.id||index);if(!drafts.has(key))drafts.set(key,{scenarios:createScenarios(unit),edited:{}});draft=drafts.get(key);
    inventory.append(element('h4','Dados do inventário — referência original'));
    inventory.append(element('p',`${selected.name} · ${selected.neighborhood} · ${unit.type} · ${brl(unit.price)} · ${unit.area??'Não informado'} m² · ${unit.bedrooms??'Não informado'} dormitório(s) · ${unit.parking??'Não informado'} vaga(s) · estoque: ${unit.stock??'Não informado'} · ${selected.stage} · entrega: ${selected.delivery||'Não informada'}.`));
    inventory.append(element('p','Condomínio, IPTU, mobília, diária, ocupação e custos de operação não foram informados pelo inventário nesta seleção. Documentação da locação curta: não verificada.'));
    fillForm();showBenchmarks();
  }
  projectSelect.addEventListener('change',()=>{
    saveForm();draft=null;unit=null;selected=projects.find(p=>p.id===projectSelect.value);unitSelect.replaceChildren(element('option','Escolha uma configuração'));unitSelect.options[0].value='';unitSelect.disabled=!selected;
    for(const [i,u] of (selected?.units||[]).entries()){const option=element('option',`${u.type} · ${u.area??'?'} m² · ${brl(u.price)} · estoque ${u.stock??'não informado'}`);option.value=String(i);unitSelect.append(option);}
    document.getElementById('sim-editor').hidden=true;document.getElementById('sim-inventory').replaceChildren();results.replaceChildren();showBenchmarks();
  });
  unitSelect.addEventListener('change',chooseUnit);
  scenarioSelect.addEventListener('change',()=>{saveForm();currentScenario=SCENARIOS.includes(scenarioSelect.value)?scenarioSelect.value:'base';if(draft)fillForm();signal('investment_scenario_changed');});
  document.getElementById('sim-copy-base').addEventListener('click',()=>{if(draft&&currentScenario!=='base'){draft.scenarios[currentScenario]={...draft.scenarios.base};draft.edited[currentScenario]=draft.edited.base;fillForm();signal('investment_assumption_changed',{field:'copy_base'});}});
  form.addEventListener('change',event=>{const key=event.target.name;if(![...Object.keys(FINANCIAL_FIELDS),'financing','outsourced','furnished'].includes(key))return;saveForm();if(key==='acquisition')draft.edited[currentScenario]=true;calculated=null;results.replaceChildren();signal('investment_assumption_changed',{field:key});});
  function snapshot(){return {projectId:selected.id,scenario:currentScenario,inventory:{...unit,unitId:unit.id,name:selected.name,neighborhood:selected.neighborhood,stage:selected.stage,delivery:selected.delivery},assumptions:{...draft.scenarios[currentScenario]},acquisitionEdited:draft.edited[currentScenario]===true,benchmark:{referenceIds:refs().map(b=>b.id)}};}
  function renderComparison(){
    comparison.replaceChildren();if(!comparisons.length)return;
    comparison.append(element('h3','4. Compare até três empreendimentos'));
    comparison.append(element('p','Ordem de inclusão, sem ranking por yield. Cada coluna mantém o cenário e as premissas que você adicionou; alterações posteriores exigem atualizar a coluna.'));
    const wrap=element('div',undefined,'market-table-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Métricas lado a lado');
    const table=element('table',undefined,'market-table sim-compare-table'),caption=element('caption','Comparação de hipóteses, não de resultados previstos');table.append(caption);
    const data=compareSimulations(comparisons),head=element('thead'),tr=element('tr');tr.append(element('th','Critério'));
    for(const item of data){const th=element('th',`${item.inventory.name} · ${SCENARIO_LABELS[item.scenario]}`);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
    const tbody=element('tbody');
    const rows=[['Ticket do inventário',i=>brl(i.inventory.price)],['Aquisição informada pelo usuário',i=>brl(i.assumptions.acquisition)],['Área',i=>i.inventory.area===null?'Não informado':`${i.inventory.area} m²`],['Bairro',i=>i.inventory.neighborhood],['Estágio',i=>i.inventory.stage],...['totalCapital','grossMonthly','netMonthly','grossYield','netYield','cashOnCash','breakEvenAfterDebt'].map(k=>[labels[k],i=>format(k,i.result.metrics[k])])];
    for(const [label,get] of rows){const row=element('tr'),th=element('th',label);th.scope='row';row.append(th);for(const item of data)row.append(element('td',get(item)));tbody.append(row);}table.append(tbody);wrap.append(table);comparison.append(wrap);
    for(const item of data){const detail=element('details'),summary=element('summary',`Premissas e alertas: ${item.inventory.name}`);detail.append(summary);for(const [k,v] of Object.entries(item.assumptions))if(FINANCIAL_FIELDS[k])detail.append(element('p',`${FINANCIAL_FIELDS[k][0]}: ${v??'Não informado'}`));for(const alert of item.result.alerts)detail.append(element('p',alert));const remove=element('button',`Remover ${item.inventory.name}`);remove.type='button';remove.addEventListener('click',()=>{comparisons=comparisons.filter(p=>p.projectId!==item.projectId);renderComparison();});detail.append(remove);comparison.append(detail);}
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!selected||!unit||!draft)return;saveForm();const snap=snapshot(),computed=calculate(snap.assumptions,refs());calculated=snap;results.replaceChildren();
    results.append(element('h3',`3. Resultado hipotético — ${SCENARIO_LABELS[currentScenario]}`));
    results.append(element('p',computed.missing.length?'Dados incompletos: métricas dependentes dos campos abaixo permanecem indisponíveis. Não tratamos campos vazios como gratuitos.':'Cálculo com as hipóteses preenchidas. Os valores não são previsão nem garantia de receita.',computed.missing.length?'sim-warning':''));
    if(computed.missing.length){const details=element('details'),summary=element('summary',`${computed.missing.length} campos não informados`);details.append(summary,element('p',computed.missing.map(k=>FINANCIAL_FIELDS[k][0]).join('; ')));results.append(details);}
    for(const alert of computed.alerts)results.append(element('p',alert,'sim-warning'));
    const dl=element('dl',undefined,'sim-metrics');for(const [k,label] of Object.entries(labels)){dl.append(element('dt',label),element('dd',format(k,computed.metrics[k])));}results.append(dl);
    results.append(element('p',`Noites ocupadas no mês-modelo: ${decimal(computed.metrics.occupiedNights)}. Reservas aproximadas: ${decimal(computed.metrics.bookings)}. O anual repete esse mês; não prevê sazonalidade. Imóveis em obra não têm receita presumida antes da entrega.`));
    const add=element('button','Adicionar ou atualizar na comparação');add.type='button';add.addEventListener('click',()=>{const change=addComparison(comparisons,{...calculated,benchmarks:refs()});if(change.error){add.nextElementSibling.textContent=change.error;return;}comparisons=change.items;signal('investment_comparison_started',{comparison_count:comparisons.length});renderComparison();});results.append(add,element('p',''));
    results.append(element('h4','5. Continue com o atendimento'));
    results.append(element('p','Ao continuar para a ficha, este cenário e suas principais hipóteses serão mantidos temporariamente nesta sessão para anexar ao contato que você enviar. Não são salvos com sua identidade antes do envio do formulário de lead.'));
    const link=element('a','Quero analisar este cenário com a Yincorp','button primary');link.href=attributedHref(selected.path+(unit.id?'/tipologia/'+unit.id:''),location.search,tracking);
    link.addEventListener('click',()=>{journey.select('investment');journey.project(selected.id);journey.setSimulation?.(cleanSimulation(calculated));signal('investment_project_selected_from_simulator');});results.append(link);
    signal('investment_simulation_completed');results.focus();
  });
}
