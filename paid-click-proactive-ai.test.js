const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const paid = require('./paid-click-experience.js');
const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const scheduler = html.slice(html.indexOf('const YNT_PAID_UTM_MEDIA='), html.indexOf('function extractAllPropertyImages('));

function runtime(search = '', active = false) {
  const timers = new Map();
  const opened = [];
  const bodyClasses = new Set();
  let serial = 0;
  const context = {
    paidSearch: paid.readSearchParams(search), adIntent: {active},
    YNTELIGENCIA_TOUCHES: {},
    aiAssistantTriggerTimer: null, aiResumeChatAfterDetail: false,
    document: {body: {contains: () => true, classList: {
      contains: name => bodyClasses.has(name),
      toggle: (name, enabled) => enabled ? bodyClasses.add(name) : bodyClasses.delete(name)
    }}},
    setTimeout: (fn, delay) => { timers.set(++serial, {fn, delay}); return serial; },
    clearTimeout: id => timers.delete(id),
    yntIsPaidDirectPropertyEntry: () => true,
    yntOpenProactiveAiForProperty: p => opened.push(p.id),
    supabaseTrack: () => {}, gtag: () => {}
  };
  vm.createContext(context);
  vm.runInContext(scheduler, context);
  return {context, timers, opened, bodyClasses, flush() {
    const pending = [...timers.values()]; timers.clear();
    for (const {fn} of pending) fn();
  }};
}
const example = '?modo=explorar&cidade=São+Paulo&estado=SP&regiao=oeste&bairro=Pinheiros&dormitorios=2';

test('paid explorar: first and second detail never schedule automatic AI', () => {
  const r = runtime(example);
  for (const id of ['first', 'second']) {
    r.context.scheduleAiAssistantForProperty({id}, {});
    assert.equal(r.timers.size, 0);
    r.flush();
  }
  assert.deepEqual(r.opened, []);
});
test('paid UI sync adds class when current touch receives a click ID later', () => {
  const r = runtime();
  assert.equal(r.bodyClasses.has('paid-click-context'), false);
  r.context.YNTELIGENCIA_TOUCHES.current_touch = {gclid:'late-click-id'};
  r.context.syncPaidClickContextUi();
  assert.equal(r.bodyClasses.has('paid-click-context'), true);
});

test('paid click IDs block automatic AI without search intent', () => {
  const r = runtime();
  r.context.YNTELIGENCIA_TOUCHES.current_touch = {gclid:'click-id'};
  r.context.scheduleAiAssistantForProperty({id:'paid-click'}, {});
  assert.equal(r.timers.size, 0);
  assert.deepEqual(r.opened, []);
});

test('paid campaign UTMs block automatic AI but email UTMs do not', () => {
  const paidCampaign = runtime();
  paidCampaign.context.YNTELIGENCIA_TOUCHES.current_touch = {utm_source:'google', utm_medium:'cpc'};
  paidCampaign.context.scheduleAiAssistantForProperty({id:'paid-utm'}, {});
  assert.equal(paidCampaign.timers.size, 0);

  const emailCampaign = runtime();
  emailCampaign.context.YNTELIGENCIA_TOUCHES.current_touch = {utm_source:'newsletter', utm_medium:'email'};
  emailCampaign.context.scheduleAiAssistantForProperty({id:'email'}, {});
  assert.equal([...emailCampaign.timers.values()][0].delay, 5000);
});

test('active ad intent cancels an already pending organic AI timer', () => {
  const r = runtime();
  r.context.scheduleAiAssistantForProperty({id:'first'}, {});
  assert.equal(r.timers.size, 1);
  r.context.adIntent.active = true;
  r.context.scheduleAiAssistantForProperty({id:'second'}, {});
  r.flush();
  assert.deepEqual(r.opened, []);
});
test('pending callback rechecks paid context before opening AI', () => {
  const r = runtime();
  r.context.scheduleAiAssistantForProperty({id:'first'}, {});
  r.context.adIntent.active = true;
  r.flush();
  assert.deepEqual(r.opened, []);
});
test('organic automatic AI retains its five second timer', () => {
  const r = runtime();
  r.context.scheduleAiAssistantForProperty({id:'organic'}, {});
  assert.equal([...r.timers.values()][0].delay, 5000);
  r.flush();
  assert.deepEqual(r.opened, ['organic']);
});
test('paid manual AI handler still opens the chosen property', () => {
  const handler = html.match(/"\.detail-ai-float-btn"\s*\)\s*\?\.addEventListener\(\s*"click",\s*(\(\)=>openAgentConversation\(p\))/);
  assert.ok(handler);
  const r = runtime(example);
  r.context.p = {id:'manual'};
  r.context.openAgentConversation = p => r.opened.push(p.id);
  vm.runInContext(`(${handler[1]})()`, r.context);
  assert.deepEqual(r.opened, ['manual']);
});
test('detail/return/second property preserves push eligibility without AI covering it', () => {
  const r = runtime(example);
  let state = paid.createExperience({intent: r.context.paidSearch, sessionId:'s', subscriptionAuthority:'not_subscribed'});
  state = paid.reducePaidExperience(state, {type:'results_shown'});
  for (const id of ['first','second']) {
    r.context.scheduleAiAssistantForProperty({id}, {});
    state = paid.reducePaidExperience(state, {type:'detail_opened', propertyId:id});
    assert.equal(paid.evaluatePushPrompt(state, {detailOpen:true}).visible, false);
    state = paid.reducePaidExperience(state, {type:'returned_to_results'});
  }
  assert.equal(state.promptEligible, true);
  assert.equal(r.timers.size, 0);
  assert.deepEqual(r.opened, []);
});
test('Ads aliases and explorar routing remain unchanged; no native permission on load', () => {
  assert.equal(paid.readSearchParams(example).directToResults, false);
  assert.equal(paid.readSearchParams('?neighborhood=Pinheiros&bedrooms=2&max_price=900000').directToResults, true);
  assert.equal(html.includes('Notification.requestPermission('), false);
});
