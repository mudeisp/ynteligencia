import {html as h} from './model.js';

// One contact hierarchy for both states, development pages and selected typologies.
export function contactActions(unit){
  const id=h(unit?.id || '');
  return `<div class="contact-actions"><button class="button primary whatsapp-cta" type="button" data-whatsapp="${id}">Falar pelo WhatsApp</button><button class="contact-secondary" type="button" data-contact="${id}">Prefiro deixar meus dados</button></div>`;
}
