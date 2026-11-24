import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matrix, presentation } from './model.mjs';
import { pilot } from './pilot.mjs';
import { renderExperience } from './render.mjs';
import handler from '../api/studio.js';

test('publishing projection keeps only reviewed fields explicitly selected by the operator', () => {
  const data = presentation({
    title: '<script>alert(1)</script>', phone: 'private-phone', notes: 'private-notes',
    properties: [{ id: '123', name: 'Teste', images: [{ url: 'javascript:alert(1)' }],
      facts: [{ key: 'lazer', value: 'Piscina', source: '' }], privateField: 'private' }]
  });
  const html = renderExperience(data);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /private-phone|private-notes|javascript:|Piscina/);
  assert.match(html, /Informação a confirmar/);
});

test('comparisons require distinct properties and preserve editorial chapter order', () => {
  const property = { id: '123', name: 'Teste' };
  assert.throws(() => presentation({ comparison: true, properties: [property] }));
  assert.throws(() => presentation({ properties: [property, property] }));
  const result = presentation({ ...pilot, chapters: ['plantas', 'plantas', 'privacidade'] });
  assert.deepEqual(matrix(result).map(row => row.key), ['plantas', 'privacidade']);
});

test('pilot uses the common renderer and generic metadata', () => {
  const html = renderExperience(pilot);
  assert.match(html, /Mariana/);
  assert.match(html, /201 m²/);
  assert.match(html, /94 m²/);
  assert.match(html, /noindex,nofollow/);
  assert.match(html, /atypik-16.webp/);
  assert.doesNotMatch(html, /<meta[^>]+Mariana/);
});

test('administrative requests are rejected before any database access without a token', async () => {
  const overrides = {
    STUDIO_ENABLED: 'true', STUDIO_SUPABASE_URL: 'https://example.invalid',
    STUDIO_SUPABASE_SERVICE_KEY: 'example', STUDIO_SUPABASE_ANON_KEY: 'example'
  };
  const old = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
  try {
    await handler({ method: 'GET', headers: {}, query: { action: 'clients' } }, response);
    assert.equal(response.code, 401);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
