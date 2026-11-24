import { randomBytes } from 'node:crypto';
import { presentation } from '../studio/model.mjs';
import { renderExperience } from '../studio/render.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[a-f0-9]{48}$/;
const fields = ['treatment', 'phone', 'email', 'city', 'neighborhoods', 'minBudget', 'maxBudget',
  'purpose', 'family', 'area', 'bedrooms', 'suites', 'parking', 'timing', 'architecture', 'leisure',
  'needs', 'notes', 'instructions'];

function config() {
  if (process.env.STUDIO_ENABLED !== 'true') return null;
  const url = process.env.STUDIO_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.STUDIO_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.STUDIO_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  return url && key && anon ? { url, key, anon } : null;
}

async function request(cfg, path, { method = 'GET', body, auth, privileged = false } = {}) {
  const key = privileged ? cfg.key : cfg.anon;
  const response = await fetch(new URL(path, cfg.url), {
    method, headers: { apikey: key, ...(auth ? { Authorization: auth } : {}),
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
    { ...options, privileged: true, auth: cfg.key.startsWith('eyJ') ? 'Bearer ' + cfg.key : undefined });
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
    if (action === 'experience' && req.method === 'GET') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (!tokenPattern.test(token || '')) return fail(404, 'Apresentação indisponível.');
      const [page] = await rest(cfg, 'studio_presentations', {
        token: 'eq.' + token, published_revision: 'not.is.null', select: 'id,published_revision,expires_at'
      });
      if (!page || (page.expires_at && Date.parse(page.expires_at) <= Date.now())) return fail(404, 'Apresentação indisponível.');
      const [version] = await rest(cfg, 'studio_presentation_versions', {
        presentation_id: 'eq.' + page.id, revision: 'eq.' + page.published_revision, select: 'content'
      });
      if (!version) return fail(404, 'Apresentação indisponível.');
      return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').end(renderExperience(version.content));
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
    const owner = 'eq.' + user.id;
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
      return res.json(await rest(cfg, 'studio_presentations', { owner, order: 'updated_at.desc', limit: 100 }));
    }
    if (action === 'presentations' && req.method === 'POST') {
      let draft;
      try { draft = presentation(body.draft); } catch (error) { return fail(400, error.message); }
      if (body.id) {
        if (!uuid.test(body.id) || !Number.isSafeInteger(body.revision)) return fail(400, 'Versão inválida.');
        const [row] = await rest(cfg, 'studio_presentations', { id: 'eq.' + body.id, owner, revision: 'eq.' + body.revision },
          { method: 'PATCH', body: { draft, revision: body.revision + 1, updated_at: new Date().toISOString() } });
        return row ? res.json(row) : fail(409, 'A apresentação foi atualizada. Reabra para editar.');
      }
      if (!uuid.test(body.clientId || '')) return fail(400, 'Selecione um cliente.');
      const [client] = await rest(cfg, 'studio_clients', { id: 'eq.' + body.clientId, owner, select: 'id' });
      if (!client) return fail(404, 'Cliente indisponível.');
      const [row] = await rest(cfg, 'studio_presentations', {}, { method: 'POST',
        body: { client_id: client.id, owner: user.id, token: randomBytes(24).toString('hex'), draft } });
      return res.status(201).json(row);
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
      let draft;
      try { draft = presentation(body.draft); } catch (error) { return fail(400, error.message); }
      return res.json({ html: renderExperience(draft) });
    }
    if ((action === 'publish' || action === 'unpublish') && req.method === 'POST') {
      if (!uuid.test(body.id || '')) return fail(400, 'Apresentação inválida.');
      if (action === 'publish') {
        if (!Number.isSafeInteger(body.revision) || body.approved !== true) return fail(400, 'Aprove a versão antes de publicar.');
        const ok = await rest(cfg, 'rpc/studio_publish', {}, { method: 'POST', body: { p_owner: user.id, p_id: body.id, p_revision: body.revision } });
        if (!ok) return fail(409, 'A versão mudou ou está indisponível.');
      } else {
        const [row] = await rest(cfg, 'studio_presentations', { id: 'eq.' + body.id, owner },
          { method: 'PATCH', body: { published_revision: null, updated_at: new Date().toISOString() } });
        if (!row) return fail(404, 'Apresentação indisponível.');
      }
      return res.json({ ok: true });
    }
    return fail(404, 'Operação indisponível.');
  } catch {
    return fail(502, 'Não foi possível concluir a operação.');
  }
}
