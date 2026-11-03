export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.VERCEL_GIT_COMMIT_REF !== 'orulo-media-recovery-v1') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { runRecovery } = await import('../scripts/orulo-media-recovery.mjs');
    const summary = await runRecovery({
      args: { states: ['SP'], limit: 50, write: false }
    });
    return res.status(200).json({
      ok: true,
      diagnostic: true,
      write: false,
      summary
    });
  } catch {
    return res.status(500).json({
      ok: false,
      diagnostic: true,
      write: false,
      summary: null
    });
  }
}
