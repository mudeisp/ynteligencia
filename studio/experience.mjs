const consent = document.getElementById('studio-consent');
const link = document.getElementById('studio-share');
const video = document.getElementById('cinema');
let observer;
let session;
let visitor;
let accepted = false;
const publicLink = /^\/experiencia\/[a-f0-9]{48}\/?$/.test(location.pathname);
const storageKey = 'yincorp-studio:' + location.pathname;
const sent = new Set();

async function log(event, target = '') {
  if (!accepted || !publicLink || sent.has(event + target)) return;
  sent.add(event + target);
  try {
    await fetch(location.pathname, {
      method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, target, session, visitor, consent: true })
    });
  } catch {
    sent.delete(event + target);
  }
}

consent?.addEventListener('click', () => {
  accepted = !accepted;
  consent.textContent = accepted ? 'Desativar medição de uso' : 'Permitir medição de uso';
  consent.setAttribute('aria-pressed', String(accepted));
  if (!accepted) {
    observer?.disconnect();
    try { localStorage.removeItem(storageKey); } catch {}
    visitor = undefined;
    session = undefined;
    sent.clear();
    return;
  }
  visitor = crypto.randomUUID();
  session = crypto.randomUUID();
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) visitor = saved;
    else localStorage.setItem(storageKey,visitor);
  } catch {}
  log('superpage_view');
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id;
      log('chapter_view', id);
      if (id === 'inteligencia') log('property_comparison',id);
      if (id === 'plantas') log('floorplan_view',id);
      if (id === 'financeiro') log('pricing_view',id);
      observer.unobserve(entry.target);
    }
  }, { rootMargin:'-20% 0px -45% 0px' });
  document.querySelectorAll('main section[id]').forEach(section => observer.observe(section));
});

link?.addEventListener('click', () => log('superpage_share'));
document.getElementById('studio-visit')?.addEventListener('click', () => {
  log('whatsapp_click');
  log('visit_requested');
});
for (const button of document.querySelectorAll('[data-favorite]')) {
  button.addEventListener('click', () => {
    const added = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed',String(added));
    button.textContent = added ? 'Favoritado' : 'Marcar favorito';
    if (added) log('property_favorite',button.dataset.favorite);
  });
}
if (video && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.animate([{ opacity:.55, transform:'translateY(12px)' },{ opacity:1, transform:'none' }],{ duration:480,easing:'ease-out' });
      reveal.unobserve(entry.target);
    }
  },{ threshold:.15 });
  video.querySelectorAll('figure').forEach(figure => reveal.observe(figure));
}
