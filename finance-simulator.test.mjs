import test from 'node:test';
import assert from 'node:assert/strict';
import {FINANCIAL_FIELDS,calculate,payment,createScenarios,validBenchmarks,compareSimulations,addComparison,cleanSimulation} from './portal/finance-model.js';
import {cleanInvestmentContext,attributedHref} from './portal/investment-model.js';
import {createJourney} from './assets/js/investment-journey.js';
import {simulatorEvent} from './assets/js/investment-simulator.js';
import {renderSimulator} from './portal/investment-simulator.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const complete={acquisition:600000,financing:true,downPayment:120000,financed:480000,annualInterest:0,loanMonths:240,itbi:18000,registry:6000,fees:1000,brokerage:0,furniture:25000,linen:2000,decoration:3000,equipment:5000,reserve:10000,condo:500,annualIPTU:1200,internet:100,energy:200,insurance:50,maintenance:150,cleaning:100,platform:3,management:10,tax:6,nightlyRate:300,occupancy:50,nightsAvailable:30,averageStay:3};
const sim=(extra={})=>({projectId:'orulo-1',scenario:'base',inventory:{name:'Projeto real',unitId:'unit-1',price:600000,area:35,bedrooms:1,parking:0,stock:3,stage:'Em construção',type:'Apartamento',neighborhood:'Mata da Praia'},assumptions:{...complete},...extra});
const benchmark={id:'reference-1',city:'Vitória',neighborhood:'Mata da Praia',metric:'nightly_rate',value:200,unit:'BRL/night',method:'median',source:'Fonte externa de teste',sourceUrl:'https://example.test/methodology',periodStart:'2026-01-01',periodEnd:'2026-09-30',updatedAt:'2026-10-31'};
test('hand-calculated revenue, cleaning by reservation, platform, management, tax and total costs',()=>{
 const {metrics:m,missing}=calculate(complete);assert.deepEqual(missing,[]);
 assert.equal(m.occupiedNights,15);assert.equal(m.bookings,5);assert.equal(m.grossMonthly,4500);assert.equal(m.grossAnnual,54000);assert.equal(m.cleaningCost,500);assert.equal(m.platformCost,135);assert.equal(m.managementCost,450);assert.equal(m.taxes,270);assert.equal(m.iptuMonthly,100);assert.equal(m.fixedMonthly,1100);assert.equal(m.operatingTotal,2455);assert.equal(m.netMonthly,2045);assert.equal(m.netAnnual,24540);
});
test('capital, yields, cap rate, cash-on-cash and unlevered simple payback keep distinct denominators',()=>{
 const m=calculate(complete).metrics;assert.equal(m.implementationCost,45000);assert.equal(m.acquisitionCosts,25000);assert.equal(m.totalCapital,670000);assert.equal(m.equityCapital,190000);
 near(m.grossYield,9);near(m.netYield,24540/670000*100);near(m.capRate,4.09);assert.equal(m.cashMonthly,45);assert.equal(m.cashAnnual,540);near(m.cashOnCash,540/190000*100);near(m.paybackYears,670000/24540);
});
test('effective interest Price financing, zero interest, short term debt and mismatched funding',()=>{
 near(payment(120000,Math.pow(1.01,12)*100-100,120),120000*0.01/(1-Math.pow(1.01,-120)));
 assert.equal(payment(480000,0,240),2000);assert.equal(payment(0,0,240),null);
 const short=calculate({...complete,financed:6000,downPayment:594000,loanMonths:6}).metrics;assert.equal(short.debtMonthly,1000);assert.equal(short.debtAnnual,6000);assert.equal(short.cashAnnual,24540-6000);
 const bad=calculate({...complete,downPayment:0});assert.equal(bad.metrics.cashMonthly,null);assert.match(bad.alerts.join(' '),/entrada \+ financiamento/);assert.equal(calculate({...complete,financing:false}).metrics.cashOnCash,null);
});
test('break-even uses per-night contribution margin, with debt separate and impossible cases signaled',()=>{
 const m=calculate(complete).metrics;near(m.breakEvenOperating,1100/6290*100);near(m.breakEvenAfterDebt,3100/6290*100);
 const impossible=calculate({...complete,platform:100});assert.equal(impossible.metrics.breakEvenOperating,null);assert.match(impossible.alerts.join(' '),/Margem por noite não positiva/);
 const loss=calculate({...complete,nightlyRate:0});assert.equal(loss.metrics.paybackYears,null);assert.ok(loss.metrics.cashMonthly<0);
});
test('Conservador, Base and Otimista start without fabricated operating assumptions and remain independently editable',()=>{
 const scenarios=createScenarios({price:600000});for(const s of Object.values(scenarios)){assert.equal(s.acquisition,600000);assert.equal(s.nightlyRate,null);assert.equal(s.occupancy,null);assert.equal(s.condo,null);}
 scenarios.conservative={...complete,occupancy:30};scenarios.base={...complete,occupancy:50};scenarios.optimistic={...complete,occupancy:70};
 assert.deepEqual(Object.values(scenarios).map(s=>calculate(s).metrics.grossMonthly),[2700,4500,6300]);scenarios.base.nightlyRate=400;assert.equal(scenarios.conservative.nightlyRate,300);
});
test('missing costs remain unknown; zero assumptions cause warnings without blocking the calculation',()=>{
 const missing=calculate({...complete,condo:null,furniture:null});assert.equal(missing.metrics.grossMonthly,4500);assert.equal(missing.metrics.netMonthly,null);assert.equal(missing.metrics.totalCapital,null);assert.equal(missing.metrics.netYield,null);assert.match(missing.alerts.join(' '),/Condomínio não informado/);
 const warnings=calculate({...complete,acquisition:10000,financing:false,itbi:0,registry:0,fees:0,furniture:0,linen:0,decoration:0,equipment:0,reserve:0,occupancy:90,maintenance:0,tax:0,management:0,outsourced:true,furnished:'no'},[benchmark]);
 for(const pattern of [/85%/,/30%/,/Manutenção/,/Mobília/,/Impostos/,/terceirizada/,/inferior a 5 anos/])assert.match(warnings.alerts.join(' '),pattern);
 assert.equal(warnings.metrics.grossMonthly,8100);
});
test('benchmarks require city, neighborhood, period, source, update and method; never fill user assumptions',()=>{
 assert.equal(validBenchmarks([benchmark]).length,1);for(const key of ['city','neighborhood','periodStart','periodEnd','source','sourceUrl','updatedAt','method','metric','unit'])assert.equal(validBenchmarks([{...benchmark,[key]:null}]).length,0,key);
 const a={...complete,nightlyRate:null};assert.equal(calculate(a,[benchmark]).metrics.grossMonthly,null);assert.equal(a.nightlyRate,null);
});
test('up to three projects compare in insertion order, never ranked by yield, and a fourth is refused',()=>{
 let list=[];for(let i=1;i<=3;i++)list=addComparison(list,sim({projectId:'orulo-'+i,assumptions:{...complete,nightlyRate:500-i*100}})).items;
 assert.deepEqual(compareSimulations(list).map(s=>s.projectId),['orulo-1','orulo-2','orulo-3']);assert.match(addComparison(list,sim({projectId:'orulo-4'})).error,/três/);assert.equal(addComparison(list,sim()).items.length,3);
});
test('lead context separates inventory, benchmark, user and recalculated output; ignores client metric injection',()=>{
 const cleaned=cleanSimulation({...sim(),result:{metrics:{grossMonthly:999999999}},email:'never-store@example.test'});
 assert.equal(cleaned.result.metrics.grossMonthly,4500);assert.equal(cleaned.inventory.price,600000);assert.equal(cleaned.inventory.parking,0);assert.equal(cleaned.benchmark.applied,false);assert.equal(cleaned.user.source,'user_assumptions');assert.equal(cleaned.user.fieldOrigins.acquisition,'inventory_copy_editable');assert.equal(cleaned.user.fieldOrigins.nightlyRate,'user');assert.equal(cleaned.email,undefined);
 assert.equal(cleanSimulation({...sim(),acquisitionEdited:true}).user.fieldOrigins.acquisition,'user');
 const context=cleanInvestmentContext({airbnb_interest:true,simulation:cleaned});assert.equal(context.simulation.result.metrics.totalCapital,670000);assert.equal(context.simulation.scenario,'base');
});
test('simulation carries across explicit selection only, is scrubbed from all telemetry and expires',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)},events=[];const j=createJourney({storage,key:'session',emit:(n,d)=>events.push([n,d])});j.select('investment');j.setSimulation(sim());j.project('orulo-1');assert.equal(j.context().simulation.scenario,'base');assert.equal(j.telemetryContext().simulation,undefined);assert.ok(!JSON.stringify(events).includes('nightlyRate'));
 const reload=createJourney({storage,key:'session'});assert.equal(reload.context().simulation.assumptions.nightlyRate,300);reload.project('orulo-2');assert.equal(reload.context().simulation,undefined);
 const saved=JSON.parse(map.get('session'));saved.simulation=sim();saved.simulation_expires_at=Date.now()-1;map.set('session',JSON.stringify(saved));assert.equal(createJourney({storage,key:'session'}).context().simulation,undefined);
 const e=simulatorEvent('investment_assumption_changed',{project_id:'orulo-1',scenario:'base',field:'nightlyRate',value:300,financed:480000});assert.deepEqual(e.detail,{project_id:'orulo-1',scenario:'base',field:'nightlyRate'});
 const blocked=createJourney({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},key:'blocked'});blocked.select('investment');assert.equal(blocked.setSimulation(sim()),false);
});
test('simulator SSR includes editable inputs, formula boundaries, disclaimer, separate benchmark and no promises; URLs contain attribution only',()=>{
 const html=renderSimulator([]);for(const key of Object.keys(FINANCIAL_FIELDS))assert.ok(html.includes(`name="${key}"`),key);
 assert.match(html,/Esta simulação não constitui promessa de rentabilidade/);assert.match(html,/Benchmarks externos de mercado/);assert.match(html,/Campos ausentes não são considerados gratuitos/);assert.match(html,/Cash-on-cash/);assert.doesNotMatch(html,/rentabilidade garantida|retorno garantido|apto para Airbnb|resultado esperado/);
 assert.ok(html.indexOf('id="sim-comparison"')<html.indexOf('id="sim-handoff"'));
 const href=attributedHref('/es/vitoria/empreendimento/projeto--orulo-1','?gclid=Original&utm_campaign=Residential&nightlyRate=300&occupancy=80');assert.ok(href.includes('gclid=Original'));assert.ok(href.includes('utm_campaign=Residential'));assert.ok(!href.includes('nightlyRate'));
});
