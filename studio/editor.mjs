import { dimensions } from './model.mjs';

const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
let accessToken;
let current;
let properties = [];
const editor = $('editor');
const clientFields = {
  name: 'Nome completo', treatment: 'Nome de tratamento', phone: 'Telefone', email: 'E-mail',
  city: 'Cidade', neighborhoods: 'Bairros', minBudget: 'Orçamento mínimo', maxBudget: 'Orçamento máximo',
  purpose: 'Finalidade', family: 'Composição familiar', area: 'Metragem', bedrooms: 'Dormitórios',
  suites: 'Suítes', parking: 'Vagas', timing: 'Prazo', architecture: 'Arquitetura', leisure: 'Lazer',
  needs: 'Necessidades', notes: 'Observações privadas', instructions: 'Instruções para a IA'
};

function element(tag, value) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  return node;
}

function button(label, handler) {
  const node = element('button', label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function run(handler) {
  return async event => {
    event?.preventDefault();
    status('');
    try { await handler(); } catch (error) { status(error.message); }
  };
}

for (const [key, label] of Object.entries(clientFields)) {
  const field = element('label', label);
  const input = element(['notes', 'instructions', 'needs'].includes(key) ? 'textarea' : 'input');
  input.name = key;
  input.required = key === 'name';
  field.append(input);
  $('client-fields').append(field);
}

function renderChapters(keys = Object.keys(dimensions)) {
  const order = [...keys, ...Object.keys(dimensions).filter(key => !keys.includes(key))];
  $('chapters').replaceChildren(element('h3','Capítulos'));
  for (const key of order) {
    const row = element('div');
    row.className = 'actions';
    const label = element('label');
    const line = element('span');
    const check = element('input');
    check.type = 'checkbox';
    check.name = 'chapters';
    check.value = key;
    check.checked = keys.includes(key);
    line.append(check, ' ' + dimensions[key]);
    label.append(line);
    row.append(label, button('Subir', () => {
      const previous = row.previousElementSibling;
      if (previous?.tagName === 'DIV') previous.before(row);
    }));
    $('chapters').append(row);
  }
}

async function api(action, body) {
  const response = await fetch('/api/studio?action=' + action, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Operação indisponível.');
  return data;
}

function draft() {
  const form = new FormData(editor);
  return { ...Object.fromEntries(form), chapters: form.getAll('chapters'),
    comparison: editor.elements.comparison.checked, properties };
}

function renderSelected() {
  $('selected').replaceChildren(...properties.map((property, index) => {
    const row = element('li', property.name + ' ');
    row.append(button('Subir', () => {
      if (index < 1) return;
      [properties[index - 1], properties[index]] = [properties[index], properties[index - 1]];
      renderSelected();
    }), ' ', button('Remover', () => {
      properties.splice(index, 1);
      renderSelected();
    }));
    const details = element('details');
    details.append(element('summary', 'Editar informações e fontes'));
    const editing = element('div');
    function drawFacts() {
      editing.replaceChildren();
      property.facts.forEach((fact, factIndex) => {
        const entry = element('div');
        entry.className = 'form-grid';
        const category = element('select');
        category.setAttribute('aria-label', 'Dimensão');
        for (const [key, label] of Object.entries(dimensions)) category.add(new Option(label, key));
        category.value = fact.key;
        category.onchange = () => { fact.key = category.value; };
        const value = element('textarea');
        value.setAttribute('aria-label', 'Informação');
        value.placeholder = 'Informação revisada';
        value.value = fact.value;
        value.oninput = () => { fact.value = value.value; };
        const source = element('input');
        source.setAttribute('aria-label', 'Fonte e página');
        source.placeholder = 'Fonte e página';
        source.value = fact.source;
        source.oninput = () => { fact.source = source.value; };
        entry.append(category, value, source, button('Remover informação', () => {
          property.facts.splice(factIndex, 1);
          drawFacts();
        }));
        editing.append(entry);
      });
    }
    drawFacts();
    details.append(editing, button('Adicionar informação', () => {
      property.facts.push({ key: 'arquitetura', value: '', source: '' });
      drawFacts();
    }));
    const books = element('details');
    books.append(element('summary', 'Books e fichas técnicas'));
    const files = element('input');
    files.type = 'file';
    files.accept = 'application/pdf';
    files.setAttribute('aria-label', 'Escolher PDF para ' + property.name);
    const available = element('div');
    function drawExtraction(extraction) {
      const section = element('details');
      section.append(element('summary', extraction.filename));
      const list = element('ul');
      for (const item of extraction.result?.attributes || []) {
        const line = element('li', dimensions[item.key] + ' · ' + item.value + ' · p. ' + item.page);
        line.append(element('small', [item.kind, item.scope, item.evidence].filter(Boolean).join(' · ')));
        if (!['nao_identificada','contraditoria'].includes(item.kind)) {
          line.append(button('Confirmar e incluir', () => {
            const source = extraction.filename + ', p. ' + item.page;
            const value = item.value + (item.unit ? ' ' + item.unit : '');
            if (!property.facts.some(fact => fact.key === item.key && fact.value === value && fact.source === source)) {
              property.facts.push({key:item.key,value,source});
              drawFacts();
            }
            status('Informação incluída nos capítulos.');
          }));
        }
        list.append(line);
      }
      section.append(list);
      available.append(section);
    }
    books.append(files, button('Importar e processar PDF', run(async () => {
      const file = files.files[0];
      if (!file || file.size > 20 * 1024 * 1024) throw new Error('Escolha um PDF de até 20 MB.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
        .map(byte => byte.toString(16).padStart(2,'0')).join('');
      const settings = await api('book-upload');
      const path = '/storage/v1/object/yincorp-studio-books/' + settings.owner + '/' + digest + '.pdf';
      const upload = await fetch(new URL(path,settings.url), { method:'POST',
        headers:{ apikey:settings.key, Authorization:'Bearer ' + accessToken, 'Content-Type':'application/pdf' }, body:file });
      if (!upload.ok) {
        const error = await upload.json().catch(() => ({}));
        if (upload.status !== 409 && error.statusCode !== '409' && error.error !== 'Duplicate') {
          throw new Error('Não foi possível enviar o PDF.');
        }
      }
      status('Analisando o documento.');
      drawExtraction(await api('book-process',{ digest, propertyId:property.id, filename:file.name }));
      status('Extração disponível para revisão.');
    })), button('Ver extrações anteriores', run(async () => {
      available.replaceChildren();
      const results = await api('books&propertyId=' + encodeURIComponent(property.id));
      for (const extraction of results) drawExtraction(extraction);
      if (!results.length) available.textContent = 'Nenhuma extração concluída.';
    })), available);
    row.append(details, books);
    return row;
  }));
}

function open(row) {
  current = row;
  editor.reset();
  const data = row?.draft || {};
  for (const key of ['title', 'opening', 'greeting', 'verdict', 'consultant', 'whatsapp']) {
    editor.elements[key].value = data[key] || '';
  }
  if (row) $('client').value = row.client_id;
  else $('client').onchange();
  $('client').disabled = Boolean(row);
  properties = structuredClone(data.properties || []);
  renderSelected();
  editor.elements.comparison.checked = Boolean(data.comparison);
  renderChapters(data.chapters);
  $('frame').hidden = true;
  $('publish').disabled = !row;
  $('unpublish').disabled = !row?.published_revision;
  $('revoke').disabled = !row;
  $('duplicate').disabled = !row;
  const date = row?.draft_expires_at ? new Date(row.draft_expires_at) : null;
  editor.elements.expiresAt.value = date ? new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  $('share').replaceChildren();
  $('history').replaceChildren();
  $('metrics').replaceChildren();
  if (row) {
    $('metrics').replaceChildren(button('Ver sinais de interesse',run(async () => {
      const result = await api('metrics&id=' + row.id);
      const names = { superpage_view:'Acessos',chapter_view:'Capítulos visualizados',
        property_comparison:'Comparações',floorplan_view:'Consultas de plantas',
        pricing_view:'Consultas de preços',property_favorite:'Favoritos',
        superpage_share:'Compartilhamentos',whatsapp_click:'Cliques no WhatsApp',visit_requested:'Clicou para pedir visita' };
      const list = element('ul');
      list.append(element('li','Sessões consentidas: ' + result.sessions), element('li','Retornos: ' + result.returns));
      for (const [key,label] of Object.entries(names)) list.append(element('li',label + ': ' + (result.counts[key] || 0)));
      $('metrics').replaceChildren(list);
      if (result.limitReached) $('metrics').append(element('p','Leitura dos 1.000 eventos mais recentes.'));
    })));
    $('history').append(button('Histórico de publicações', run(async () => {
      const versions = await api('history&id=' + row.id);
      const list = element('ul');
      for (const version of versions) {
        list.append(element('li', 'Versão ' + version.revision + ' · ' + new Date(version.published_at).toLocaleString('pt-BR')));
      }
      $('history').replaceChildren(list);
      if (!versions.length) $('history').textContent = 'Nenhuma versão publicada.';
    })));
  }
  if (row?.published_revision) {
    const origin = location.hostname === 'app.yincorp.com.br' ? 'https://www.yincorp.com.br' : location.origin;
    const url = new URL('/experiencia/' + row.token, origin).href;
    const link = element('a', 'Abrir apresentação publicada');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const send = element('a', 'Compartilhar pelo WhatsApp');
    send.href = 'https://wa.me/?text=' + encodeURIComponent(url);
    send.target = '_blank';
    send.rel = 'noreferrer';
    $('share').append(link, ' · ', send);
  }
}

async function refresh() {
  const selected = $('client').value;
  const [clients, pages] = await Promise.all([api('clients'), api('presentations')]);
  $('client').replaceChildren(...clients.map(client => {
    const option = new Option(client.name, client.id);
    option.dataset.treatment = client.profile?.treatment || '';
    return option;
  }));
  if (clients.some(client => client.id === selected)) $('client').value = selected;
  $('presentations').replaceChildren(...pages.map(row => {
    const item = element('li');
    item.append(button(row.draft.title, () => open(row)), ' ' + (row.published_revision ? 'Publicada' : 'Em elaboração'));
    return item;
  }));
  return pages;
}

$('login').addEventListener('submit', run(async () => {
  accessToken = (await api('login', Object.fromEntries(new FormData($('login'))))).accessToken;
  $('login').reset();
  await refresh();
  $('signin').hidden = true;
  $('workspace').hidden = false;
  $('logout').hidden = false;
  open();
}));
$('logout').onclick = () => location.reload();
$('new').onclick = () => open();
$('client').onchange = () => { editor.elements.greeting.value = $('client').selectedOptions[0]?.dataset.treatment || ''; };
$('create-client').addEventListener('submit', run(async () => {
  const client = await api('clients', Object.fromEntries(new FormData($('create-client'))));
  $('create-client').reset();
  await refresh();
  if (!current) { $('client').value = client.id; $('client').onchange(); }
}));
editor.addEventListener('submit', event => event.preventDefault());
$('search').addEventListener('submit', run(async () => {
  const query = new FormData($('search')).get('query');
  const response = await fetch('/api/search-properties', { method: 'POST',
    headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ query, limit: 20, source: 'all' }) });
  const data = await response.json();
  if (!response.ok) throw new Error('Busca indisponível.');
  $('criteria').textContent = '';
  drawResults(data.matches || data.properties || data.results || []);
}));
$('similar').addEventListener('submit',run(async () => {
  const value = new FormData($('similar')).get('path');
  const url = new URL(value,'https://www.yincorp.com.br');
  if (!['www.yincorp.com.br','yincorp.com.br'].includes(url.hostname)) throw new Error('Use uma ficha do portal da Yincorp.');
  const result = await api('similar&path=' + encodeURIComponent(url.pathname));
  $('criteria').textContent = result.criteria || '';
  drawResults(result.items,result.checkedAt);
}));

function drawResults(results,checkedAt) {
  $('results').replaceChildren(...results.map(item => {
    const row = element('li');
    const fromPortal = typeof item.projectPath === 'string';
    const portalId = /\/orulo-(\d+)\/?$/.exec(item.projectPath || '')?.[1];
    const id = String(item.building_id || portalId || item.projectPath || item.id || item.property_id || '');
    const name = item.project_name || item.empreendimento || item.name || item.title || item.nome;
    const label = [name,item.neighborhood,item.area > 0 ? item.area + ' m²' : '',item.bedrooms > 0 ? item.bedrooms + ' dorm.' : ''].filter(Boolean).join(' · ');
    row.append(document.createTextNode((label || 'Imóvel') + ' '), button('Selecionar', () => {
      if (!id || !name) return status('O catálogo retornou um imóvel sem identificação.');
      if (properties.some(property => property.id === id || property.name === name)) return;
      if (properties.length === 6) return status('Selecione até seis empreendimentos.');
      const rawImage = item.cover_image_url || item.image_url || item.image || item.main_image || item.photos?.[0];
      const images = typeof rawImage === 'string' ? [{ url:rawImage, category:'Catálogo', caption:'Imagem do catálogo' }] : [];
      const facts = [];
      if (fromPortal && Number.isFinite(item.area) && item.area > 0) {
        facts.push({key:'plantas',value:label,source:'Yincorp Intelligence · ' + (item.type || 'Tipologia do catálogo')});
      }
      if (fromPortal && Number.isFinite(item.price) && item.price > 0 && Number.isFinite(item.area) && item.area > 0 && checkedAt) {
        const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
        const reference = new Date(checkedAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
        facts.push({key:'financeiro',value:money.format(item.price) + ' anunciado · ' + money.format(item.price/item.area) +
          '/m² privativo. Disponibilidade e negociação a confirmar.',source:'Catálogo do portal consultado em ' + reference});
      }
      properties.push({ id,name,subtitle:item.neighborhood || item.bairro || '',images,facts });
      renderSelected();
    }));
    return row;
  }));
  if (!results.length) status('Nenhum imóvel encontrado.');
}
$('preview').onclick = run(async () => {
  const { html } = await api('preview', { draft: draft() });
  $('frame').srcdoc = html;
  $('frame').hidden = false;
});
$('mobile').onchange = () => $('frame').classList.toggle('mobile-preview', $('mobile').checked);
$('save').onclick = run(async () => {
  const localDate = editor.elements.expiresAt.value;
  const page = await api('presentations', { id:current?.id, revision:current?.revision, clientId:$('client').value,
    expiresAt: localDate ? new Date(localDate).toISOString() : null,
    password:editor.elements.linkPassword.value,clearPassword:editor.elements.clearPassword.checked,draft:draft() });
  await refresh();
  open(page);
  status('Versão salva.');
});
$('publish').onclick = run(async () => {
  if (!current || !confirm('Publicar a versão salva? O nome de tratamento e o conteúdo da versão ficarão disponíveis pelo link.')) return;
  await api('publish', { id: current.id, revision: current.revision, approved: true });
  open((await refresh()).find(page => page.id === current.id));
  status('Versão publicada.');
});
$('unpublish').onclick = run(async () => {
  if (!current) return;
  await api('unpublish', { id: current.id });
  open((await refresh()).find(page => page.id === current.id));
  status('Link despublicado.');
});

$('revoke').onclick = run(async () => {
  if (!current || !confirm('Invalidar definitivamente o link atual e despublicar a apresentação?')) return;
  await api('revoke',{id:current.id});
  open((await refresh()).find(page => page.id === current.id));
  status('Link anterior revogado.');
});
$('duplicate').onclick = run(async () => {
  if (!current) return;
  const copy = await api('presentations',{clientId:current.client_id,draft:{...current.draft,title:current.draft.title + ' · cópia'}});
  await refresh();
  open(copy);
  status('Cópia criada como rascunho.');
});
