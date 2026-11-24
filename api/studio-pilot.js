export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.VERCEL_ENV === 'production' || req.method !== 'GET') return res.status(404).end();
  const [{ pilot }, { renderExperience }] = await Promise.all([
    import('../studio/pilot.mjs'), import('../studio/render.mjs')
  ]);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).end(renderExperience(pilot));
}
