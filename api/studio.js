import { randomBytes } from 'node:crypto';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const presentationColumns = 'id,client_id,token,draft,revision,published_revision,draft_expires_at,expires_at,created_at,updated_at';
const tokenPattern = /^[a-f0-9]{48}$/;
const fields = ['treatment', 'phone', 'email', 'city', 'neighborhoods', 'minBudget', 'maxBudget',
  'purpose', 'family', 'area', 'bedrooms', 'suites', 'parking', 'timing', 'architecture', 'leisure',
  'needs', 'notes', 'instructions'];

function config() {
  if (process.env.STUDIO_ENABLED !== 'true') return null;
  const url = process.env.STUDIO_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.STUDIO_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  return url && anon ? { url, anon } : null;
}

async function request(cfg, path, { method = 'GET', body, auth } = {}) {
  const response = await fetch(new URL(path, cfg.url), {
    method, headers: { apikey: cfg.anon, ...(auth ? { Authorization: auth } : {}),
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = new Error('Serviço de dados indisponível.');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function rest(cfg, table, params, options) {
  return request(cfg, '/rest/v1/' + table + '?' + new URLSearchParams(params),
    { auth: cfg.auth, ...options });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const { action, token } = req.query || {};
  const cfg = config();
  const fail = (status, error) => res.status(status).json({ error });
  if (!cfg) return fail(503, 'Studio indisponível neste ambiente.');

  try {
    const unlock = req.method === 'POST' && typeof req.body?.password === 'string';
    if (action === 'experience' && req.method === 'POST' && !unlock) {
      const body = req.body || {};
      if (!tokenPattern.test(token || '') || body.consent !== true || !uuid.test(body.session || '')
          || !uuid.test(body.visitor || '') || typeof body.event !== 'string' || typeof body.target !== 'string') {
        return fail(400, 'Evento inválido.');
      }
      const ok = await rest(cfg, 'rpc/studio_track_event', {}, { method:'POST',
        body:{ p_token:token,p_session:body.session,p_visitor:body.visitor,p_event:body.event,p_target:body.target } });
      return ok ? res.status(204).end() : fail(404,'Evento indisponível.');
    }
    if (action === 'experience' && (req.method === 'GET' || unlock)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (!tokenPattern.test(token || '')) return fail(404, 'Apresentação indisponível.');
      const result = await rest(cfg, 'rpc/studio_read_published', {}, {
        method:'POST', body:{ p_token:token, p_password:unlock ? req.body.password.slice(0,256) : null }
      });
      if (!result) return fail(404, 'Apresentação indisponível.');
      const { renderExperience, renderPassword } = await import('../studio/render.mjs');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
      if (result.locked) return res.status(200).end(renderPassword(unlock));
      const previewHost = process.env.VERCEL_URL;
      const origin = process.env.VERCEL_ENV === 'preview' && /^[a-z0-9-]+\.vercel\.app$/.test(previewHost || '')
        ? 'https://' + previewHost : 'https://www.yincorp.com.br';
      return res.status(200).end(renderExperience(result.content,token,origin));
    }

    const body = req.body || {};
    if (action === 'login' && req.method === 'POST') {
      try {
        const result = await request(cfg, '/auth/v1/token?grant_type=password', {
          method: 'POST', body: { email: body.email, password: body.password }
        });
        if (result.user?.app_metadata?.yincorp_studio !== true) return fail(403, 'Acesso reservado ao comercial.');
        return res.status(200).json({ accessToken: result.access_token });
      } catch (error) {
        return fail(error.status === 429 ? 429 : 401, 'Não foi possível autenticar.');
      }
    }
    const authorization = req.headers.authorization;
    if (!/^Bearer [\w.-]+$/.test(authorization || '')) return fail(401, 'Entre com sua conta.');
    let user;
    try { user = await request(cfg, '/auth/v1/user', { auth: authorization }); } catch (error) {
      if (error.status === 401 || error.status === 403) return fail(401, 'Sessão encerrada.');
      throw error;
    }
    if (user.app_metadata?.yincorp_studio !== true) return fail(403, 'Acesso reservado ao comercial.');
    cfg.auth = authorization;
    const owner = 'eq.' + user.id;
    if (action === 'pilot-template' && req.method === 'GET' && process.env.VERCEL_ENV !== 'production') {
      const { pilot } = await import('../studio/pilot.mjs');
      return res.json(pilot);
    }
    if (action === 'similar' && req.method === 'GET') {
      const path = req.query.path;
      if (typeof path !== 'string' ||
          !/^\/[a-z]{2}\/[a-z0-9-]+\/empreendimento\/[a-z0-9-]+(?:\/tipologia\/[a-f0-9-]{36})?\/?$/.test(path) ||
          path.length > 500) return fail(400,'Informe o endereço de um empreendimento no portal.');
      const source = new URL('https://www.yincorp.com.br/api/intelligence');
      source.searchParams.set('path',path);
      const options = await fetch(source, {signal:AbortSignal.timeout(24000)});
      if (!options.ok) return fail(options.status === 404 ? 404 : 502,'O comparador do portal não encontrou alternativas para esta ficha.');
      const result = await options.json();
      return res.json({ items:[result.base,...(result.items || [])].filter(Boolean), checkedAt:result.checkedAt, criteria:result.criteria });
    }
    if (action === 'book-upload' && req.method === 'GET') {
      return res.json({ url: cfg.url, key: cfg.anon, owner: user.id });
    }
    if (action === 'books' && req.method === 'GET') {
      const propertyId = req.query.propertyId;
      if (typeof propertyId !== 'string' || !propertyId || propertyId.length > 160) return fail(400, 'Empreendimento inválido.');
      return res.json(await rest(cfg, 'studio_book_extractions', { property_id: 'eq.' + propertyId,
        status:'eq.complete', order:'updated_at.desc', limit:30 }));
    }
    if (action === 'book-process' && req.method === 'POST') {
      const { bookExtraction } = await import('../studio/books.mjs');
      const result = await bookExtraction({ cfg, user, body, rest });
      return result.error ? fail(result.status,result.error) : res.json(result.extraction);
    }
    if (action === 'clients' && req.method === 'GET') {
      return res.json(await rest(cfg, 'studio_clients', { owner, order: 'created_at.desc', limit: 100 }));
    }
    if (action === 'clients' && req.method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 160) : '';
      if (!name) return fail(400, 'Informe o nome do cliente.');
      const profile = Object.fromEntries(fields.filter(key => typeof body[key] === 'string').map(key => [key, body[key].trim().slice(0, 5000)]));
      const [client] = await rest(cfg, 'studio_clients', {}, { method: 'POST', body: { owner: user.id, name, profile } });
      return res.status(201).json(client);
    }
    if (action === 'presentations' && req.method === 'GET') {
      return res.json(await rest(cfg, 'studio_presentations', { owner, select:presentationColumns, order: 'updated_at.desc', limit: 100 }));
    }
    if (action === 'presentations' && req.method === 'POST') {
      const { presentation } = await import('../studio/model.mjs');
      let draft;
      try { draft = presentation(body.draft); } catch (error) { return fail(400, error.message); }
      const expiresAt = body.expiresAt ? Date.parse(body.expiresAt) : null;
      if (expiresAt !== null && !Number.isFinite(expiresAt)) return fail(400, 'Data de expiração inválida.');
      const draft_expires_at = expiresAt === null ? null : new Date(expiresAt).toISOString();
      const access = {};
      if (body.clearPassword === true) access.draft_password_hash = null;
      if (body.password) {
        if (typeof body.password !== 'string' || Buffer.byteLength(body.password) < 8 || Buffer.byteLength(body.password) > 72) {
          return fail(400,'A senha deve ter entre 8 e 72 bytes.');
        }
        access.draft_password_hash = await rest(cfg,'rpc/studio_hash_link_password',{},
          {method:'POST',body:{p_password:body.password}});
        if (!access.draft_password_hash) return fail(400,'Senha inválida.');
      }
      if (body.id) {
        if (!uuid.test(body.id) || !Number.isSafeInteger(body.revision)) return fail(400, 'Versão inválida.');
        const [row] = await rest(cfg, 'studio_presentations', { id: 'eq.' + body.id, owner, revision: 'eq.' + body.revision, select:presentationColumns },
          { method: 'PATCH', body: { draft, draft_expires_at, ...access, revision: body.revision + 1, updated_at: new Date().toISOString() } });
        return row ? res.json(row) : fail(409, 'A apresentação foi atualizada. Reabra para editar.');
      }
      if (!uuid.test(body.clientId || '')) return fail(400, 'Selecione um cliente.');
      const [client] = await rest(cfg, 'studio_clients', { id: 'eq.' + body.clientId, owner, select: 'id' });
      if (!client) return fail(404, 'Cliente indisponível.');
      const [row] = await rest(cfg, 'studio_presentations', { select:presentationColumns }, { method: 'POST',
        body: { client_id: client.id, owner: user.id, token: randomBytes(24).toString('hex'), draft, draft_expires_at, ...access } });
      return res.status(201).json(row);
    }
    if (action === 'metrics' && req.method === 'GET') {
      const id = req.query.id;
      if (!uuid.test(id || '')) return fail(400, 'Apresentação inválida.');
      const [row] = await rest(cfg, 'studio_presentations', { id:'eq.' + id, owner, select:'id' });
      if (!row) return fail(404, 'Apresentação indisponível.');
      const events = await rest(cfg, 'studio_events', { presentation_id:'eq.' + id,
        select:'event_name,target,session_id,visitor_id', order:'created_at.desc', limit:1000 });
      const counts = {};
      const visits = new Map();
      for (const item of events) {
        counts[item.event_name] = (counts[item.event_name] || 0) + 1;
        if (item.event_name !== 'superpage_view') continue;
        const sessions = visits.get(item.visitor_id) || new Set();
        sessions.add(item.session_id);
        visits.set(item.visitor_id,sessions);
      }
      const sessions = [...visits.values()].reduce((total, items) => total + items.size,0);
      return res.json({ counts, sessions, returns:sessions - visits.size, limitReached:events.length === 1000 });
    }
    if (action === 'history' && req.method === 'GET') {
      const id = req.query.id;
      if (!uuid.test(id || '')) return fail(400, 'Apresentação inválida.');
      const [row] = await rest(cfg, 'studio_presentations', { id: 'eq.' + id, owner, select: 'id' });
      if (!row) return fail(404, 'Apresentação indisponível.');
      return res.json(await rest(cfg, 'studio_presentation_versions', {
        presentation_id: 'eq.' + id, select: 'revision,published_at', order: 'revision.desc', limit: 100
      }));
    }
    if (action === 'preview' && req.method === 'POST') {
      const { presentation } = await import('../studio/model.mjs');
      let draft;
      try { draft = presentation(body.draft); } catch (error) { return fail(400, error.message); }
      const { renderExperience } = await import('../studio/render.mjs');
      return res.json({ html: renderExperience(draft) });
    }
    if ((action === 'publish' || action === 'unpublish' || action === 'revoke') && req.method === 'POST') {
      if (!uuid.test(body.id || '')) return fail(400, 'Apresentação inválida.');
      if (action === 'publish') {
        if (!Number.isSafeInteger(body.revision) || body.approved !== true) return fail(400, 'Aprove a versão antes de publicar.');
        const ok = await rest(cfg, 'rpc/studio_publish', {}, { method: 'POST', body: { p_owner: user.id, p_id: body.id, p_revision: body.revision } });
        if (!ok) return fail(409, 'A versão mudou ou está indisponível.');
      } else {
        const [row] = await rest(cfg, 'studio_presentations', { id: 'eq.' + body.id, owner, select:'id' },
          { method: 'PATCH', body: { published_revision: null, ...(action === 'revoke' ? { token: randomBytes(24).toString('hex') } : {}), updated_at: new Date().toISOString() } });
        if (!row) return fail(404, 'Apresentação indisponível.');
      }
      return res.json({ ok: true });
    }
    return fail(404, 'Operação indisponível.');
  } catch {
    return fail(502, 'Não foi possível concluir a operação.');
  }
}
