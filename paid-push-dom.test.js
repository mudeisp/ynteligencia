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
