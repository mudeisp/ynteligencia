import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOruloFloorPlans, mergeFloorPlans } from './orulo-floor-plans.js';

test('fetchOruloFloorPlans requests official endpoint and normalizes best image', async () => {
  let requestedUrl = '';
  const plans = await fetchOruloFloorPlans(66878, { Authorization: 'Bearer test' }, {
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            floor_plans: [
              {
                id: 1,
                description: 'Planta teste',
                '520x280': 'https://cdn.example/520.jpg',
                '1024x1024': 'https://cdn.example/1024.jpg',
                '2280x1800': 'https://cdn.example/2280.jpg'
              }
            ]
          };
        }
      };
    }
  });

  assert.match(requestedUrl, /\/api\/v2\/buildings\/66878\/floor_plans\?/);
  assert.match(requestedUrl, /dimensions%5B%5D=520x280/);
  assert.match(requestedUrl, /dimensions%5B%5D=1024x1024/);
  assert.match(requestedUrl, /dimensions%5B%5D=2280x1800/);
  assert.equal(plans[0].image_url, 'https://cdn.example/2280.jpg');
  assert.deepEqual(plans[0].images, [
    'https://cdn.example/2280.jpg',
    'https://cdn.example/1024.jpg',
    'https://cdn.example/520.jpg'
  ]);
});

test('mergeFloorPlans enriches existing records without losing descriptions', () => {
  const merged = mergeFloorPlans(
    [{ id: 10, description: 'Planta 01', type: 'Área condominial' }],
    [{ id: 10, image_url: 'https://cdn.example/planta.jpg', '1024x1024': 'https://cdn.example/planta.jpg' }]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].description, 'Planta 01');
  assert.equal(merged[0].image_url, 'https://cdn.example/planta.jpg');
});
