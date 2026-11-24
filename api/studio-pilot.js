import { pilot } from '../studio/pilot.mjs';
import { renderExperience } from '../studio/render.mjs';

export default function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.VERCEL_ENV === 'production' || req.method !== 'GET') return res.status(404).end();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).end(renderExperience(pilot));
}
