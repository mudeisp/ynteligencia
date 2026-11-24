export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.VERCEL_ENV === 'production' || req.method !== 'GET') return res.status(404).end();
  if (req.query?.frame === 'mobile') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const source = req.query?.diagnostics === '1' ? '/studio/piloto?diagnostics=1' : '/studio/piloto';
    return res.status(200).end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yincorp Studio · Prévia mobile</title><link rel="stylesheet" href="/studio/studio.css"></head><body><header class="bar"><strong class="brand">YINCORP · PRÉVIA MOBILE</strong></header><iframe width="390" height="730" class="mobile-preview" style="display:block;width:min(100%,390px);height:70vh;margin:auto;border:1px solid #ded5c7" src="${source}" title="Atypik e Escape Eden em largura móvel"></iframe></body></html>`);
  }
  const [{ pilot }, { renderExperience }] = await Promise.all([
    import('../studio/pilot.mjs'), import('../studio/render.mjs')
  ]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const html = renderExperience(pilot);
  return res.status(200).end(req.query?.diagnostics === '1'
    ? html.replace('</footer>',' <output id="studio-diagnostics" hidden></output></footer>')
    : html);
}
