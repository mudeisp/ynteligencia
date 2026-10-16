const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const paid = require('./paid-click-experience.js');
const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const render = html.slice(html.indexOf('function renderPaidPush(){'), html.indexOf('async function acceptPaidPush(){'));

function page() {
  const elements = Object.fromEntries(['paidPushSheet','paidPushStatus','paidPushTitle','paidPushAccept','paidPushDismiss'].map(id => [id, {hidden:true, textContent:''}]));
  const modal = {
    hidden:false, aria:'false', display:'block', visibility:'visible',
    getAttribute() { return this.aria; },
    getClientRects() { return this.hidden || this.display === 'none' ? [] : [{}]; }
  };
  elements.photoModal = modal;
  const context = {
    PaidClickExperience:paid,
    paidExperience:paid.createExperience({intent:{neighborhood:'Pinheiros'}, sessionId:'s', subscriptionAuthority:'not_subscribed'}),
    adIntent:{neighborhood:'Pinheiros', bedrooms:2},
    $:id => elements[id],
    document:{getElementById:id => elements[id] || null, body:{classList:{toggle(){}}}},
    getComputedStyle:element => ({visibility:element.visibility}),
    supabaseTrack() {}
  };
  context.notePaidSignal = (type, propertyId) => {
    context.paidExperience = paid.reducePaidExperience(context.paidExperience, {type, propertyId});
    context.renderPaidPush();
  };
  vm.createContext(context);
  vm.runInContext(render, context);
  return {context, elements, modal, signal:context.notePaidSignal};
}

test('real render: prompt appears only on returning from second distinct property, even with closed modal in DOM', () => {
  const p = page();
  p.modal.hidden = true;
  p.context.renderPaidPush();
  assert.equal(p.elements.paidPushSheet.hidden, true);
  p.signal('results_shown');
  assert.equal(p.elements.paidPushSheet.hidden, true);
  p.modal.hidden = false;
  p.signal('detail_opened', 'first');
  assert.equal(p.context.paidExperience.promptEligible, false);
  assert.equal(p.elements.paidPushSheet.hidden, true);
  p.modal.hidden = true;
  p.signal('returned_to_results');
  assert.equal(p.elements.paidPushSheet.hidden, true);
  p.modal.hidden = false;
  p.signal('detail_opened', 'first');
  assert.equal(p.context.paidExperience.promptEligible, false);
  p.signal('detail_opened', 'second');
  assert.equal(p.context.paidExperience.promptEligible, true);
  assert.equal(p.elements.paidPushSheet.hidden, true);
  p.modal.hidden = true;
  p.signal('returned_to_results');
  assert.ok(p.elements.photoModal);
  assert.equal(p.elements.paidPushSheet.hidden, false);
  assert.equal(p.elements.paidPushTitle.textContent, 'Quer que eu te avise quando aparecer uma nova opção dentro desta busca?');
  p.modal.hidden = false;
  p.context.renderPaidPush();
  assert.equal(p.elements.paidPushSheet.hidden, true);
});

test('real render: display none, aria-hidden, visibility hidden and removed modal do not block eligible prompt', () => {
  for (const closed of ['display','aria','visibility','removed']) {
    const p = page();
    p.signal('results_shown');
    p.signal('detail_opened', 'a');
    p.signal('detail_opened', 'b');
    assert.equal(p.elements.paidPushSheet.hidden, true);
    if (closed === 'display') p.modal.display = 'none';
    if (closed === 'aria') p.modal.aria = 'true';
    if (closed === 'visibility') p.modal.visibility = 'hidden';
    if (closed === 'removed') delete p.elements.photoModal;
    p.signal('returned_to_results');
    assert.equal(p.elements.paidPushSheet.hidden, false, closed);
  }
});

test('detail signal is emitted after modal insertion so the second opening cannot flash the prompt', () => {
  const detail = html.slice(html.indexOf('async function showPhotoModal(id){'), html.indexOf('async function showPhotoModal(id){') + 30000);
  assert.ok(detail.indexOf('document.body.appendChild(modal);') < detail.indexOf('notePaidSignal("detail_opened", p.id);'));
  assert.equal((html.match(/notePaidSignal\("detail_opened", p.id\)/g) || []).length, 1);
});

function explorarPage(search) {
  const p = page();
  const c = p.context;
  c.paidSearch = paid.readSearchParams(search);
  c.adIntent = {...c.paidSearch, active:c.paidSearch.directToResults};
  c.safeStorageGetJSON = () => ({});
  c.safeStorageGet = () => '';
  c.safeStorageSetJSON = () => {};
  c.safeStorageSet = () => {};
  c.YNT_ONESIGNAL_READY = true;
  c.YNT_ONESIGNAL_INSTANCE = {User:{PushSubscription:{optedIn:false, id:null}}};
  c.clean = value => String(value || '').trim();
  c.YNTELIGENCIA_SESSION_ID = 'explorar-session';
  c.sharedPropertyId = null;
  c.loadCatalogFromUrl = () => c.paidSearch.mode === 'explorar';
  c.document.body.classList.add = () => {};
  const helper = html.slice(html.indexOf('function yntHasPaidClickContext(){'), html.indexOf('function scheduleAiAssistantForProperty('));
  const integration = html.slice(html.indexOf('let paidExperience=null;'), html.indexOf('async function acceptPaidPush(){'));
  // Reuse the production functions with the harness's inspectable global state.
  vm.runInContext(helper + integration.replace('let paidExperience=null;', 'paidExperience=null;'), c);
  const bootStart = html.indexOf('    const openedCatalogFromUrl=');
  const bootEnd = html.indexOf('    /* Se o clique veio de um anúncio', bootStart);
  vm.runInContext(html.slice(bootStart, bootEnd), c);
  return p;
}

test('integrated explorar paid context records real arrival and detail signals without direct navigation', () => {
  const p = explorarPage('?modo=explorar&cidade=São+Paulo&estado=SP&regiao=oeste&bairro=Pinheiros&dormitorios=2');
  const c = p.context;
  assert.equal(c.paidSearch.directToResults, false);
  assert.equal(c.adIntent.active, false);
  assert.equal(c.paidExperience.resultsShown, true);
  assert.equal(p.elements.paidPushSheet.hidden, true);
  c.notePaidSignal('detail_opened', 'first');
  assert.equal(c.paidExperience.propertiesSeen, 1);
  assert.equal(c.paidExperience.promptEligible, false);
  p.modal.hidden = true;
  c.notePaidSignal('returned_to_results');
  assert.equal(p.elements.paidPushSheet.hidden, true);
  p.modal.hidden = false;
  c.notePaidSignal('detail_opened', 'second');
  assert.equal(c.paidExperience.propertiesSeen, 2);
  assert.equal(c.paidExperience.promptEligible, true);
  assert.equal(p.elements.paidPushSheet.hidden, true);
  p.modal.hidden = true;
  c.notePaidSignal('returned_to_results');
  assert.equal(p.elements.paidPushSheet.hidden, false);
  assert.equal(p.elements.paidPushTitle.textContent, 'Quer que eu te avise quando aparecer uma nova opção dentro desta busca?');
  assert.equal(c.adIntent.active, false);
});

test('explorar without normalized paid intent ignores paid signals', () => {
  const p = explorarPage('?modo=explorar&cidade=São+Paulo&estado=SP');
  const c = p.context;
  assert.equal(c.yntHasPaidClickContext(), false);
  assert.equal(c.paidSearch.directToResults, false);
  c.notePaidSignal('results_shown');
  c.notePaidSignal('detail_opened', 'first');
  c.notePaidSignal('detail_opened', 'second');
  c.notePaidSignal('returned_to_results');
  assert.equal(c.paidExperience.resultsShown, false);
  assert.equal(c.paidExperience.propertiesSeen, 0);
  assert.equal(p.elements.paidPushSheet.hidden, true);
});

test('one paid retention surface: real scheduler and legacy opener cannot compete with Paid Push', async () => {
  const p = explorarPage('?modo=explorar&bairro=Pinheiros&dormitorios=2');
  const c = p.context;
  const timers = new Map();
  let serial = 0;
  let legacyShellCalls = 0;
  c.aiAssistantTriggerTimer = null;
  c.aiResumeChatAfterDetail = false;
  c.setTimeout = (fn, delay) => {timers.set(++serial, {fn, delay}); return serial;};
  c.clearTimeout = id => timers.delete(id);
  c.ensureAiAssistantShell = () => {legacyShellCalls++; throw new Error('unexpected legacy shell');};
  const source = html.slice(html.indexOf('async function yntOpenProactiveAiForProperty('), html.indexOf('function extractAllPropertyImages('));
  vm.runInContext(source, c);
  for (const id of ['first','second']) {
    p.modal.hidden = false;
    c.notePaidSignal('detail_opened', id);
    c.scheduleAiAssistantForProperty({id}, p.modal);
    // Advance all scheduled callbacks, including any five-second opener.
    for (const {fn} of [...timers.values()]) fn();
    timers.clear();
    await c.yntOpenProactiveAiForProperty({id});
    assert.equal(legacyShellCalls, 0);
    assert.equal(p.elements.paidPushSheet.hidden, true);
    p.modal.hidden = true;
    c.notePaidSignal('returned_to_results');
    assert.equal(p.elements.paidPushSheet.hidden, id === 'first');
  }
  assert.equal(p.elements.paidPushAccept.textContent, 'SIM, QUERO SER AVISADO');
  assert.equal(p.elements.paidPushDismiss.textContent, 'Agora não');
  assert.match(html, /id="paidPushSheet" data-retention-experience="paid-push"/);
  assert.match(html, /shell\.dataset\.retentionExperience="match-ai"/);
});

test('actual subscription reconciliation hides prompt for already subscribed visitor', () => {
  const p = explorarPage('?modo=explorar&bairro=Pinheiros&dormitorios=2');
  const c = p.context;
  c.YNT_ONESIGNAL_INSTANCE.User.PushSubscription = {optedIn:true, id:'valid-subscription-id'};
  c.reconcilePaidPushState();
  c.notePaidSignal('detail_opened', 'first');
  c.notePaidSignal('returned_to_results');
  c.notePaidSignal('detail_opened', 'second');
  p.modal.hidden = true;
  c.notePaidSignal('returned_to_results');
  assert.equal(c.paidExperience.subscribed, true);
  assert.equal(p.elements.paidPushSheet.hidden, true);
});

test('dismissal does not prompt again in the same session after further properties', () => {
  const p = explorarPage('?modo=explorar&bairro=Pinheiros&dormitorios=2');
  const c = p.context;
  c.notePaidSignal('detail_opened', 'first');
  c.notePaidSignal('detail_opened', 'second');
  p.modal.hidden = true;
  c.notePaidSignal('returned_to_results');
  assert.equal(p.elements.paidPushSheet.hidden, false);
  c.notePaidSignal('dismiss');
  for (const id of ['third','fourth']) {
    c.notePaidSignal('detail_opened', id);
    c.notePaidSignal('returned_to_results');
  }
  assert.equal(c.paidExperience.dismissed, true);
  assert.equal(p.elements.paidPushSheet.hidden, true);
});
