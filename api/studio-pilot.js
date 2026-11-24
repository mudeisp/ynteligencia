export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.VERCEL_ENV === 'production' || req.method !== 'GET') return res.status(404).end();
  if (req.query?.frame === 'mobile') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).end('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yincorp Studio · Prévia mobile</title><link rel="stylesheet" href="/studio/studio.css"></head><body><header class="bar"><strong class="brand">YINCORP · PRÉVIA MOBILE</strong></header><iframe class="mobile-preview" src="/studio/piloto" title="Atypik e Escape Eden em largura móvel"></iframe></body></html>');
  }
  const [{ pilot }, { renderExperience }] = await Promise.all([
    import('../studio/pilot.mjs'), import('../studio/render.mjs')
  ]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).end(renderExperience(pilot));
}
