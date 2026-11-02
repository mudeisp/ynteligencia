// Deterministic hypothetical cash-flow model. Amounts are BRL; rates are percent.
export const SCENARIOS=['conservative','base','optimistic'];
export const SCENARIO_LABELS={conservative:'Conservador',base:'Base',optimistic:'Otimista'};
export const FINANCIAL_FIELDS={
  acquisition:['Preço de aquisição (R$)',1,1e9],downPayment:['Entrada (R$)',0,1e9],financed:['Valor financiado (R$)',0,1e9],annualInterest:['Juros efetivos anuais (%)',0,200],loanMonths:['Prazo do financiamento (meses)',1,600],
  itbi:['ITBI (R$)',0,1e8],registry:['Escritura e registro (R$)',0,1e8],fees:['Outras taxas de aquisição (R$)',0,1e8],brokerage:['Corretagem aplicável (R$)',0,1e8],furniture:['Mobília e implantação (R$)',0,1e8],linen:['Enxoval (R$)',0,1e8],decoration:['Decoração (R$)',0,1e8],equipment:['Equipamentos (R$)',0,1e8],reserve:['Reserva inicial de manutenção (R$)',0,1e8],
  condo:['Condomínio mensal (R$)',0,1e7],annualIPTU:['IPTU anual (R$)',0,1e7],internet:['Internet mensal (R$)',0,1e7],energy:['Energia mensal (R$)',0,1e7],insurance:['Seguro mensal (R$)',0,1e7],maintenance:['Manutenção mensal (R$)',0,1e7],cleaning:['Limpeza por reserva (R$)',0,1e7],platform:['Taxa da plataforma (% da receita de diárias)',0,100],management:['Gestão (% da receita de diárias)',0,100],tax:['Impostos (% da receita de diárias)',0,100],
  nightlyRate:['Diária média informada (R$)',0,1e7],occupancy:['Ocupação das noites disponíveis (%)',0,100],nightsAvailable:['Noites disponíveis no mês-modelo',1,31],averageStay:['Estadia média (noites)',1,365]
};
const setupKeys=['itbi','registry','fees','brokerage','furniture','linen','decoration','equipment','reserve'];
const fixedKeys=['condo','annualIPTU','internet','energy','insurance','maintenance'];
const operatingKeys=[...fixedKeys,'cleaning','platform','management','tax'];
const revenueKeys=['nightlyRate','occupancy','nightsAvailable','averageStay'];
export function normalizeAssumptions(input={}) {
  const result={financing:input.financing===true,outsourced:input.outsourced===true,furnished:['yes','no'].includes(input.furnished)?input.furnished:'unknown'};
  for(const [key,[,min,max]] of Object.entries(FINANCIAL_FIELDS)){
    const raw=input[key],n=raw===null||raw===undefined||raw===''?NaN:Number(raw);
    result[key]=Number.isFinite(n)&&n>=min&&n<=max && (key!=='loanMonths'||Number.isInteger(n))?n:null;
  }
  return result;
}
export function emptyScenario(unit={}) {return normalizeAssumptions({acquisition:unit.price??null});}
export function createScenarios(unit={}) {return Object.fromEntries(SCENARIOS.map(s=>[s,emptyScenario(unit)]));}
export function payment(principal,annualPercent,months) {
  if(!(principal>0)||annualPercent===null||annualPercent<0||!Number.isInteger(months)||months<1)return null;
  const rate=Math.expm1(Math.log1p(annualPercent/100)/12);
  return rate===0?principal/months:principal*rate/(-Math.expm1(-months*Math.log1p(rate)));
}
export function validBenchmarks(rows=[]) {
  return (Array.isArray(rows)?rows:[]).filter(b=>b && b.city==='Vitória' && typeof b.neighborhood==='string' && ['nightly_rate','occupancy','annual_revenue','seasonality'].includes(b.metric) && ['mean','median','estimate'].includes(b.method) && typeof b.value==='number' && Number.isFinite(b.value) && b.value>=0 && (b.metric!=='occupancy'||b.value<=100) && /^https:\/\//.test(b.sourceUrl||'') && b.source && /^\d{4}-\d{2}-\d{2}$/.test(b.periodStart||'') && /^\d{4}-\d{2}-\d{2}$/.test(b.periodEnd||'') && b.periodStart<=b.periodEnd && Number.isFinite(Date.parse(b.updatedAt)) && b.unit && b.id).map(b=>({id:String(b.id).slice(0,80),city:'Vitória',neighborhood:String(b.neighborhood).slice(0,80),metric:b.metric,value:b.value,unit:String(b.unit).slice(0,40),source:String(b.source).slice(0,160),sourceUrl:String(b.sourceUrl).slice(0,500),periodStart:b.periodStart,periodEnd:b.periodEnd,updatedAt:new Date(b.updatedAt).toISOString(),method:b.method}));
}
export function calculate(input,benchmarks=[]) {
  const a=normalizeAssumptions(input),has=keys=>keys.every(k=>a[k]!==null),sum=keys=>keys.reduce((s,k)=>s+a[k],0);
  const revenueReady=has(revenueKeys),operatingReady=revenueReady&&has(operatingKeys),capitalReady=a.acquisition!==null&&has(setupKeys);
  const occupiedNights=revenueReady?a.nightsAvailable*a.occupancy/100:null,bookings=revenueReady?occupiedNights/a.averageStay:null;
  const grossMonthly=revenueReady?a.nightlyRate*occupiedNights:null,grossAnnual=grossMonthly===null?null:grossMonthly*12;
  const platformCost=grossMonthly!==null&&a.platform!==null?grossMonthly*a.platform/100:null;
  const managementCost=grossMonthly!==null&&a.management!==null?grossMonthly*a.management/100:null;
  const taxes=grossMonthly!==null&&a.tax!==null?grossMonthly*a.tax/100:null;
  const cleaningCost=bookings!==null&&a.cleaning!==null?bookings*a.cleaning:null;
  const fixedMonthly=has(fixedKeys)?a.condo+a.annualIPTU/12+a.internet+a.energy+a.insurance+a.maintenance:null;
  const operatingTotal=operatingReady?fixedMonthly+platformCost+managementCost+taxes+cleaningCost:null;
  const netMonthly=operatingTotal===null?null:grossMonthly-operatingTotal,netAnnual=netMonthly===null?null:netMonthly*12;
  const implementationCost=has(['furniture','linen','decoration','equipment','reserve'])?sum(['furniture','linen','decoration','equipment','reserve']):null;
  const acquisitionCosts=has(['itbi','registry','fees','brokerage'])?sum(['itbi','registry','fees','brokerage']):null;
  const setupTotal=has(setupKeys)?sum(setupKeys):null,totalCapital=capitalReady?a.acquisition+setupTotal:null;
  const debtValid=!a.financing || (has(['downPayment','financed','annualInterest','loanMonths','acquisition'])&&a.financed>0&&Math.abs(a.downPayment+a.financed-a.acquisition)<=0.01);
  const debtMonthly=debtValid?(a.financing?payment(a.financed,a.annualInterest,a.loanMonths):0):null;
  const equityCapital=capitalReady&&debtValid?(a.financing?a.downPayment:a.acquisition)+setupTotal:null;
  const cashMonthly=netMonthly!==null&&debtMonthly!==null?netMonthly-debtMonthly:null;
  // First 12 operating months; if the loan ends earlier, do not charge 12 installments.
  const debtAnnual=debtMonthly===null?null:debtMonthly*(a.financing?Math.min(12,a.loanMonths):12);
  const cashAnnual=netAnnual!==null&&debtAnnual!==null?netAnnual-debtAnnual:null;
  const ratio=(n,d)=>n!==null&&d>0?n/d*100:null;
  const grossYield=ratio(grossAnnual,a.acquisition),netYield=ratio(netAnnual,totalCapital),capRate=ratio(netAnnual,a.acquisition),cashOnCash=a.financing?ratio(cashAnnual,equityCapital):null;
  const paybackYears=netAnnual>0&&totalCapital>0?totalCapital/netAnnual:null;
  const margin=has(['nightlyRate','platform','management','tax','cleaning','averageStay'])?a.nightlyRate*(1-(a.platform+a.management+a.tax)/100)-a.cleaning/a.averageStay:null;
  const breakEvenOperating=fixedMonthly!==null&&margin>0&&a.nightsAvailable!==null?fixedMonthly/(a.nightsAvailable*margin)*100:null;
  const breakEvenAfterDebt=breakEvenOperating!==null&&debtMonthly!==null?(fixedMonthly+debtMonthly)/(a.nightsAvailable*margin)*100:null;
  const alerts=[];
  if(a.occupancy>85)alerts.push('Ocupação acima de 85%: hipótese agressiva, sem garantia de demanda.');
  if(a.maintenance===0)alerts.push('Manutenção mensal igual a zero; revise a provisão.');
  if(a.condo===null)alerts.push('Condomínio não informado. Resultados operacionais líquidos ficam incompletos.');
  if(a.furniture===0&&a.furnished!=='yes')alerts.push('Mobília igual a zero para unidade não confirmada como mobiliada.');
  if(a.tax===0)alerts.push('Impostos iguais a zero. Confirme o enquadramento e os custos aplicáveis.');
  if(a.outsourced&&a.management===0)alerts.push('Operação terceirizada com gestão igual a zero.');
  if(paybackYears!==null&&paybackYears<5)alerts.push('Payback simples inferior a 5 anos: confira todas as hipóteses e custos. Esse limiar é apenas um alerta de revisão.');
  const rates=validBenchmarks(benchmarks).filter(b=>b.metric==='nightly_rate'&&b.unit==='BRL/night'&&b.value>0);
  if(rates.some(b=>a.nightlyRate>b.value*1.3))alerts.push('Diária informada mais de 30% acima de referência cadastrada. O limite é um alerta de revisão, não uma previsão.');
  if(a.financing&&!debtValid)alerts.push('Financiamento incompleto ou entrada + financiamento diferente do preço de aquisição. Fluxo após dívida indisponível.');
  if(margin!==null&&margin<=0)alerts.push('Margem por noite não positiva; não há ocupação que cubra os custos fixos neste modelo.');
  if(breakEvenAfterDebt>100)alerts.push('O ponto de equilíbrio após dívida supera as noites disponíveis.');
  if(netMonthly!==null&&netMonthly<=0)alerts.push('Operação líquida não positiva; payback simples indisponível.');
  return {assumptions:a,missing:[...new Set([...revenueKeys,...operatingKeys,...setupKeys,'acquisition',...(a.financing?['downPayment','financed','annualInterest','loanMonths']:[])])].filter(k=>a[k]===null),metrics:{occupiedNights,bookings,grossMonthly,grossAnnual,platformCost,managementCost,taxes,cleaningCost,condo:a.condo,iptuMonthly:a.annualIPTU===null?null:a.annualIPTU/12,internet:a.internet,energy:a.energy,insurance:a.insurance,maintenance:a.maintenance,fixedMonthly,operatingTotal,netMonthly,netAnnual,implementationCost,acquisitionCosts,setupTotal,totalCapital,equityCapital,debtMonthly,debtAnnual,cashMonthly,cashAnnual,grossYield,netYield,capRate,cashOnCash,paybackYears,breakEvenOperating,breakEvenAfterDebt},alerts};
}
export function compareSimulations(items) {return [...new Map(items.map(item=>[item.projectId,item])).values()].slice(0,3).map(item=>({...item,result:calculate(item.assumptions,item.benchmarks)}));}
export function addComparison(items,item){if(!items.some(i=>i.projectId===item.projectId)&&items.length>=3)return {items,error:'A comparação aceita até três empreendimentos. Remova um antes de adicionar outro.'};return {items:[...items.filter(i=>i.projectId!==item.projectId),item],error:null};}
const text=(v,max=160)=>String(v||'').slice(0,max),amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9?v:null;
export function cleanSimulation(value) {
  if(!value || !SCENARIOS.includes(value.scenario) || !/^orulo-\d+$|^imovel-[a-f0-9]{16}$/.test(value.projectId||''))return null;
  const i=value.inventory||{},assumptions=normalizeAssumptions(value.assumptions),result=calculate(assumptions);
  const acquisitionEdited=value.acquisitionEdited===true||value.user?.acquisitionEdited===true;
  return {version:1,projectId:value.projectId,scenario:value.scenario,inventory:{source:'portal_inventory',verification:'client_snapshot_requires_confirmation',name:text(i.name),neighborhood:text(i.neighborhood,80),unitId:text(i.unitId,100),price:amount(i.price),area:amount(i.area),bedrooms:amount(i.bedrooms),parking:amount(i.parking),stock:amount(i.stock),type:text(i.type,60),stage:text(i.stage,80),delivery:/^\d{4}-\d{2}-\d{2}$/.test(i.delivery||'')?i.delivery:null,documentaryStatus:'not_verified'},benchmark:{source:'external_market',applied:false,referenceIds:(Array.isArray(value.benchmark?.referenceIds)?value.benchmark.referenceIds:[]).map(id=>text(id,80)).slice(0,8),note:'Referências não são previsões da unidade; valores não são aplicados automaticamente.'},user:{source:'user_assumptions',acquisitionEdited,fieldOrigins:Object.fromEntries(Object.keys(FINANCIAL_FIELDS).map(k=>[k,assumptions[k]===null?'not_informed':k==='acquisition'&&!acquisitionEdited&&assumptions[k]===i.price?'inventory_copy_editable':'user'])),assumptions},assumptions,result:{source:'deterministic_calculation',modelVersion:1,metrics:result.metrics,missing:result.missing},disclaimer:'Esta simulação não constitui promessa de rentabilidade. Diárias, ocupação, custos e receitas variam conforme mercado, sazonalidade, operação, regras condominiais e características da unidade.'};
}
