import { matrix, priorities, relationships } from './model.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function renderExperience(data, token, origin = 'https://www.yincorp.com.br') {
  const e = escape;
  const assets = data.properties.flatMap(property => property.images.map(image => ({ ...image, property: property.name })));
  const categories = [...new Set(assets.map(asset => asset.category))];
  const figure = (asset, eager = false) => `<figure><img src="${e(asset.url)}" alt="${e(asset.caption || asset.property)}" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''}><figcaption>${e(asset.property)} · ${e(asset.caption)}</figcaption></figure>`;
  const link = data.whatsapp ? `<a class="button" id="studio-visit" rel="noreferrer" href="https://wa.me/${e(data.whatsapp)}?text=${encodeURIComponent('Gostaria de conversar sobre a seleção de imóveis e agendar uma visita.')}">Agendar visita pelo WhatsApp</a>` : '';
  const rows = matrix(data);
  const focus = priorities(data);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta property="og:title" content="Yincorp | Seleção imobiliária"><title>Yincorp | Seleção imobiliária</title><link rel="stylesheet" href="/studio/studio.css"></head><body class="experience">
<header class="bar"><a class="brand" href="#inicio">YINCORP</a><nav aria-label="Modos de apresentação"><a href="#cinema">Cinema</a><a href="#inteligencia">Inteligência</a><a href="#decisao">Decisão</a></nav></header>
<main id="inicio"><section class="hero"><div class="kicker">Consultoria imobiliária</div><h1>${e(data.title)}</h1>
<p>${e(data.greeting ? data.greeting + ', ' : '')}${e(data.opening)}</p></section>
<section id="cinema" aria-label="Cinema"><div class="image-grid">${data.properties.map(property => `<article>${property.images[0] ? figure({...property.images[0], property:property.name}, true) : ''}<h2>${e(property.name)}</h2><p>${e([relationships[property.relationship],property.subtitle].filter(Boolean).join(' · '))}</p><button type="button" aria-pressed="false" data-favorite="${e(property.id)}">Marcar favorito</button></article>`).join('')}</div>
${categories.map(category => `<section class="chapter"><h2>${e(category)}</h2><div class="image-grid visual-comparison" tabindex="0" aria-label="Galeria comparativa">${assets.filter(asset => asset.category === category).map(asset => figure(asset)).join('')}</div></section>`).join('')}</section>
<section id="inteligencia" class="chapter"><h2>${data.properties.length > 1 ? 'Onde os projetos se diferenciam' : 'Conheça o empreendimento'}</h2>
<nav class="chapter-links" aria-label="Capítulos">${rows.map(row => `<a href="#${row.key}">${e(row.label)}</a>`).join('')}</nav>
${rows.map(row => `<section id="${row.key}" class="comparison"><h3>${e(row.label)}</h3><div class="comparison-grid">
${row.cells.map((cell, i) => `<article><h4>${e(data.properties[i].name)}</h4>${cell.length ? cell.map(fact => `<p>${e(fact.value)} <small>${e(fact.source)}</small></p>`).join('') : `<p>${row.key === 'financeiro' ? 'Condições comerciais vigentes a confirmar.' : 'Informação a confirmar.'}</p>`}</article>`).join('')}</div></section>`).join('')}</section>
<section class="chapter conclusion" id="decisao"><h2>Próximos passos</h2>${focus.length ? `<p>Critérios priorizados nesta seleção: ${e(focus.join(', '))}.</p>` : ''}<p>${e(data.verdict)}</p><p>${e(data.consultant)}</p>${link}
${token ? `<p><a id="studio-share" rel="noreferrer" href="https://wa.me/?text=${encodeURIComponent('Uma seleção da Yincorp: ' + origin + '/experiencia/' + token)}">Compartilhar pelo WhatsApp</a></p>` : ''}</section></main>
<footer>Yincorp ${token ? '<button id="studio-consent" type="button" aria-pressed="false">Permitir medição de uso</button>' : ''}</footer><script type="module" src="/studio/experience.mjs"></script></body></html>`;
}

export function renderPassword(attempted) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Yincorp | Apresentação protegida</title><link rel="stylesheet" href="/studio/studio.css"></head><body><header class="bar"><strong class="brand">YINCORP</strong></header><main class="hero"><h1 class="compact">Apresentação protegida</h1><form method="post"><label>Senha da apresentação<input type="password" name="password" required autocomplete="current-password"></label>${attempted ? '<p role="alert">Senha incorreta.</p>' : ''}<div><button>Abrir apresentação</button></div></form></main></body></html>`;
}
